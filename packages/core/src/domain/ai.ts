// The private staff assistant. Spend is reserved against the tenant's daily limit before the job
// exists; suggestions apply to the draft only while it still has the source they were based on.
import { randomUUID } from "node:crypto";
import { AI_MODEL, AI_RESERVATION_MICROS } from "../adapters/anthropic.ts";
import { loadConfig } from "../config.ts";
import type { Db } from "../db.ts";
import { DomainError } from "../errors.ts";
import { enqueue } from "../jobs/outbox.ts";
import { aiSuggestionResultSchema, LIMITS } from "../schema.ts";
import type { AiDraft, AiMode, AiSuggestionResult, CommandOf, DocumentSource } from "../schema.ts";
import { canonicalSha256 } from "./receipts.ts";
import { stageDraft } from "./revisions.ts";
import { conflict } from "./state.ts";
import type { CommandContext } from "./state.ts";

/** One earlier turn as the model sees it: the reply's summary and outline, never a full source. */
export interface SuggestionTurn {
  readonly instruction: string;
  readonly reply: string;
}

export interface SuggestionInput {
  readonly mode: AiMode;
  readonly source: DocumentSource;
  readonly instruction: string;
  readonly history: readonly SuggestionTurn[];
}

export async function askAi(ctx: CommandContext, command: CommandOf<"ask_ai">): Promise<void> {
  const { db, agreement, actor } = ctx;
  const ai = loadConfig().ai;
  const source = agreement.draft.source;
  if (ai === null) throw conflict();
  // The reply carries the whole revised source, so a longer one could never come back whole.
  if (new TextEncoder().encode(JSON.stringify(source)).length > LIMITS.aiSourceBytes) {
    throw new DomainError("invalid", "These terms are too long for the assistant.");
  }
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
  const reserved = AI_RESERVATION_MICROS[command.mode];
  if (Number(spent.rows[0]?.micros ?? 0) + reserved > limit) {
    throw new DomainError("rate_limited", "Today’s assistant limit is reached.");
  }
  const suggestionId = randomUUID();
  await db.query(
    `INSERT INTO dripsign.ai_suggestion (
       tenant_id, agreement_id, id, requested_by, instruction, mode, base_source,
       base_source_sha256, model, reserved_micros
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      agreement.tenantId,
      agreement.id,
      suggestionId,
      actor.email,
      command.instruction,
      command.mode,
      JSON.stringify(source),
      canonicalSha256(source),
      AI_MODEL,
      reserved,
    ],
  );
  await enqueue(db, {
    tenantId: agreement.tenantId,
    agreementId: agreement.id,
    dedupeKey: `ai_suggest:${suggestionId}`,
    payload: { kind: "ai_suggest", suggestionId },
  });
}

export async function applyAi(ctx: CommandContext, command: CommandOf<"apply_ai">): Promise<void> {
  const { db, agreement, state } = ctx;
  const found = await db.query<{ baseSourceSha256: string; result: AiDraft }>(
    `SELECT base_source_sha256 AS "baseSourceSha256", result FROM dripsign.ai_suggestion
     WHERE tenant_id = $1 AND agreement_id = $2 AND id = $3 AND status = 'ready'
       AND mode = 'draft'
     FOR UPDATE`,
    [agreement.tenantId, agreement.id, command.suggestionId],
  );
  const suggestion = found.rows[0];
  if (suggestion === undefined) throw conflict("This suggestion is no longer available.");
  if (canonicalSha256(agreement.draft.source) !== suggestion.baseSourceSha256) {
    throw conflict("The draft changed after this suggestion was prepared. Ask again.");
  }
  await stageDraft(db, agreement, {
    source: suggestion.result.source,
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
    mode: AiMode;
    source: DocumentSource;
    instruction: string;
    history: { instruction: string; result: AiSuggestionResult }[];
  }>(
    `SELECT i.mode, i.base_source AS source, i.instruction,
       coalesce((
         SELECT jsonb_agg(jsonb_build_object('instruction', t.instruction, 'result', t.result)
           ORDER BY t.created_at, t.id)
         FROM (
           SELECT h.instruction, h.result, h.created_at, h.id FROM dripsign.ai_suggestion h
           WHERE h.tenant_id = i.tenant_id AND h.agreement_id = i.agreement_id
             AND h.status IN ('ready', 'applied') AND h.created_at < i.created_at
           ORDER BY h.created_at DESC, h.id DESC LIMIT $3
         ) t
       ), '[]') AS history
     FROM dripsign.ai_suggestion i
     WHERE i.tenant_id = $1 AND i.id = $2 AND i.status = 'queued'`,
    [input.tenantId, input.suggestionId, LIMITS.aiTurns],
  );
  const row = found.rows[0];
  if (row === undefined) return null;
  const { mode, source, instruction } = row;
  const history = row.history.map((turn) => ({
    instruction: turn.instruction,
    reply: turnReply(turn.result),
  }));
  return { mode, source, instruction, history };
}

// The current base source is already the latest state, so a reply is its gist, not its terms.
function turnReply(result: AiSuggestionResult): string {
  const lines =
    result.kind === "plan"
      ? result.outline.map((item, index) => `${String(index + 1)}. ${item.heading}: ${item.intent}`)
      : result.source.sections.map((section) => `- ${section.heading}`);
  return [result.summary, ...lines].join("\n");
}

/**
 * Worker seam: stores the result and the actual cost, never more than was reserved. False when
 * the suggestion already ended.
 */
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
     SET status = 'ready', result = $3, cost_micros = least($4, reserved_micros),
       finished_at = now()
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
