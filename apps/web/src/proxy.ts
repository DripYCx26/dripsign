import { NextResponse, type NextRequest } from "next/server";
import { loadConfig, type Config } from "@dripsign/core/config";
import { PATH_HEADER } from "@/server/navigation";

/**
 * Every page response gets a fresh script nonce. Next reads the nonce from the request's CSP
 * header and stamps it on its own scripts. Route handlers under /api set their own headers: the
 * proxy would buffer (and past 10 MB truncate) upload bodies.
 */
export function proxy(request: NextRequest): NextResponse {
  const settings = loadConfig();
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const policy = contentSecurityPolicy(settings, nonce, request.nextUrl.pathname);
  const path = request.nextUrl.clone();
  path.searchParams.delete("_rsc");

  const forwarded = new Headers(request.headers);
  forwarded.set("x-nonce", nonce);
  forwarded.set("Content-Security-Policy", policy);
  forwarded.set(PATH_HEADER, `${path.pathname}${path.search}`);
  const response = NextResponse.next({ request: { headers: forwarded } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

function contentSecurityPolicy(settings: Config, nonce: string, pathname: string): string {
  // React's development tooling evaluates code to rebuild server stacks; production never does.
  const devEval = settings.nodeEnv === "development" ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devEval}`,
    // CSS modules and next/font emit style tags without a nonce.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    // pdf.js runs its parser in a same-origin worker.
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors(settings, pathname)}`,
    ...(settings.publicOrigin.startsWith("https:") ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** Only the staff workspace may be framed, and only by the configured host. */
function frameAncestors(settings: Config, pathname: string): string {
  const staff = pathname === "/staff" || pathname.startsWith("/staff/");
  return staff && settings.host !== null ? new URL(settings.host.origin).origin : "'none'";
}

export const config = {
  matcher: ["/((?!api/|_next/|favicon.ico).*)"],
};
