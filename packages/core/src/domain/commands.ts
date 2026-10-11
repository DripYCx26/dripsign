// Every mutation runs here in one transaction: resolve access, take the receipt, lock (and fence)
// the agreement, recheck the grant and the policy, apply, enqueue effects.
import { storeBytes } from "../adapters/storage.ts";
import { tx } from "../db.ts";
import { assertRenderableName } from "../pdf/font.ts";
import { commandSchema, expectedVersionSchema, newAgreementInputSchema } from "../schema.ts";
import type { Command, CommandKind, CommandOf, NewAgreementInput } from "../schema.ts";
import type { Actor, AgreementAction, AgreementView, StaffActor } from "../types.ts";
import { applyAi, askAi } from "./ai.ts";
import { insertAgreement, voidAgreement } from "./agreements.ts";
import { accept, addMessage, counter, propose, reject } from "./proposals.ts";
import { withReceipt } from "./receipts.ts";
import { addRecipient, removeRecipient, resendInvite, setSigner } from "./recipients.ts";
import {
  assertPdfEnvelope,
  publish,
  retryPreparation,
  saveDraft,
  stageUpload,
} from "./revisions.ts";
import { cancelSignatures, requestSignatures, sign } from "./signing.ts";
import {
  lockAgreement,
  lockGrant,
  loadState,
  parseOrInvalid,
  requireAction,
  resolveAccess,
  touchAgreement,
} from "./state.ts";
import type { CommandContext } from "./state.ts";
import { loadAgreementView } from "./view.ts";

export interface UploadRequest {
  readonly expectedVersion: number;
  readonly bytes: Uint8Array;
}

type Handlers = {
  readonly [K in CommandKind]: (ctx: CommandContext, command: CommandOf<K>) => Promise<void>;
};

const HANDLERS: Handlers = {
  save_draft: saveDraft,
  publish,
  retry_preparation: retryPreparation,
  add_recipient: addRecipient,
  remove_recipient: removeRecipient,
  resend_invite: resendInvite,
  set_signer: setSigner,
  message: addMessage,
  propose,
  counter,
  accept,
  reject,
  request_signatures: requestSignatures,
  cancel_signatures: cancelSignatures,
  // A signature changes lifecycle state without a version fence, so it moves the version itself.
  sign: async (ctx, command) => {
    await sign(ctx, command);
    await touchAgreement(ctx.db, ctx.agreement, true);
  },
  void: voidAgreement,
  ask_ai: askAi,
  apply_ai: applyAi,
};

function dispatch<K extends CommandKind>(
  ctx: CommandContext,
  kind: K,
  command: CommandOf<K>,
): Promise<void> {
  return HANDLERS[kind](ctx, command);
}

interface LockedRun {
  readonly actor: Actor;
  readonly agreementId: string;
  readonly receiptKey: string;
  readonly operation: string;
  readonly payload: unknown;
  readonly expectedVersion: number | null;
  readonly action: AgreementAction;
}

/**
 * The transaction of every agreement command. A replay changes nothing, and both callers answer
 * with a fresh view load that resolves access again, so only a new command needs `lockGrant`.
 */
async function runLocked(run: LockedRun, apply: (ctx: CommandContext) => Promise<void>) {
  const { actor, agreementId } = run;
  await tx(async (db) => {
    const access = await resolveAccess(db, actor, agreementId);
    await withReceipt(
      db,
      {
        tenantId: access.tenantId,
        actorEmail: actor.email,
        key: run.receiptKey,
        operation: run.operation,
        capacity: actor.capacity,
        resourceId: agreementId,
        payload: run.payload,
      },
      async () => {
        const agreement = await lockAgreement(
          db,
          access.tenantId,
          agreementId,
          run.expectedVersion,
        );
        await lockGrant(db, actor, { tenantId: access.tenantId, agreementId });
        const state = await loadState(db, agreement, actor);
        requireAction(state, actor.capacity, run.action);
        await apply({ db, actor, access, agreement, state });
        return true;
      },
    );
  });
}

/**
 * Runs one command under its receipt: take the receipt, lock and fence the agreement, recheck the
 * grant and allowedActions, apply, enqueue effects. Capacity is `actor.capacity`.
 */
export async function executeCommand(
  actor: Actor,
  agreementId: string,
  receiptKey: string,
  command: Command,
): Promise<AgreementView> {
  const parsed = parseOrInvalid(commandSchema, command);
  // Font metrics load asynchronously, so the renderable check runs before the transaction.
  if (parsed.kind === "sign") await assertRenderableName(parsed.typedName);
  await runLocked(
    {
      actor,
      agreementId,
      receiptKey,
      operation: parsed.kind,
      payload: parsed,
      expectedVersion: "expectedVersion" in parsed ? parsed.expectedVersion : null,
      action: parsed.kind,
    },
    (ctx) => dispatch(ctx, parsed.kind, parsed),
  );
  return loadAgreementView(actor, agreementId);
}

/** Returns the new agreement id; a replayed key returns the original id. */
export async function createAgreement(
  actor: StaffActor,
  receiptKey: string,
  input: NewAgreementInput,
): Promise<string> {
  const parsed = parseOrInvalid(newAgreementInputSchema, input);
  const scope = { tenantId: actor.tenantId, agreementId: null };
  return tx(async (db) => {
    const created = await withReceipt(
      db,
      {
        tenantId: actor.tenantId,
        actorEmail: actor.email,
        key: receiptKey,
        operation: "create",
        capacity: "staff",
        resourceId: null,
        payload: parsed,
      },
      async () => {
        await lockGrant(db, actor, scope);
        return insertAgreement(db, actor, parsed);
      },
    );
    // The stored id is the whole answer, so a replay rechecks the grant after its receipt wait.
    if (created.replayed) await lockGrant(db, actor, scope);
    return created.value;
  });
}

/** Stores raw PDF bytes (envelope check only) and enqueues `pdf_prepare`; parsing is the worker's. */
export async function storeUpload(
  actor: StaffActor,
  agreementId: string,
  receiptKey: string,
  upload: UploadRequest,
): Promise<AgreementView> {
  const expectedVersion = parseOrInvalid(expectedVersionSchema, upload.expectedVersion);
  assertPdfEnvelope(upload.bytes);
  // Content-addressed under the actor's own tenant: a refused request leaves only a harmless orphan.
  const stored = await storeBytes(actor.tenantId, upload.bytes);
  await runLocked(
    {
      actor,
      agreementId,
      receiptKey,
      operation: "upload",
      payload: { expectedVersion, sha256: stored.sha256 },
      expectedVersion,
      action: "save_draft",
    },
    (ctx) => stageUpload(ctx, stored),
  );
  return loadAgreementView(actor, agreementId);
}
