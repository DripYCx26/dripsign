import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream, rgb } from "pdf-lib";
import type { PDFObject, PDFFont } from "pdf-lib";
import { z } from "zod";
import { DomainError } from "../errors.ts";
import {
  documentSourceSchema,
  emailSchema,
  LIMITS,
  personNameSchema,
  titleSchema,
  uuidSchema,
} from "../schema.ts";
import type { DocumentSource, SigningField } from "../schema.ts";
import { assertTextRenderable, embedSignatureFont, SIGNATURE_BOX, wrapPdfText } from "./font.ts";
import { MAX_PREPARED_PAGES, metadata, pageNumbers, PAPER, savePdf, textWriter } from "./render.ts";
import { isolateUpload } from "./isolate.ts";
import { assertInflationBound } from "./preflight.ts";

const signerSchema = z.strictObject({ id: uuidSchema, name: personNameSchema, email: emailSchema });
export type DraftSigner = z.infer<typeof signerSchema>;

export interface PreparationInput {
  title: string;
  source?: DocumentSource;
  uploadBytes?: Uint8Array;
  signers: readonly DraftSigner[];
}

export interface PreparedPdf {
  bytes: Uint8Array;
  fields: SigningField[];
  pageCount: number;
}

export async function prepareDraftPdf(
  input: PreparationInput,
  signal?: AbortSignal,
): Promise<PreparedPdf> {
  const title = titleSchema.parse(input.title);
  const signers = z.array(signerSchema).max(LIMITS.requiredSigners).parse(input.signers);
  if (
    new Set(signers.map((signer) => signer.id)).size !== signers.length ||
    new Set(signers.map((signer) => signer.email)).size !== signers.length
  ) {
    throw new DomainError("invalid", "The required signers are invalid.");
  }
  if ((input.source === undefined) === (input.uploadBytes === undefined)) {
    throw new DomainError("invalid", "Use terms or a PDF, not both.");
  }
  signal?.throwIfAborted();
  if (input.uploadBytes) {
    if (input.uploadBytes.byteLength === 0 || input.uploadBytes.byteLength > LIMITS.pdfBytes)
      throw new DomainError("invalid", "The PDF exceeds the upload limit.");
    // Parsing, copying and rendering stay in the bounded isolate; no attacker PDF is re-parsed here.
    return isolateUpload({ ...input, title, signers }, signal);
  }
  return preparePdfInProcess({ ...input, title, signers });
}

/** The isolate entry; callers handling uploads must use prepareDraftPdf's resource supervision. */
export async function preparePdfInProcess(input: PreparationInput): Promise<PreparedPdf> {
  const { title, signers } = input;
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await embedSignatureFont(document);
  let uploadedPages = 0;
  if (input.uploadBytes) {
    const uploaded = await loadUploadedPdf(input.uploadBytes);
    const pages = await document.copyPages(uploaded, uploaded.getPageIndices());
    for (const page of pages) document.addPage(page);
    rejectActiveContent(document);
    uploadedPages = pages.length;
  } else {
    const source = documentSourceSchema.parse(input.source);
    const write = textWriter(document, font, LIMITS.pdfPages);
    write(title, 22, 24);
    for (const [index, section] of source.sections.entries()) {
      write(`${String(index + 1)}. ${section.heading}`, 14, 12);
      for (const paragraph of section.paragraphs) write(paragraph, 11, 12);
    }
  }
  const fields = appendSignaturePages(document, font, signers);
  metadata(document, title, new Date(0));
  pageNumbers(document, font, uploadedPages);
  return { bytes: await savePdf(document), fields, pageCount: document.getPageCount() };
}

async function loadUploadedPdf(bytes: Uint8Array): Promise<PDFDocument> {
  if (bytes.byteLength === 0 || bytes.byteLength > LIMITS.pdfBytes) {
    throw new DomainError("invalid", "The PDF exceeds the upload limit.");
  }
  assertInflationBound(bytes);
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  } catch {
    throw new DomainError("invalid", "The PDF could not be read or is encrypted.");
  }
  if (
    document.isEncrypted ||
    document.getPageCount() < 1 ||
    document.getPageCount() > LIMITS.pdfPages
  ) {
    throw new DomainError("invalid", "The PDF is encrypted or has too many pages.");
  }
  return document;
}

function rejectActiveContent(document: PDFDocument): void {
  const indirectObjects = document.context.enumerateIndirectObjects();
  if (indirectObjects.length > 100_000) throw new DomainError("invalid", "The PDF is too complex.");
  rejectPageActions(document);
  const prohibited = new Set([
    "JavaScript",
    "JS",
    "Launch",
    "EmbeddedFiles",
    "EmbeddedFile",
    "FileAttachment",
    "EF",
    "RichMedia",
  ]);
  const pending: PDFObject[] = indirectObjects.map(([, object]) => object);
  const visited = new Set<PDFObject>();
  const additionalActionVisited = new Set<PDFObject>();
  while (pending.length > 0) {
    const object = pending.pop();
    if (!object || visited.has(object)) continue;
    if (object instanceof PDFStream || object instanceof PDFArray || object instanceof PDFDict)
      visited.add(object);
    if (object instanceof PDFStream) pending.push(object.dict);
    if (object instanceof PDFArray) pending.push(...object.asArray());
    if (object instanceof PDFName && prohibited.has(object.decodeText()))
      throw new DomainError("invalid", "The PDF contains unsupported active content.");
    if (object instanceof PDFDict) {
      rejectSignedField(document, object);
      rejectAdditionalActions(document, object, additionalActionVisited);
      for (const [key, value] of object.entries()) {
        if (prohibited.has(key.decodeText()))
          throw new DomainError("invalid", "The PDF contains unsupported active content.");
        pending.push(value);
      }
    }
  }
}

function rejectSignedField(document: PDFDocument, field: PDFDict): void {
  const type = document.context.lookup(field.get(PDFName.of("FT")));
  if (type instanceof PDFName && type.decodeText() === "Sig" && field.has(PDFName.of("V")))
    throw new DomainError("invalid", "The PDF contains unsupported active content.");
}

function rejectPageActions(document: PDFDocument): void {
  const visited = new Set<PDFObject>();
  const linkVisited = new Set<PDFObject>();
  for (const page of document.getPages()) {
    const annotations = document.context.lookup(page.node.get(PDFName.of("Annots")));
    if (annotations === undefined) continue;
    if (!(annotations instanceof PDFArray))
      throw new DomainError("invalid", "The PDF contains unsupported active content.");
    for (const reference of annotations.asArray()) {
      const annotation = document.context.lookup(reference);
      if (!(annotation instanceof PDFDict))
        throw new DomainError("invalid", "The PDF contains unsupported active content.");
      const action = annotation.get(PDFName.of("A"));
      const subtype = document.context.lookup(annotation.get(PDFName.of("Subtype")));
      const isLink = subtype instanceof PDFName && subtype.decodeText() === "Link";
      if (action !== undefined)
        rejectUnsupportedAction(document, action, isLink ? linkVisited : visited, isLink);
    }
  }
}

function rejectAdditionalActions(
  document: PDFDocument,
  owner: PDFDict,
  visited: Set<PDFObject>,
): void {
  const reference = owner.get(PDFName.of("AA"));
  if (reference === undefined) return;
  const actions = document.context.lookup(reference);
  if (!(actions instanceof PDFDict))
    throw new DomainError("invalid", "The PDF contains unsupported active content.");
  for (const [, action] of actions.entries()) rejectUnsupportedAction(document, action, visited);
}

function rejectUnsupportedAction(
  document: PDFDocument,
  action: PDFObject,
  visited: Set<PDFObject>,
  allowUri = false,
): void {
  const pending = [action];
  while (pending.length > 0) {
    const object = document.context.lookup(pending.pop());
    if (!object) throw new DomainError("invalid", "The PDF contains unsupported active content.");
    if (visited.has(object)) continue;
    visited.add(object);
    if (!(object instanceof PDFDict))
      throw new DomainError("invalid", "The PDF contains unsupported active content.");
    const type = document.context.lookup(object.get(PDFName.of("S")));
    const name = document.context.lookup(object.get(PDFName.of("N")));
    if (
      !(type instanceof PDFName) ||
      !(
        type.decodeText() === "GoTo" ||
        (allowUri && type.decodeText() === "URI") ||
        (type.decodeText() === "Named" &&
          name instanceof PDFName &&
          ["NextPage", "PrevPage", "FirstPage", "LastPage"].includes(name.decodeText()))
      )
    )
      throw new DomainError("invalid", "The PDF contains unsupported active content.");
    const next = object.get(PDFName.of("Next"));
    if (next === undefined) continue;
    const resolved = document.context.lookup(next);
    pending.push(...(resolved instanceof PDFArray ? resolved.asArray() : [next]));
  }
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
