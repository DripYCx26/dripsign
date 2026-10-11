// Drives the real domain commands as the seeded people, and runs the queued PDF work in-process.
import { setTimeout as sleep } from "node:timers/promises";
import { getPool, tx } from "../db.ts";
import { createAgreement, executeCommand, storeUpload } from "../domain/commands.ts";
import { loadAgreementView } from "../domain/view.ts";
import { createHandlers } from "../jobs/handlers.ts";
import { claimJobs, finishJob } from "../jobs/outbox.ts";
import { executeJob } from "../jobs/runner.ts";
import { issueSession, readSession } from "../auth/sessions.ts";
import type { Command, NewAgreementInput } from "../schema.ts";
import type { Actor, AgreementView, RecipientActor, StaffActor, StaffRole } from "../types.ts";
import type { Person } from "./people.ts";

const LEASE_MS = 120_000;
const CLAIM_BATCH = 20;
// A job that fails once retries after 10 seconds, so the wait outlasts one backoff.
const SETTLE_TIMEOUT_MS = 45_000;
const POLL_MS = 250;
/** The only kinds seed data needs; mail and host events are marked done without being sent. */
const RUN_KINDS: readonly string[] = ["pdf_prepare", "archive"];

export interface Script {
  /** Loads the viewer's current view, builds the command from it and runs it under a fresh key. */
  step(
    actor: Actor,
    agreementId: string,
    make: (view: AgreementView) => Command,
  ): Promise<AgreementView>;
  create(actor: StaffActor, input: NewAgreementInput): Promise<string>;
  upload(actor: StaffActor, agreementId: string, bytes: Uint8Array): Promise<AgreementView>;
  /** Runs queued PDF preparation and archive work until none is open. */
  settle(): Promise<void>;
  /** A verified session per person, so signing sees a fresh verification. */
  staff(tenantId: string, person: Person, role: StaffRole): Promise<StaffActor>;
  recipient(person: Person): Promise<RecipientActor>;
  /** The seed's sessions end with the seed. */
  endSessions(): Promise<void>;
}

export function createScript(): Script {
  const handlers = createHandlers();
  const sessions = new Map<string, string>();
  let keys = 0;
  const nextKey = (): string => {
    keys += 1;
    return `seed-${String(keys).padStart(4, "0")}`;
  };

  async function sessionId(email: string): Promise<string> {
    const known = sessions.get(email);
    if (known !== undefined) return known;
    const { sessionToken } = await tx((db) => issueSession(db, { email, embed: false }));
    const resolved = await readSession(sessionToken);
    if (resolved === null) throw new Error("A seed session ended before it was used.");
    sessions.set(email, resolved.session.id);
    return resolved.session.id;
  }

  return {
    async step(actor, agreementId, make) {
      const view = await loadAgreementView(actor, agreementId);
      return executeCommand(actor, agreementId, nextKey(), make(view));
    },
    create: (actor, input) => createAgreement(actor, nextKey(), input),
    async upload(actor, agreementId, bytes) {
      const view = await loadAgreementView(actor, agreementId);
      return storeUpload(actor, agreementId, nextKey(), {
        expectedVersion: view.agreement.version,
        bytes,
      });
    },
    settle: () => settleJobs(handlers),
    async staff(tenantId, person, role) {
      return {
        capacity: "staff",
        tenantId,
        email: person.email,
        sessionId: await sessionId(person.email),
        verifiedAt: new Date().toISOString(),
        role,
      };
    },
    async recipient(person) {
      return {
        capacity: "recipient",
        email: person.email,
        sessionId: await sessionId(person.email),
        verifiedAt: new Date().toISOString(),
      };
    },
    async endSessions() {
      await getPool().query(
        "UPDATE dripsign.auth_session SET revoked_at = now() WHERE id = ANY($1::uuid[])",
        [[...sessions.values()]],
      );
    },
  };
}

type Handlers = ReturnType<typeof createHandlers>;

async function runOpenJobs(handlers: Handlers): Promise<number> {
  const claimed = await claimJobs(getPool(), { limit: CLAIM_BATCH, leaseMs: LEASE_MS });
  for (const job of claimed) {
    if (RUN_KINDS.includes(job.payload.kind)) {
      await executeJob(job, handlers, new AbortController().signal);
    } else {
      await finishJob(getPool(), job);
    }
  }
  return claimed.length;
}

async function settleJobs(handlers: Handlers): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  for (;;) {
    const ran = await runOpenJobs(handlers);
    const open = await getPool().query<{ pending: number; failed: number }>(
      `SELECT count(*) FILTER (WHERE status IN ('pending', 'running'))::int AS pending,
              count(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM dripsign.outbox WHERE kind = ANY($1::text[])`,
      [RUN_KINDS],
    );
    const counts = open.rows[0];
    if (counts === undefined || counts.failed > 0) throw new Error("A seed job failed.");
    if (ran > 0) continue;
    if (counts.pending === 0) return;
    if (Date.now() > deadline) throw new Error("Seed jobs did not finish in time.");
    await sleep(POLL_MS);
  }
}
