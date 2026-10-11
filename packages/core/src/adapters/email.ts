import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import nodemailer from "nodemailer";
import { loadConfig } from "../config.ts";
import type { EmailConfig } from "../config.ts";
import { azureToken } from "./azure.ts";

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

export type EmailSender = (mail: Mail, signal?: AbortSignal) => Promise<void>;

const SEND_TIMEOUT_MS = 60_000;
export const MAIL_API_VERSION = "2023-03-31";
const COMMUNICATION_RESOURCE = "https://communication.azure.com";
const AZURE_ATTEMPT_TIMEOUT_MS = 30_000;
/** A throttled send waits at most this long, once; the job lease is two minutes. */
const MAX_RETRY_AFTER_SECONDS = 30;

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

function sendSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function createEmailSender(config: EmailConfig): EmailSender {
  const send = transportSender(config);
  return async (mail, signal) => {
    signal?.throwIfAborted();
    try {
      await send(mail, signal);
    } catch (error: unknown) {
      if (error instanceof RetryableDeliveryError || !retryableDelivery(error)) throw error;
      throw new RetryableDeliveryError({ cause: error });
    }
  };
}

function transportSender(config: EmailConfig): EmailSender {
  switch (config.transport) {
    case "smtp": {
      const smtp = nodemailer.createTransport(config.smtpUrl, {
        connectionTimeout: 30_000,
        greetingTimeout: 30_000,
        socketTimeout: 60_000,
      });
      return async (mail) => {
        await smtp.sendMail({ from: config.from, ...mail });
      };
    }
    case "ses":
      return sesSender(config);
    case "azure":
      return azureSender(config);
  }
}

function sesSender(config: Extract<EmailConfig, { transport: "ses" }>): EmailSender {
  // No credentials override: production resolves the task role through the SDK's default chain.
  const ses = new SESv2Client({ region: config.region, maxAttempts: 1 });
  return async (mail, signal) => {
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
      { abortSignal: sendSignal(signal, SEND_TIMEOUT_MS) },
    );
  };
}

/**
 * Communication Services Email under the app's managed identity. Each send has its own
 * `Operation-Id`. A 2xx is accepted and never resent. Only an answer proving the message was not
 * taken is resent, with the same `Operation-Id`: once after a refused token, and once after a 429
 * whose `Retry-After` is at most 30 seconds. A 5xx or a lost connection is uncertain; like SES,
 * the job retries it, so a duplicate is possible and a loss is not.
 */
function azureSender(config: Extract<EmailConfig, { transport: "azure" }>): EmailSender {
  const url = new URL(`${config.endpoint.replace(/\/$/u, "")}/emails:send`);
  url.search = new URLSearchParams({ "api-version": MAIL_API_VERSION }).toString();
  const token = azureToken(config.identity, COMMUNICATION_RESOURCE);
  return async (mail, signal) => {
    const operationId = randomUUID();
    const body = JSON.stringify({
      senderAddress: config.from,
      recipients: { to: [{ address: mail.to }] },
      content: { subject: mail.subject, plainText: mail.text, html: mail.html },
      userEngagementTrackingDisabled: true,
    });
    let refreshed = false;
    let throttled = false;
    for (;;) {
      const attempt = sendSignal(signal, AZURE_ATTEMPT_TIMEOUT_MS);
      // Nothing has been sent when the identity endpoint fails.
      const bearer = await token.bearer(attempt).catch((error: unknown) => {
        throw new RetryableDeliveryError({ cause: error });
      });
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        body,
        signal: attempt,
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
          "Operation-Id": operationId,
        },
      }).catch((error: unknown) => {
        throw new RetryableDeliveryError({ cause: error });
      });
      await response.body?.cancel();
      if (response.ok) return;
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        token.refuse(bearer);
        continue;
      }
      const wait = throttled ? undefined : retryAfterSeconds(response);
      if (wait !== undefined) {
        throttled = true;
        await sleep(wait * 1000, undefined, signal ? { signal } : {});
        continue;
      }
      if (response.status === 429 || response.status >= 500) throw new RetryableDeliveryError();
      throw new Error(`Email refused with status ${String(response.status)}`);
    }
  };
}

/** A 429's delay-seconds within the bound; anything else ends the send. */
function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (response.status !== 429 || value === undefined || !/^\d{1,4}$/u.test(value)) return undefined;
  const seconds = Number(value);
  return seconds <= MAX_RETRY_AFTER_SECONDS ? seconds : undefined;
}

let sender: EmailSender | undefined;
export async function sendEmail(mail: Mail, signal?: AbortSignal): Promise<void> {
  sender ??= createEmailSender(loadConfig().email);
  await sender(mail, signal);
}
