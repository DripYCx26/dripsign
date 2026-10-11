// The private staff assistant. Spend is reserved against the tenant's daily limit before the job
// exists; suggestions apply to the draft only while it still has the source they were based on.
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.ts";
import type { Db } from "../db.ts";
import { DomainError, notFound } from "../errors.ts";
import { enqueue } from "../jobs/outbox.ts";
import { aiSuggestionResultSchema } from "../schema.ts";
import type { AiSuggestionResult, CommandOf, DocumentSource } from "../schema.ts";
import { canonicalSha256 } from "./receipts.ts";
import { stageDraft } from "./revisions.ts";
import { conflict } from "./state.ts";
import type { CommandContext } from "./state.ts";

/**
 * Reserved per request: an upper bound for one call (a 500 KB source is about 150k input tokens
 * plus 8k output tokens at Sonnet prices). The actual cost replaces it when the call finishes.
 */
export const AI_RESERVATION_MICROS = 1_000_000;

export interface SuggestionInput {
  readonly source: DocumentSource;
  readonly instruction: string;
  readonly proposalText?: string;
}

export async function askAi(ctx: CommandContext, command: CommandOf<"ask_ai">): Promise<void> {
  const { db, agreement, actor } = ctx;
  const ai = loadConfig().ai;
  const source = agreement.draft.source;
  if (ai === null || source === null) throw conflict();
  if (command.proposalId !== undefined) await requireProposal(ctx, command.proposalId);
  // One lock per tenant serialises reservations, so concurrent requests cannot overspend.
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `dripsign.ai-spend:${agreement.tenantId}`,
  ]);
  const spent = await db.query<{ micros: string }>(
    `SELECT coalesce(sum(coalesce(cost_micros, reserved_micros)), 0)::text AS micros
     FROM dripsign.ai_suggestion
     WHERE tenant_id = $1 AND day = (now() AT TIME ZONE 'UTC')::date`,
    [agreement.tenantId],
  );
  const limit = Math.floor(ai.dailyLimitUsd * 1_000_000);
  if (Number(spent.rows[0]?.micros ?? 0) + AI_RESERVATION_MICROS > limit) {
    throw new DomainError("rate_limited", "Today’s assistant limit is reached.");
  }
  const suggestionId = randomUUID();
  await db.query(
    `INSERT INTO dripsign.ai_suggestion (
       tenant_id, agreement_id, id, requested_by, instruction, proposal_id, base_source,
       base_source_sha256, model, reserved_micros
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      agreement.tenantId,
      agreement.id,
      suggestionId,
      actor.email,
      command.instruction,
      command.proposalId ?? null,
      JSON.stringify(source),
      canonicalSha256(source),
      ai.model,
      AI_RESERVATION_MICROS,
    ],
  );
  await enqueue(db, {
    tenantId: agreement.tenantId,
    agreementId: agreement.id,
    dedupeKey: `ai_suggest:${suggestionId}`,
    payload: { kind: "ai_suggest", suggestionId },
  });
}

async function requireProposal(ctx: CommandContext, proposalId: string): Promise<void> {
  const found = await ctx.db.query(
    "SELECT 1 FROM dripsign.proposal WHERE tenant_id = $1 AND agreement_id = $2 AND id = $3",
    [ctx.agreement.tenantId, ctx.agreement.id, proposalId],
  );
  if (found.rowCount !== 1) throw notFound();
}

export async function applyAi(ctx: CommandContext, command: CommandOf<"apply_ai">): Promise<void> {
  const { db, agreement, state } = ctx;
  const found = await db.query<{ baseSourceSha256: string; result: AiSuggestionResult }>(
    `SELECT base_source_sha256 AS "baseSourceSha256", result FROM dripsign.ai_suggestion
     WHERE tenant_id = $1 AND agreement_id = $2 AND id = $3 AND status = 'ready'
     FOR UPDATE`,
    [agreement.tenantId, agreement.id, command.suggestionId],
  );
  const suggestion = found.rows[0];
  if (suggestion === undefined) throw conflict("This suggestion is no longer available.");
  const source = agreement.draft.source;
  if (source === null || canonicalSha256(source) !== suggestion.baseSourceSha256) {
    throw conflict("The draft changed after this suggestion was prepared. Ask again.");
  }
  await stageDraft(db, agreement, {
    content: { source: suggestion.result.source, upload: null },
    signers: state.signers,
    dirty: true,
  });
  await db.query(
    `UPDATE dripsign.ai_suggestion SET status = 'applied', applied_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [agreement.tenantId, command.suggestionId],
  );
}

/** Worker seam: the provider input of a queued suggestion; null once it has finished. */
export async function loadSuggestionInput(
  db: Db,
  input: { readonly tenantId: string; readonly suggestionId: string },
): Promise<SuggestionInput | null> {
  const found = await db.query<{
    source: DocumentSource;
    instruction: string;
    proposalText: string | null;
  }>(
    `SELECT i.base_source AS source, i.instruction, p.text AS "proposalText"
     FROM dripsign.ai_suggestion i
     LEFT JOIN dripsign.proposal p
       ON p.tenant_id = i.tenant_id AND p.agreement_id = i.agreement_id AND p.id = i.proposal_id
     WHERE i.tenant_id = $1 AND i.id = $2 AND i.status = 'queued'`,
    [input.tenantId, input.suggestionId],
  );
  const row = found.rows[0];
  if (row === undefined) return null;
  const { source, instruction, proposalText } = row;
  return proposalText === null ? { source, instruction } : { source, instruction, proposalText };
}

/** Worker seam: stores the result and the actual cost. False when the suggestion already ended. */
export async function completeSuggestion(
  db: Db,
  input: {
    readonly tenantId: string;
    readonly suggestionId: string;
    readonly result: AiSuggestionResult;
    readonly costMicros: number;
  },
): Promise<boolean> {
  const result = aiSuggestionResultSchema.parse(input.result);
  if (!Number.isSafeInteger(input.costMicros) || input.costMicros < 0) {
    throw new DomainError("invalid", "The assistant cost is invalid.");
  }
  const updated = await db.query(
    `UPDATE dripsign.ai_suggestion
     SET status = 'ready', result = $3, cost_micros = $4, finished_at = now()
     WHERE tenant_id = $1 AND id = $2 AND status = 'queued'`,
    [input.tenantId, input.suggestionId, JSON.stringify(result), input.costMicros],
  );
  return updated.rowCount === 1;
}

/**
 * Worker seam: fails a queued suggestion. Spend is released only when the provider was never
 * called; otherwise the reservation stands, because the call may have been billed.
 */
export async function failSuggestion(
  db: Db,
  input: {
    readonly tenantId: string;
    readonly suggestionId: string;
    readonly code: string;
    readonly providerCalled: boolean;
  },
): Promise<boolean> {
  const updated = await db.query(
    `UPDATE dripsign.ai_suggestion
     SET status = 'failed', error = left($3, 2000), finished_at = now(),
         cost_micros = CASE WHEN $4 THEN reserved_micros ELSE 0 END
     WHERE tenant_id = $1 AND id = $2 AND status = 'queued'`,
    [input.tenantId, input.suggestionId, input.code, input.providerCalled],
  );
  return updated.rowCount === 1;
}
