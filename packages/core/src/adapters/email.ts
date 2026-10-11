import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import nodemailer from "nodemailer";
import { loadConfig } from "../config.ts";
import type { EmailConfig } from "../config.ts";

export class RetryableDeliveryError extends Error {
  constructor(options?: ErrorOptions) {
    super("Delivery temporarily unavailable", options);
    this.name = "RetryableDeliveryError";
  }
}

export interface Mail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export function retryableDelivery(error: unknown): boolean {
  if (error instanceof RetryableDeliveryError) return true;
  if (!(error instanceof Error)) return false;
  const metadata = "$metadata" in error ? (error.$metadata as { httpStatusCode?: number }) : null;
  const status = metadata?.httpStatusCode;
  const response = "responseCode" in error ? error.responseCode : null;
  const code = "code" in error ? error.code : null;
  return (
    status === 429 ||
    (status !== undefined && status >= 500) ||
    (typeof response === "number" && response >= 400 && response < 500) ||
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "ENETUNREACH",
      "ESOCKET",
      "ECONNECTION",
      "ENOTFOUND",
      "EHOSTUNREACH",
    ].includes(String(code)) ||
    ["TimeoutError", "AbortError", "ThrottlingException", "TooManyRequestsException"].includes(
      error.name,
    )
  );
}

export function createEmailSender(
  config: EmailConfig,
): (mail: Mail, signal?: AbortSignal) => Promise<void> {
  const smtp =
    config.transport === "smtp"
      ? nodemailer.createTransport(config.smtpUrl, {
          connectionTimeout: 30_000,
          greetingTimeout: 30_000,
          socketTimeout: 60_000,
        })
      : null;
  // No credentials override: production resolves the task role through the SDK's default chain.
  const ses =
    config.transport === "ses" ? new SESv2Client({ region: config.region, maxAttempts: 1 }) : null;
  return async (mail, signal) => {
    signal?.throwIfAborted();
    try {
      if (smtp) await smtp.sendMail({ from: config.from, ...mail });
      else if (ses)
        await ses.send(
          new SendEmailCommand({
            FromEmailAddress: config.from,
            Destination: { ToAddresses: [mail.to] },
            Content: {
              Simple: {
                Subject: { Data: mail.subject, Charset: "UTF-8" },
                Body: {
                  Text: { Data: mail.text, Charset: "UTF-8" },
                  Html: { Data: mail.html, Charset: "UTF-8" },
                },
              },
            },
          }),
          {
            abortSignal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
              : AbortSignal.timeout(60_000),
          },
        );
    } catch (error: unknown) {
      if (retryableDelivery(error)) throw new RetryableDeliveryError({ cause: error });
      throw error;
    }
  };
}

let sender: ReturnType<typeof createEmailSender> | undefined;
export async function sendEmail(mail: Mail, signal?: AbortSignal): Promise<void> {
  sender ??= createEmailSender(loadConfig().email);
  await sender(mail, signal);
}
