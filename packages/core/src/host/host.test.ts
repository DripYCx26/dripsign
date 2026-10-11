import { createHash, createPrivateKey, randomUUID, sign } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { issueSession, readRequestSession, readSession, signOut } from "../auth/sessions.ts";
import { closePool, getPool, tx } from "../db.ts";
import { acceptBridgeAssertion, verifyBridgeToken } from "./entry.ts";
import { executedEventBody, signExecutedEvent } from "./event.ts";

// Golden bridge vector from dreach crates/dr-authority/src/golden_vectors_tests.rs
// (BridgeKey seed [7; 32], issued at 1_790_828_000, nonce bytes 0..16).
const BRIDGE_TOKEN = [
  "eyJhbGciOiJFZERTQSIsImtpZCI6ImZlODEyYzEyZjNhYjRjZTYiLCJ0eXAiOiJkcmlwc2lnbi1zdGFmZitqd3QifQ",
  ".eyJpc3MiOiJodHRwczovL2FwcC5leGFtcGxlLnRlc3QiLCJhdWQiOiJodHRwczovL3NpZ24uZXhhbXBsZS50ZXN0",
  "Iiwic3ViIjoiMDE5OGI4MDItZGMwYi03MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwiZmlybSI6IjAxOThiODAyLWRj",
  "MGItNzAwMC04MDAwLTAwMDAwMDAwMDAwMiIsImVtYWlsIjoic3RhZmZAZXhhbXBsZS50ZXN0IiwiaWF0IjoxNzkw",
  "ODI4MDAwLCJleHAiOjE3OTA4MjgwNjAsImp0aSI6IkFBRUNBd1FGQmdjSUNRb0xEQTBPRHcifQ",
  ".yz5fovvWHe-9gTrUv1oE85inrlMx3V7S7PI6nYGqHCzGbs4U5rEPgMYmuQt8mkfFrgp1_dYRGCz0B069Ws-qDw",
].join("");
const BRIDGE_PUBLIC_KEY_HEX = "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
const BRIDGE_KID = "fe812c12f3ab4ce6";
const ISSUED_AT = 1_790_828_000;
const FIRM = "0198b802-dc0b-7000-8000-000000000002";
const HOST_ORIGIN = "https://app.example.test";

// Executed-event vector from dreach crates/dr-authority/src/external_signing_vector.json.
const EVENT_VECTOR = {
  seedHex: "0909090909090909090909090909090909090909090909090909090909090909",
  body: '{"agreementId":"00000006-0000-4000-8000-000000000001","audience":"https://app.example.test","auditRecordSha256":"2222222222222222222222222222222222222222222222222222222222222222","completedAtMicros":1791500000000000,"eventId":"00000003-0000-4000-8000-000000000001","issuer":"https://sign.example.test","keyId":"fixture-key","keyVersion":1,"kind":"agreement_executed","revisionId":"00000007-0000-4000-8000-000000000001","roundId":"00000008-0000-4000-8000-000000000001","schemaVersion":1,"senderBindingId":"00000001-0000-4000-8000-000000000001","senderBindingRevision":1,"senderGrantId":"00000002-0000-4000-8000-000000000001","signedDocumentSha256":"1111111111111111111111111111111111111111111111111111111111111111","sourceTenantId":"00000005-0000-4000-8000-000000000001","tenantId":"00000004-0000-4000-8000-000000000001"}',
  bodySha256: "e2307a7e8798fe067416224e65f60c5dd08c6a1448949a65b8b4434260744fbf",
  issuedMicros: "1791500001000000",
  expiresMicros: "1791500301000000",
  frameHex:
    "6472656163682e647269707369676e2e6578656375746564000000000100000004504f5354000000152f76312f776562686f6f6b732f647269707369676e0000001968747470733a2f2f7369676e2e6578616d706c652e746573740000001868747470733a2f2f6170702e6578616d706c652e746573740000000b666978747572652d6b65790000000100065d5c192cba4000065d5c2b0e5d40e2307a7e8798fe067416224e65f60c5dd08c6a1448949a65b8b4434260744fbf",
  signature:
    "GlaO7TvnVsivLPgRgQW69O0PPUdlISqA7lx-6cXvpHi_thtxyP3cLcSqeEHIlKX2bzQTvR5GAUUCuwazIE1nBA",
};

const ENTRY = {
  issuer: HOST_ORIGIN,
  audience: "https://sign.example.test",
  keys: [
    { kid: BRIDGE_KID, publicKey: Buffer.from(BRIDGE_PUBLIC_KEY_HEX, "hex").toString("base64url") },
  ],
};
const tenantId = randomUUID();

/** The golden token with another lifetime, re-signed with Dreach's fixture key (seed [7; 32]). */
function withLifetime(seconds: number): string {
  const [header = "", claims = ""] = BRIDGE_TOKEN.split(".");
  const decoded = JSON.parse(Buffer.from(claims, "base64url").toString("utf8")) as object;
  const edited = { ...decoded, exp: ISSUED_AT + seconds };
  const body = `${header}.${Buffer.from(JSON.stringify(edited)).toString("base64url")}`;
  const x = Buffer.from(BRIDGE_PUBLIC_KEY_HEX, "hex").toString("base64url");
  const d = Buffer.alloc(32, 7).toString("base64url");
  const key = createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d, x }, format: "jwk" });
  return `${body}.${sign(null, Buffer.from(body), key).toString("base64url")}`;
}

// loadConfig is lazy and memoized per test file, so the host must be set before first use.
vi.stubEnv(
  "DRIPSIGN_HOST",
  JSON.stringify({
    origin: HOST_ORIGIN,
    entry: ENTRY,
    tenants: [{ firm: FIRM, tenantId }],
  }),
);

afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await closePool();
});

it("accepts Dreach's golden bridge token once and refuses forged, expired or misaddressed ones", async () => {
  expect(verifyBridgeToken(BRIDGE_TOKEN, ENTRY, ISSUED_AT + 1)).toMatchObject({
    firm: FIRM,
    email: "staff@example.test",
  });
  const [header, claims, signature] = BRIDGE_TOKEN.split(".");
  const forgedClaims = {
    ...(JSON.parse(Buffer.from(claims ?? "", "base64url").toString("utf8")) as object),
    email: "admin@example.test",
  };
  const forged = [
    header,
    Buffer.from(JSON.stringify(forgedClaims)).toString("base64url"),
    signature,
  ];
  expect(verifyBridgeToken(forged.join("."), ENTRY, ISSUED_AT + 1)).toBeNull();
  expect(verifyBridgeToken(BRIDGE_TOKEN, ENTRY, ISSUED_AT + 60)).toBeNull();
  const elsewhere = { ...ENTRY, audience: "https://other.example.test" };
  expect(verifyBridgeToken(BRIDGE_TOKEN, elsewhere, ISSUED_AT + 1)).toBeNull();
  expect(verifyBridgeToken(withLifetime(59), ENTRY, ISSUED_AT + 1)).not.toBeNull();
  expect(verifyBridgeToken(withLifetime(61), ENTRY, ISSUED_AT + 1)).toBeNull();

  await getPool().query("INSERT INTO dripsign.tenant (id, name) VALUES ($1, $2)", [
    tenantId,
    `Host test ${tenantId}`,
  ]);
  await getPool().query(
    "INSERT INTO dripsign.staff (tenant_id, email, role) VALUES ($1, 'staff@example.test', 'member')",
    [tenantId],
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime((ISSUED_AT + 1) * 1_000);
  const form = new FormData();
  form.set("assertion", BRIDGE_TOKEN);
  const issued = await acceptBridgeAssertion(form, HOST_ORIGIN);
  expect((await readSession(issued.sessionToken))?.view).toMatchObject({
    email: "staff@example.test",
    selectedTenantId: tenantId,
    hasRecipientGrants: false,
    embed: true,
  });
  // A same-site host frame may also send the first-party cookie; the bridge session acts.
  const native = await tx((db) => issueSession(db, { email: "staff@example.test", embed: false }));
  const tokens = { session: native.sessionToken, embed: issued.sessionToken };
  expect(await readRequestSession(tokens)).toMatchObject({
    cookie: "embed",
    token: issued.sessionToken,
  });
  const nativeOnly = await readRequestSession({ session: native.sessionToken, embed: null });
  expect(nativeOnly?.cookie).toBe("session");
  expect(await readRequestSession({ session: issued.sessionToken, embed: null })).toBeNull();
  // A dead bridge session fails closed; it never falls back to the first-party one.
  await signOut(issued.sessionToken);
  expect(await readRequestSession(tokens)).toBeNull();
  vi.setSystemTime((ISSUED_AT + 2) * 1_000);
  await expect(acceptBridgeAssertion(form, HOST_ORIGIN)).rejects.toMatchObject({
    code: "not_found",
  });
});

it("freezes and signs the executed event byte for byte like Dreach's vector", () => {
  const ids = (n: number): string => `0000000${String(n)}-0000-4000-8000-000000000001`;
  const body = executedEventBody(
    {
      hostTenantId: ids(4),
      senderBindingId: ids(1),
      senderBindingRevision: 1,
      senderGrantId: ids(2),
      issuer: "https://sign.example.test",
      audience: "https://app.example.test",
      keyId: "fixture-key",
      keyVersion: 1,
      freshnessSeconds: 300,
    },
    {
      eventId: ids(3),
      tenantId: ids(5),
      agreementId: ids(6),
      revisionId: ids(7),
      roundId: ids(8),
      completedAtMicros: 1_791_500_000_000_000,
      signedDocumentSha256: "1".repeat(64),
      auditRecordSha256: "2".repeat(64),
    },
  );
  expect(body).toBe(EVENT_VECTOR.body);
  expect(createHash("sha256").update(body).digest("hex")).toBe(EVENT_VECTOR.bodySha256);
  // The body's own keyId and keyVersion pick the key; a rotated-in key does not.
  const fixture = { keyId: "fixture-key", keyVersion: 1, seed: EVENT_VECTOR.seedHex };
  const rotated = { keyId: "fixture-key", keyVersion: 2, seed: "0a".repeat(32) };
  const issued = BigInt(EVENT_VECTOR.issuedMicros);
  const signed = signExecutedEvent(body, [rotated, fixture], issued, 300);
  expect(signed.frame.toString("hex")).toBe(EVENT_VECTOR.frameHex);
  expect(signed.headers).toEqual({
    "content-type": "application/json",
    "x-dripsign-issued-at-micros": EVENT_VECTOR.issuedMicros,
    "x-dripsign-expires-at-micros": EVENT_VECTOR.expiresMicros,
    "x-dripsign-signature": EVENT_VECTOR.signature,
  });
  expect(() => signExecutedEvent(body, [rotated], issued, 300)).toThrow(/No configured/u);
});
