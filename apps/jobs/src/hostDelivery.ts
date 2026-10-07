import { createHmac } from 'node:crypto';
import type { ExecutedAgreementEvent } from '@dripsign/db';

/** Delivers an allowlisted execution event; the configured host deduplicates its event id. */
export async function deliverExecutedEvent(
  url: URL,
  secret: string,
  event: ExecutedAgreementEvent,
): Promise<'delivered' | 'retry' | 'failed'> {
  // Serialize only this event contract even when a caller's object has additional private properties.
  const payload: ExecutedAgreementEvent = {
    eventId: event.eventId, tenantId: event.tenantId, agreementId: event.agreementId,
    revisionId: event.revisionId, signedDocumentSha256: event.signedDocumentSha256,
    auditRecordSha256: event.auditRecordSha256,
    createProvenance: event.createProvenance === null ? null : {
      tenantId: event.createProvenance.tenantId,
      subject: event.createProvenance.subject,
      idempotencyKey: event.createProvenance.idempotencyKey,
      bodySha256: event.createProvenance.bodySha256,
    },
  };
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DripSign-Timestamp': timestamp,
        'X-DripSign-Signature': signature,
        'Idempotency-Key': event.eventId,
      },
      body,
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    });
    await response.body?.cancel();
    if (response.ok) return 'delivered';
    if (response.status === 408 || response.status === 429 || response.status >= 500) return 'retry';
    return 'failed';
  } catch (error: unknown) {
    // An idempotent host receipt permits replay after an unknown delivery outcome.
    return error instanceof Error ? 'retry' : 'failed';
  }
}
