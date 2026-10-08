import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { renderDocumentPdf } from './documents.ts';
import { DirectoryMail, FilesystemDocumentStorage } from './filesystem.ts';
import { createDocumentStorage, createEmailSender, readMailSettings, readStorageSettings } from './providers.ts';

const directories: string[] = [];
async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'dripsign-local-'));
  directories.push(path);
  return path;
}
after(async () => { for (const path of directories) await rm(path, { recursive: true, force: true }); });

test('the filesystem store writes once, keeps the first bytes, and refuses a changed object', async () => {
  const root = await directory();
  const storage = createDocumentStorage(readStorageSettings({ DRIPSIGN_STORAGE_PROVIDER: 'filesystem', DRIPSIGN_DOCUMENT_DIRECTORY: root }));
  assert.ok(storage instanceof FilesystemDocumentStorage);
  const pdf = await renderDocumentPdf({ title: 'Terms', sections: [{ id: 'terms', heading: 'Terms', paragraphs: ['One.'] }] });
  const asset = await storage.putImmutable('tenant-1', 'agreement-1', 'draft', pdf);
  assert.deepEqual(await storage.putImmutable('tenant-1', 'agreement-1', 'draft', pdf), asset);
  assert.deepEqual(await storage.get('tenant-1', 'agreement-1', asset), pdf);
  assert.deepEqual((await readdir(join(root, 'tenants/tenant-1/agreements/agreement-1/draft'))), [`${asset.sha256}.pdf`]);
  await rm(join(root, asset.objectKey));
  await writeFile(join(root, asset.objectKey), pdf.subarray(0, pdf.length - 1));
  await assert.rejects(storage.get('tenant-1', 'agreement-1', asset), /integrity/u);
  await assert.rejects(storage.putImmutable('tenant-1', 'agreement-1', 'draft', pdf), /integrity/u);
  await assert.rejects(storage.get('tenant-2', 'agreement-1', asset), /unavailable/u);
});

test('the directory mail spool writes one whole message per send and refuses header injection', async () => {
  const root = await directory();
  const mail = createEmailSender(readMailSettings({ DRIPSIGN_MAIL_PROVIDER: 'directory', DRIPSIGN_MAIL_DIRECTORY: root, DRIPSIGN_EMAIL_FROM: 'sign@example.com' }));
  assert.ok(mail instanceof DirectoryMail);
  const outcome = await mail.send({ to: 'person@example.com', subject: 'Your code', text: 'Code 123456\nThanks' });
  assert.equal(outcome.status, 'accepted');
  const files = await readdir(root);
  assert.equal(files.length, 1);
  const text = await readFile(join(root, files[0] ?? ''), 'utf8');
  assert.match(text, /^From: sign@example\.com\r\nTo: person@example\.com\r\nSubject: Your code\r\n/u);
  assert.match(text, /\r\n\r\nCode 123456\r\nThanks\r\n$/u);
  assert.deepEqual(await mail.send({ to: 'person@example.com', subject: 'Bcc: x@example.com\r\nX', text: 'x' }), { status: 'rejected', code: 'invalid_message' });
  assert.equal((await readdir(root)).length, 1);
});
