import { PDFDocument, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import { z } from 'zod';
import { StoreError } from '@dripsign/db';
import type { Signature, SigningArchiveRequest, SigningField } from '@dripsign/db';
import { assertPdfTextRenderable, embedNativeSignatureFont, fitNativeSignatureText, hashBytes, parseSigningFields, validateUploadedPdf, wrapPdfText } from './documents.ts';

const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;
// The immutable publication is bounded at 200 pages; ten signers need at most four certificate pages.
const MAX_ARTIFACT_PAGES = 200 + Math.ceil(10 / 3);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const printable = z.string().refine(value => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value));
const timestamp = z.string().min(1).max(64).refine(value => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/u.test(value) && Number.isFinite(Date.parse(value)));
const consent = z.string().min(1).max(8_000).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const signatureSchema: z.ZodType<Signature> = z.strictObject({
  roundId: z.uuid(), grantId: z.uuid(), typedName: printable.min(1).max(200).refine(value => value === value.trim()),
  consentVersion: printable.min(1).max(128), consentText: consent, consentHash: digest,
  documentSha256: digest, signedAt: timestamp, authSessionId: z.uuid(), verifiedAt: timestamp,
  requestEvidence: z.strictObject({
    ipAddress: printable.max(64).nullable(), userAgent: printable.max(500).nullable(), requestId: printable.max(200).nullable(),
  }),
});
const requestSchema = z.strictObject({
  title: z.string().min(1).max(300), pdf: z.instanceof(Uint8Array),
  round: z.strictObject({
    id: z.uuid(), agreementId: z.uuid(), revisionId: z.uuid(), documentSha256: digest,
    status: z.enum(['active', 'finalizing', 'completed', 'void']), createdAt: timestamp,
    consentVersion: printable.min(1).max(128), consentText: consent, consentHash: digest,
    requiredGrantIds: z.array(z.uuid()).min(1).max(10),
    signers: z.array(z.strictObject({ grantId: z.uuid(), name: printable.min(1).max(200), email: z.email().max(254) })).min(1).max(10),
  }), signatures: z.array(signatureSchema).min(1).max(10), fields: z.unknown(),
});

function utc(value: string): string { return new Date(value).toISOString(); }

function validateEvidence(request: SigningArchiveRequest): readonly Signature[] {
  const { round, signatures } = request;
  const ids = new Set(round.requiredGrantIds);
  if ((round.status !== 'finalizing' && round.status !== 'completed') || hashBytes(request.pdf) !== round.documentSha256
    || hashBytes(new TextEncoder().encode(round.consentText)) !== round.consentHash
    || ids.size !== round.requiredGrantIds.length || round.signers.length !== ids.size || signatures.length !== ids.size
    || new Set(round.signers.map(signer => signer.grantId)).size !== ids.size
    || new Set(round.signers.map(signer => signer.email.toLowerCase())).size !== ids.size
    || new Set(signatures.map(signature => signature.grantId)).size !== ids.size
    || round.signers.some(signer => !ids.has(signer.grantId))) throw new StoreError('invalid', 'The signing evidence is incomplete or inconsistent.');
  for (const signature of signatures) {
    if (!ids.has(signature.grantId) || signature.roundId !== round.id || signature.documentSha256 !== round.documentSha256
      || signature.consentVersion !== round.consentVersion || signature.consentText !== round.consentText || signature.consentHash !== round.consentHash
      || Date.parse(signature.signedAt) < Date.parse(round.createdAt) || Date.parse(signature.verifiedAt) > Date.parse(signature.signedAt)) {
      throw new StoreError('invalid', 'The signing evidence is incomplete or inconsistent.');
    }
  }
  return [...signatures].sort((left, right) => left.grantId < right.grantId ? -1 : left.grantId > right.grantId ? 1 : 0);
}

function validateFields(fields: readonly SigningField[], request: SigningArchiveRequest, document: PDFDocument): void {
  const keys = new Set<string>();
  for (const field of fields) {
    const key = `${field.grantId}:${field.type}`;
    if (!request.round.requiredGrantIds.includes(field.grantId) || field.page > document.getPageCount() || keys.has(key)) {
      throw new StoreError('invalid', 'The frozen signing fields are invalid.');
    }
    keys.add(key);
    const page = document.getPage(field.page - 1);
    const { width, height } = page.getSize();
    const mediaBox = page.getMediaBox();
    const cropBox = page.getCropBox();
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 14_400 || height > 14_400
      || mediaBox.x !== 0 || mediaBox.y !== 0 || cropBox.x !== 0 || cropBox.y !== 0 || cropBox.width !== width || cropBox.height !== height
      || page.getRotation().angle % 360 !== 0 || field.width * width < 12 || field.height * height < 12) {
      throw new StoreError('invalid', 'The frozen signing fields are invalid.');
    }
  }
  if (fields.length !== request.round.requiredGrantIds.length * 2
    || request.round.requiredGrantIds.some(id => !keys.has(`${id}:signature`) || !keys.has(`${id}:date`))) {
    throw new StoreError('invalid', 'The frozen signing fields are incomplete.');
  }
  for (const [index, field] of fields.entries()) {
    if (fields.slice(index + 1).some(other => field.page === other.page && field.x < other.x + other.width
      && other.x < field.x + field.width && field.y < other.y + other.height && other.y < field.y + field.height)) {
      throw new StoreError('invalid', 'The frozen signing fields overlap.');
    }
  }
}

function drawField(page: PDFPage, field: SigningField, value: string, font: PDFFont): void {
  const { width, height } = page.getSize();
  const { lines, size, lineHeight } = fitNativeSignatureText(value, font, field.width * width, field.height * height);
  lines.forEach((line, index) => page.drawText(line, { font, size, color: rgb(0.1, 0.1, 0.1),
    x: field.x * width + 4, y: height * (1 - field.y) - 4 - lineHeight * (index + 1) }));
}

function metadata(document: PDFDocument, title: string): void {
  document.setTitle(title); document.setAuthor('DripSign'); document.setCreator('DripSign');
  document.setProducer('DripSign native electronic signature pdf-lib 1.17.1');
  document.setCreationDate(new Date(0)); document.setModificationDate(new Date(0));
}

function writeCertificate(document: PDFDocument, font: PDFFont, title: string, paragraphs: readonly string[]): void {
  let page: PDFPage | undefined;
  let y = 0;
  for (const [index, paragraph] of [title, ...paragraphs].entries()) {
    assertPdfTextRenderable(paragraph, font);
    const size = index === 0 ? 18 : 8;
    for (const line of wrapPdfText(paragraph, font, size, 504)) {
      if (!page || y < 54 + size) {
        if (document.getPageCount() >= MAX_ARTIFACT_PAGES) throw new StoreError('invalid', 'The executed PDF has too many pages.');
        page = document.addPage([612, 792]); y = 738;
      }
      page.drawText(line, { x: 54, y, size, font }); y -= size * 1.5;
    }
    y -= 8;
  }
}

function signerCertificate(request: SigningArchiveRequest, signatures: readonly Signature[], includeEvidence: boolean): readonly string[] {
  return signatures.flatMap(signature => {
    const signer = request.round.signers.find(item => item.grantId === signature.grantId);
    if (!signer) throw new StoreError('invalid', 'The signing evidence is incomplete.');
    const paragraphs = [`Signer: ${signer.name} <${signer.email}>`, `Typed signature: ${signature.typedName}`,
      `Signature reference: ${signature.roundId}/${signature.grantId}`, `Signed at (server UTC): ${utc(signature.signedAt)}`];
    if (includeEvidence) {
      // Only a digest of contextual evidence is shared; raw network identifiers remain in the scoped database evidence.
      const evidenceHash = hashBytes(new TextEncoder().encode(JSON.stringify({ version: 1, roundId: signature.roundId,
        grantId: signature.grantId, ipAddress: signature.requestEvidence.ipAddress,
        userAgent: signature.requestEvidence.userAgent, requestId: signature.requestEvidence.requestId })));
      paragraphs.push(`Verified email session reference: ${signature.authSessionId}`, `Verified at (server UTC): ${utc(signature.verifiedAt)}`,
        `Context evidence SHA-256 (v1): ${evidenceHash}`);
    }
    return paragraphs;
  });
}

async function saveArtifact(document: PDFDocument): Promise<Uint8Array> {
  const bytes = await document.save({ useObjectStreams: false, updateFieldAppearances: false });
  if (bytes.length > MAX_ARTIFACT_BYTES) throw new StoreError('invalid', 'The executed artifact exceeds its size limit.');
  return bytes;
}

/** Renders a complete frozen native signing round without network calls or current-time-dependent output. */
export async function renderExecutedArtifacts(value: SigningArchiveRequest): Promise<{ readonly signedPdf: Uint8Array; readonly auditPdf: Uint8Array }> {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) throw new StoreError('invalid', 'The signing archive request is invalid.');
  const request: SigningArchiveRequest = { ...parsed.data, fields: parseSigningFields(parsed.data.fields) };
  const signatures = validateEvidence(request);
  await validateUploadedPdf(request.pdf);
  const document = await PDFDocument.load(request.pdf, { updateMetadata: false, throwOnInvalidObject: true });
  validateFields(request.fields, request, document);
  const font = await embedNativeSignatureFont(document);
  for (const field of request.fields) {
    const signature = signatures.find(item => item.grantId === field.grantId);
    if (!signature) throw new StoreError('invalid', 'The signing evidence is incomplete.');
    drawField(document.getPage(field.page - 1), field, field.type === 'signature' ? signature.typedName : utc(signature.signedAt).slice(0, 10), font);
  }
  const references = [`Agreement: ${request.round.agreementId}`, `Round: ${request.round.id}`, `Revision: ${request.round.revisionId}`,
    `Issued PDF SHA-256: ${request.round.documentSha256}`, `Round opened (server UTC): ${utc(request.round.createdAt)}`];
  const statement = 'DripSign electronic signature record. Typed signatures and server-recorded times are rendered from the frozen signing evidence. This record does not assert certificate-based PDF signing or independent timestamping.';
  metadata(document, request.title);
  writeCertificate(document, font, 'Execution certificate', [statement, ...references, ...signerCertificate(request, signatures, false)]);
  const signedPdf = await saveArtifact(document);
  const audit = await PDFDocument.create({ updateMetadata: false });
  metadata(audit, request.title);
  const auditFont = await embedNativeSignatureFont(audit);
  writeCertificate(audit, auditFont, 'Signing audit record', [statement, ...references,
    `Executed PDF SHA-256: ${hashBytes(signedPdf)}`, `Consent version: ${request.round.consentVersion}`,
    `Consent SHA-256: ${request.round.consentHash}`, `Exact consent text:\n${request.round.consentText}`,
    ...signerCertificate(request, signatures, true)]);
  return { signedPdf, auditPdf: await saveArtifact(audit) };
}
