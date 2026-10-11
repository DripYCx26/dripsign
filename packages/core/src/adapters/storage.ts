import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { loadConfig } from "../config.ts";
import type { StorageConfig } from "../config.ts";
import { LIMITS, sha256Schema, uuidSchema } from "../schema.ts";

const MAX_OBJECT_BYTES = LIMITS.pdfBytes * 2;

export interface StoredObject {
  readonly key: string;
  readonly sha256: string;
  readonly byteLength: number;
}

export interface StorageDriver {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function objectKey(tenantId: string, sha256: string): string {
  return `tenants/${uuidSchema.parse(tenantId)}/objects/${sha256Schema.parse(sha256)}`;
}

function validateKey(key: string): void {
  const match = /^tenants\/([^/]+)\/objects\/([^/]+)$/u.exec(key);
  if (!match || objectKey(match[1] ?? "", match[2] ?? "") !== key) {
    throw new Error("Invalid storage key");
  }
}

export function createStorage(config: StorageConfig): StorageDriver {
  if (config.kind === "file") return fileStorage(config.dir);
  const client = new S3Client({ region: config.region });
  return {
    async put(key, bytes) {
      validateKey(key);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: bytes,
            IfNoneMatch: "*",
            ContentType: "application/pdf",
            ...(config.kmsKeyId
              ? { ServerSideEncryption: "aws:kms", SSEKMSKeyId: config.kmsKeyId }
              : {}),
          }),
          { abortSignal: AbortSignal.timeout(60_000) },
        );
      } catch (error: unknown) {
        if (!(
          error instanceof Error &&
          "$metadata" in error &&
          (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 412
        ))
          throw error;
      }
    },
    async get(key) {
      validateKey(key);
      const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(60_000),
      });
      if (!result.Body) throw new Error("Storage object has no body");
      return boundedStorageRead(result.Body.transformToWebStream());
    },
  };
}

function fileStorage(dir: string): StorageDriver {
  return {
    async put(key, bytes) {
      validateKey(key);
      const path = join(dir, key);
      const temporary = `${path}.${randomUUID()}.tmp`;
      await mkdir(dirname(path), { recursive: true });
      try {
        await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch((error: unknown) => {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        });
      }
    },
    async get(key) {
      validateKey(key);
      const path = join(dir, key);
      if ((await stat(path)).size > MAX_OBJECT_BYTES)
        throw new Error("Storage object exceeds limit");
      return readFile(path);
    },
  };
}

let defaultStorage: StorageDriver | undefined;
export function getStorage(): StorageDriver {
  defaultStorage ??= createStorage(loadConfig().storage);
  return defaultStorage;
}

export async function storeBytes(
  tenantId: string,
  bytes: Uint8Array,
  driver = getStorage(),
): Promise<StoredObject> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_OBJECT_BYTES)
    throw new Error("Storage object size is invalid");
  const sha256 = hashBytes(bytes);
  const object = { key: objectKey(tenantId, sha256), sha256, byteLength: bytes.byteLength };
  await driver.put(object.key, bytes);
  // Conditional writes may have found an existing object. Verify it rather than trusting its key.
  await readBytes(object, driver);
  return object;
}

export async function readBytes(object: StoredObject, driver = getStorage()): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(object.byteLength) ||
    object.byteLength <= 0 ||
    object.byteLength > MAX_OBJECT_BYTES
  )
    throw new Error("Storage object size is invalid");
  validateKey(object.key);
  if (!object.key.endsWith(`/${sha256Schema.parse(object.sha256)}`))
    throw new Error("Storage key mismatch");
  const bytes = await driver.get(object.key);
  if (bytes.byteLength !== object.byteLength || hashBytes(bytes) !== object.sha256) {
    throw new Error("Storage integrity mismatch");
  }
  return bytes;
}

async function boundedStorageRead(stream: ReadableStream): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const chunk: unknown = next.value;
      if (!(chunk instanceof Uint8Array)) throw new Error("Storage body is invalid");
      length += chunk.byteLength;
      if (length > MAX_OBJECT_BYTES) throw new Error("Storage object exceeds limit");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
