import { GetObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import type { DocumentAsset } from '@dripsign/db';
import { StoreError } from '@dripsign/db';
import { acceptUploadedPdfEnvelope, hashBytes, validateUploadedPdf } from './documents.ts';

export type DocumentKind = 'draft' | 'revision' | 'signed_document' | 'audit_record';

/**
 * The document storage port. Objects are private and content-addressed inside one tenant and
 * agreement; a write never replaces an object and a read returns only the exact recorded bytes.
 * The port has no delete. Configuration chooses the adapter (`providers.ts`).
 */
export interface DocumentStorage {
  putImmutable(tenantId: string, agreementId: string, kind: DocumentKind, bytes: Uint8Array): Promise<DocumentAsset>;
  /** Stores a private original without parsing; this asset is not a prepared or published document. */
  putRawPdfImmutable(tenantId: string, agreementId: string, bytes: Uint8Array): Promise<DocumentAsset>;
  get(tenantId: string, agreementId: string, asset: DocumentAsset): Promise<Uint8Array>;
}

function scopePrefix(tenantId: string, agreementId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(tenantId) || !/^[A-Za-z0-9_-]{1,128}$/u.test(agreementId)) {
    throw new StoreError('invalid', 'The document scope is invalid.');
  }
  return `tenants/${tenantId}/agreements/${agreementId}/`;
}

/** Applies the parse bounds for a stored kind before any provider call. */
export async function validateDocumentForKind(kind: DocumentKind, bytes: Uint8Array): Promise<void> {
  if (!['draft', 'revision', 'signed_document', 'audit_record'].includes(kind)) throw new StoreError('invalid', 'The document kind is invalid.');
  const isPreparedDocument = kind === 'draft' || kind === 'revision';
  // Executed renditions may append four certificate pages; drafts and immutable publications keep their original quarantine bounds.
  await validateUploadedPdf(bytes, isPreparedDocument ? 10 * 1024 * 1024 : 20 * 1024 * 1024, isPreparedDocument ? 200 : 200 + Math.ceil(10 / 3));
}

/** Names the content-addressed object for exact bytes; the key is derived, never supplied. */
export function contentAddressedAsset(tenantId: string, agreementId: string, kind: DocumentKind, bytes: Uint8Array): DocumentAsset {
  const sha256 = hashBytes(bytes);
  return { objectKey: `${scopePrefix(tenantId, agreementId)}${kind}/${sha256}.pdf`,
    sha256, byteLength: bytes.length, contentType: 'application/pdf' };
}

/** Refuses a malformed asset or one outside the caller's scope before any provider call. */
export function assertScopedAsset(tenantId: string, agreementId: string, asset: DocumentAsset): void {
  const prefix = scopePrefix(tenantId, agreementId);
  if (!/^[a-f0-9]{64}$/u.test(asset.sha256) || !Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1 || asset.byteLength > 20 * 1024 * 1024
    || asset.contentType !== 'application/pdf' || !asset.objectKey.startsWith(prefix)
    || !/^(draft|revision|signed_document|audit_record)\/[a-f0-9]{64}\.pdf$/u.test(asset.objectKey.slice(prefix.length))
    || !asset.objectKey.endsWith(`/${asset.sha256}.pdf`)) throw new StoreError('not_found', 'The document is unavailable.');
}

/** Reads exactly the asset's bytes from a provider stream and verifies its hash; the stream is always cancelled. */
export async function readVerifiedDocument(body: ReadableStream<Uint8Array>, declaredLength: number | undefined,
  asset: DocumentAsset, signal: AbortSignal): Promise<Uint8Array> {
  const reader = body.getReader();
  const onAbort = (): void => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (declaredLength !== asset.byteLength) throw new Error('Stored document length does not match.');
    const bytes = new Uint8Array(asset.byteLength);
    let offset = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (offset + next.value.length > bytes.length) throw new Error('Stored document exceeds its limit.');
      bytes.set(next.value, offset); offset += next.value.length;
    }
    if (signal.aborted || offset !== asset.byteLength || hashBytes(bytes) !== asset.sha256) throw new Error('Stored document integrity check failed.');
    return bytes;
  } finally {
    signal.removeEventListener('abort', onAbort);
    await reader.cancel(); reader.releaseLock();
  }
}

/** Private, content-addressed objects cannot be replaced; reads verify exact bytes and tenant containment. */
export class S3DocumentStorage implements DocumentStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly kmsKeyId: string | undefined;

  constructor(region: string, bucket: string, kmsKeyId?: string) {
    if (!region || !bucket) throw new Error('Document storage configuration is missing.');
    this.client = new S3Client({ region, maxAttempts: 1 });
    this.bucket = bucket;
    this.kmsKeyId = kmsKeyId;
  }

  async putImmutable(tenantId: string, agreementId: string, kind: DocumentKind, bytes: Uint8Array): Promise<DocumentAsset> {
    await validateDocumentForKind(kind, bytes);
    return this.writeImmutableAsset(tenantId, agreementId, kind, bytes);
  }

  async putRawPdfImmutable(tenantId: string, agreementId: string, bytes: Uint8Array): Promise<DocumentAsset> {
    acceptUploadedPdfEnvelope(bytes);
    return this.writeImmutableAsset(tenantId, agreementId, 'draft', bytes);
  }

  private async writeImmutableAsset(tenantId: string, agreementId: string, kind: DocumentKind, bytes: Uint8Array): Promise<DocumentAsset> {
    const asset = contentAddressedAsset(tenantId, agreementId, kind, bytes);
    const { sha256 } = asset;
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: asset.objectKey, Body: bytes,
        ContentType: asset.contentType, ContentLength: bytes.length, IfNoneMatch: '*',
        ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
        ServerSideEncryption: this.kmsKeyId ? 'aws:kms' : 'AES256',
        ...(this.kmsKeyId ? { SSEKMSKeyId: this.kmsKeyId } : {}),
        Metadata: { sha256 },
      }), { abortSignal: AbortSignal.timeout(30_000) });
    } catch (error: unknown) {
      if (!(error instanceof S3ServiceException) || error.$metadata.httpStatusCode !== 412) throw error;
      await this.get(tenantId, agreementId, asset);
    }
    return asset;
  }

  async get(tenantId: string, agreementId: string, asset: DocumentAsset): Promise<Uint8Array> {
    assertScopedAsset(tenantId, agreementId, asset);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: asset.objectKey }), { abortSignal: controller.signal });
      if (!response.Body) throw new Error('Stored document is missing.');
      return await readVerifiedDocument(response.Body.transformToWebStream(), response.ContentLength, asset, controller.signal);
    } finally { clearTimeout(timeout); }
  }
}
