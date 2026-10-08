import { createHash } from 'node:crypto';
import type { DocumentAsset } from '@dripsign/db';
import type { ManagedIdentity } from './managedIdentity.ts';
import { ManagedIdentityToken } from './managedIdentity.ts';
import { configuredEndpoint } from './providerHttp.ts';
import type { DocumentKind, DocumentStorage } from './storage.ts';
import { assertScopedAsset, contentAddressedAsset, readVerifiedDocument, validateDocumentForKind } from './storage.ts';
import { acceptUploadedPdfEnvelope } from './documents.ts';

/** The newest Blob service version fully deployed in every public region on 2026-09-23. */
export const BLOB_SERVICE_VERSION = '2026-04-06';
const STORAGE_RESOURCE = 'https://storage.azure.com/';
// ASSUMPTION: the same 30-second bound the S3 adapter applies to one storage operation.
const OPERATION_TIMEOUT_MS = 30_000;

export interface AzureBlobSettings {
  /** The account's blob endpoint, `https://<account>.blob.core.windows.net`. */
  readonly endpoint: string;
  readonly container: string;
  readonly identity: ManagedIdentity;
}

/**
 * Azure Blob Storage under the app's managed identity: block blobs written once with
 * `If-None-Match: *`, read back with length and SHA-256 checks. No shared key or SAS exists here;
 * the template grants create and read, never overwrite or delete.
 */
export class AzureBlobDocumentStorage implements DocumentStorage {
  private readonly base: URL;
  private readonly token: ManagedIdentityToken;

  constructor(settings: AzureBlobSettings) {
    if (!/^[a-z0-9](?!.*--)[a-z0-9-]{1,61}[a-z0-9]$/u.test(settings.container)) throw new Error('Document storage configuration is invalid.');
    const endpoint = configuredEndpoint(settings.endpoint);
    this.base = new URL(`${endpoint.pathname.replace(/\/$/u, '')}/${settings.container}/`, endpoint);
    this.token = new ManagedIdentityToken(settings.identity, STORAGE_RESOURCE);
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
    const signal = AbortSignal.timeout(OPERATION_TIMEOUT_MS);
    const response = await this.send('PUT', asset.objectKey, signal, {
      'x-ms-blob-type': 'BlockBlob', 'Content-Type': asset.contentType, 'If-None-Match': '*',
      // The service rejects a body whose MD5 differs in transit; reads verify the SHA-256.
      'Content-MD5': createHash('md5').update(bytes).digest('base64'), 'x-ms-meta-sha256': asset.sha256,
    }, new Uint8Array(bytes));
    await response.body?.cancel();
    if (response.status === 201) return asset;
    // An existing object, or one this identity may not overwrite, counts only if it holds these exact bytes.
    if (response.status === 403 || response.status === 409 || response.status === 412) {
      await this.get(tenantId, agreementId, asset);
      return asset;
    }
    throw new Error(`Document storage write failed with status ${response.status}.`);
  }

  async get(tenantId: string, agreementId: string, asset: DocumentAsset): Promise<Uint8Array> {
    assertScopedAsset(tenantId, agreementId, asset);
    const signal = AbortSignal.timeout(OPERATION_TIMEOUT_MS);
    const response = await this.send('GET', asset.objectKey, signal, {});
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new Error(`Stored document is unavailable with status ${response.status}.`);
    }
    const length = response.headers.get('content-length');
    return readVerifiedDocument(response.body, length !== null && /^\d+$/u.test(length) ? Number(length) : undefined, asset, signal);
  }

  /** One request, resent once with a fresh token only when the service refused the token. */
  private async send(method: 'GET' | 'PUT', key: string, signal: AbortSignal, headers: Record<string, string>, body?: Uint8Array<ArrayBuffer>): Promise<Response> {
    const url = new URL(key.split('/').map(encodeURIComponent).join('/'), this.base);
    for (let attempt = 0; ; attempt += 1) {
      const bearer = await this.token.bearer(signal);
      const response = await fetch(url, { method, redirect: 'error', signal, ...(body ? { body } : {}), headers: {
        ...headers, Authorization: `Bearer ${bearer}`, 'x-ms-version': BLOB_SERVICE_VERSION, 'x-ms-date': new Date().toUTCString(),
      } });
      if (response.status !== 401 || attempt > 0) return response;
      await response.body?.cancel();
      this.token.refuse(bearer);
    }
  }
}
