// Pure and client-safe: the proxy and server code share the path header, sign-in links take `next`.

/** Set by `proxy.ts` on every page request (overwriting any client value) to the path + query. */
export const PATH_HEADER = "x-dripsign-path";

const MAX_NEXT_LENGTH = 2_000;
const PROBE_ORIGIN = "http://dripsign.invalid";

/** A same-origin path to return to after sign-in, or null for anything that could leave the site. */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw.length > MAX_NEXT_LENGTH) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return null;
  }
  // The URL parser drops tabs and newlines, so recheck the origin rather than the raw string.
  if (url.origin !== PROBE_ORIGIN) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function signInPath(next: string | null): string {
  if (next === null || next === "/" || next.startsWith("/sign-in")) return "/sign-in";
  return `/sign-in?next=${encodeURIComponent(next)}`;
}
