import { configuredEndpoint, readProviderJson } from './providerHttp.ts';

/** A user-assigned identity reached through the hosting platform's local identity endpoint. */
export interface ManagedIdentity {
  /** The platform's `IDENTITY_ENDPOINT`. */
  readonly endpoint: string;
  /** The platform's `IDENTITY_HEADER`; sent only to the identity endpoint. */
  readonly header: string;
  /** The client ID of the app's own user-assigned identity. */
  readonly clientId: string;
}

const IDENTITY_API_VERSION = '2019-08-01';
// ASSUMPTION: a cached token is replaced five minutes before it expires.
const REFRESH_EARLY_MS = 5 * 60_000;
// ASSUMPTION: the local identity endpoint answers within ten seconds.
const TOKEN_TIMEOUT_MS = 10_000;

interface CachedToken { readonly value: string; readonly refreshAt: number }

/**
 * Bearer tokens for one resource from the Container Apps identity endpoint. A token is reused until
 * shortly before it expires; concurrent callers share one fetch; a token a provider refused is
 * dropped by `refuse`. No token, header value, or response body appears in an error or a log.
 */
export class ManagedIdentityToken {
  private readonly url: URL;
  private readonly header: string;
  private cached: CachedToken | undefined;
  private pending: Promise<CachedToken> | undefined;

  constructor(identity: ManagedIdentity, resource: string) {
    if (!identity.header || !/^[A-Za-z0-9-]{1,128}$/u.test(identity.clientId)) throw new Error('Managed identity configuration is invalid.');
    this.url = configuredEndpoint(identity.endpoint);
    this.url.search = new URLSearchParams({ 'api-version': IDENTITY_API_VERSION, resource, client_id: identity.clientId }).toString();
    this.header = identity.header;
  }

  async bearer(signal: AbortSignal): Promise<string> {
    if (this.cached && Date.now() < this.cached.refreshAt) return this.cached.value;
    this.pending ??= this.fetchToken(signal).finally(() => { this.pending = undefined; });
    this.cached = await this.pending;
    return this.cached.value;
  }

  /** Drops the cached token if it is the one a provider just refused. */
  refuse(token: string): void {
    if (this.cached?.value === token) this.cached = undefined;
  }

  private async fetchToken(signal: AbortSignal): Promise<CachedToken> {
    const response = await fetch(this.url, { method: 'GET', redirect: 'error', headers: { 'X-IDENTITY-HEADER': this.header },
      signal: AbortSignal.any([signal, AbortSignal.timeout(TOKEN_TIMEOUT_MS)]) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Managed identity token is unavailable.');
    }
    const answer = await readProviderJson(response).catch(() => null);
    const token = answer !== null && typeof answer === 'object' ? (answer as Record<string, unknown>)['access_token'] : undefined;
    const expiresOn = answer !== null && typeof answer === 'object' ? Number((answer as Record<string, unknown>)['expires_on']) : Number.NaN;
    if (typeof token !== 'string' || !/^[\x21-\x7e]{1,16384}$/u.test(token) || !Number.isSafeInteger(expiresOn) || expiresOn <= 0) {
      throw new Error('Managed identity token is unavailable.');
    }
    return { value: token, refreshAt: expiresOn * 1000 - REFRESH_EARLY_MS };
  }
}
