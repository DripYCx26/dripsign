/**
 * The one Content-Security-Policy; only its frame parent changes. Everything is framed by nobody,
 * except staff pages and the bridge entry, which the configured host app alone may frame.
 */
export function contentSecurityPolicy(frameAncestors: string): string {
  return "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
    + "connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; "
    + `frame-ancestors ${frameAncestors}`;
}
