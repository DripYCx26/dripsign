// The only idempotency mechanism: one receipt per (tenant, actor email, client key).
import { createHash } from "node:crypto";
import type { Db } from "../db.ts";
import { DomainError } from "../errors.ts";
import { canonicalJson, receiptKeySchema } from "../schema.ts";
import type { Capacity } from "../types.ts";

export interface ReceiptRequest {
  readonly tenantId: string;
  readonly actorEmail: string;
  readonly key: string;
  readonly operation: string;
  readonly capacity: Capacity;
  readonly resourceId: string | null;
  readonly payload: unknown;
}

export interface ReceiptOutcome<T> {
  readonly value: T;
  /** True when the stored result of an earlier identical request was returned. */
  readonly replayed: boolean;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function canonicalSha256(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/**
 * Runs `fn` once per receipt key inside the caller's transaction, taking the receipt lock first.
 * Same key and payload returns the stored result; a different payload is a `conflict`. Callers
 * recheck the actor's grant (`lockGrant`) after any wait here: inside `fn`, and before handing a
 * replayed result back.
 */
export async function withReceipt<T extends object | string | number | boolean>(
  db: Db,
  request: ReceiptRequest,
  fn: () => Promise<T>,
): Promise<ReceiptOutcome<T>> {
  if (!receiptKeySchema.safeParse(request.key).success) {
    throw new DomainError("invalid", "The request key is invalid.");
  }
  const payloadSha256 = canonicalSha256({
    operation: request.operation,
    capacity: request.capacity,
    resourceId: request.resourceId,
    payload: request.payload,
  });
  // The placeholder row holds the key: a concurrent duplicate waits here until this commits.
  const claimed = await db.query(
    `INSERT INTO dripsign.command_receipt (
       tenant_id, actor_email, key, operation, capacity, resource_id, payload_sha256
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [
      request.tenantId,
      request.actorEmail,
      request.key,
      request.operation,
      request.capacity,
      request.resourceId,
      payloadSha256,
    ],
  );
  if (claimed.rowCount === 0) return replay<T>(db, request, payloadSha256);
  const value = await fn();
  await db.query(
    `UPDATE dripsign.command_receipt SET result = $4
     WHERE tenant_id = $1 AND actor_email = $2 AND key = $3`,
    [request.tenantId, request.actorEmail, request.key, JSON.stringify(value)],
  );
  return { value, replayed: false };
}

async function replay<T>(
  db: Db,
  request: ReceiptRequest,
  payloadSha256: string,
): Promise<ReceiptOutcome<T>> {
  const prior = await db.query<{ payload_sha256: string; result: T | null }>(
    `SELECT payload_sha256, result FROM dripsign.command_receipt
     WHERE tenant_id = $1 AND actor_email = $2 AND key = $3
     FOR UPDATE`,
    [request.tenantId, request.actorEmail, request.key],
  );
  const row = prior.rows[0];
  if (row?.payload_sha256 !== payloadSha256 || row.result === null) {
    throw new DomainError("conflict", "This request key was already used for a different request.");
  }
  return { value: row.result, replayed: true };
}
