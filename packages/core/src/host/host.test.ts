import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { issueSession, readRequestSession, readSession, signOut } from "../auth/sessions.ts";
import { closePool, getPool, tx } from "../db.ts";
import { acceptBridgeAssertion, verifyBridgeToken } from "./entry.ts";

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
