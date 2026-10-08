// The end-to-end journey over HTTP, as a browser drives it: staff sign in at the top of the page,
// prepare a document and invite a recipient; the recipient proposes a change; staff accept and
// publish it; the recipient signs; both download the signed PDF and the audit record.
//
// DRIPSIGN_SMOKE_URL picks the host (default: the local stack at https://localhost:8443).
// Codes come from DRIPSIGN_SMOKE_MAIL_DIRECTORY (the local stack's spool by default); without a
// spool the run asks for each emailed code on stdin. See apps/web/README.md.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { test } from 'node:test';

const LOCAL_ORIGIN = 'https://localhost:8443';
const LOCAL_STACK = fileURLToPath(new URL('../../../infra/container/.local/', import.meta.url));
const origin = new URL(process.env['DRIPSIGN_SMOKE_URL'] ?? LOCAL_ORIGIN).origin;
const isLocal = origin === LOCAL_ORIGIN;
const caFile = process.env['DRIPSIGN_SMOKE_CA_FILE'] ?? (isLocal ? join(LOCAL_STACK, 'caddy/caddy/pki/authorities/local/root.crt') : undefined);
const mailDirectory = process.env['DRIPSIGN_SMOKE_MAIL_DIRECTORY'] ?? (isLocal ? join(LOCAL_STACK, 'mail') : undefined);
const staffEmail = process.env['DRIPSIGN_SMOKE_STAFF_EMAIL'] ?? 'staff@example.com';
const recipientEmail = process.env['DRIPSIGN_SMOKE_RECIPIENT_EMAIL'] ?? 'recipient@example.com';
// ASSUMPTION: the jobs worker polls every second; a minute covers mail, PDF work and archival.
const WAIT_MS = 60_000;

if (caFile) {
  if (!existsSync(caFile)) throw new Error(`The CA file is missing: ${caFile}. Start the local stack first.`);
  setDefaultCACertificates([...getCACertificates('default'), readFileSync(caFile, 'utf8')]);
}

type Json = Record<string, unknown>;
type Source = { title: string; sections: { id: string; heading: string; paragraphs: string[] }[] };
interface Detail {
  agreement: { id: string; version: number; status: string; currentRevisionId: string | null };
  draft: { source: Source | null; document: { sha256: string } | null; preparationStatus: string } | null;
  proposals: { id: string; status: string; authorKind: string }[];
  signingRound: { id: string; revisionId: string; documentSha256: string; status: string; consentVersion: string; consentHash: string } | null;
  artifacts: { kind: string }[];
}

async function until<T>(what: string, probe: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** The newest spooled code to this address since the request, or one typed by the operator. */
async function emailedCode(email: string, since: number): Promise<string> {
  if (!mailDirectory) {
    const prompt = createInterface({ input: process.stdin, output: process.stderr });
    try { return (await prompt.question(`Code sent to ${email}: `)).trim(); } finally { prompt.close(); }
  }
  const directory = mailDirectory;
  return until(`a code for ${email}`, async () => {
    const names = (await readdir(directory)).filter((name) => name.endsWith('.eml')).sort().reverse();
    for (const name of names) {
      const text = await readFile(join(directory, name), 'utf8');
      const stamp = Date.parse(name.slice(0, 24).replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/u, '$1:$2:$3.$4Z'));
      const code = /Your DripSign code is (\d{6})\./u.exec(text)?.[1];
      if (code && stamp >= since - 1_000 && text.includes(`\r\nTo: ${email}\r\n`)) return code;
    }
    return undefined;
  });
}

/** One browser: its own cookie jar, the exact Origin a browser sends, and no redirect following. */
class Browser {
  private readonly cookies = new Map<string, string>();

  async send(method: string, path: string, body?: unknown): Promise<Response> {
    const response = await fetch(new URL(path, origin), { method, redirect: 'manual', headers: {
      Origin: origin, Cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    for (const header of response.headers.getSetCookie()) {
      const [pair = ''] = header.split(';');
      const index = pair.indexOf('=');
      const [name, value] = [pair.slice(0, index), pair.slice(index + 1)];
      if (value) this.cookies.set(name, value); else this.cookies.delete(name);
    }
    return response;
  }

  async json(method: string, path: string, body?: unknown, status = 200): Promise<Json> {
    const response = await this.send(method, path, body);
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${path} answered ${response.status} ${text.slice(0, 200)}`);
    return JSON.parse(text) as Json;
  }

  async signIn(email: string, kind: 'staff' | 'recipient', agreementId?: string): Promise<void> {
    const since = Date.now();
    const { challengeId } = await this.json('POST', '/api/auth/request', { email, kind, ...(agreementId ? { agreementId } : {}) }, 202);
    await this.json('POST', '/api/auth/verify', { challengeId, code: await emailedCode(email, since) });
  }

  async detail(id: string): Promise<Detail> { return await this.json('GET', `/api/agreements/${id}`) as unknown as Detail; }

  async command(id: string, fields: Json): Promise<Json> {
    const { agreement } = await this.detail(id);
    return this.json('POST', `/api/agreements/${id}/commands`, { expectedVersion: agreement.version, idempotencyKey: randomUUID(), ...fields });
  }

  async pdf(id: string, kind: string): Promise<Buffer> {
    const response = await this.send('GET', `/api/agreements/${id}/pdf?kind=${kind}`);
    assert.equal(response.status, 200, `${kind} download answered ${response.status}`);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
    return bytes;
  }

  async signOut(): Promise<void> {
    const response = await this.send('POST', '/api/auth/logout');
    assert.equal(response.status, 303);
    assert.equal((await this.send('GET', '/api/agreements')).status, 401);
  }
}

/** Staff save the private draft, wait for its PDF, then publish exactly the bytes they reviewed. */
async function preparePublish(staff: Browser, id: string): Promise<void> {
  const { draft } = await staff.detail(id);
  assert.ok(draft?.source, 'the draft has editable source');
  await staff.command(id, { action: 'save_draft', source: draft.source });
  const reviewed = await until('the prepared draft', async () => {
    const current = (await staff.detail(id)).draft;
    return current?.preparationStatus === 'ready' && current.document ? current.document.sha256 : undefined;
  });
  await staff.pdf(id, 'draft');
  await staff.command(id, { action: 'publish', reviewedSha256: reviewed });
}

test('staff and a recipient negotiate, publish, sign and download on one host', async () => {
  const health = await fetch(new URL('/health', origin));
  assert.equal(health.status, 200);
  await health.body?.cancel();

  const staff = new Browser();
  const recipient = new Browser();
  const page = await staff.send('GET', '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<a href="\/staff">Staff sign-in<\/a>/u, 'the recipient page offers staff sign-in at the top');
  assert.equal((await staff.send('GET', '/api/agreements')).status, 401, 'the shared interface alone grants nothing');

  await staff.signIn(staffEmail, 'staff');
  // The root loading boundary streams the page, so the redirect may arrive as a refresh tag.
  const home = await staff.send('GET', '/');
  const target = home.headers.get('location') ?? /http-equiv="refresh" content="\d+;url=([^"]+)"/u.exec(await home.text())?.[1];
  assert.equal(new URL(target ?? '/', origin).pathname, '/staff', 'a staff session opens the staff workspace');
  assert.match(await (await staff.send('GET', '/staff')).text(), /Agreement inbox/u);

  const terms: Source = { title: `Smoke agreement ${randomUUID().slice(0, 8)}`, sections: [{ id: 'terms', heading: 'Terms',
    paragraphs: ['The supplier provides weekly staffing reports.', 'Payment is due within 30 days of each invoice.'] }] };
  const created = await staff.json('POST', '/api/agreements', { idempotencyKey: randomUUID(), title: terms.title, source: terms,
    recipients: [{ email: recipientEmail, name: 'Smoke Recipient', requiredSigner: true }] }, 201);
  const id = String(created['id']);
  await preparePublish(staff, id);
  assert.equal((await staff.detail(id)).agreement.status, 'negotiating', 'the first revision is published and the recipient invited');

  await recipient.signIn(recipientEmail, 'recipient', id);
  assert.equal((await recipient.send('GET', `/api/agreements/${id}/pdf?kind=draft`)).status, 404, 'a recipient never reads the private draft');
  assert.equal((await recipient.send('GET', `/api/agreements/${randomUUID()}`)).status, 404, 'a recipient reads only granted agreements');
  assert.equal((await recipient.send('POST', '/api/agreements', { idempotencyKey: randomUUID(), title: 'x', source: null,
    recipients: [{ email: recipientEmail, name: 'x', requiredSigner: true }] })).status, 401, 'a recipient session is not staff');
  await recipient.pdf(id, 'document');
  const proposed: Source = { ...terms, sections: [{ id: 'terms', heading: 'Terms',
    paragraphs: ['The supplier provides weekly staffing reports.', 'Payment is due within 45 days of each invoice.'] }] };
  const proposal = await recipient.command(id, { action: 'propose', text: 'Please make payment due within 45 days.', replacementSource: proposed, supersedesId: null });

  await staff.command(id, { action: 'accept', proposalId: proposal['id'] });
  assert.deepEqual((await staff.detail(id)).draft?.source, proposed, 'accepting stages the change privately');
  await preparePublish(staff, id);
  await staff.command(id, { action: 'request_signatures' });

  const round = await until('the signing round', async () => (await recipient.detail(id)).signingRound ?? undefined);
  const { agreement } = await recipient.detail(id);
  assert.equal(round.revisionId, agreement.currentRevisionId);
  await recipient.json('POST', `/api/agreements/${id}/sign`, { expectedVersion: agreement.version, idempotencyKey: randomUUID(),
    roundId: round.id, revisionId: round.revisionId, documentSha256: round.documentSha256, typedName: 'Smoke Recipient',
    consentVersion: round.consentVersion, consentHash: round.consentHash, consentAccepted: true });

  await until('the archived signed PDF and audit record', async () => {
    const detail = await recipient.detail(id);
    return detail.agreement.status === 'signed' && detail.artifacts.length === 2 ? detail : undefined;
  });
  for (const browser of [recipient, staff]) {
    await browser.pdf(id, 'signed_document');
    await browser.pdf(id, 'audit_record');
  }

  await staff.signOut();
  await recipient.signOut();
});
