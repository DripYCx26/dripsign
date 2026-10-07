import { createHash } from 'node:crypto';
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFNull, PDFSignature, PDFStream, StandardFonts, rgb } from 'pdf-lib';
import type { PDFObject } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';
import { z } from 'zod';
import { StoreError } from '@dripsign/db';
import type { DocumentSource, PreparedSigningDocument, RecipientGrant, SigningField } from '@dripsign/db';

// ASSUMPTION: Initial document bounds await pilot workload measurements.
const MAX_SOURCE_CHARACTERS = 60_000;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 200;
const text = z.string().refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
export const documentSourceSchema: z.ZodType<DocumentSource> = z.strictObject({
  title: text.min(1).max(200),
  sections: z.array(z.strictObject({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
    heading: text.max(200),
    paragraphs: z.array(text.min(1).max(8_000)).min(1).max(100),
  })).min(1).max(100),
}).refine(source => new Set(source.sections.map(section => section.id)).size === source.sections.length)
  .refine(source => JSON.stringify(source).length <= MAX_SOURCE_CHARACTERS);

export function parseDocumentSource(value: unknown): DocumentSource {
  const parsed = documentSourceSchema.safeParse(value);
  if (!parsed.success) throw new StoreError('invalid', 'The editable document is invalid.');
  return parsed.data;
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Accepts only the bounded upload envelope; parsing and preparation belong to the isolated jobs task. */
export function acceptUploadedPdfEnvelope(bytes: Uint8Array, maxBytes = MAX_PDF_BYTES): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 20 * 1024 * 1024
    || !bytes.length || bytes.length > maxBytes || !/^(?:%PDF-1\.[0-7]|%PDF-2\.0)$/u.test(Buffer.from(bytes.subarray(0, 8)).toString('latin1'))) {
    throw new StoreError('invalid', 'The PDF is invalid or exceeds the upload limit.');
  }
}

/** Checks format, encryption, page count, and known active objects; run in the isolated jobs task, not web. */
export async function validateUploadedPdf(bytes: Uint8Array, maxBytes = MAX_PDF_BYTES): Promise<number> {
  acceptUploadedPdfEnvelope(bytes, maxBytes);
  let document: PDFDocument;
  try { document = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true }); }
  catch (error: unknown) { throw new StoreError('invalid', 'The PDF could not be read.'); }
  const pages = document.getPageCount();
  if (document.isEncrypted || pages < 1 || pages > MAX_PAGES) throw new StoreError('invalid', 'The PDF is encrypted or has too many pages.');
  const prohibited = new Set(['JavaScript', 'JS', 'Launch', 'EmbeddedFiles', 'EmbeddedFile', 'RichMedia', 'XFA', 'OpenAction', 'AA']);
  const pending: PDFObject[] = document.context.enumerateIndirectObjects().map(([, object]) => object);
  const visited = new Set<PDFObject>();
  while (pending.length) {
    const object = pending.pop();
    if (!object || visited.has(object)) continue;
    visited.add(object);
    if (visited.size > 100_000) throw new StoreError('invalid', 'The PDF is too complex.');
    if (object instanceof PDFStream) pending.push(object.dict);
    if (object instanceof PDFArray) pending.push(...object.asArray());
    if (object instanceof PDFName && prohibited.has(object.decodeText())) throw new StoreError('invalid', 'The PDF contains unsupported active content.');
    if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        if (prohibited.has(key.decodeText())) throw new StoreError('invalid', 'The PDF contains unsupported active content.');
        pending.push(value);
      }
    }
  }
  return pages;
}

function wrapText(value: string, font: PDFFont, size: number, width: number): readonly string[] {
  const lines: string[] = [];
  for (const paragraph of value.split('\n')) {
    let line = '';
    let lineWidth = 0;
    for (const token of paragraph.match(/\S+|\s+/gu) ?? []) {
      const tokenWidth = font.widthOfTextAtSize(token, size);
      if (tokenWidth <= width) {
        if (lineWidth + tokenWidth > width) { lines.push(line); line = ''; lineWidth = 0; }
        line += token; lineWidth += tokenWidth;
        continue;
      }
      for (const character of token) {
        const characterWidth = font.widthOfTextAtSize(character, size);
        if (lineWidth + characterWidth > width) { lines.push(line); line = ''; lineWidth = 0; }
        line += character; lineWidth += characterWidth;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Renders canonical source with fixed metadata and fonts; unsupported glyphs fail instead of disappearing. */
export async function renderDocumentPdf(value: DocumentSource): Promise<Uint8Array> {
  const source = parseDocumentSource(value);
  const document = await PDFDocument.create({ updateMetadata: false });
  document.setTitle(source.title);
  document.setCreator('DripSign');
  document.setProducer('DripSign pdf-lib 1.17.1');
  document.setCreationDate(new Date(0));
  document.setModificationDate(new Date(0));
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage([612, 792]);
  let y = 738;
  function write(value: string, size: number, font: PDFFont): void {
    for (const line of wrapText(value, font, size, 504)) {
      if (y < 54 + size) {
        if (document.getPageCount() >= MAX_PAGES) throw new StoreError('invalid', 'The document has too many pages.');
        page = document.addPage([612, 792]); y = 738;
      }
      page.drawText(line, { x: 54, y, size, font });
      y -= size * 1.45;
    }
    y -= 10;
  }
  try {
    write(source.title, 18, bold);
    for (const section of source.sections) {
      if (section.heading) write(section.heading, 13, bold);
      for (const paragraph of section.paragraphs) write(paragraph, 11, regular);
    }
  } catch (error: unknown) {
    if (error instanceof StoreError) throw error;
    throw new StoreError('invalid', 'The document contains unsupported characters.');
  }
  return document.save({ useObjectStreams: false, updateFieldAppearances: false });
}

/** Creates the final preview bytes and visible signer slots before publication; original uploads stay separate. */
export async function prepareSigningDocument(bytes: Uint8Array, grants: readonly RecipientGrant[]): Promise<PreparedSigningDocument> {
  await validateUploadedPdf(bytes);
  const signers = grants.filter(grant => grant.requiredSigner && grant.revokedAt === null);
  if (!signers.length || signers.length > 10 || new Set(signers.map(signer => signer.id)).size !== signers.length
    || new Set(signers.map(signer => signer.email.toLowerCase())).size !== signers.length
    || new Set(signers.map(signer => signer.agreementId)).size !== 1) throw new StoreError('invalid', 'The required signers are invalid.');
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  if (document.getPageCount() + Math.ceil(signers.length / 3) > MAX_PAGES) throw new StoreError('invalid', 'The document has too many pages.');
  // Existing digital signatures would be invalidated by a new signature page.
  for (const field of document.getForm().getFields()) {
    if (!(field instanceof PDFSignature)) continue;
    const value = field.acroField.V();
    if (value !== undefined && value !== PDFNull) throw new StoreError('invalid', 'An already signed PDF needs a separate agreement.');
  }
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict && object.get(PDFName.of('Type')) === PDFName.of('Sig')) throw new StoreError('invalid', 'An already signed PDF needs a separate agreement.');
  }
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const fields: SigningField[] = [];
  let page = document.addPage([612, 792]);
  try {
    for (const [index, signer] of signers.entries()) {
      if (!z.uuid().safeParse(signer.id).success || !z.email().max(254).safeParse(signer.email).success
        || !text.min(1).max(200).safeParse(signer.name).success) throw new StoreError('invalid', 'The required signers are invalid.');
      if (index % 3 === 0) {
        if (index > 0) page = document.addPage([612, 792]);
        page.drawText('Signatures', { x: 54, y: 738, font: bold, size: 18 });
      }
      const top = 680 - (index % 3) * 200;
      const nameLines = wrapText(signer.name, font, 11, 504);
      if (nameLines.length > 3) throw new StoreError('invalid', 'The signer name is too long for its signature slot.');
      nameLines.forEach((line, lineIndex) => page.drawText(line, { x: 54, y: top - lineIndex * 14, font, size: 11 }));
      const emailLines = wrapText(signer.email, font, 8, 504);
      if (emailLines.length > 3) throw new StoreError('invalid', 'The signer email is too long for its signature slot.');
      emailLines.forEach((line, lineIndex) => page.drawText(line, { x: 54, y: top - 48 - lineIndex * 10, font, size: 8 }));
      const bottom = top - 118;
      page.drawRectangle({ x: 54, y: bottom, width: 330, height: 46, borderWidth: 0.5, borderColor: rgb(0.4, 0.4, 0.4) });
      page.drawRectangle({ x: 420, y: bottom, width: 138, height: 46, borderWidth: 0.5, borderColor: rgb(0.4, 0.4, 0.4) });
      page.drawText('Signature', { x: 54, y: bottom - 18, font, size: 9 });
      page.drawText('Date', { x: 420, y: bottom - 18, font, size: 9 });
      fields.push({ grantId: signer.id, type: 'signature', page: document.getPageCount(), x: 54 / 612, y: (792 - bottom - 46) / 792, width: 330 / 612, height: 46 / 792 });
      fields.push({ grantId: signer.id, type: 'date', page: document.getPageCount(), x: 420 / 612, y: (792 - bottom - 46) / 792, width: 138 / 612, height: 46 / 792 });
    }
  } catch (error: unknown) {
    if (error instanceof StoreError) throw error;
    throw new StoreError('invalid', 'The signer labels contain unsupported characters.');
  }
  const pdf = await document.save({ useObjectStreams: false, updateFieldAppearances: false });
  if (pdf.length > MAX_PDF_BYTES) throw new StoreError('invalid', 'The prepared PDF exceeds the upload limit.');
  return { pdf, fields, sha256: hashBytes(pdf) };
}
