import { loadConfig } from "../config.ts";
import type { Mail } from "../adapters/email.ts";
import type { EmailTemplate } from "../schema.ts";

const COPY: Record<
  Exclude<EmailTemplate, "otp_code" | "step_up">,
  { subject: string; text: string }
> = {
  invite: {
    subject: "An agreement is ready to review",
    text: "You have been invited to review this agreement. You can read it and discuss any changes in DripSign.",
  },
  revision_published: {
    subject: "An agreement has been updated",
    text: "A new revision is ready to review. Please read the updated document before signing.",
  },
  sign_request: {
    subject: "An agreement is ready for your signature",
    text: "Please review the exact document and sign when you are ready.",
  },
  signing_cancelled: {
    subject: "A signature request has been cancelled",
    text: "This signature request is no longer open. Any signatures already recorded remain part of the history. You will be notified if a new request is made.",
  },
  completed: {
    subject: "An agreement has been signed",
    text: "Everyone has signed. The signed PDF and signing audit record are now available in DripSign.",
  },
  voided: {
    subject: "An agreement has been voided",
    text: "This agreement has been voided. It is no longer open for discussion or signature. Its recorded history is kept.",
  },
};

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}

export function renderMail(
  input: {
    template: EmailTemplate;
    to: string;
    params: Readonly<Record<string, string>>;
    agreementId?: string | null;
  },
  origin = loadConfig().publicOrigin,
): Mail {
  if (input.template === "otp_code" || input.template === "step_up") {
    const code = input.params.code;
    if (!code || !/^\d{6}$/u.test(code)) throw new Error("Mail code is invalid");
    const subject =
      input.template === "step_up"
        ? "Confirm your identity in DripSign"
        : "Your DripSign sign-in code";
    const copy =
      "This code expires in 10 minutes. If you did not request it, you can ignore this email.";
    return {
      to: input.to,
      subject,
      text: `${subject}\n\n${code}\n\n${copy}`,
      html: `<p>${subject}</p><p style="font-size:28px;letter-spacing:4px"><strong>${code}</strong></p><p>${copy}</p>`,
    };
  }
  const copy = COPY[input.template];
  const id = input.agreementId;
  if (!id) throw new Error("Mail agreement is missing");
  const path = `/agreements/${encodeURIComponent(id)}${input.template === "sign_request" ? "/sign" : ""}`;
  const url = new URL(path, origin).href;
  const title = input.params.title ?? "Agreement";
  return {
    to: input.to,
    subject: copy.subject,
    text: `${title}\n\n${copy.text}\n\nOpen agreement: ${url}`,
    html: `<p><strong>${escapeHtml(title)}</strong></p><p>${copy.text}</p><p><a href="${escapeHtml(url)}">Open agreement</a></p>`,
  };
}
