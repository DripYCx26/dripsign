import "server-only";
import { cookies } from "next/headers";
import { loadConfig } from "@dripsign/core/config";

/**
 * `session`: the first-party sign-in. `embed`: the host bridge session, sent only inside the host's
 * frame. `challenge`: binds an email code to the browser that asked for it.
 */
export type CookieKind = "session" | "embed" | "challenge";

const BASE_NAMES: Readonly<Record<CookieKind, string>> = {
  session: "dripsign_session",
  embed: "dripsign_embed",
  challenge: "dripsign_challenge",
};

/** The attributes Next's cookie stores accept, for both `cookies()` and `NextResponse`. */
export interface CookieSpec {
  readonly name: string;
  readonly value: string;
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: "lax" | "strict" | "none";
  readonly partitioned: boolean;
  readonly path: "/";
  readonly expires: Date;
}

// `__Host-` pins a cookie to this exact origin (Secure, Path=/, no Domain); production is https.
export function cookieName(kind: CookieKind): string {
  return loadConfig().production ? `__Host-${BASE_NAMES[kind]}` : BASE_NAMES[kind];
}

export function cookieSpec(kind: CookieKind, value: string, expires: Date): CookieSpec {
  const https = loadConfig().publicOrigin.startsWith("https:");
  const common = { name: cookieName(kind), value, httpOnly: true, path: "/", expires } as const;
  switch (kind) {
    case "session":
      return { ...common, secure: https, sameSite: "lax", partitioned: false };
    case "challenge":
      return { ...common, secure: https, sameSite: "strict", partitioned: false };
    case "embed":
      // A third-party frame only receives SameSite=None cookies, which browsers require be Secure.
      return { ...common, secure: true, sameSite: "none", partitioned: true };
  }
}

export async function readCookie(kind: CookieKind): Promise<string | null> {
  const value = (await cookies()).get(cookieName(kind))?.value;
  return value === undefined || value === "" ? null : value;
}

/** Server actions and route handlers only: Next refuses cookie writes while rendering. */
export async function writeCookie(kind: CookieKind, value: string, expires: Date): Promise<void> {
  (await cookies()).set(cookieSpec(kind, value, expires));
}

// Deleting with the original attributes: browsers ignore an expiry for a `__Host-` or
// partitioned cookie that does not repeat Secure, Path and Partitioned.
export async function clearCookie(kind: CookieKind): Promise<void> {
  (await cookies()).set(cookieSpec(kind, "", new Date(0)));
}
