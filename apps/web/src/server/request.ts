// What the server derives about the client from request headers. Pure (no Next, no config read),
// so the parsing is tested directly; callers pass `loadConfig().trustedProxyHops`.
import { isIP } from "node:net";
import type { RequestEvidence } from "@dripsign/core/types";

// The `ip_address` and `user_agent` column limits; a zone-scoped IPv6 can pass isIP at any length.
const MAX_IP_CHARS = 64;
const MAX_USER_AGENT_CHARS = 500;

/**
 * The client address for rate limits and evidence. Each trusted proxy appends the peer it saw, so
 * the client is `hops` entries from the right. With no trusted proxy (0 hops, past the end) the
 * header is whatever the client sent (Next only fills it when absent), so the address is unknown.
 */
export function clientIp(requestHeaders: Headers, hops: number): string | null {
  const chain = (requestHeaders.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  const candidate = chain[chain.length - hops];
  return candidate !== undefined && candidate.length <= MAX_IP_CHARS && isIP(candidate) !== 0
    ? candidate
    : null;
}

/** What a signature records about the request that made it; the user agent is client-chosen. */
export function requestEvidence(requestHeaders: Headers, hops: number): RequestEvidence {
  return {
    ipAddress: clientIp(requestHeaders, hops),
    userAgent: requestHeaders.get("user-agent")?.slice(0, MAX_USER_AGENT_CHARS) ?? null,
  };
}
