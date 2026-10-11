// One font for signature text in the PDF and the on-screen preview; the name preflight and the
// renderer share these glyphs, widths and fit rules so a recorded signature always renders.
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import type { PDFFont } from "pdf-lib";
import { DomainError } from "../errors.ts";
import { typedNameSchema } from "../schema.ts";

export const SIGNATURE_FONT_URL = new URL("../../assets/NotoSans-Regular.ttf", import.meta.url);

/** The signature box drawn on the signature page, in PDF points. */
export const SIGNATURE_BOX = { width: 330, height: 46 } as const;

export const NAME_NOT_RENDERABLE_MESSAGE =
  "This name can’t be shown in the signed PDF. Remove unusual characters or shorten it.";

const PADDING = 8;
const MAX_SIZE = 16;
const MIN_SIZE = 6;

let fontBytes: Promise<Uint8Array> | undefined;
let preflightFont: Promise<PDFFont> | undefined;

export function loadSignatureFontBytes(): Promise<Uint8Array> {
  fontBytes ??= readFile(SIGNATURE_FONT_URL);
  return fontBytes;
}

/** Embeds the full font (no subsetting) so every glyph the preflight accepted is present. */
export async function embedSignatureFont(document: PDFDocument): Promise<PDFFont> {
  document.registerFontkit(fontkit);
  return document.embedFont(await loadSignatureFontBytes(), { subset: false });
}

export function assertTextRenderable(value: string, font: PDFFont): void {
  const supported = new Set(font.getCharacterSet());
  for (const character of value) {
    if (character === "\n") continue;
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || !supported.has(codePoint)) {
      throw new DomainError("invalid", NAME_NOT_RENDERABLE_MESSAGE);
    }
  }
}

export function wrapPdfText(
  value: string,
  font: PDFFont,
  size: number,
  width: number,
): readonly string[] {
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    let line = "";
    let lineWidth = 0;
    const push = (piece: string, pieceWidth: number): void => {
      if (lineWidth + pieceWidth > width && line !== "") {
        lines.push(line);
        line = "";
        lineWidth = 0;
      }
      line += piece;
      lineWidth += pieceWidth;
    };
    for (const token of paragraph.match(/\S+|\s+/gu) ?? []) {
      const tokenWidth = font.widthOfTextAtSize(token, size);
      if (tokenWidth <= width) {
        push(token, tokenWidth);
        continue;
      }
      // A single word wider than the box breaks between characters.
      for (const character of token) push(character, font.widthOfTextAtSize(character, size));
    }
    lines.push(line);
  }
  return lines;
}

export interface FittedText {
  readonly size: number;
  readonly lineHeight: number;
  readonly lines: readonly string[];
}

/** Largest size from 16pt down to 6pt at which the text fits the padded box. */
export function fitSignatureText(
  value: string,
  font: PDFFont,
  width: number,
  height: number,
): FittedText {
  assertTextRenderable(value, font);
  const boxWidth = width - PADDING;
  const boxHeight = height - PADDING;
  for (let size = MAX_SIZE; size >= MIN_SIZE; size--) {
    const lines = wrapPdfText(value, font, size, boxWidth);
    const lineHeight = Math.max(font.heightAtSize(size, { descender: true }), size * 1.2);
    const fitsWidth = lines.every((line) => font.widthOfTextAtSize(line, size) <= boxWidth);
    if (fitsWidth && lines.length * lineHeight <= boxHeight) return { size, lineHeight, lines };
  }
  throw new DomainError("invalid", NAME_NOT_RENDERABLE_MESSAGE);
}

/** Server-side gate for a typed signature name; resolves to the trimmed name that will be stored. */
export async function assertRenderableName(name: string): Promise<string> {
  const parsed = typedNameSchema.safeParse(name);
  if (!parsed.success) throw new DomainError("invalid", NAME_NOT_RENDERABLE_MESSAGE);
  fitSignatureText(
    parsed.data,
    await getPreflightFont(),
    SIGNATURE_BOX.width,
    SIGNATURE_BOX.height,
  );
  return parsed.data;
}

// Metrics only: the cached document is never saved.
function getPreflightFont(): Promise<PDFFont> {
  preflightFont ??= PDFDocument.create({ updateMetadata: false }).then(embedSignatureFont);
  return preflightFont;
}
