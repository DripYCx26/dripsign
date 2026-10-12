import { PDFDocument, rgb } from "pdf-lib";
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
import { assertTextRenderable, embedSignatureFont, SIGNATURE_BOX, wrapPdfText } from "./font.ts";
import { MAX_PREPARED_PAGES, metadata, pageNumbers, PAPER, savePdf, textWriter } from "./render.ts";

const signerSchema = z.strictObject({ id: uuidSchema, name: personNameSchema, email: emailSchema });
export type DraftSigner = z.infer<typeof signerSchema>;

export interface PreparationInput {
  source: DocumentSource;
  signers: readonly DraftSigner[];
}

export interface PreparedPdf {
  bytes: Uint8Array;
  fields: SigningField[];
  pageCount: number;
}

/** Renders written terms, then one signature page per three required signers. */
export async function prepareDraftPdf(input: PreparationInput): Promise<PreparedPdf> {
  const source = documentSourceSchema.parse(input.source);
  const { title } = source;
  const signers = z.array(signerSchema).max(LIMITS.requiredSigners).parse(input.signers);
  if (
    new Set(signers.map((signer) => signer.id)).size !== signers.length ||
    new Set(signers.map((signer) => signer.email)).size !== signers.length
  ) {
    throw new DomainError("invalid", "The required signers are invalid.");
  }
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await embedSignatureFont(document);
  const write = textWriter(document, font, LIMITS.pdfPages);
  write(title, 22, 24);
  for (const [index, section] of source.sections.entries()) {
    write(`${String(index + 1)}. ${section.heading}`, 14, 12);
    for (const paragraph of section.paragraphs) write(paragraph, 11, 12);
  }
  const fields = appendSignaturePages(document, font, signers);
  metadata(document, title, new Date(0));
  pageNumbers(document, font);
  return { bytes: await savePdf(document), fields, pageCount: document.getPageCount() };
}

function appendSignaturePages(
  document: PDFDocument,
  font: PDFFont,
  signers: readonly DraftSigner[],
): SigningField[] {
  const fields: SigningField[] = [];
  for (const [index, signer] of signers.entries()) {
    if (index % 3 === 0) {
      if (document.getPageCount() >= MAX_PREPARED_PAGES)
        throw new DomainError("invalid", "The PDF has too many pages.");
      const page = document.addPage([PAPER.width, PAPER.height]);
      page.drawText("Signatures", { x: 54, y: 738, size: 20, font });
    }
    const page = document.getPage(document.getPageCount() - 1);
    const top = 680 - (index % 3) * 200;
    assertTextRenderable(signer.name, font);
    const lines = wrapPdfText(signer.name, font, 11, 504);
    if (lines.length > 3) throw new DomainError("invalid", "The signer label is too long.");
    lines.forEach((line, lineIndex) => {
      page.drawText(line, { x: 54, y: top - lineIndex * 11 * 1.3, size: 11, font });
    });
    const bottom = top - 118;
    for (const [type, x, width] of [
      ["signature", 54, SIGNATURE_BOX.width],
      ["date", 420, 138],
    ] as const) {
      page.drawRectangle({
        x,
        y: bottom,
        width,
        height: SIGNATURE_BOX.height,
        borderWidth: 0.5,
        borderColor: rgb(0.5, 0.55, 0.6),
      });
      page.drawText(type === "signature" ? "Signature" : "Date (UTC)", {
        x,
        y: bottom - 18,
        size: 9,
        font,
      });
      fields.push({
        recipientId: signer.id,
        type,
        page: document.getPageCount(),
        x: x / PAPER.width,
        y: (PAPER.height - bottom - SIGNATURE_BOX.height) / PAPER.height,
        width: width / PAPER.width,
        height: SIGNATURE_BOX.height / PAPER.height,
      });
    }
  }
  return fields;
}
