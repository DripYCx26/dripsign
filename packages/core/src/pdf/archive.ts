import { PDFDocument, rgb } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import type { StoredObject } from "../adapters/storage.ts";
import { hashBytes } from "../adapters/storage.ts";
import { DomainError } from "../errors.ts";
import { LIMITS, signingFieldSchema } from "../schema.ts";
import type { SigningField } from "../schema.ts";
import { embedSignatureFont, fitSignatureText } from "./font.ts";
import { MAX_PREPARED_PAGES, metadata, pageNumbers, savePdf, textWriter } from "./render.ts";

export interface ArchiveEvidence {
  readonly title: string;
  readonly revision: {
    readonly number: number;
    readonly document: StoredObject;
    readonly fields: readonly SigningField[];
  };
  readonly round: {
    readonly id: string;
    readonly createdAt: string;
    readonly finalizingAt: string;
    readonly consent: { readonly version: string; readonly text: string; readonly sha256: string };
  };
  readonly signers: readonly {
    readonly recipientId: string;
    readonly name: string;
    readonly email: string;
  }[];
  readonly signatures: readonly {
    readonly recipientId: string;
    readonly typedName: string;
    readonly verifiedAt: string;
    readonly signedAt: string;
    readonly sessionId: string;
    readonly ipAddress: string | null;
    readonly userAgent: string | null;
  }[];
  readonly timeline: readonly { readonly at: string; readonly kind: string }[];
}

function signatures(evidence: ArchiveEvidence): ArchiveEvidence["signatures"] {
  const ids = new Set(evidence.signers.map((signer) => signer.recipientId));
  if (
    ids.size === 0 ||
    ids.size > LIMITS.requiredSigners ||
    ids.size !== evidence.signers.length ||
    evidence.signatures.length !== ids.size ||
    new Set(evidence.signatures.map((signature) => signature.recipientId)).size !== ids.size ||
    evidence.signatures.some((signature) => !ids.has(signature.recipientId)) ||
    hashBytes(Buffer.from(evidence.round.consent.text)) !== evidence.round.consent.sha256
  ) {
    throw new DomainError("invalid", "The signing evidence is incomplete.");
  }
  const opened = timestamp(evidence.round.createdAt);
  const generated = timestamp(evidence.round.finalizingAt);
  for (const signature of evidence.signatures) {
    const signed = timestamp(signature.signedAt);
    const verified = timestamp(signature.verifiedAt);
    if (signed < opened || signed > generated || verified > signed)
      throw new DomainError("invalid", "The signing evidence times are inconsistent.");
  }
  const byRecipient = new Map(
    evidence.signatures.map((signature) => [signature.recipientId, signature]),
  );
  return evidence.signers.map((signer) => {
    const signature = byRecipient.get(signer.recipientId);
    if (!signature) throw new DomainError("invalid", "A required signature is missing.");
    return signature;
  });
}

function timestamp(value: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time))
    throw new DomainError("invalid", "The evidence timestamp is invalid.");
  return time;
}

function validateFields(evidence: ArchiveEvidence, document: PDFDocument): readonly SigningField[] {
  const fields = evidence.revision.fields.map((field) => signingFieldSchema.parse(field));
  const ids = new Set(evidence.signers.map((signer) => signer.recipientId));
  const keys = new Set(fields.map((field) => `${field.recipientId}:${field.type}`));
  if (
    fields.length !== ids.size * 2 ||
    keys.size !== fields.length ||
    evidence.signers.some(
      (signer) =>
        !keys.has(`${signer.recipientId}:signature`) || !keys.has(`${signer.recipientId}:date`),
    )
  ) {
    throw new DomainError("invalid", "The frozen signing fields are incomplete.");
  }
  for (const [index, field] of fields.entries()) {
    if (!ids.has(field.recipientId) || field.page > document.getPageCount())
      throw new DomainError("invalid", "The frozen signing fields are invalid.");
    const page = document.getPage(field.page - 1);
    validateFieldPage(page, field);
    if (
      fields
        .slice(index + 1)
        .some(
          (other) =>
            field.page === other.page &&
            field.x < other.x + other.width &&
            other.x < field.x + field.width &&
            field.y < other.y + other.height &&
            other.y < field.y + field.height,
        )
    ) {
      throw new DomainError("invalid", "The frozen signing fields overlap.");
    }
  }
  return fields;
}

function validateFieldPage(page: PDFPage, field: SigningField): void {
  const { width, height } = page.getSize();
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  if (
    !validDimension(width) ||
    !validDimension(height) ||
    media.x !== 0 ||
    media.y !== 0 ||
    crop.x !== 0 ||
    crop.y !== 0 ||
    crop.width !== width ||
    crop.height !== height ||
    page.getRotation().angle % 360 !== 0 ||
    field.width * width < 12 ||
    field.height * height < 12
  ) {
    throw new DomainError("invalid", "The frozen signing page is invalid.");
  }
}

function validDimension(value: number): boolean {
  return Number.isFinite(value) && value >= 1 && value <= 14_400;
}

function drawField(document: PDFDocument, field: SigningField, value: string, font: PDFFont): void {
  const page = document.getPage(field.page - 1);
  const { width, height } = page.getSize();
  const fitted = fitSignatureText(value, font, field.width * width, field.height * height);
  fitted.lines.forEach((line, index) => {
    page.drawText(line, {
      x: field.x * width + 4,
      y: height * (1 - field.y) - 4 - fitted.lineHeight * (index + 1),
      size: fitted.size,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
  });
}

export async function renderSignedPdf(
  evidence: ArchiveEvidence,
  revisionBytes: Uint8Array,
): Promise<Uint8Array> {
  const sorted = signatures(evidence);
  if (
    hashBytes(revisionBytes) !== evidence.revision.document.sha256 ||
    revisionBytes.byteLength !== evidence.revision.document.byteLength
  ) {
    throw new DomainError("invalid", "The revision PDF does not match the frozen evidence.");
  }
  const document = await PDFDocument.load(revisionBytes, {
    updateMetadata: false,
    throwOnInvalidObject: true,
  });
  if (document.isEncrypted || document.getPageCount() > MAX_PREPARED_PAGES)
    throw new DomainError("invalid", "The revision PDF is invalid.");
  const fields = validateFields(evidence, document);
  const font = await embedSignatureFont(document);
  for (const field of fields) {
    const signature = sorted.find((item) => item.recipientId === field.recipientId);
    if (!signature) throw new DomainError("invalid", "A required signature is missing.");
    drawField(
      document,
      field,
      field.type === "signature"
        ? signature.typedName
        : new Date(signature.signedAt).toISOString().slice(0, 10),
      font,
    );
  }
  for (const page of document.getPages()) {
    page.drawText("Signed electronically with DripSign", { x: 54, y: 18, font, size: 7 });
    page.drawText(`Document SHA-256: ${evidence.revision.document.sha256}`, {
      x: 54,
      y: 8,
      font,
      size: 6,
    });
  }
  metadata(document, evidence.title, new Date(evidence.round.finalizingAt));
  return savePdf(document);
}

// Request evidence is literal audit data. JSON escaping preserves controls without rendering them.
function auditText(value: string | null, font: PDFFont): string {
  if (value === null) return "Not recorded";
  const supported = new Set(font.getCharacterSet());
  return Array.from(JSON.stringify(value).slice(1, -1))
    .map((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && supported.has(code)
        ? character
        : `\\u{${code?.toString(16) ?? "0"}}`;
    })
    .join("");
}

export async function renderAuditRecord(evidence: ArchiveEvidence): Promise<Uint8Array> {
  const sorted = signatures(evidence);
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await embedSignatureFont(document);
  const write = textWriter(document, font, MAX_PREPARED_PAGES);
  write("Signing audit record", 22, 20);
  write(evidence.title, 16);
  write(
    `Revision ${String(evidence.revision.number)}\nDocument SHA-256: ${evidence.revision.document.sha256}`,
    9,
  );
  write(
    `Round: ${evidence.round.id}\nConsent version: ${evidence.round.consent.version}\nConsent SHA-256: ${evidence.round.consent.sha256}`,
    9,
  );
  write(`Verbatim consent:\n${evidence.round.consent.text}`, 10);
  for (const signature of sorted) {
    const signer = evidence.signers.find((item) => item.recipientId === signature.recipientId);
    if (!signer) throw new DomainError("invalid", "A frozen signer is missing.");
    const domain = signer.email.slice(signer.email.lastIndexOf("@") + 1);
    write(`${signer.name} <${signer.email[0] ?? ""}***@${domain}>`, 12);
    write(
      `Typed name: ${signature.typedName}\nEmail verified: ${new Date(signature.verifiedAt).toISOString()}\nSigned: ${new Date(signature.signedAt).toISOString()}\nSession: ${signature.sessionId}\nIP address: ${auditText(signature.ipAddress, font)}\nUser agent: ${auditText(signature.userAgent, font)}`,
      9,
    );
  }
  write("Round timeline", 12);
  write(`Opened: ${new Date(evidence.round.createdAt).toISOString()}`, 9);
  const timeline = [...evidence.timeline].sort(
    (a, b) => timestamp(a.at) - timestamp(b.at) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
  );
  for (const event of timeline) write(`${new Date(event.at).toISOString()} — ${event.kind}`, 9);
  write(
    `All signatures recorded: ${new Date(evidence.round.finalizingAt).toISOString()}\nGenerated from evidence at: ${new Date(evidence.round.finalizingAt).toISOString()}`,
    9,
  );
  metadata(document, `${evidence.title} — signing audit`, new Date(evidence.round.finalizingAt));
  pageNumbers(document, font);
  return savePdf(document);
}
