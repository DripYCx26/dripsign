import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { closePool, getPool } from "../db.ts";
import type { IssuedChallenge } from "./sessions.ts";
import {
  readSession,
  requestCode,
  resolveRecipient,
  resolveStaff,
  verifyCode,
} from "./sessions.ts";

afterAll(closePool);

async function addTenantWithStaff(email: string): Promise<string> {
  const tenantId = randomUUID();
  await getPool().query("INSERT INTO dripsign.tenant (id, name) VALUES ($1, $2)", [
    tenantId,
    `Auth test ${tenantId}`,
  ]);
  await getPool().query(
    "INSERT INTO dripsign.staff (tenant_id, email, role) VALUES ($1, $2, 'admin')",
    [tenantId, email],
  );
  return tenantId;
}

/** A published agreement in its own tenant with `email` as a live recipient. */
async function addRecipient(email: string): Promise<{ agreementId: string; recipientId: string }> {
  const pool = getPool();
  const tenantId = randomUUID();
  const agreementId = randomUUID();
  const revisionId = randomUUID();
  const recipientId = randomUUID();
  await pool.query("INSERT INTO dripsign.tenant (id, name) VALUES ($1, $2)", [
    tenantId,
    `Auth test ${tenantId}`,
  ]);
  await pool.query(
    `INSERT INTO dripsign.agreement (tenant_id, id, title, draft, created_by)
     VALUES ($1, $2, 'Services', '{}', 'owner@dripsign.test')`,
    [tenantId, agreementId],
  );
  await pool.query(
    `INSERT INTO dripsign.recipient (tenant_id, agreement_id, id, email, name, is_signer)
     VALUES ($1, $2, $3, $4, 'Dual Role', true)`,
    [tenantId, agreementId, recipientId, email],
  );
  await pool.query(
    `INSERT INTO dripsign.revision (tenant_id, agreement_id, id, number, document_sha256,
       document_bytes, page_count, upload_sha256, signing_fields, signer_ids, published_by)
     VALUES ($1, $2, $3, 1, repeat('a', 64), 100, 1, repeat('b', 64), '[]', ARRAY[$4::uuid],
       'owner@dripsign.test')`,
    [tenantId, agreementId, revisionId, recipientId],
  );
  await pool.query(
    `UPDATE dripsign.agreement SET current_revision_id = $3, status = 'negotiating'
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, agreementId, revisionId],
  );
  return { agreementId, recipientId };
}

async function mailedCodes(email: string): Promise<string[]> {
  const mails = await getPool().query<{ code: string }>(
    `SELECT payload->'params'->>'code' AS code FROM dripsign.outbox
     WHERE kind = 'email' AND payload->>'to' = $1 ORDER BY created_at`,
    [email],
  );
  return mails.rows.map((row) => row.code);
}

async function latestCode(email: string): Promise<string> {
  const code = (await mailedCodes(email)).at(-1);
  if (code === undefined) throw new Error("No code was mailed");
  return code;
}

/** Every answer looks alike: a bearer token and a ten-minute expiry. */
function expectChallenge(challenge: IssuedChallenge): void {
  expect(challenge.challengeToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  const remaining = Date.parse(challenge.expiresAt) - Date.now();
  expect(remaining).toBeGreaterThan(9 * 60_000);
  expect(remaining).toBeLessThanOrEqual(10 * 60_000 + 5_000);
}

function wrongCode(code: string): string {
  return String((Number(code) + 1) % 1_000_000).padStart(6, "0");
}

function testIp(): string {
  const bytes = Buffer.from(randomUUID().replaceAll("-", ""), "hex");
  return `10.${String(bytes[0])}.${String(bytes[1])}.${String(bytes[2])}`;
}

it("locks a challenge after 5 wrong codes, then the email budget stops mail; unknown is alike", async () => {
  const email = `lock-${randomUUID()}@dripsign.test`;
  const ip = testIp();
  await addTenantWithStaff(email);

  const first = await requestCode(email, ip);
  expectChallenge(first);
  const code = await latestCode(email);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expect(verifyCode(first.challengeToken, wrongCode(code), ip)).rejects.toMatchObject({
      code: "invalid",
    });
  }
  await expect(verifyCode(first.challengeToken, code, ip)).rejects.toMatchObject({
    code: "invalid",
  });

  // Two more challenges of five failures each reach the 15-failure budget.
  for (let round = 0; round < 2; round += 1) {
    const next = await requestCode(email, ip);
    const nextCode = await latestCode(email);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(verifyCode(next.challengeToken, wrongCode(nextCode), ip)).rejects.toMatchObject({
        code: "invalid",
      });
    }
  }
  expect(await mailedCodes(email)).toHaveLength(3);
  expectChallenge(await requestCode(email, ip));
  expect(await mailedCodes(email)).toHaveLength(3);

  const unknown = `nobody-${randomUUID()}@dripsign.test`;
  expectChallenge(await requestCode(unknown, ip));
  expect(await mailedCodes(unknown)).toHaveLength(0);
  const stored = await getPool().query(
    "SELECT 1 FROM dripsign.otp_challenge WHERE email = $1 AND NOT known",
    [unknown],
  );
  expect(stored.rowCount).toBe(1);
});

it("resolves staff and recipient capacity for one email and drops a revoked grant", async () => {
  const email = `dual-${randomUUID()}@dripsign.test`;
  const ip = testIp();
  const tenantId = await addTenantWithStaff(email);
  const { agreementId, recipientId } = await addRecipient(email);

  const challenge = await requestCode(email, ip);
  const issued = await verifyCode(challenge.challengeToken, await latestCode(email), ip);
  const resolved = await readSession(issued.sessionToken);
  if (resolved === null) throw new Error("The issued session is not readable");
  expect(resolved.view).toMatchObject({
    email,
    selectedTenantId: tenantId,
    hasRecipientGrants: true,
    embed: false,
  });
  expect(resolved.view.staffTenants).toEqual([
    { id: tenantId, name: `Auth test ${tenantId}`, role: "admin" },
  ]);
  expect(await resolveStaff(resolved.session)).toMatchObject({ tenantId, role: "admin" });
  expect(await resolveRecipient(resolved.session, agreementId)).toMatchObject({
    capacity: "recipient",
    email,
  });

  await getPool().query("UPDATE dripsign.recipient SET revoked_at = now() WHERE id = $1", [
    recipientId,
  ]);
  await expect(resolveRecipient(resolved.session, agreementId)).rejects.toMatchObject({
    code: "not_found",
  });
  expect((await readSession(issued.sessionToken))?.view.hasRecipientGrants).toBe(false);
  expect(await resolveStaff(resolved.session)).toMatchObject({ tenantId, role: "admin" });
});
