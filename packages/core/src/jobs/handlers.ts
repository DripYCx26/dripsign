import type { Db } from "../db.ts";
import { getPool, pgErrorCode, readTx } from "../db.ts";
import { DomainError } from "../errors.ts";
import { draftSchema } from "../schema.ts";
import type { JobKind } from "../schema.ts";
import { suggestEdits } from "../adapters/anthropic.ts";
import { RetryableDeliveryError, retryableDelivery, sendEmail } from "../adapters/email.ts";
import { getStorage, objectKey, readBytes, storeBytes } from "../adapters/storage.ts";
import type { StorageDriver } from "../adapters/storage.ts";
import { readBoundedJson } from "../adapters/http.ts";
import { loadSuggestionInput, completeSuggestion, failSuggestion } from "../domain/ai.ts";
import { loadCompletionExport, recordCompletionDelivery } from "../domain/completionExport.ts";
import { applyPreparedDraft, failPreparation } from "../domain/revisions.ts";
import { loadArchiveEvidence, completeArchive } from "../domain/signing.ts";
import { liveSigners } from "../domain/state.ts";
import { parseExecutedReceipt, prepareExecutedEvent } from "../host/event.ts";
import { prepareDraftPdf } from "../pdf/prepare.ts";
import { renderAuditRecord, renderSignedPdf } from "../pdf/archive.ts";
import { scrubEmailParams } from "./outbox.ts";
import type { ClaimedJob, JobOf } from "./outbox.ts";
import { renderMail } from "./mail.ts";

export interface HandlerDefinition {
  readonly handler: (job: ClaimedJob, signal: AbortSignal) => Promise<void>;
  readonly retryable: (error: unknown) => boolean;
  readonly onFinalFailure: (
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

/** The sentence of a PDF the worker refused as invalid; null for any other failure. */
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
    const result = await db.query<{ title: string; draft: unknown }>(
      "SELECT title, draft FROM dripsign.agreement WHERE tenant_id = $1 AND id = $2",
      [tenantId, agreementId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const draft = draftSchema.parse(row.draft);
    if (
      draft.preparation.inputSha256 !== job.payload.inputSha256 ||
      draft.preparation.signerSetHash !== job.payload.signerSetHash
    )
      return null;
    // The domain's one signer order, the order the draft's signer-set hash was taken in.
    const signers = await liveSigners(db, tenantId, agreementId);
    return { title: row.title, draft, signers };
  });
  if (!input) return;
  signal.throwIfAborted();
  const upload = input.draft.upload;
  const uploadBytes = upload
    ? await readBytes(
        {
          key: objectKey(tenantId, upload.sha256),
          sha256: upload.sha256,
          byteLength: upload.byteLength,
        },
        storage,
      )
    : undefined;
  const prepared = await prepareDraftPdf(
    {
      title: input.title,
      signers: input.signers,
      ...(input.draft.source ? { source: input.draft.source } : {}),
      ...(uploadBytes ? { uploadBytes } : {}),
    },
    signal,
  );
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

/** Dreach's receipt is four short fields. */
const RECEIPT_BYTES = 1024;

/** Delivered only once the host returns its receipt for exactly this body. */
async function hostEvent(job: JobOf<"host_event">, signal: AbortSignal): Promise<void> {
  const tenantId = tenant(job);
  const roundId = job.payload.roundId;
  const frozen = await loadCompletionExport(getPool(), { tenantId, roundId });
  if (frozen === null) throw new Error("Round has no completion export");
  const event = prepareExecutedEvent(frozen);
  const response = await fetch(event.url, {
    method: "POST",
    headers: event.headers,
    body: event.body,
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  }).catch((error: unknown) => {
    throw new RetryableDeliveryError({ cause: error });
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 408 || response.status === 429 || response.status >= 500)
      throw new RetryableDeliveryError();
    throw new Error("Host refused executed event");
  }
  const answer = await readBoundedJson(response, RECEIPT_BYTES).catch((error: unknown) => {
    throw new RetryableDeliveryError({ cause: error });
  });
  const receipt = parseExecutedReceipt(answer, event.body);
  if (receipt === null) throw new RetryableDeliveryError();
  await recordCompletionDelivery(getPool(), { tenantId, roundId, receipt });
}

function retryableHostEvent(error: unknown): boolean {
  if (retryableDelivery(error)) return true;
  // Transactions wrap busy/deadlock errors; inspect their bounded cause chain as well.
  for (let depth = 0; depth < 4 && error instanceof Error; depth++) {
    const code = pgErrorCode(error);
    if (code && /^(?:08|57|40)/u.test(code)) return true;
    error = error.cause;
  }
  return false;
}

export function createHandlers(storage = getStorage()): Record<JobKind, HandlerDefinition> {
  const none = async (): Promise<void> => {
    /* No domain effect needs a failure transition. */
  };
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
    archive: {
      retryable: () => true,
      onFinalFailure: none,
      handler: async (job, signal) => {
        if (job.payload.kind === "archive")
          await archive({ ...job, payload: job.payload }, storage, signal);
      },
    },
    ai_suggest: {
      retryable: () => false,
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
    host_event: {
      retryable: retryableHostEvent,
      onFinalFailure: none,
      handler: async (job, signal) => {
        if (job.payload.kind === "host_event")
          await hostEvent({ ...job, payload: job.payload }, signal);
      },
    },
  };
}
