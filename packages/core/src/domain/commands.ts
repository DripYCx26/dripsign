// Every mutation runs here: lock receipt, resolve live access, lock (and fence) the agreement,
// recheck the policy, apply, enqueue effects; all in one transaction.
import { storeBytes } from "../adapters/storage.ts";
import { tx } from "../db.ts";
import { notFound } from "../errors.ts";
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
        const state = await loadState(db, agreement, actor);
        requireAction(state, actor.capacity, run.action);
        await apply({ db, actor, access, agreement, state });
        return true;
      },
    );
  });
}

/**
 * Runs one command under its receipt: lock receipt, lock agreement, recheck allowedActions,
 * fence, apply, enqueue effects. Capacity is `actor.capacity`.
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
  return tx(async (db) => {
    const staff = await db.query(
      `SELECT 1 FROM dripsign.staff
       WHERE tenant_id = $1 AND email = $2 AND revoked_at IS NULL`,
      [actor.tenantId, actor.email],
    );
    if (staff.rowCount !== 1) throw notFound();
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
      () => insertAgreement(db, actor, parsed),
    );
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
