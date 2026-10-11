// Bearer tokens from the Container Apps managed identity endpoint, shared by the Azure Blob and
// Communication Services adapters. No shared key, SAS or connection string exists anywhere.
import type { AzureIdentity } from "../config.ts";
import { readBoundedJson } from "./http.ts";

const IDENTITY_API_VERSION = "2019-08-01";
/** A cached token is replaced this long before it expires. */
const REFRESH_EARLY_MS = 5 * 60_000;
const TOKEN_TIMEOUT_MS = 10_000;
const TOKEN_RESPONSE_BYTES = 64 * 1024;

export interface AzureToken {
  /** A token for the resource, reused until shortly before it expires. */
  bearer(signal: AbortSignal): Promise<string>;
  /** Drops the cached token if it is the one the service just refused. */
  refuse(token: string): void;
}

interface CachedToken {
  readonly value: string;
  readonly refreshAt: number;
}

/**
 * Tokens for one resource. Concurrent callers share one fetch. No token, header value or
 * response body appears in an error.
 */
export function azureToken(identity: AzureIdentity, resource: string): AzureToken {
  const url = new URL(identity.endpoint);
  url.search = new URLSearchParams({
    "api-version": IDENTITY_API_VERSION,
    resource,
    client_id: identity.clientId,
  }).toString();
  let cached: CachedToken | undefined;
  let pending: Promise<CachedToken> | undefined;

  async function fetchToken(signal: AbortSignal): Promise<CachedToken> {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      headers: { "X-IDENTITY-HEADER": identity.header },
      signal: AbortSignal.any([signal, AbortSignal.timeout(TOKEN_TIMEOUT_MS)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Managed identity token is unavailable");
    }
    const answer = await readBoundedJson(response, TOKEN_RESPONSE_BYTES);
    const fields = typeof answer === "object" && answer !== null ? answer : {};
    const token = "access_token" in fields ? fields.access_token : undefined;
    const expiresOn = "expires_on" in fields ? Number(fields.expires_on) : Number.NaN;
    if (
      typeof token !== "string" ||
      !/^[\x21-\x7e]{1,16384}$/u.test(token) ||
      !Number.isSafeInteger(expiresOn) ||
      expiresOn <= 0
    ) {
      throw new Error("Managed identity token is unavailable");
    }
    return { value: token, refreshAt: expiresOn * 1000 - REFRESH_EARLY_MS };
  }

  return {
    async bearer(signal) {
      if (cached && Date.now() < cached.refreshAt) return cached.value;
      pending ??= fetchToken(signal).finally(() => {
        pending = undefined;
      });
      cached = await pending;
      return cached.value;
    },
    refuse(token) {
      if (cached?.value === token) cached = undefined;
    },
  };
}
