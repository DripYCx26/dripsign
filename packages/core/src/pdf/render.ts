import { PDFDocument, rgb } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import { LIMITS } from "../schema.ts";
import { DomainError } from "../errors.ts";
import { assertTextRenderable, wrapPdfText } from "./font.ts";

export const PAPER = { width: 612, height: 792, margin: 54 } as const;
export const MAX_PREPARED_PAGES = LIMITS.pdfPages + Math.ceil(LIMITS.requiredSigners / 3);

export function metadata(document: PDFDocument, title: string, generatedAt: Date): void {
  document.setTitle(title);
  document.setAuthor("DripSign");
  document.setCreator("DripSign");
  document.setProducer("DripSign pdf-lib 1.17.1");
  document.setCreationDate(generatedAt);
  document.setModificationDate(generatedAt);
}

export function textWriter(document: PDFDocument, font: PDFFont, maxPages: number) {
  let page: PDFPage | undefined;
  let y = 0;
  return (value: string, size = 11, gap = 10): void => {
    assertTextRenderable(value, font);
    for (const line of wrapPdfText(value, font, size, PAPER.width - PAPER.margin * 2)) {
      if (!page || y < PAPER.margin + size) {
        if (document.getPageCount() >= maxPages)
          throw new DomainError("invalid", "The PDF has too many pages.");
        page = document.addPage([PAPER.width, PAPER.height]);
        y = PAPER.height - PAPER.margin;
      }
      page.drawText(line, { x: PAPER.margin, y, size, font, color: rgb(0.12, 0.15, 0.19) });
      y -= size * 1.5;
    }
    y -= gap;
  };
}

export function pageNumbers(document: PDFDocument, font: PDFFont, firstPage = 0): void {
  const pages = document.getPages();
  for (const [index, page] of pages.entries()) {
    if (index < firstPage) continue;
    const label = `${String(index + 1)} / ${String(pages.length)}`;
    page.drawText(label, {
      x: page.getWidth() - PAPER.margin - font.widthOfTextAtSize(label, 8),
      y: 26,
      size: 8,
      font,
    });
  }
}

export async function savePdf(
  document: PDFDocument,
  byteLimit = LIMITS.pdfBytes * 2,
): Promise<Uint8Array> {
  const bytes = await document.save({ useObjectStreams: false, updateFieldAppearances: false });
  if (bytes.byteLength > byteLimit)
    throw new DomainError("invalid", "The PDF exceeds its size limit.");
  return bytes;
}
