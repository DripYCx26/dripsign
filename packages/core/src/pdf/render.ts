import { PDFDocument, rgb } from "pdf-lib";
import type { PDFFont, PDFPage, RGB } from "pdf-lib";
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

export const INK = rgb(0.12, 0.15, 0.19);
export const MUTED = rgb(0.38, 0.4, 0.44);

export interface TextStyle {
  readonly color?: RGB;
  /** Text starts this far past the margin; `hang` (a section number) sits in the gap it leaves. */
  readonly indent?: number;
  readonly hang?: string;
  /** A rule of this thickness one line below the text, `gap` above whatever follows. */
  readonly rule?: number;
}

export function textWriter(document: PDFDocument, font: PDFFont, maxPages: number) {
  let page: PDFPage | undefined;
  let y = 0;
  return (value: string, size = 11, gap = 10, style: TextStyle = {}): void => {
    const { color = INK, indent = 0, hang, rule } = style;
    assertTextRenderable(value + (hang ?? ""), font);
    const width = PAPER.width - PAPER.margin * 2;
    for (const [index, line] of wrapPdfText(value, font, size, width - indent).entries()) {
      if (!page || y < PAPER.margin + size) {
        if (document.getPageCount() >= maxPages)
          throw new DomainError("invalid", "The PDF has too many pages.");
        page = document.addPage([PAPER.width, PAPER.height]);
        y = PAPER.height - PAPER.margin;
      }
      if (index === 0 && hang !== undefined)
        page.drawText(hang, { x: PAPER.margin, y, size, font, color: MUTED });
      page.drawText(line, { x: PAPER.margin + indent, y, size, font, color });
      y -= size * 1.5;
    }
    if (rule !== undefined) {
      const start = { x: PAPER.margin, y };
      page?.drawLine({ start, end: { x: PAPER.margin + width, y }, thickness: rule, color: MUTED });
    }
    y -= gap;
  };
}

export function pageNumbers(document: PDFDocument, font: PDFFont): void {
  const pages = document.getPages();
  for (const [index, page] of pages.entries()) {
    const label = `${String(index + 1)} / ${String(pages.length)}`;
    page.drawText(label, {
      x: page.getWidth() - PAPER.margin - font.widthOfTextAtSize(label, 8),
      y: 26,
      size: 8,
      font,
    });
  }
}

export async function savePdf(document: PDFDocument): Promise<Uint8Array> {
  const bytes = await document.save({ useObjectStreams: false, updateFieldAppearances: false });
  if (bytes.byteLength > LIMITS.pdfBytes)
    throw new DomainError("invalid", "The PDF exceeds its size limit.");
  return bytes;
}
