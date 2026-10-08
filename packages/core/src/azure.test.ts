import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';
import { AzureBlobDocumentStorage, BLOB_SERVICE_VERSION } from './azureBlob.ts';
import { AzureCommunicationMail, MAIL_API_VERSION } from './azureMail.ts';
import { readMailSettings, readStorageSettings } from './providers.ts';

const TOKEN = 'token-SECRET-access-value';
const IDENTITY_HEADER = 'identity-SECRET-header';
const CLIENT_ID = '00000000-0000-4000-8000-000000000001';
const DOCUMENT = new Uint8Array(Buffer.from('%PDF-1.7\nDOCUMENT-BODY-MARKER signed terms\n%%EOF\n', 'latin1'));
const SHA256 = createHash('sha256').update(DOCUMENT).digest('hex');
const MAIL_TEXT = 'MAIL-BODY-MARKER your code is 482913';

interface Recorded { readonly method: string; readonly url: string; readonly headers: IncomingHttpHeaders; readonly body: Buffer }
type Handler = (request: Recorded, response: ServerResponse) => void;

/** A loopback double for the identity endpoint, the blob service, and the email service. */
let server: Server;
let origin = '';
let recorded: Recorded[] = [];
let handlers: Handler[] = [];
let tokens = 0;

before(async () => {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const entry = { method: request.method ?? '', url: request.url ?? '', headers: request.headers, body: Buffer.concat(chunks) };
      if (entry.url.startsWith('/msi/token')) {
        tokens += 1;
        recorded.push(entry);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ access_token: `${TOKEN}-${tokens}`, expires_on: String(Math.floor(Date.now() / 1000) + 3600) }));
        return;
      }
      recorded.push(entry);
      const handler = handlers.shift();
      if (!handler) { response.writeHead(500); response.end(); return; }
      handler(entry, response);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => { server.closeAllConnections(); server.close(); });
beforeEach(() => { recorded = []; handlers = []; tokens = 0; });

const identity = (): { endpoint: string; header: string; clientId: string } => ({ endpoint: `${origin}/msi/token`, header: IDENTITY_HEADER, clientId: CLIENT_ID });
const blobStore = (): AzureBlobDocumentStorage => new AzureBlobDocumentStorage({ endpoint: origin, container: 'documents', identity: identity() });
const objectPath = `/documents/tenants/tenant-1/agreements/agreement-1/draft/${SHA256}.pdf`;
const services = (): Recorded[] => recorded.filter((entry) => !entry.url.startsWith('/msi/token'));

/** Runs an operation while every console and process stream write is recorded; stream writes still pass through to the runner. */
async function capturingLogs<T>(operation: () => Promise<T>): Promise<{ result: T | Error; lines: string[] }> {
  const lines: string[] = [];
  const saved = { out: process.stdout.write, err: process.stderr.write, log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  const record = (write: typeof process.stdout.write, stream: NodeJS.WriteStream) => ((chunk: unknown, ...rest: unknown[]): boolean => {
    lines.push(Buffer.isBuffer(chunk) ? chunk.toString('latin1') : String(chunk));
    return (write as (...values: unknown[]) => boolean).call(stream, chunk, ...rest);
  }) as typeof process.stdout.write;
  process.stdout.write = record(saved.out, process.stdout);
  process.stderr.write = record(saved.err, process.stderr);
  console.log = console.info = console.warn = console.error = console.debug = (...values: unknown[]): void => { lines.push(values.map(String).join(' ')); };
  try {
    return { result: await operation().catch((error: unknown) => error instanceof Error ? error : new Error('non-error thrown')), lines };
  } finally {
    process.stdout.write = saved.out; process.stderr.write = saved.err;
    console.log = saved.log; console.info = saved.info; console.warn = saved.warn; console.error = saved.error; console.debug = saved.debug;
  }
}

function assertNothingSensitive(lines: readonly string[], result: unknown): void {
  const surfaced = [...lines, result instanceof Error ? `${result.message} ${result.stack ?? ''}` : ''].join('\n');
  for (const secret of [TOKEN, IDENTITY_HEADER, 'DOCUMENT-BODY-MARKER', '%PDF', 'MAIL-BODY-MARKER', '482913']) {
    assert.ok(!surfaced.includes(secret), `a log line or error carried ${secret}`);
  }
}

test('identity: the token request names the resource and client and carries the platform header', async () => {
  handlers.push((_request, response) => { response.writeHead(201); response.end(); });
  await blobStore().putRawPdfImmutable('tenant-1', 'agreement-1', DOCUMENT);
  const token = recorded.find((entry) => entry.url.startsWith('/msi/token'));
  assert.ok(token);
  assert.equal(token.method, 'GET');
  const url = new URL(token.url, origin);
  assert.equal(url.pathname, '/msi/token');
  assert.deepEqual(Object.fromEntries(url.searchParams), { 'api-version': '2019-08-01', resource: 'https://storage.azure.com/', client_id: CLIENT_ID });
  assert.equal(token.headers['x-identity-header'], IDENTITY_HEADER);
  assert.equal(token.headers['authorization'], undefined);
});

test('blob put: one conditional block blob PUT with the exact headers and body', async () => {
  handlers.push((_request, response) => { response.writeHead(201); response.end(); });
  const { result, lines } = await capturingLogs(() => blobStore().putRawPdfImmutable('tenant-1', 'agreement-1', DOCUMENT));
  assert.deepEqual(result, { objectKey: `tenants/tenant-1/agreements/agreement-1/draft/${SHA256}.pdf`, sha256: SHA256, byteLength: DOCUMENT.length, contentType: 'application/pdf' });
  const [put, ...rest] = services();
  assert.ok(put);
  assert.equal(rest.length, 0);
  assert.equal(put.method, 'PUT');
  assert.equal(put.url, objectPath);
  assert.equal(put.headers['authorization'], `Bearer ${TOKEN}-1`);
  assert.equal(put.headers['x-ms-version'], BLOB_SERVICE_VERSION);
  assert.equal(put.headers['x-ms-blob-type'], 'BlockBlob');
  assert.equal(put.headers['if-none-match'], '*');
  assert.equal(put.headers['content-type'], 'application/pdf');
  assert.equal(put.headers['content-length'], String(DOCUMENT.length));
  assert.equal(put.headers['content-md5'], createHash('md5').update(DOCUMENT).digest('base64'));
  assert.equal(put.headers['x-ms-meta-sha256'], SHA256);
  assert.ok(!Number.isNaN(Date.parse(String(put.headers['x-ms-date']))));
  assert.equal(put.headers['x-identity-header'], undefined);
  assert.deepEqual(new Uint8Array(put.body), DOCUMENT);
  assertNothingSensitive(lines, result);
});

test('blob get: one authorized GET returns the exact verified bytes; the token is reused', async () => {
  handlers.push((_request, response) => { response.writeHead(201); response.end(); });
  handlers.push((_request, response) => { response.writeHead(200, { 'content-length': String(DOCUMENT.length) }); response.end(Buffer.from(DOCUMENT)); });
  const store = blobStore();
  const asset = await store.putRawPdfImmutable('tenant-1', 'agreement-1', DOCUMENT);
  const { result, lines } = await capturingLogs(() => store.get('tenant-1', 'agreement-1', asset));
  assert.deepEqual(result, DOCUMENT);
  const get = services()[1];
  assert.ok(get);
  assert.equal(get.method, 'GET');
  assert.equal(get.url, objectPath);
  assert.equal(get.headers['authorization'], `Bearer ${TOKEN}-1`);
  assert.equal(get.headers['x-ms-version'], BLOB_SERVICE_VERSION);
  assert.equal(get.body.length, 0);
  assert.equal(tokens, 1);
  assertNothingSensitive(lines, result);
});

test('blob get: altered bytes and out-of-scope assets are refused without leaking the body', async () => {
  const tampered = Buffer.from(DOCUMENT);
  tampered[tampered.length - 2] = 0x41;
  handlers.push((_request, response) => { response.writeHead(200, { 'content-length': String(tampered.length) }); response.end(tampered); });
  const asset = { objectKey: `tenants/tenant-1/agreements/agreement-1/draft/${SHA256}.pdf`, sha256: SHA256, byteLength: DOCUMENT.length, contentType: 'application/pdf' } as const;
  const { result, lines } = await capturingLogs(() => blobStore().get('tenant-1', 'agreement-1', asset));
  assert.ok(result instanceof Error);
  assertNothingSensitive(lines, result);
  await assert.rejects(blobStore().get('tenant-2', 'agreement-1', asset));
  assert.equal(services().length, 1);
});

test('blob put: an existing object counts only after a verified read of the same bytes', async () => {
  handlers.push((_request, response) => { response.writeHead(412); response.end(); });
  handlers.push((_request, response) => { response.writeHead(200, { 'content-length': String(DOCUMENT.length) }); response.end(Buffer.from(DOCUMENT)); });
  await blobStore().putRawPdfImmutable('tenant-1', 'agreement-1', DOCUMENT);
  assert.deepEqual(services().map((entry) => entry.method), ['PUT', 'GET']);

  recorded = [];
  handlers.push((_request, response) => { response.writeHead(409); response.end(); });
  handlers.push((_request, response) => { response.writeHead(200, { 'content-length': '3' }); response.end('abc'); });
  await assert.rejects(blobStore().putRawPdfImmutable('tenant-1', 'agreement-1', DOCUMENT));
});

test('blob: a refused token is replaced once, then the failure surfaces', async () => {
  handlers.push((_request, response) => { response.writeHead(401); response.end(); });
  handlers.push((_request, response) => { response.writeHead(201); response.end(); });
  await blobStore().putRawPdfImmutable('tenant-1', 'agreement-1', DOCUMENT);
  assert.deepEqual(services().map((entry) => entry.headers['authorization']), [`Bearer ${TOKEN}-1`, `Bearer ${TOKEN}-2`]);

  recorded = [];
  handlers.push((_request, response) => { response.writeHead(401); response.end(); });
  handlers.push((_request, response) => { response.writeHead(401); response.end(); });
  const { result, lines } = await capturingLogs(() => blobStore().putRawPdfImmutable('tenant-1', 'agreement-1', DOCUMENT));
  assert.ok(result instanceof Error);
  assert.equal(services().length, 2);
  assertNothingSensitive(lines, result);
});

const mailer = (sleeps: number[] = []): AzureCommunicationMail => new AzureCommunicationMail(
  { endpoint: origin, from: 'DoNotReply@example.test', identity: identity() },
  async (milliseconds) => { sleeps.push(milliseconds); });
const message = { to: 'recipient@example.test', subject: 'Your DripSign code', text: MAIL_TEXT };
const accepted = (id: string): Handler => (_request, response) => {
  response.writeHead(202, { 'content-type': 'application/json', 'operation-location': `${origin}/emails/operations/${id}` });
  response.end(JSON.stringify({ id, status: 'Running' }));
};

test('mail send: one POST with the exact body, an Operation-Id, and the communication token', async () => {
  handlers.push(accepted('operation-accepted'));
  const { result, lines } = await capturingLogs(() => mailer().send(message));
  assert.deepEqual(result, { status: 'accepted', messageId: 'operation-accepted' });
  const [send, ...rest] = services();
  assert.ok(send);
  assert.equal(rest.length, 0);
  assert.equal(send.method, 'POST');
  assert.equal(send.url, `/emails:send?api-version=${MAIL_API_VERSION}`);
  assert.equal(send.headers['authorization'], `Bearer ${TOKEN}-1`);
  assert.equal(send.headers['content-type'], 'application/json');
  assert.match(String(send.headers['operation-id']), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.deepEqual(JSON.parse(send.body.toString('utf8')), {
    senderAddress: 'DoNotReply@example.test', recipients: { to: [{ address: 'recipient@example.test' }] },
    content: { subject: 'Your DripSign code', plainText: MAIL_TEXT }, userEngagementTrackingDisabled: true,
  });
  const token = recorded.find((entry) => entry.url.startsWith('/msi/token'));
  assert.equal(new URL(token?.url ?? '/', origin).searchParams.get('resource'), 'https://communication.azure.com');
  assertNothingSensitive(lines, result);
});

test('mail send: every send has its own Operation-Id', async () => {
  handlers.push(accepted('first'), accepted('second'));
  const sender = mailer();
  await sender.send(message);
  await sender.send(message);
  const [first, second] = services().map((entry) => entry.headers['operation-id']);
  assert.ok(first && second && first !== second);
});

test('mail send: an accepted send is never resent, even when its answer is unreadable', async () => {
  handlers.push((_request, response) => { response.writeHead(202); response.end('not json'); });
  const outcome = await mailer().send(message);
  assert.equal(outcome.status, 'accepted');
  assert.equal(outcome.status === 'accepted' ? outcome.messageId : '', services()[0]?.headers['operation-id']);
  assert.equal(services().length, 1);
});

test('mail send: a 5xx or a broken connection is uncertain and is not resent', async () => {
  handlers.push((_request, response) => { response.writeHead(503); response.end(); });
  assert.deepEqual(await mailer().send(message), { status: 'uncertain' });
  assert.equal(services().length, 1);

  recorded = [];
  handlers.push((_request, response) => { response.socket?.destroy(); });
  const { result, lines } = await capturingLogs(() => mailer().send(message));
  assert.deepEqual(result, { status: 'uncertain' });
  assert.equal(services().length, 1);
  assertNothingSensitive(lines, result);
});

test('mail send: a 429 honours Retry-After once with the same Operation-Id', async () => {
  const sleeps: number[] = [];
  handlers.push((_request, response) => { response.writeHead(429, { 'retry-after': '2' }); response.end(); });
  handlers.push(accepted('after-throttle'));
  assert.deepEqual(await mailer(sleeps).send(message), { status: 'accepted', messageId: 'after-throttle' });
  assert.deepEqual(sleeps, [2000]);
  const [first, second] = services().map((entry) => entry.headers['operation-id']);
  assert.ok(first && first === second);

  recorded = [];
  handlers.push((_request, response) => { response.writeHead(429, { 'retry-after': '1' }); response.end(); });
  handlers.push((_request, response) => { response.writeHead(429, { 'retry-after': '1' }); response.end(); });
  assert.deepEqual(await mailer().send(message), { status: 'rejected', code: 'acs_429' });
  assert.equal(services().length, 2);

  recorded = [];
  handlers.push((_request, response) => { response.writeHead(429, { 'retry-after': '3600' }); response.end(); });
  assert.deepEqual(await mailer().send(message), { status: 'rejected', code: 'acs_429' });
  assert.equal(services().length, 1);
});

test('mail send: a refused token is replaced once with the same Operation-Id; other 4xx are rejections', async () => {
  handlers.push((_request, response) => { response.writeHead(401); response.end(); });
  handlers.push(accepted('after-refresh'));
  assert.deepEqual(await mailer().send(message), { status: 'accepted', messageId: 'after-refresh' });
  const sends = services();
  assert.deepEqual(sends.map((entry) => entry.headers['authorization']), [`Bearer ${TOKEN}-1`, `Bearer ${TOKEN}-2`]);
  assert.equal(sends[0]?.headers['operation-id'], sends[1]?.headers['operation-id']);

  recorded = [];
  handlers.push((_request, response) => { response.writeHead(400, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: MAIL_TEXT } })); });
  const { result, lines } = await capturingLogs(() => mailer().send(message));
  assert.deepEqual(result, { status: 'rejected', code: 'acs_400' });
  assertNothingSensitive(lines, result);
});

test('mail send: an invalid message never reaches the provider', async () => {
  assert.deepEqual(await mailer().send({ ...message, subject: 'a\r\nBcc: other@example.test' }), { status: 'rejected', code: 'invalid_message' });
  assert.equal(recorded.length, 0);
});

test('configuration chooses each adapter and requires its own keys', () => {
  assert.equal(readStorageSettings({ AWS_REGION: 'us-east-1', DRIPSIGN_DOCUMENT_BUCKET: 'bucket' }).provider, 's3');
  assert.equal(readMailSettings({ AWS_REGION: 'us-east-1', DRIPSIGN_EMAIL_FROM: 'a@example.test' }).provider, 'ses');
  const azure = { IDENTITY_ENDPOINT: 'http://localhost:42356/msi/token', IDENTITY_HEADER: 'header', AZURE_CLIENT_ID: CLIENT_ID };
  assert.deepEqual(readStorageSettings({ ...azure, DRIPSIGN_STORAGE_PROVIDER: 'azure', DRIPSIGN_BLOB_ENDPOINT: 'https://account.blob.core.windows.net', DRIPSIGN_DOCUMENT_CONTAINER: 'documents' }),
    { provider: 'azure', endpoint: 'https://account.blob.core.windows.net', container: 'documents', identity: { endpoint: azure.IDENTITY_ENDPOINT, header: 'header', clientId: CLIENT_ID } });
  assert.throws(() => readStorageSettings({ ...azure, DRIPSIGN_STORAGE_PROVIDER: 'azure' }), /DRIPSIGN_BLOB_ENDPOINT/u);
  assert.throws(() => readMailSettings({ DRIPSIGN_MAIL_PROVIDER: 'smtp' }), /DRIPSIGN_MAIL_PROVIDER/u);
  assert.throws(() => new AzureBlobDocumentStorage({ endpoint: 'http://account.blob.core.windows.net', container: 'documents', identity: identity() }));
});
