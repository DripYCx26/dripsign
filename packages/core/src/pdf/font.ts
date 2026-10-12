// The PDF's two faces: Noto Sans for all text, and Newsreader Italic for a typed signature whose
// every glyph it has. The name preflight and the renderer share these glyphs, widths and fit rules
// so a recorded signature always renders, in the face the preview showed.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import type { PDFFont } from "pdf-lib";
import { DomainError } from "../errors.ts";
import { typedNameSchema } from "../schema.ts";

// A path from `import.meta.url`, not `new URL(..., import.meta.url)`: Next's bundler rewrites that
// form into a `/_next/static/media/` asset URL that `readFile` cannot open in a server action.
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `script` is Newsreader Italic, `plain` is Noto Sans. */
export type SignatureFace = "script" | "plain";

// One literal path per face, so the bundler traces the two files and nothing else.
const READ_FONT: Readonly<Record<SignatureFace, () => Promise<Uint8Array>>> = {
  script: () => readFile(path.join(HERE, "../../assets/Newsreader-Italic.ttf")),
  plain: () => readFile(path.join(HERE, "../../assets/NotoSans-Regular.ttf")),
};

/** The signature box drawn on the signature page, in PDF points. */
export const SIGNATURE_BOX = { width: 330, height: 46 } as const;

export const NAME_NOT_RENDERABLE_MESSAGE =
  "This name can’t be shown in the signed PDF. Remove unusual characters or shorten it.";

const PADDING = 8;
const MAX_SIZE: Readonly<Record<SignatureFace, number>> = { script: 20, plain: 16 };
const MIN_SIZE = 6;

const fontBytes = new Map<SignatureFace, Promise<Uint8Array>>();
let preflightFonts: Promise<Readonly<Record<SignatureFace, PDFFont>>> | undefined;

/** Embeds the full font (no subsetting) so every glyph the preflight accepted is present. */
export async function embedFont(document: PDFDocument, face: SignatureFace): Promise<PDFFont> {
  let bytes = fontBytes.get(face);
  if (!bytes) {
    bytes = READ_FONT[face]();
    fontBytes.set(face, bytes);
  }
  document.registerFontkit(fontkit);
  return document.embedFont(await bytes, { subset: false });
}

/** True when the font has a glyph for every character of the value. */
export function covers(font: PDFFont, value: string): boolean {
  const supported = new Set(font.getCharacterSet());
  return Array.from(value).every(
    (character) => character === "\n" || supported.has(character.codePointAt(0) ?? -1),
  );
}

export function assertTextRenderable(value: string, font: PDFFont): void {
  if (!covers(font, value)) throw new DomainError("invalid", NAME_NOT_RENDERABLE_MESSAGE);
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

/** Largest size from the face's maximum (20pt script, 16pt plain) down to 6pt that fits the box. */
export function fitSignatureText(
  value: string,
  font: PDFFont,
  box: Readonly<{ width: number; height: number }>,
  face: SignatureFace = "plain",
): FittedText {
  assertTextRenderable(value, font);
  const boxWidth = box.width - PADDING;
  const boxHeight = box.height - PADDING;
  for (let size = MAX_SIZE[face]; size >= MIN_SIZE; size--) {
    const lines = wrapPdfText(value, font, size, boxWidth);
    const lineHeight = Math.max(font.heightAtSize(size, { descender: true }), size * 1.2);
    const fitsWidth = lines.every((line) => font.widthOfTextAtSize(line, size) <= boxWidth);
    if (fitsWidth && lines.length * lineHeight <= boxHeight) return { size, lineHeight, lines };
  }
  throw new DomainError("invalid", NAME_NOT_RENDERABLE_MESSAGE);
}

/** Newsreader Italic when it has every glyph of the name, else Noto Sans: what the PDF draws. */
export async function signatureFaceOf(name: string): Promise<SignatureFace> {
  return covers((await getPreflightFonts()).script, name) ? "script" : "plain";
}

/** Server-side gate for a typed signature name; resolves to the face the signed PDF draws it in. */
export async function assertRenderableName(name: string): Promise<SignatureFace> {
  const parsed = typedNameSchema.safeParse(name);
  if (!parsed.success) throw new DomainError("invalid", NAME_NOT_RENDERABLE_MESSAGE);
  const face = await signatureFaceOf(parsed.data);
  const fonts = await getPreflightFonts();
  fitSignatureText(parsed.data, fonts[face], SIGNATURE_BOX, face);
  return face;
}

// Metrics only: the cached document is never saved.
function getPreflightFonts(): Promise<Readonly<Record<SignatureFace, PDFFont>>> {
  preflightFonts ??= PDFDocument.create({ updateMetadata: false }).then(async (document) => ({
    script: await embedFont(document, "script"),
    plain: await embedFont(document, "plain"),
  }));
  return preflightFonts;
}
