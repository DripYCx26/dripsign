import "server-only";
import { isLoopbackHostname, loadConfig } from "@dripsign/core/config";
import type { DomainErrorCode } from "@dripsign/core/errors";
import { failure, toFailure, type ActionResult } from "./action.ts";

export const PRIVATE_NO_STORE = "private, no-store";

const STATUS: Readonly<Record<DomainErrorCode, number>> = {
  not_found: 404,
  conflict: 409,
  invalid: 400,
  rate_limited: 429,
  verification_required: 401,
  unavailable: 503,
};

/** A transport refusal decided before the domain runs, with its own status and fixed wording. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: DomainErrorCode;

  constructor(status: number, code: DomainErrorCode, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function statusFor(code: DomainErrorCode): number {
  return STATUS[code];
}

export function jsonResult<T>(result: ActionResult<T>, status?: number): Response {
  return Response.json(result, {
    status: status ?? (result.ok ? 200 : STATUS[result.code]),
    headers: { "Cache-Control": PRIVATE_NO_STORE },
  });
}

/** Route handlers' one catch: transport refusals keep their status, the rest map like actions. */
export function failureResponse(error: unknown): Response {
  if (error instanceof HttpError)
    return jsonResult(failure(error.code, error.message), error.status);
  return jsonResult(toFailure(error));
}

/** True only when every host the request names (Host and any X-Forwarded-Host) is loopback. */
export function isLoopbackRequest(requestHeaders: Headers): boolean {
  const host = requestHeaders.get("host");
  if (host === null) return false;
  const forwarded = requestHeaders.get("x-forwarded-host");
  return [host, ...(forwarded === null ? [] : [forwarded])].every((value) => {
    const hostname = hostnameOf(value);
    return hostname !== null && isLoopbackHostname(hostname);
  });
}

/** Browser mutations outside server actions must come from the configured public origin. */
export function requirePublicOrigin(requestHeaders: Headers): void {
  const site = requestHeaders.get("sec-fetch-site");
  if (
    requestHeaders.get("origin") !== loadConfig().publicOrigin ||
    (site !== null && site !== "same-origin")
  ) {
    throw new HttpError(403, "invalid", "This request came from another site.");
  }
}

export function mediaType(requestHeaders: Headers): string | null {
  const value = requestHeaders.get("content-type");
  return value === null ? null : (value.split(";")[0]?.trim().toLowerCase() ?? null);
}

export interface BodyLimit {
  readonly bytes: number;
  readonly ms: number;
  readonly tooLarge: string;
}

/** Reads at most `limit.bytes` within `limit.ms`; a missing or false Content-Length cannot bypass it. */
export async function readBoundedBody(request: Request, limit: BodyLimit): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > limit.bytes)) {
    throw new HttpError(413, "invalid", limit.tooLarge);
  }
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new HttpError(408, "invalid", "The upload took too long. Try again."));
    }, limit.ms);
  });
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit.bytes) throw new HttpError(413, "invalid", limit.tooLarge);
      chunks.push(next.value);
    }
  } catch (error) {
    // The refusal is the error worth reporting; cancelling an already failed stream may reject too.
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return concat(chunks, size);
}

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// Host header syntax only: no userinfo, path or list can smuggle a loopback name past the check.
const HOST_HEADER = /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/u;

function hostnameOf(host: string): string | null {
  if (!HOST_HEADER.test(host)) return null;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}
