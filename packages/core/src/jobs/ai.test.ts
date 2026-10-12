import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { hashBytes } from "../adapters/storage.ts";
import { closePool, getPool, tx } from "../db.ts";
import { AI_RESERVATION_MICROS } from "../adapters/anthropic.ts";
import { applyAi, askAi } from "../domain/ai.ts";
import { loadState, lockAgreement, resolveAccess } from "../domain/state.ts";
import type { CommandContext } from "../domain/state.ts";
import { loadAgreementView } from "../domain/view.ts";
import { canonicalJson, LIMITS } from "../schema.ts";
import type { DocumentSource } from "../schema.ts";
import type { StaffActor } from "../types.ts";
import { createHandlers } from "./handlers.ts";
import { executeJob } from "./runner.ts";
import { claimOwnJobs, fixture, source } from "./testSupport.ts";

beforeAll(() => {
  vi.stubEnv("DRIPSIGN_ANTHROPIC_API_KEY", "synthetic-not-a-provider-key");
  vi.stubEnv("DRIPSIGN_AI_DAILY_LIMIT_USD", "1");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await closePool();
  vi.unstubAllEnvs();
});

function staffActor(context: { tenantId: string; email: string }): StaffActor {
  return {
    capacity: "staff",
    tenantId: context.tenantId,
    email: context.email,
    sessionId: randomUUID(),
    verifiedAt: new Date().toISOString(),
    role: "admin",
  };
}

function inCommand(
  actor: StaffActor,
  agreementId: string,
  run: (ctx: CommandContext) => Promise<void>,
  terms: DocumentSource = source,
): Promise<void> {
  return tx(async (db) => {
    const access = await resolveAccess(db, actor, agreementId);
    const locked = await lockAgreement(db, actor.tenantId, agreementId);
    const agreement = { ...locked, draft: { ...locked.draft, source: terms } };
    const state = await loadState(db, agreement, actor);
    await run({ db, actor, agreement, access, state });
  });
}

async function seedPriorDrafts(context: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  // Every turn's reply lists LIMITS.sections long headings, so all of them exceed the plan budget.
  const sections = Array.from({ length: LIMITS.sections }, (_, index) => ({
    id: `s${String(index)}`,
    heading: "Fees ".padEnd(LIMITS.heading, "x"),
    paragraphs: ["Prior full terms."],
  }));
  const prior = { title: "Prior", sections };
  // Applied drafts are history, not another ready suggestion that could offer apply_ai.
  await getPool().query(
    `INSERT INTO dripsign.ai_suggestion (tenant_id,agreement_id,id,requested_by,instruction,mode,base_source,base_source_sha256,model,reserved_micros,status,result,cost_micros,finished_at,applied_at,created_at)
     SELECT $1,$2,gen_random_uuid(),$3,'Turn ' || n,'draft',$4,$5,'claude-sonnet-5-5',1,'applied',
       jsonb_build_object('kind','draft','summary','Turn ' || n,'source',$6::jsonb,'questions','[]'::jsonb),
       0,now(),now(),now() - make_interval(mins => 10 - n)
     FROM generate_series(1, 9) n`,
    [
      context.tenantId,
      context.agreementId,
      context.email,
      source,
      hashBytes(Buffer.from(canonicalJson(source))),
      prior,
    ],
  );
}

it("admits exactly one of two concurrent ask_ai calls at the daily cap", async () => {
  const first = await fixture();
  const second = await fixture(first.tenantId);
  const actor = staffActor(first);
  const ask = (agreementId: string, terms = source) =>
    inCommand(
      actor,
      agreementId,
      (ctx) =>
        askAi(ctx, {
          kind: "ask_ai",
          instruction: "Review this synthetic scope.",
          mode: "draft",
        }),
      terms,
    );
  const results = await Promise.allSettled([ask(first.agreementId), ask(second.agreementId)]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const refused = results.find((result) => result.status === "rejected");
  if (!refused) throw new Error("Concurrent AI request was not refused");
  expect(refused.reason).toMatchObject({ code: "rate_limited" });
  // Terms longer than the assistant can return are refused before any spend is reserved.
  const paragraphs = ["x".repeat(LIMITS.paragraph), "y".repeat(LIMITS.paragraph)];
  const long = { ...source, sections: [{ id: "long", heading: "Long", paragraphs }] };
  await expect(ask(second.agreementId, long)).rejects.toMatchObject({ code: "invalid" });
  const suggestions = await getPool().query<{ count: string; total: string }>(
    "SELECT count(*)::text AS count, sum(reserved_micros)::text AS total FROM dripsign.ai_suggestion WHERE tenant_id=$1",
    [first.tenantId],
  );
  expect(Number(suggestions.rows[0]?.count)).toBe(1);
  expect(Number(suggestions.rows[0]?.total)).toBe(AI_RESERVATION_MICROS.draft);
});

function assertPlanRequest(sent: string): void {
  const body = JSON.parse(sent) as {
    max_tokens: number;
    tool_choice: { name: string };
    messages: { content: string }[];
  };
  expect(body.tool_choice.name).toBe("propose_plan");
  expect(body.max_tokens).toBe(2_000);
  const content = JSON.parse(body.messages[0]?.content ?? "{}") as {
    history: { instruction: string; reply: string }[];
  };
  // The latest bounded turns, oldest dropped first until the request fits the plan reservation.
  const latest = Array.from({ length: LIMITS.aiTurns }, (_, index) => `Turn ${String(index + 2)}`);
  const kept = content.history.map((item) => item.instruction);
  expect(kept.length).toBeGreaterThan(0);
  expect(kept.length).toBeLessThan(LIMITS.aiTurns);
  expect(kept).toEqual(latest.slice(-kept.length));
  expect(content.history.at(-1)?.reply).toMatch(/^Turn 9\n- Fees x/u);
  expect(sent).not.toContain("Prior full terms.");
}

it("plans on a forced tool with a bounded history, spends once and never applies a plan", async () => {
  const context = await fixture();
  const actor = staffActor(context);
  await seedPriorDrafts(context);
  await inCommand(actor, context.agreementId, (ctx) =>
    askAi(ctx, { kind: "ask_ai", instruction: "Plan a website build.", mode: "plan" }),
  );
  const turn = () =>
    getPool().query<{ id: string; status: string; reserved: string; cost: string | null }>(
      `SELECT id,status,reserved_micros::text AS reserved,cost_micros::text AS cost,result
       FROM dripsign.ai_suggestion WHERE tenant_id=$1 AND mode='plan'`,
      [context.tenantId],
    );
  const queued = (await turn()).rows[0];
  if (!queued) throw new Error("Plan turn was not stored");
  expect(Number(queued.reserved)).toBe(250_000);
  const outbox = await getPool().query<{ id: string }>(
    "SELECT id FROM dripsign.outbox WHERE dedupe_key=$1",
    [`ai_suggest:${queued.id}`],
  );
  const [job] = await claimOwnJobs([outbox.rows[0]?.id ?? null]);
  if (!job) throw new Error("Plan job was not claimed");
  const plan = {
    summary: "A fixed-fee website build.",
    outline: [{ heading: "Scope", intent: "Twelve weeks of design and build." }],
    questions: ["Who owns the code?"],
  };
  const provider = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        stop_reason: "tool_use",
        // Usage priced above the reservation is stored as the reservation.
        usage: { input_tokens: 130_000, output_tokens: 100 },
        content: [{ type: "tool_use", name: "propose_plan", input: plan }],
      }),
    ),
  );
  vi.stubGlobal("fetch", provider);
  await executeJob(job, createHandlers());
  expect(provider).toHaveBeenCalledOnce();
  const [, { body: sent }] = provider.mock.calls[0] as [string, { body: string }];
  assertPlanRequest(sent);
  expect((await turn()).rows[0]).toMatchObject({
    status: "ready",
    cost: String(AI_RESERVATION_MICROS.plan),
    result: { kind: "plan", ...plan },
  });
  // A ready plan neither offers nor performs apply_ai.
  const view = await loadAgreementView(actor, context.agreementId);
  expect(view.allowedActions).not.toContain("apply_ai");
  await expect(
    inCommand(actor, context.agreementId, (ctx) =>
      applyAi(ctx, {
        kind: "apply_ai",
        expectedDraftVersion: ctx.agreement.draftVersion,
        suggestionId: queued.id,
      }),
    ),
  ).rejects.toMatchObject({ code: "conflict" });
});
