import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import type { DocumentAsset, EmailMessage, EmailOutcome } from '@dripsign/db';
import { acceptUploadedPdfEnvelope, hashBytes } from './documents.ts';
import type { EmailSender } from './email.ts';
import { parseEmailMessage } from './email.ts';
import type { DocumentKind, DocumentStorage } from './storage.ts';
import { assertScopedAsset, contentAddressedAsset, validateDocumentForKind } from './storage.ts';

function absoluteDirectory(directory: string): string {
  if (!isAbsolute(directory)) throw new Error('Local provider directories must be absolute.');
  return directory;
}

/**
 * Documents on one host's disk, for a single-host instance or the local stack. Each object is
 * created once with an exclusive open; an existing file counts only if it holds the same bytes,
 * and every read checks length and SHA-256. Content-addressed keys never leave the directory.
 */
export class FilesystemDocumentStorage implements DocumentStorage {
  private readonly directory: string;

  constructor(directory: string) { this.directory = absoluteDirectory(directory); }

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
    const path = join(this.directory, asset.objectKey);
    await mkdir(dirname(path), { recursive: true });
    // The whole file is written under a private name, then hard-linked into place, which fails if
    // the object exists; a crash never leaves a partial object under its content address.
    const partial = `${path}.${randomUUID()}.partial`;
    await writeFile(partial, bytes, { flag: 'wx', mode: 0o600 });
    try { await link(partial, path); }
    catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      await this.get(tenantId, agreementId, asset);
    } finally { await rm(partial, { force: true }); }
    return asset;
  }

  async get(tenantId: string, agreementId: string, asset: DocumentAsset): Promise<Uint8Array> {
    assertScopedAsset(tenantId, agreementId, asset);
    const bytes = new Uint8Array(await readFile(join(this.directory, asset.objectKey)));
    if (bytes.byteLength !== asset.byteLength || hashBytes(bytes) !== asset.sha256) throw new Error('Stored document integrity check failed.');
    return bytes;
  }
}

/**
 * Mail written to a spool directory instead of a provider, for a single-host instance or the
 * local stack. Each message becomes one file, renamed into place whole; nothing is sent.
 */
export class DirectoryMail implements EmailSender {
  private readonly directory: string;
  private readonly from: string;

  constructor(directory: string, from: string) {
    if (!z.email().safeParse(from).success) throw new Error('Email configuration is invalid.');
    this.directory = absoluteDirectory(directory);
    this.from = from;
  }

  async send(value: EmailMessage): Promise<EmailOutcome> {
    let message: EmailMessage;
    try { message = parseEmailMessage(value); } catch { return { status: 'rejected', code: 'invalid_message' }; }
    const messageId = randomUUID();
    const name = `${new Date().toISOString().replace(/[:.]/gu, '-')}-${messageId}.eml`;
    const text = `From: ${this.from}\r\nTo: ${message.to}\r\nSubject: ${message.subject}\r\nMessage-ID: <${messageId}@dripsign.local>\r\n`
      + `Content-Type: text/plain; charset=utf-8\r\n\r\n${message.text.replace(/\r?\n/gu, '\r\n')}\r\n`;
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, `.${name}`), text, { flag: 'wx', mode: 0o600 });
    await rename(join(this.directory, `.${name}`), join(this.directory, name));
    return { status: 'accepted', messageId };
  }
}
