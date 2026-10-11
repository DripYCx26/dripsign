import { connection } from "next/server";
import { getPool, schemaMatches } from "@dripsign/core/db";

const DEADLINE_MS = 1_000;

/** Ready means the database answers within a second and holds the schema this build expects. */
export async function GET(): Promise<Response> {
  await connection();
  const ok = await withinDeadline(isReady(), DEADLINE_MS);
  return Response.json(
    { ok },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

async function isReady(): Promise<boolean> {
  const pool = getPool();
  await pool.query("SELECT 1");
  return schemaMatches(pool);
}

// A failed or slow check is the answer (503), not an error to raise; the probe repeats it.
function withinDeadline(check: Promise<boolean>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, ms);
  });
  return Promise.race([check.catch(() => false), late]).finally(() => {
    clearTimeout(timer);
  });
}
