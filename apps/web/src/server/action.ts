import "server-only";
import { randomUUID } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { isDomainError, type DomainErrorCode } from "@dripsign/core/errors";

export interface ActionFailure {
  readonly ok: false;
  readonly code: DomainErrorCode;
  readonly message: string;
}

/** What every server action returns; the client never sees a stack trace or a raw record. */
export type ActionResult<T> = { readonly ok: true; readonly value: T } | ActionFailure;

/** One message per code. `invalid` carries the schema's or domain's own wording instead. */
const MESSAGES: Readonly<Record<DomainErrorCode, string>> = {
  not_found: "This isn’t available.",
  conflict: "This agreement changed. Reload to see the latest.",
  invalid: "Check the details and try again.",
  rate_limited: "Too many attempts. Try again in a few minutes.",
  verification_required: "Confirm it’s you to continue.",
  unavailable:
    "We couldn’t confirm whether that went through. Reload to check before trying again.",
};

export function failure(code: DomainErrorCode, message: string = MESSAGES[code]): ActionFailure {
  return { ok: false, code, message };
}

/**
 * Maps a thrown value once for actions and route handlers. Domain errors become their code;
 * anything else is logged by id and class only (messages may hold user text) and reported as
 * `unavailable`, because the effect may or may not have committed.
 */
export function toFailure(error: unknown): ActionFailure {
  if (isDomainError(error)) {
    return error.code === "invalid" ? failure("invalid", error.message) : failure(error.code);
  }
  const errorId = randomUUID();
  const errorClass = error instanceof Error ? error.name : typeof error;
  console.error(JSON.stringify({ event: "request_failed", errorId, errorClass }));
  return failure("unavailable");
}

/**
 * Wraps a server action: validates the untrusted input with the core schema, runs the handler
 * (which resolves the session and capacity itself), and maps failures. Next's redirect and
 * not-found signals pass through untouched.
 */
export function action<S extends z.ZodType, T>(
  schema: S,
  handler: (input: z.output<S>) => Promise<T>,
): (input: z.input<S>) => Promise<ActionResult<T>> {
  return async (input) => {
    try {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        return failure("invalid", parsed.error.issues[0]?.message ?? MESSAGES.invalid);
      }
      return { ok: true, value: await handler(parsed.data) };
    } catch (error) {
      unstable_rethrow(error);
      return toFailure(error);
    }
  };
}
