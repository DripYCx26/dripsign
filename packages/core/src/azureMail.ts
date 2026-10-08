import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { EmailMessage, EmailOutcome } from '@dripsign/db';
import type { EmailSender } from './email.ts';
import { parseEmailMessage } from './email.ts';
import type { ManagedIdentity } from './managedIdentity.ts';
import { ManagedIdentityToken } from './managedIdentity.ts';
import { configuredEndpoint, readProviderJson } from './providerHttp.ts';

export const MAIL_API_VERSION = '2023-03-31';
const COMMUNICATION_RESOURCE = 'https://communication.azure.com';
// ASSUMPTION: the same 30-second bound the SES adapter applies to one send.
const ATTEMPT_TIMEOUT_MS = 30_000;
// ASSUMPTION: a throttled send waits at most this long once; the jobs lease is five minutes.
const MAX_RETRY_AFTER_SECONDS = 30;

export interface AzureMailSettings {
  /** The Communication Services endpoint, `https://<resource>.communication.azure.com`. */
  readonly endpoint: string;
  /** A sender address on a domain connected to the resource. */
  readonly from: string;
  readonly identity: ManagedIdentity;
}

/**
 * Azure Communication Services Email under the app's managed identity. Each send carries a fresh
 * `Operation-Id`. A 2xx is accepted and never resent. Only an answer that proves the message was
 * not taken is resent, with the same `Operation-Id`: a refused token once after a fresh token, and a
 * 429 once after its `Retry-After`. A 5xx or a transport failure is uncertain and is not resent.
 */
export class AzureCommunicationMail implements EmailSender {
  private readonly url: URL;
  private readonly from: string;
  private readonly token: ManagedIdentityToken;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(settings: AzureMailSettings, sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, milliseconds); })) {
    if (!z.email().safeParse(settings.from).success) throw new Error('Email configuration is invalid.');
    const endpoint = configuredEndpoint(settings.endpoint);
    this.url = new URL(`${endpoint.pathname.replace(/\/$/u, '')}/emails:send`, endpoint);
    this.url.search = new URLSearchParams({ 'api-version': MAIL_API_VERSION }).toString();
    this.from = settings.from;
    this.token = new ManagedIdentityToken(settings.identity, COMMUNICATION_RESOURCE);
    this.sleep = sleep;
  }

  async send(value: EmailMessage): Promise<EmailOutcome> {
    let message: EmailMessage;
    try { message = parseEmailMessage(value); } catch { return { status: 'rejected', code: 'invalid_message' }; }
    const operationId = randomUUID();
    const body = JSON.stringify({
      senderAddress: this.from, recipients: { to: [{ address: message.to }] },
      content: { subject: message.subject, plainText: message.text }, userEngagementTrackingDisabled: true,
    });
    let refreshed = false;
    let throttled = false;
    while (true) {
      let bearer: string;
      // Nothing has been sent when the identity endpoint fails.
      try { bearer = await this.token.bearer(AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)); } catch { return { status: 'rejected', code: 'acs_identity' }; }
      let response: Response;
      try {
        response = await fetch(this.url, { method: 'POST', redirect: 'error', body, signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
          headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', 'Operation-Id': operationId } });
      } catch { return { status: 'uncertain' }; }
      if (response.ok) return { status: 'accepted', messageId: await acceptedId(response, operationId) };
      await response.body?.cancel();
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        this.token.refuse(bearer);
        continue;
      }
      const wait = response.status === 429 && !throttled ? retryAfterSeconds(response.headers.get('retry-after')) : undefined;
      if (wait !== undefined) {
        throttled = true;
        await this.sleep(wait * 1000);
        continue;
      }
      if (response.status >= 400 && response.status < 500) return { status: 'rejected', code: `acs_${response.status}` };
      return { status: 'uncertain' };
    }
  }
}

/** Only the delay-seconds form within the bound is honoured; anything else ends the send. */
function retryAfterSeconds(value: string | null): number | undefined {
  if (value === null || !/^\d{1,4}$/u.test(value.trim())) return undefined;
  const seconds = Number(value.trim());
  return seconds <= MAX_RETRY_AFTER_SECONDS ? seconds : undefined;
}

/** The service's message ID when its answer is readable; the accepted operation ID otherwise. */
async function acceptedId(response: Response, operationId: string): Promise<string> {
  const answer = await readProviderJson(response).catch(() => null);
  const id = answer !== null && typeof answer === 'object' ? (answer as Record<string, unknown>)['id'] : undefined;
  return typeof id === 'string' && /^[A-Za-z0-9-]{1,128}$/u.test(id) ? id : operationId;
}
