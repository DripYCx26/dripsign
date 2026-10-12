import type { Db } from "../db.ts";
import { getPool, readTx } from "../db.ts";
import { DomainError } from "../errors.ts";
import { draftSchema } from "../schema.ts";
import type { JobKind } from "../schema.ts";
import { suggestEdits } from "../adapters/anthropic.ts";
import { retryableDelivery, sendEmail } from "../adapters/email.ts";
import { getStorage, readBytes, storeBytes } from "../adapters/storage.ts";
import type { StorageDriver } from "../adapters/storage.ts";
import { loadSuggestionInput, completeSuggestion, failSuggestion } from "../domain/ai.ts";
import {
  applyPreparedDraft,
  failPreparation,
  nextRevisionNumber,
  preparationInputSha256,
} from "../domain/revisions.ts";
import { loadArchiveEvidence, completeArchive } from "../domain/signing.ts";
import { liveSigners } from "../domain/state.ts";
import { prepareDraftPdf } from "../pdf/prepare.ts";
import { renderAuditRecord, renderSignedPdf } from "../pdf/archive.ts";
import { scrubEmailParams } from "./outbox.ts";
import type { ClaimedJob, JobOf } from "./outbox.ts";
import { renderMail } from "./mail.ts";

/** Absent `retryable` means no failure is retried within the kind's attempts. */
export interface HandlerDefinition {
  readonly handler: (job: ClaimedJob, signal: AbortSignal) => Promise<void>;
  readonly retryable?: (error: unknown) => boolean;
  readonly onFinalFailure?: (
    db: Db,
    job: ClaimedJob,
    code: string,
    error?: unknown,
  ) => Promise<void>;
}

function tenant(job: ClaimedJob): string {
  if (!job.tenantId) throw new Error("Job tenant is missing");
  return job.tenantId;
}

/** The sentence of terms the renderer refused as invalid; null for any other failure. */
function refusal(error: unknown): string | null {
  return error instanceof DomainError && error.code === "invalid" ? error.message : null;
}

function preparationFence(job: JobOf<"pdf_prepare">) {
  return { inputSha256: job.payload.inputSha256, signerSetHash: job.payload.signerSetHash };
}

async function prepare(
  job: JobOf<"pdf_prepare">,
  storage: StorageDriver,
  signal: AbortSignal,
): Promise<void> {
  const tenantId = tenant(job);
  if (!job.agreementId) throw new Error("Preparation agreement is missing");
  const agreementId = job.agreementId;
  const input = await readTx(async (db) => {
    // The fence need not cover the organisation: a tenant's name never changes.
    const result = await db.query<{ draft: unknown; organisation: string }>(
      `SELECT a.draft, t.name AS organisation
       FROM dripsign.agreement a JOIN dripsign.tenant t ON t.id = a.tenant_id
       WHERE a.tenant_id = $1 AND a.id = $2`,
      [tenantId, agreementId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const { source, preparation } = draftSchema.parse(row.draft);
    if (
      preparation.inputSha256 !== job.payload.inputSha256 ||
      preparation.signerSetHash !== job.payload.signerSetHash
    )
      return null;
    // Only publish adds a revision, and it needs this preparation ready: a mismatch is a bug.
    const revision = await nextRevisionNumber(db, tenantId, agreementId);
    if (preparationInputSha256(source, revision) !== preparation.inputSha256)
      throw new Error("Preparation revision number is stale");
    // The domain's one signer order, the order the draft's signer-set hash was taken in.
    const signers = await liveSigners(db, tenantId, agreementId);
    return { source, signers, revision, organisation: row.organisation };
  });
  if (!input) return;
  signal.throwIfAborted();
  const prepared = await prepareDraftPdf(input);
  signal.throwIfAborted();
  const document = await storeBytes(tenantId, prepared.bytes, storage);
  await applyPreparedDraft(getPool(), {
    tenantId,
    agreementId,
    fence: preparationFence(job),
    document,
    fields: prepared.fields,
    pageCount: prepared.pageCount,
  });
}

async function archive(
  job: JobOf<"archive">,
  storage: StorageDriver,
  signal: AbortSignal,
): Promise<void> {
  const tenantId = tenant(job);
  const evidence = await loadArchiveEvidence(getPool(), { tenantId, roundId: job.payload.roundId });
  if (!evidence) return;
  const revisionBytes = await readBytes(evidence.revision.document, storage);
  signal.throwIfAborted();
  const signedBytes = await renderSignedPdf(evidence, revisionBytes);
  const auditBytes = await renderAuditRecord(evidence);
  signal.throwIfAborted();
  const signedDocument = await storeBytes(tenantId, signedBytes, storage);
  const auditRecord = await storeBytes(tenantId, auditBytes, storage);
  signal.throwIfAborted();
  const outcome = await completeArchive(getPool(), {
    tenantId,
    roundId: job.payload.roundId,
    leaseFence: { id: job.id, leaseToken: job.leaseToken },
    signedDocument,
    auditRecord,
  });
  if (outcome === "lease_lost")
    console.error("dripsign: archive lease lost", { id: job.id, code: outcome });
}

async function ai(job: JobOf<"ai_suggest">, signal: AbortSignal): Promise<void> {
  const tenantId = tenant(job);
  const suggestionId = job.payload.suggestionId;
  let providerCalled = false;
  try {
    const input = await loadSuggestionInput(getPool(), { tenantId, suggestionId });
    if (!input) return;
    signal.throwIfAborted();
    const { costMicros, ...result } = await suggestEdits(input, signal, () => {
      providerCalled = true;
    });
    await completeSuggestion(getPool(), { tenantId, suggestionId, result, costMicros });
  } catch (error: unknown) {
    throw Object.assign(new Error("AI suggestion failed", { cause: error }), { providerCalled });
  }
}

export function createHandlers(storage = getStorage()): Record<JobKind, HandlerDefinition> {
  return {
    email: {
      retryable: retryableDelivery,
      onFinalFailure: async (db, job) => {
        await scrubEmailParams(db, job);
      },
      handler: async (job, signal) => {
        if (job.payload.kind === "email")
          await sendEmail(renderMail({ ...job.payload, agreementId: job.agreementId }), signal);
      },
    },
    pdf_prepare: {
      retryable: (error) => refusal(error) === null,
      handler: async (job, signal) => {
        if (job.payload.kind === "pdf_prepare")
          await prepare({ ...job, payload: job.payload }, storage, signal);
      },
      onFinalFailure: async (db, job, _code, error) => {
        if (job.payload.kind === "pdf_prepare" && job.agreementId)
          await failPreparation(db, {
            tenantId: tenant(job),
            agreementId: job.agreementId,
            fence: preparationFence({ ...job, payload: job.payload }),
            reason: refusal(error) ?? "The PDF could not be prepared. Try again.",
          });
      },
    },
    // Archive has no attempt limit, so it never fails finally.
    archive: {
      handler: async (job, signal) => {
        if (job.payload.kind === "archive")
          await archive({ ...job, payload: job.payload }, storage, signal);
      },
    },
    ai_suggest: {
      handler: async (job, signal) => {
        if (job.payload.kind === "ai_suggest") await ai({ ...job, payload: job.payload }, signal);
      },
      onFinalFailure: async (db, job, code, error) => {
        if (job.payload.kind === "ai_suggest")
          await failSuggestion(db, {
            tenantId: tenant(job),
            suggestionId: job.payload.suggestionId,
            code,
            providerCalled: !(
              error instanceof Error &&
              "providerCalled" in error &&
              error.providerCalled === false
            ),
          });
      },
    },
  };
}
