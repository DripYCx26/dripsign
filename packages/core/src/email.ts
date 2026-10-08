import { SendEmailCommand, SESv2Client, SESv2ServiceException } from '@aws-sdk/client-sesv2';
import { z } from 'zod';
import type { EmailMessage, EmailOutcome } from '@dripsign/db';
import { StoreError } from '@dripsign/db';

const messageSchema: z.ZodType<EmailMessage> = z.strictObject({
  to: z.email().max(254), subject: z.string().min(1).max(200).refine(value => !/[\r\n]/u.test(value)),
  text: z.string().min(1).max(20_000),
});

export function parseEmailMessage(value: unknown): EmailMessage {
  const parsed = messageSchema.safeParse(value);
  if (!parsed.success) throw new StoreError('invalid', 'The email message is invalid.');
  return parsed.data;
}

/**
 * The mail port. `accepted` means the provider took the message, not that it was delivered;
 * `uncertain` means it may have been taken, so the caller must never resend it blindly;
 * `rejected` means it was not taken. Configuration chooses the adapter (`providers.ts`).
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<EmailOutcome>;
}

/** An accepted message is submitted to SES; delivery is not implied and uncertain sends cannot be retried blindly. */
export class SesEmailClient implements EmailSender {
  private readonly client: SESv2Client;
  private readonly from: string;

  constructor(region: string, from: string) {
    if (!region || !z.email().safeParse(from).success) throw new Error('Email configuration is invalid.');
    this.client = new SESv2Client({ region, maxAttempts: 1 });
    this.from = from;
  }

  async send(value: EmailMessage): Promise<EmailOutcome> {
    const message = messageSchema.safeParse(value);
    if (!message.success) return { status: 'rejected', code: 'invalid_message' };
    try {
      const response = await this.client.send(new SendEmailCommand({ FromEmailAddress: this.from,
        Destination: { ToAddresses: [message.data.to] }, Content: { Simple: {
          Subject: { Data: message.data.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: message.data.text, Charset: 'UTF-8' } },
        } },
      }), { abortSignal: AbortSignal.timeout(30_000) });
      return response.MessageId ? { status: 'accepted', messageId: response.MessageId } : { status: 'uncertain' };
    } catch (error: unknown) {
      if (error instanceof SESv2ServiceException && error.$metadata.httpStatusCode
        && error.$metadata.httpStatusCode >= 400 && error.$metadata.httpStatusCode < 500) {
        return { status: 'rejected', code: `ses_${error.$metadata.httpStatusCode}` };
      }
      return { status: 'uncertain' };
    }
  }
}
