import { PDFDocument } from "pdf-lib";
import type { PDFFont } from "pdf-lib";
import { z } from "zod";
import { DomainError } from "../errors.ts";
import {
  documentSourceSchema,
  emailSchema,
  LIMITS,
  personNameSchema,
  uuidSchema,
} from "../schema.ts";
import type { DocumentSource, SigningField } from "../schema.ts";
import { assertTextRenderable, covers, embedFont, SIGNATURE_BOX, wrapPdfText } from "./font.ts";
import {
  INK,
  MAX_PREPARED_PAGES,
  metadata,
  MUTED,
  pageNumbers,
  PAPER,
  savePdf,
  textWriter,
} from "./render.ts";

const signerSchema = z.strictObject({ id: uuidSchema, name: personNameSchema, email: emailSchema });
export type DraftSigner = z.infer<typeof signerSchema>;

export interface PreparationInput {
  source: DocumentSource;
  signers: readonly DraftSigner[];
  /** The revision number the publish of this PDF creates: the bytes are fixed at review. */
  revision: number;
  organisation: string;
}

export interface PreparedPdf {
  bytes: Uint8Array;
  fields: SigningField[];
  pageCount: number;
}

// A section number's gutter, wide enough for "100." at the heading size.
const GUTTER = 30;
const CAPTION = { size: 9, leading: 12 } as const;
const EVIDENCE_HEIGHT = 14;

/** Renders the title block and written terms, then one signature page per three signers. */
export async function prepareDraftPdf(input: PreparationInput): Promise<PreparedPdf> {
  const source = documentSourceSchema.parse(input.source);
  const signers = z.array(signerSchema).max(LIMITS.requiredSigners).parse(input.signers);
  const revision = z.number().int().positive().parse(input.revision);
  if (
    new Set(signers.map((signer) => signer.id)).size !== signers.length ||
    new Set(signers.map((signer) => signer.email)).size !== signers.length
  ) {
    throw new DomainError("invalid", "The required signers are invalid.");
  }
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await embedFont(document, "plain");
  const write = textWriter(document, font, LIMITS.pdfPages);
  write(source.title, 24, 0);
  write(metaLine(revision, input.organisation, signers, font), 9, 30, { color: MUTED, rule: 0.5 });
  for (const [index, section] of source.sections.entries()) {
    const hang = `${String(index + 1)}.`;
    if (section.heading !== "") write(section.heading, 14, 4, { indent: GUTTER, hang });
    section.paragraphs.forEach((paragraph, at) => {
      write(paragraph, 11, at === section.paragraphs.length - 1 ? 18 : 6, { indent: GUTTER });
    });
  }
  const fields = appendSignaturePages(document, font, signers);
  metadata(document, source.title, new Date(0));
  pageNumbers(document, font);
  return { bytes: await savePdf(document), fields, pageCount: document.getPageCount() };
}

/**
 * "REVISION 2 · BETWEEN NORTHWIND STUDIO AND JORDAN LEE, TAYLOR KIM": signer names only, never
 * emails. No date: publish happens after these bytes are reviewed. Noto Sans has no "↔".
 */
function metaLine(
  revision: number,
  organisation: string,
  signers: readonly DraftSigner[],
  font: PDFFont,
): string {
  const names = signers.map((signer) => signer.name).join(", ");
  const parties = names === "" ? organisation : `Between ${organisation} and ${names}`;
  const line = `Revision ${String(revision)} · ${parties}`;
  // An uppercase form can need a glyph the lowercase did not; the text as written still renders.
  return covers(font, line.toUpperCase()) ? line.toUpperCase() : line;
}

/**
 * Per signer: an empty signature field over a 0.75pt rule, the signer's name as a caption, then
 * the date field where the signed PDF writes "Signed … UTC · Email verified".
 */
function appendSignaturePages(
  document: PDFDocument,
  font: PDFFont,
  signers: readonly DraftSigner[],
): SigningField[] {
  const fields: SigningField[] = [];
  const field = (recipientId: string, type: SigningField["type"], bottom: number, height: number) =>
    fields.push({
      recipientId,
      type,
      page: document.getPageCount(),
      x: PAPER.margin / PAPER.width,
      y: (PAPER.height - bottom - height) / PAPER.height,
      width: SIGNATURE_BOX.width / PAPER.width,
      height: height / PAPER.height,
    });
  for (const [index, signer] of signers.entries()) {
    if (index % 3 === 0) {
      if (document.getPageCount() >= MAX_PREPARED_PAGES)
        throw new DomainError("invalid", "The PDF has too many pages.");
      const page = document.addPage([PAPER.width, PAPER.height]);
      page.drawText("Signatures", { x: PAPER.margin, y: 738, size: 20, font, color: INK });
    }
    const page = document.getPage(document.getPageCount() - 1);
    const rule = 664 - (index % 3) * 130;
    page.drawLine({
      start: { x: PAPER.margin, y: rule },
      end: { x: PAPER.margin + SIGNATURE_BOX.width, y: rule },
      thickness: 0.75,
      color: MUTED,
    });
    field(signer.id, "signature", rule, SIGNATURE_BOX.height);
    assertTextRenderable(signer.name, font);
    const width = PAPER.width - PAPER.margin * 2;
    const caption = wrapPdfText(signer.name, font, CAPTION.size, width);
    if (caption.length > 3) throw new DomainError("invalid", "The signer label is too long.");
    caption.forEach((line, at) => {
      const y = rule - CAPTION.leading * (at + 1);
      page.drawText(line, { x: PAPER.margin, y, size: CAPTION.size, font, color: MUTED });
    });
    const captionBottom = rule - CAPTION.leading * caption.length - 6;
    field(signer.id, "date", captionBottom - EVIDENCE_HEIGHT, EVIDENCE_HEIGHT);
  }
  return fields;
}
