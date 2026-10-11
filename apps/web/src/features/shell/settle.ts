import type { ActionResult } from "@/server/action.ts";

const UNREACHABLE = "We couldn’t reach DripSign. Check your connection and try again.";

/**
 * A server action's result, or a refusal in the same shape when the request itself failed (the
 * network dropped, the server restarted), so a screen has one failure path to show.
 */
export async function settle<T>(call: Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await call;
  } catch {
    return { ok: false, code: "unavailable", message: UNREACHABLE };
  }
}
