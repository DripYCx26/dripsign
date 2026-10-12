import { NextResponse } from "next/server";
import { signOut } from "@dripsign/core/auth/sessions";
import { loadConfig } from "@dripsign/core/config";
import { acceptBridgeAssertion } from "@dripsign/core/host/entry";
import { toFailure } from "@/server/action";
import { cookieSpec, readCookie } from "@/server/cookies";
import { HttpError, mediaType, readBoundedBody, statusFor } from "@/server/http";

const FORM_TYPES = new Set(["application/x-www-form-urlencoded", "multipart/form-data"]);
const FORM_LIMIT = { bytes: 16 * 1024, ms: 10_000, tooLarge: "This sign-in request is too large." };

/**
 * The host's signed entry, posted cross-site into its frame, so no same-origin check applies: core
 * accepts only the configured host's Origin and a valid, unreplayed assertion.
 * Off unless a host is configured.
 */
export async function POST(request: Request): Promise<Response> {
  const config = loadConfig();
  if (config.host === null) return new Response(null, { status: 404 });
  const frame = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": `default-src 'none'; frame-ancestors ${new URL(config.host.origin).origin}`,
  };
  try {
    const issued = await acceptBridgeAssertion(
      await readForm(request),
      request.headers.get("origin"),
    );
    // The two kinds are exclusive per browser (readRequestSession): entry ends both prior sessions.
    for (const kind of ["session", "embed"] as const) {
      const previous = await readCookie(kind);
      if (previous !== null) await signOut(previous);
    }
    const response = NextResponse.redirect(new URL("/staff", config.publicOrigin), 303);
    response.cookies.set(cookieSpec("session", "", new Date(0)));
    response.cookies.set(cookieSpec("embed", issued.sessionToken, new Date(issued.expiresAt)));
    for (const [name, value] of Object.entries(frame)) response.headers.set(name, value);
    return response;
  } catch (error) {
    const [status, message] =
      error instanceof HttpError
        ? [error.status, error.message]
        : [statusFor(toFailure(error).code), "This sign-in link isn’t valid. Open it again."];
    return new Response(message, {
      status,
      headers: { ...frame, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function readForm(request: Request): Promise<FormData> {
  const type = mediaType(request.headers);
  const contentType = request.headers.get("content-type");
  if (type === null || contentType === null || !FORM_TYPES.has(type)) {
    throw new HttpError(415, "invalid", "This sign-in request is not a form.");
  }
  const bytes = await readBoundedBody(request, FORM_LIMIT);
  try {
    return await new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch {
    throw new HttpError(400, "invalid", "This sign-in request is malformed.");
  }
}
