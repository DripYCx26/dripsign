// The private draft, its PDF preparation (fenced on input and signer set) and publication of
// immutable revisions.
import { randomUUID } from "node:crypto";
import { objectKey } from "../adapters/storage.ts";
import type { StoredObject } from "../adapters/storage.ts";
import type { Db } from "../db.ts";
import { DomainError } from "../errors.ts";
import { enqueue } from "../jobs/outbox.ts";
import { draftSchema, LIMITS, signingFieldSchema } from "../schema.ts";
import type {
  CommandOf,
  DocumentSource,
  Draft,
  PreparationStatus,
  SigningField,
  UploadAsset,
} from "../schema.ts";
import { liveRecipients, markInvited, notify } from "./notify.ts";
import { canonicalSha256 } from "./receipts.ts";
import { AGREEMENT_COLUMNS, conflict, liveSigners, withinTx } from "./state.ts";
import type { AgreementRow, CommandContext, LiveSigner } from "./state.ts";

/** What a `pdf_prepare` commit must still match: the job payload carries the same pair. */
export interface PreparationFence {
  readonly inputSha256: string;
  readonly signerSetHash: string;
}

export interface DraftContent {
  readonly source: DocumentSource | null;
  readonly upload: UploadAsset | null;
}

export interface PreparedDraft {
  readonly tenantId: string;
  readonly agreementId: string;
  readonly fence: PreparationFence;
  readonly document: StoredObject;
  readonly pageCount: number;
  readonly fields: readonly SigningField[];
}

export interface FailedPreparation {
  readonly tenantId: string;
  readonly agreementId: string;
  readonly fence: PreparationFence;
  readonly code: string;
}

const PDF_MAGIC = "%PDF-";
const PREPARATION_ERROR_LENGTH = 500;

/** A draft with no terms, PDF or signers yet. */
export const EMPTY_DRAFT: Draft = {
  source: null,
  upload: null,
  document: null,
  signingFields: [],
  signerIds: [],
  preparation: { status: "empty", error: null, inputSha256: null, signerSetHash: null },
};

export function signerSetHash(signers: readonly LiveSigner[]): string {
  return canonicalSha256(signers.map(({ id, name, email }) => ({ id, name, email })));
}

interface DraftInput {
  /** The renderer prints the agreement title, so it is part of the prepared input. */
  readonly title: string;
  readonly content: DraftContent;
  readonly signers: readonly LiveSigner[];
}

/**
 * The draft after a title, content or signer change, and the fence to enqueue (null when nothing
 * needs preparing). An unchanged fence that is ready or preparing keeps the prepared document.
 */
function nextDraft(
  current: Draft | null,
  input: DraftInput,
): { readonly draft: Draft; readonly fence: PreparationFence | null } {
  const { title, content, signers } = input;
  const signerIds = signers.map((signer) => signer.id);
  const inputSha256 =
    content.source === null && content.upload === null
      ? null
      : canonicalSha256({ title, source: content.source, upload: content.upload?.sha256 ?? null });
  if (inputSha256 === null) return { draft: { ...EMPTY_DRAFT, signerIds }, fence: null };
  const fence = { inputSha256, signerSetHash: signerSetHash(signers) };
  const prior = current?.preparation;
  const live: readonly PreparationStatus[] = ["ready", "preparing"];
  if (
    current !== null &&
    prior?.inputSha256 === fence.inputSha256 &&
    prior.signerSetHash === fence.signerSetHash &&
    live.includes(prior.status)
  ) {
    return { draft: { ...current, ...content }, fence: null };
  }
  const preparation = { status: "preparing", error: null, ...fence } as const;
  return { draft: { ...EMPTY_DRAFT, ...content, signerIds, preparation }, fence };
}

async function enqueuePreparation(
  db: Db,
  agreement: { readonly tenantId: string; readonly id: string },
  fence: PreparationFence,
): Promise<void> {
  // No dedupe key: returning to earlier content must prepare again; stale jobs miss the fence.
  await enqueue(db, {
    tenantId: agreement.tenantId,
    agreementId: agreement.id,
    dedupeKey: null,
    payload: { kind: "pdf_prepare", ...fence },
  });
}

async function writeDraft(
  db: Db,
  agreement: AgreementRow,
  draft: Draft,
  dirty: boolean,
): Promise<void> {
  await db.query(
    `UPDATE dripsign.agreement
     SET draft = $3, draft_dirty = draft_dirty OR $4, updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [agreement.tenantId, agreement.id, JSON.stringify(draftSchema.parse(draft)), dirty],
  );
}

/** Writes the next draft and enqueues preparation when its fence moved. */
export async function stageDraft(
  db: Db,
  agreement: AgreementRow,
  change: {
    readonly title?: string;
    readonly content: DraftContent;
    readonly signers: readonly LiveSigner[];
    readonly dirty: boolean;
  },
): Promise<void> {
  const { draft, fence } = nextDraft(agreement.draft, {
    title: change.title ?? agreement.title,
    content: change.content,
    signers: change.signers,
  });
  await writeDraft(db, agreement, draft, change.dirty);
  if (fence !== null) await enqueuePreparation(db, agreement, fence);
}

/**
 * Required signers are part of the prepared PDF: after a signer change in this transaction, the
 * draft re-prepares for the live signers and needs publishing.
 */
export async function restageForSigners(db: Db, agreement: AgreementRow): Promise<void> {
  const { source, upload } = agreement.draft;
  const signers = await liveSigners(db, agreement.tenantId, agreement.id);
  await stageDraft(db, agreement, { content: { source, upload }, signers, dirty: true });
}

/** New terms replace the draft's content; a title-only save keeps its terms or uploaded PDF. */
export async function saveDraft(
  ctx: CommandContext,
  command: CommandOf<"save_draft">,
): Promise<void> {
  const { db, agreement } = ctx;
  const { source, upload } = agreement.draft;
  const content =
    command.source === undefined ? { source, upload } : { source: command.source, upload: null };
  const title = command.title ?? agreement.title;
  if (title !== agreement.title) {
    await db.query("UPDATE dripsign.agreement SET title = $3 WHERE tenant_id = $1 AND id = $2", [
      agreement.tenantId,
      agreement.id,
      title,
    ]);
  }
  await stageDraft(db, agreement, { title, content, signers: ctx.state.signers, dirty: true });
}

export function retryPreparation(ctx: CommandContext): Promise<void> {
  const { source, upload } = ctx.agreement.draft;
  return stageDraft(ctx.db, ctx.agreement, {
    content: { source, upload },
    signers: ctx.state.signers,
    dirty: false,
  });
}

/** Envelope only: the bytes are parsed by the worker, never here. */
export function assertPdfEnvelope(bytes: Uint8Array): void {
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, PDF_MAGIC.length));
  if (bytes.byteLength === 0 || bytes.byteLength > LIMITS.pdfBytes || header !== PDF_MAGIC) {
    throw new DomainError("invalid", "Upload a PDF of at most 10 MB.");
  }
}

export function stageUpload(ctx: CommandContext, upload: StoredObject): Promise<void> {
  return stageDraft(ctx.db, ctx.agreement, {
    content: { source: null, upload: { sha256: upload.sha256, byteLength: upload.byteLength } },
    signers: ctx.state.signers,
    dirty: true,
  });
}

/** Creates the immutable revision the staff member reviewed, freezing the live required signers. */
export async function publish(ctx: CommandContext, command: CommandOf<"publish">): Promise<void> {
  const { db, agreement, state, actor } = ctx;
  const { document, source, upload, signingFields, preparation } = agreement.draft;
  if (document?.sha256 !== command.reviewedSha256) {
    throw conflict("The draft changed after you reviewed it. Review it again before publishing.");
  }
  // The reviewed PDF was prepared for exactly the live signers, in the one signer order.
  if (signerSetHash(state.signers) !== preparation.signerSetHash) throw conflict();
  const revisionId = randomUUID();
  await db.query(
    `INSERT INTO dripsign.revision (
       tenant_id, agreement_id, id, number, document_sha256, document_bytes, page_count,
       upload_sha256, source, signing_fields, signer_ids, published_by
     )
     SELECT $1, $2, $3, coalesce(max(number), 0) + 1, $4, $5, $6, $7, $8, $9, $10, $11
     FROM dripsign.revision WHERE tenant_id = $1 AND agreement_id = $2`,
    [
      agreement.tenantId,
      agreement.id,
      revisionId,
      document.sha256,
      document.byteLength,
      document.pageCount,
      upload?.sha256 ?? null,
      source === null ? null : JSON.stringify(source),
      JSON.stringify(signingFields),
      state.signers.map((signer) => signer.id),
      actor.email,
    ],
  );
  await db.query(
    `UPDATE dripsign.agreement
     SET current_revision_id = $3, status = 'negotiating', draft_dirty = false
     WHERE tenant_id = $1 AND id = $2`,
    [agreement.tenantId, agreement.id, revisionId],
  );
  const recipients = await liveRecipients(db, agreement.tenantId, agreement.id);
  const first = agreement.status === "draft";
  await notify(db, {
    agreement,
    template: first ? "invite" : "revision_published",
    to: recipients,
    resourceId: revisionId,
  });
  if (first) {
    await markInvited(
      db,
      agreement.tenantId,
      recipients.map((recipient) => recipient.id),
    );
  }
}

/** Worker seam: commits a prepared PDF if the draft still expects it. False when stale. */
export async function applyPreparedDraft(db: Db, prepared: PreparedDraft): Promise<boolean> {
  const { tenantId, agreementId, fence, document } = prepared;
  if (document.key !== objectKey(tenantId, document.sha256)) {
    throw new DomainError("invalid", "The prepared document belongs to another tenant.");
  }
  return withinTx(db, async (tx) => {
    const agreement = await lockForWorker(tx, tenantId, agreementId);
    if (agreement === null || !expects(agreement.draft, fence)) return false;
    const fields = assertFieldsCoverSigners(prepared.fields, agreement.draft.signerIds);
    const draft: Draft = {
      ...agreement.draft,
      document: {
        sha256: document.sha256,
        byteLength: document.byteLength,
        pageCount: prepared.pageCount,
      },
      signingFields: fields,
      preparation: { ...agreement.draft.preparation, status: "ready", error: null },
    };
    await writeDraft(tx, agreement, draft, false);
    return true;
  });
}

/** Worker seam: records a final preparation failure if the draft still expects that job. */
export async function failPreparation(db: Db, failed: FailedPreparation): Promise<boolean> {
  return withinTx(db, async (tx) => {
    const agreement = await lockForWorker(tx, failed.tenantId, failed.agreementId);
    if (agreement === null || !expects(agreement.draft, failed.fence)) return false;
    const error = failed.code.slice(0, PREPARATION_ERROR_LENGTH);
    const preparation = { ...agreement.draft.preparation, status: "failed", error } as const;
    await writeDraft(tx, agreement, { ...agreement.draft, preparation }, false);
    return true;
  });
}

function expects(draft: Draft, fence: PreparationFence): boolean {
  const { status, inputSha256, signerSetHash: signers } = draft.preparation;
  return (
    status === "preparing" && inputSha256 === fence.inputSha256 && signers === fence.signerSetHash
  );
}

async function lockForWorker(
  db: Db,
  tenantId: string,
  agreementId: string,
): Promise<AgreementRow | null> {
  const locked = await db.query<AgreementRow>(
    `SELECT ${AGREEMENT_COLUMNS} FROM dripsign.agreement
     WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
    [tenantId, agreementId],
  );
  return locked.rows[0] ?? null;
}

/** Every required signer needs a signature field, and fields name only those signers. */
function assertFieldsCoverSigners(
  fields: readonly SigningField[],
  signerIds: readonly string[],
): SigningField[] {
  const parsed = fields.map((field) => signingFieldSchema.parse(field));
  const signers = new Set(signerIds);
  const signed = new Set(
    parsed.filter((field) => field.type === "signature").map((field) => field.recipientId),
  );
  if (parsed.some((field) => !signers.has(field.recipientId)) || signed.size !== signers.size) {
    throw new DomainError("invalid", "The prepared signing fields do not match the signers.");
  }
  return parsed;
}
