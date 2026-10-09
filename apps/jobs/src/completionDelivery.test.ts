import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseExecutedEvidence } from "@dripsign/db";
import {
  completionFrame,
  completionKeys,
  deliverCompletion,
} from "./completionDelivery.ts";
test("real Ed25519 frame matches the shared Rust vector and recovery preserves body bytes", async () => {
  const vector = JSON.parse(
    await readFile(
      new URL("./completion-vector.json", import.meta.url),
      "utf8",
    ),
  ) as {
    bodySha256: string;
    seedHex: string;
    body: string;
    frameHex: string;
    signature: string;
    issuedMicros: string;
    expiresMicros: string;
  };
  const event = parseExecutedEvidence(JSON.parse(vector.body) as unknown);
  const keys = completionKeys(
    JSON.stringify([
      {
        keyId: event.keyId,
        keyVersion: event.keyVersion,
        seed: vector.seedHex,
      },
    ]),
  );
  const frame = completionFrame(
    event,
    vector.body,
    BigInt(vector.issuedMicros),
    BigInt(vector.expiresMicros),
  );
  assert.equal(frame.toString("hex"), vector.frameHex);
  const key = keys[0];
  assert.ok(key);
  assert.ok(
    verify(
      null,
      frame,
      createPublicKey(key.privateKey),
      Buffer.from(vector.signature, "base64url"),
    ),
  );
  const bodies: string[] = [];
  const transport: typeof fetch = async (_url, init) => {
    assert.ok(init, "completion delivery supplies request options");
    assert.equal(typeof init?.body, "string");
    const body = init.body as string;
    bodies.push(body);
    const headers = new Headers(init.headers);
    const issued = BigInt(headers.get("x-dripsign-issued-at-micros") ?? "0");
    const expires = BigInt(headers.get("x-dripsign-expires-at-micros") ?? "0");
    const signature = Buffer.from(
      headers.get("x-dripsign-signature") ?? "",
      "base64url",
    );
    assert.ok(
      verify(
        null,
        completionFrame(event, body, issued, expires),
        createPublicKey(key.privateKey),
        signature,
      ),
    );
    return new Response(
      bodies.length === 1
        ? null
        : JSON.stringify({
            eventId: event.eventId,
            bodySha256: vector.bodySha256,
            evidenceId: "00000001-0000-4000-8000-000000000001",
            recordedAtMicros: Number(issued),
          }),
      { status: bodies.length === 1 ? 503 : 200 },
    );
  };
  const frozen = { event, body: vector.body, freshnessSeconds: 300 };
  const url = new URL("https://app.example.test/v1/webhooks/dripsign");
  assert.equal(
    (
      await deliverCompletion(
        url,
        keys,
        frozen,
        BigInt(vector.issuedMicros),
        event.issuer,
        transport,
      )
    ).status,
    "retry",
  );
  assert.equal(
    (
      await deliverCompletion(
        url,
        keys,
        frozen,
        BigInt(vector.expiresMicros) + 1n,
        event.issuer,
        transport,
      )
    ).status,
    "delivered",
  );
  assert.deepEqual(bodies, [vector.body, vector.body]);
  assert.equal(
    (
      await deliverCompletion(
        url,
        [],
        frozen,
        BigInt(vector.issuedMicros),
        event.issuer,
        transport,
      )
    ).status,
    "failed",
  );
  assert.equal(bodies.length, 2, "missing key does not dispatch");
});
