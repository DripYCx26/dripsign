import 'server-only';
import { randomUUID } from 'node:crypto';
import { StoreError } from '@dripsign/db';
import { z } from 'zod';
import { getConfiguration } from './config';

// ASSUMPTION: JSON commands fit within 128 KiB; documents use a separate bounded upload.
export const MAX_COMMAND_BYTES = 128 * 1024;
export const API_VERSION = '2';
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

/** Cookie mutations require an exact configured origin, independent of proxy headers. */
export function requireOrigin(request: Request): void {
  if (request.headers.get('origin') !== getConfiguration().publicOrigin) {
    throw new HttpError(403, 'origin_rejected');
  }
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'origin_rejected');
}

/** A release pause blocks new content and signing effects while reads and recovery remain available. */
export function requireAdmission(): void {
  if (getConfiguration().isAdmissionPaused) throw new HttpError(503, 'admission_paused');
}

/** Bound streaming input before parsing so a missing content length cannot bypass the limit. */
export async function readBytes(request: Request, maximum: number): Promise<Uint8Array> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new HttpError(413, 'request_too_large');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new HttpError(408, 'request_timed_out')), 30_000); });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new HttpError(413, 'request_too_large');
      }
      chunks.push(chunk.value);
    }
  } finally {
    if (timeout) clearTimeout(timeout);
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Parse only the declared JSON transport and reject unknown schema fields. */
export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
    throw new HttpError(415, 'json_required');
  }
  const bytes = await readBytes(request, MAX_COMMAND_BYTES);
  return parseJsonBytes(bytes, schema);
}

/** Decode the exact signed bytes through the same strict JSON boundary. */
export function parseJsonBytes<T>(bytes: Uint8Array, schema: z.ZodType<T>): T {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new HttpError(400, 'invalid_request'); }
  return schema.parse(value);
}

/** JSON and PDF transports advertise the same version and private cache boundary. */
export function apiResponseHeaders(): Readonly<Record<string, string>> {
  return { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization', 'X-DripSign-Api-Version': API_VERSION };
}

export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: apiResponseHeaders() });
}

/** Map expected failures once without exposing private records or provider responses. */
export async function handleRequest(action: () => Promise<Response>): Promise<Response> {
  try { return await action(); }
  catch (error: unknown) {
    if (error instanceof HttpError) return json({ error: error.code }, error.status);
    if (error instanceof z.ZodError) return json({ error: 'invalid_request' }, 400);
    if (error instanceof StoreError) {
      const codes = { not_found: 404, forbidden: 404, conflict: 409, invalid: 400, rate_limited: 429, verification_required: 401 } as const;
      return json({ error: error.code === 'forbidden' ? 'not_found' : error.code }, codes[error.code]);
    }
    const requestId = randomUUID();
    process.stderr.write(JSON.stringify({ event: 'request_failed', requestId, errorClass: error instanceof Error ? error.name : 'Unknown' }) + '\n');
    return json({ error: 'service_unavailable', requestId }, 503);
  }
}
