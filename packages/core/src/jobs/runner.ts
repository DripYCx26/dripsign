import type pg from "pg";
import { getPool, pgErrorCode, tx } from "../db.ts";
import { DomainError } from "../errors.ts";
import { createHandlers } from "./handlers.ts";
import type { HandlerDefinition } from "./handlers.ts";
import type { ClaimedJob } from "./outbox.ts";
import {
  claimJobs,
  failJob,
  finishJob,
  JOB_MAX_ATTEMPTS,
  lockLease,
  OUTBOX_CHANNEL,
  renewLease,
  retryJob,
} from "./outbox.ts";

const LEASE_MS = 120_000;
const HEARTBEAT_MS = 30_000;

interface RunnerState {
  readonly pool: pg.Pool;
  readonly concurrency: number;
  readonly handlers: ReturnType<typeof createHandlers>;
  readonly active: Map<string, { promise: Promise<void>; controller: AbortController }>;
  stopped: boolean;
  pump: Promise<void> | null;
  listener: { client: pg.PoolClient; notification: () => void; error: () => void } | null;
  connecting: Promise<void> | null;
}

function failureCode(error: unknown): string {
  for (let depth = 0; depth < 4 && error instanceof Error; depth++) {
    const code = pgErrorCode(error);
    if (code && /^[0-9A-Z]{5}$/u.test(code)) return code;
    if (error instanceof DomainError) return error.code;
    error = error.cause;
  }
  return "handler_failed";
}

function logFailure(error?: unknown): void {
  console.error("dripsign: worker failure", { code: failureCode(error) });
}

export async function executeJob(
  job: ClaimedJob,
  handlers: ReturnType<typeof createHandlers>,
  signal: AbortSignal,
): Promise<void> {
  const definition = handlers[job.payload.kind];
  const maxAttempts = JOB_MAX_ATTEMPTS[job.payload.kind];
  if (maxAttempts !== null && job.attempts > maxAttempts) {
    await finalFailure(job, definition, "attempts_exhausted");
    return;
  }
  const controller = new AbortController();
  const stopHeartbeat = keepLease(job, controller);
  try {
    // Each handler checks cancellation before its effect; AI also records whether it called out.
    await definition.handler(job, AbortSignal.any([signal, controller.signal]));
    await finishJob(getPool(), job);
  } catch (error: unknown) {
    const code = failureCode(error);
    console.error("dripsign: job failed", { id: job.id, code });
    if (maxAttempts === null || (definition.retryable(error) && job.attempts < maxAttempts)) {
      await retryJob(getPool(), job, code);
    } else await finalFailure(job, definition, code, error);
  } finally {
    stopHeartbeat();
  }
}

async function finalFailure(
  job: ClaimedJob,
  definition: HandlerDefinition,
  code: string,
  error?: unknown,
): Promise<void> {
  await tx(async (db) => {
    // Hooks lock their agreement first; a lost lease rolls their effects back in this same tx.
    await definition.onFinalFailure(db, job, code, error);
    if (!(await lockLease(db, job))) throw new Error("Job lease lost");
    await failJob(db, job, code);
  });
}

function keepLease(job: ClaimedJob, controller: AbortController): () => void {
  let renewing = false;
  let stopped = false;
  // The lease token fences database transitions, not external effects, so stop before expiry.
  let leaseUntil = job.leaseUntil.getTime();
  let expiry = setTimeout(
    () => {
      controller.abort();
    },
    Math.max(0, leaseUntil - Date.now()),
  );
  const heartbeat = setInterval(() => {
    if (renewing) return;
    renewing = true;
    const startedAt = Date.now();
    void renewLease(getPool(), job, LEASE_MS)
      .then((owned) => {
        if (stopped) return;
        if (!owned) controller.abort();
        else {
          leaseUntil = startedAt + LEASE_MS;
          clearTimeout(expiry);
          expiry = setTimeout(
            () => {
              controller.abort();
            },
            Math.max(0, leaseUntil - Date.now()),
          );
        }
      })
      .catch((error: unknown) => {
        if (stopped) return;
        // A failed renewal is not proof of a lost lease. Retry within the last confirmed window.
        if (Date.now() >= leaseUntil) controller.abort();
        console.error("dripsign: lease renewal failed", { id: job.id, code: failureCode(error) });
      })
      .finally(() => {
        renewing = false;
      });
  }, HEARTBEAT_MS);
  return () => {
    stopped = true;
    clearInterval(heartbeat);
    clearTimeout(expiry);
  };
}

function launch(state: RunnerState, job: ClaimedJob): void {
  const controller = new AbortController();
  const promise = executeJob(job, state.handlers, controller.signal)
    .catch(logFailure)
    .finally(() => {
      state.active.delete(job.id);
      wake(state);
    });
  state.active.set(job.id, { promise, controller });
}

function wake(state: RunnerState): void {
  if (state.stopped || state.pump) return;
  state.pump = fillSlots(state)
    .catch(logFailure)
    .finally(() => {
      state.pump = null;
    });
}

async function fillSlots(state: RunnerState): Promise<void> {
  while (!state.stopped && state.active.size < state.concurrency) {
    const jobs = await claimJobs(state.pool, {
      limit: state.concurrency - state.active.size,
      leaseMs: LEASE_MS,
    });
    // A claim already in flight at shutdown belongs to the drain too.
    for (const job of jobs) launch(state, job);
    if (jobs.length === 0) break;
  }
}

function listen(state: RunnerState): void {
  if (state.listener || state.connecting || state.stopped) return;
  state.connecting = connectListener(state)
    .catch(logFailure)
    .finally(() => {
      state.connecting = null;
    });
}

async function connectListener(state: RunnerState): Promise<void> {
  const client = await state.pool.connect();
  try {
    await client.query(`LISTEN ${OUTBOX_CHANNEL}`);
    if (state.stopped) {
      await client.query(`UNLISTEN ${OUTBOX_CHANNEL}`);
      client.release();
      return;
    }
    const notification = (): void => {
      wake(state);
    };
    const error = (): void => {
      if (state.listener?.client === client) {
        state.listener = null;
        client.removeListener("notification", notification);
        client.release(true);
      }
      logFailure();
    };
    state.listener = { client, notification, error };
    client.on("notification", notification);
    client.once("error", error);
  } catch (error: unknown) {
    client.release(true);
    throw error;
  }
}

async function drain(state: RunnerState): Promise<void> {
  await Promise.all([state.pump, state.connecting]);
  const listener = state.listener;
  state.listener = null;
  if (listener) {
    await listener.client.query(`UNLISTEN ${OUTBOX_CHANNEL}`).catch(logFailure);
    listener.client.removeListener("notification", listener.notification);
    listener.client.removeListener("error", listener.error);
    listener.client.release();
  }
  await Promise.all([...state.active.values()].map((item) => item.promise));
}

async function stopRunner(state: RunnerState): Promise<boolean> {
  state.stopped = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const drained = await Promise.race([
    drain(state).then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => {
        resolve(false);
      }, 25_000);
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (!drained) for (const item of state.active.values()) item.controller.abort();
  return drained;
}

export async function startRunner(options: {
  concurrency: number;
  handlers?: ReturnType<typeof createHandlers>;
}): Promise<{ stop(): Promise<boolean> }> {
  const pool = getPool();
  if (
    !Number.isInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > pool.options.max - 2
  )
    throw new Error("Invalid worker concurrency");
  const state: RunnerState = {
    pool,
    concurrency: options.concurrency,
    handlers: options.handlers ?? createHandlers(),
    active: new Map(),
    stopped: false,
    pump: null,
    listener: null,
    connecting: null,
  };
  const poll = setInterval(() => {
    listen(state);
    wake(state);
  }, 2_000);
  listen(state);
  wake(state);
  await Promise.all([state.connecting, state.pump]);
  return {
    stop: () => {
      clearInterval(poll);
      return stopRunner(state);
    },
  };
}
