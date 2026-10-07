import { GetObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import type { DocumentAsset } from '@dripsign/db';
import { StoreError } from '@dripsign/db';
import { acceptUploadedPdfEnvelope, hashBytes, validateUploadedPdf } from './documents.ts';

function scopePrefix(tenantId: string, agreementId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(tenantId) || !/^[A-Za-z0-9_-]{1,128}$/u.test(agreementId)) {
    throw new StoreError('invalid', 'The document scope is invalid.');
  }
  return `tenants/${tenantId}/agreements/${agreementId}/`;
}

/** Private, content-addressed objects cannot be replaced; reads verify exact bytes and tenant containment. */
export class S3DocumentStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly kmsKeyId: string | undefined;

  constructor(region: string, bucket: string, kmsKeyId?: string) {
    if (!region || !bucket) throw new Error('Document storage configuration is missing.');
    this.client = new S3Client({ region, maxAttempts: 1 });
    this.bucket = bucket;
    this.kmsKeyId = kmsKeyId;
  }

  async putImmutable(tenantId: string, agreementId: string, kind: 'draft' | 'revision' | 'signed_document' | 'audit_record', bytes: Uint8Array): Promise<DocumentAsset> {
    if (!['draft', 'revision', 'signed_document', 'audit_record'].includes(kind)) throw new StoreError('invalid', 'The document kind is invalid.');
    await validateUploadedPdf(bytes, kind === 'draft' || kind === 'revision' ? 10 * 1024 * 1024 : 20 * 1024 * 1024);
    return this.writeImmutableAsset(tenantId, agreementId, kind, bytes);
  }

  /** Stores a private original without parsing; this asset is not a prepared or published document. */
  async putRawPdfImmutable(tenantId: string, agreementId: string, bytes: Uint8Array): Promise<DocumentAsset> {
    acceptUploadedPdfEnvelope(bytes);
    return this.writeImmutableAsset(tenantId, agreementId, 'draft', bytes);
  }

  private async writeImmutableAsset(tenantId: string, agreementId: string, kind: 'draft' | 'revision' | 'signed_document' | 'audit_record', bytes: Uint8Array): Promise<DocumentAsset> {
    const sha256 = hashBytes(bytes);
    const asset: DocumentAsset = { objectKey: `${scopePrefix(tenantId, agreementId)}${kind}/${sha256}.pdf`,
      sha256, byteLength: bytes.length, contentType: 'application/pdf' };
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
    const prefix = scopePrefix(tenantId, agreementId);
    if (!/^[a-f0-9]{64}$/u.test(asset.sha256) || !Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1 || asset.byteLength > 20 * 1024 * 1024
      || asset.contentType !== 'application/pdf' || !asset.objectKey.startsWith(prefix)
      || !/^(draft|revision|signed_document|audit_record)\/[a-f0-9]{64}\.pdf$/u.test(asset.objectKey.slice(prefix.length))
      || !asset.objectKey.endsWith(`/${asset.sha256}.pdf`)) throw new StoreError('not_found', 'The document is unavailable.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: asset.objectKey }), { abortSignal: controller.signal });
      if (!response.Body) throw new Error('Stored document is missing.');
      const reader = response.Body.transformToWebStream().getReader();
      const onAbort = (): void => { void reader.cancel().catch(() => undefined); };
      controller.signal.addEventListener('abort', onAbort, { once: true });
      try {
        if (response.ContentLength !== asset.byteLength) throw new Error('Stored document length does not match.');
        const bytes = new Uint8Array(asset.byteLength);
        let offset = 0;
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          if (offset + next.value.length > bytes.length) throw new Error('Stored document exceeds its limit.');
          bytes.set(next.value, offset); offset += next.value.length;
        }
        if (controller.signal.aborted || offset !== asset.byteLength || hashBytes(bytes) !== asset.sha256) throw new Error('Stored document integrity check failed.');
        return bytes;
      } finally {
        controller.signal.removeEventListener('abort', onAbort);
        await reader.cancel(); reader.releaseLock();
      }
    } finally { clearTimeout(timeout); }
  }
}
