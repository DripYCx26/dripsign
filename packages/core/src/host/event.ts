// The agreement-executed event in the exact shape Dreach's receiver verifies: a closed 18-field
// canonical JSON body, frozen when the round completes, and an Ed25519 signature over a binary
// delivery frame stamped per attempt (dreach crates/dr-authority/src/external_signing.rs). It
// reports evidence; it grants nothing.
import { createHash, createPrivateKey, sign } from "node:crypto";
import { z } from "zod";
import { HOST_EVENT_PATH, loadConfig } from "../config.ts";
import type { CompletionExportDelivery, CompletionKey } from "../config.ts";
import {
  canonicalJson,
  completionExportConfigSchema,
  sha256Schema,
  uuidSchema,
} from "../schema.ts";
import type { CompletionExportConfig } from "../schema.ts";

const FRAME_LABEL = "dreach.dripsign.executed\0";
const FRAME_VERSION = 1;
/** PKCS#8 wrapping for a raw RFC 8032 seed, so node:crypto can load it. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** Dreach's closed 18-field `agreement_executed` body: the pins, then the round's facts. */
const executedEventSchema = completionExportConfigSchema
  .omit({ hostTenantId: true, freshnessSeconds: true })
  .extend({
    schemaVersion: z.literal(1),
    kind: z.literal("agreement_executed"),
    tenantId: uuidSchema,
    sourceTenantId: uuidSchema,
    eventId: uuidSchema,
    agreementId: uuidSchema,
    revisionId: uuidSchema,
    roundId: uuidSchema,
    completedAtMicros: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    signedDocumentSha256: sha256Schema,
    auditRecordSha256: sha256Schema,
  });

type ExecutedEvent = z.infer<typeof executedEventSchema>;

/** The completed round's facts; `tenantId` is DripSign's tenant (the body's `sourceTenantId`). */
export interface ExecutedFacts {
  readonly eventId: string;
  readonly tenantId: string;
  readonly agreementId: string;
  readonly revisionId: string;
  readonly roundId: string;
  readonly completedAtMicros: number;
  readonly signedDocumentSha256: string;
  readonly auditRecordSha256: string;
}

export interface SignedEvent {
  readonly body: string;
  readonly frame: Buffer;
  readonly headers: Readonly<Record<string, string>>;
}

export interface HostEventRequest extends SignedEvent {
  readonly url: string;
}

/** A round's frozen export as stored, with the database clock at load time. */
export interface FrozenExport {
  readonly body: string;
  readonly freshnessSeconds: number;
  readonly nowMicros: bigint;
}

/** The host's acknowledgement of one event. */
export interface ExecutedReceipt {
  readonly evidenceId: string;
  readonly recordedAtMicros: number;
}

/** Pure: the canonical body frozen at completion. Its pins never change on retry. */
export function executedEventBody(pins: CompletionExportConfig, facts: ExecutedFacts): string {
  const event: ExecutedEvent = {
    schemaVersion: 1,
    kind: "agreement_executed",
    issuer: pins.issuer,
    audience: pins.audience,
    keyId: pins.keyId,
    keyVersion: pins.keyVersion,
    senderBindingId: pins.senderBindingId,
    senderBindingRevision: pins.senderBindingRevision,
    senderGrantId: pins.senderGrantId,
    tenantId: pins.hostTenantId,
    sourceTenantId: facts.tenantId,
    eventId: facts.eventId,
    agreementId: facts.agreementId,
    revisionId: facts.revisionId,
    roundId: facts.roundId,
    completedAtMicros: facts.completedAtMicros,
    signedDocumentSha256: facts.signedDocumentSha256,
    auditRecordSha256: facts.auditRecordSha256,
  };
  return canonicalJson(executedEventSchema.parse(event));
}

/** The frozen body's fields; throws if the stored bytes are not exactly a canonical body. */
export function parseExecutedEvent(body: string): ExecutedEvent {
  const event = executedEventSchema.parse(JSON.parse(body));
  if (canonicalJson(event) !== body) throw new Error("Executed event body is not canonical");
  return event;
}

/**
 * Pure: signs a frozen body with the key its own keyId and keyVersion name, valid from
 * `issuedMicros` for `freshnessSeconds`. Throws when no configured key matches.
 */
export function signExecutedEvent(
  body: string,
  keys: readonly CompletionKey[],
  issuedMicros: bigint,
  freshnessSeconds: number,
): SignedEvent {
  const event = parseExecutedEvent(body);
  const key = keys.find(
    (candidate) => candidate.keyId === event.keyId && candidate.keyVersion === event.keyVersion,
  );
  if (!key) throw new Error("No configured completion key matches the event");
  const expiresMicros = issuedMicros + BigInt(freshnessSeconds) * 1_000_000n;
  const frame = deliveryFrame(event, issuedMicros, expiresMicros, body);
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(key.seed, "hex")]),
    format: "der",
    type: "pkcs8",
  });
  return {
    body,
    frame,
    headers: {
      "content-type": "application/json",
      "x-dripsign-issued-at-micros": issuedMicros.toString(),
      "x-dripsign-expires-at-micros": expiresMicros.toString(),
      "x-dripsign-signature": sign(null, frame, privateKey).toString("base64url"),
    },
  };
}

/** The pins an executed event is addressed and signed by. */
type DeliveryPins = Pick<CompletionExportConfig, "issuer" | "audience" | "keyId" | "keyVersion">;

/**
 * The one deliverability rule, shared by saving pins, freezing an event and delivering it: why
 * this deployment could never send an event under these pins (another sender or destination, or
 * a key it does not hold), or null when it can.
 */
export function undeliverableReason(
  pins: DeliveryPins,
  delivery: CompletionExportDelivery,
): string | null {
  const issuer = loadConfig().publicOrigin;
  const audience = new URL(delivery.url).origin;
  if (pins.issuer !== issuer || pins.audience !== audience) {
    return `On this server the issuer is ${issuer} and the audience is ${audience}.`;
  }
  const held = delivery.keys.some(
    (key) => key.keyId === pins.keyId && key.keyVersion === pins.keyVersion,
  );
  return held ? null : "This server holds no completion key with that id and version.";
}

/**
 * A freshly stamped delivery of a frozen event. Call it per attempt: the signature expires after
 * the frozen freshness. Throws when delivery is off or the frozen pins are undeliverable here.
 */
export function prepareExecutedEvent(frozen: FrozenExport): HostEventRequest {
  const delivery = loadConfig().completionExport;
  if (delivery === null) throw new Error("Completion export delivery is off");
  const event = parseExecutedEvent(frozen.body);
  const refusal = undeliverableReason(event, delivery);
  if (refusal !== null) throw new Error(refusal);
  const signed = signExecutedEvent(
    frozen.body,
    delivery.keys,
    frozen.nowMicros,
    frozen.freshnessSeconds,
  );
  return { ...signed, url: delivery.url };
}

/** The receipt Dreach returns for exactly this body, or null when the answer is anything else. */
export function parseExecutedReceipt(answer: unknown, body: string): ExecutedReceipt | null {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) return null;
  const fields = answer as Record<string, unknown>;
  const event = parseExecutedEvent(body);
  const { evidenceId, recordedAtMicros } = fields;
  if (
    Object.keys(fields).sort().join(",") !== "bodySha256,eventId,evidenceId,recordedAtMicros" ||
    fields.eventId !== event.eventId ||
    fields.bodySha256 !== createHash("sha256").update(body, "utf8").digest("hex") ||
    typeof evidenceId !== "string" ||
    !uuidSchema.safeParse(evidenceId).success ||
    typeof recordedAtMicros !== "number" ||
    !Number.isSafeInteger(recordedAtMicros) ||
    recordedAtMicros < event.completedAtMicros
  ) {
    return null;
  }
  return { evidenceId, recordedAtMicros };
}

function deliveryFrame(
  event: ExecutedEvent,
  issuedMicros: bigint,
  expiresMicros: bigint,
  body: string,
): Buffer {
  const fields = ["POST", HOST_EVENT_PATH, event.issuer, event.audience, event.keyId].map(
    (field) => {
      const bytes = Buffer.from(field, "ascii");
      return Buffer.concat([uint32(bytes.length), bytes]);
    },
  );
  const times = Buffer.alloc(16);
  times.writeBigInt64BE(issuedMicros, 0);
  times.writeBigInt64BE(expiresMicros, 8);
  return Buffer.concat([
    Buffer.from(FRAME_LABEL, "ascii"),
    uint32(FRAME_VERSION),
    ...fields,
    uint32(event.keyVersion),
    times,
    createHash("sha256").update(body, "utf8").digest(),
  ]);
}

function uint32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}
