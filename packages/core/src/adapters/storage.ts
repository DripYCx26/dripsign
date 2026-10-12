import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { loadConfig } from "../config.ts";
import type { StorageConfig } from "../config.ts";
import { LIMITS, sha256Schema, uuidSchema } from "../schema.ts";
import { azureToken } from "./azure.ts";
import { readBoundedBody } from "./http.ts";

const MAX_OBJECT_BYTES = LIMITS.pdfBytes;
const OPERATION_TIMEOUT_MS = 60_000;
/** Pinned: the newest Blob service version deployed in every public region on 2026-09-23. */
export const BLOB_SERVICE_VERSION = "2026-04-06";
const STORAGE_RESOURCE = "https://storage.azure.com/";

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
  switch (config.kind) {
    case "file":
      return fileStorage(config.dir);
    case "s3":
      return s3Storage(config);
    case "azure":
      return azureBlobStorage(config);
  }
}

function s3Storage(config: Extract<StorageConfig, { kind: "s3" }>): StorageDriver {
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
          { abortSignal: AbortSignal.timeout(OPERATION_TIMEOUT_MS) },
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
        abortSignal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
      });
      if (!result.Body) throw new Error("Storage object has no body");
      return readBoundedBody(new Response(result.Body.transformToWebStream()), MAX_OBJECT_BYTES);
    },
  };
}

/**
 * Block blobs under the app's managed identity, written once with `If-None-Match: *`. The
 * template grants create and read, never overwrite or delete.
 */
function azureBlobStorage(config: Extract<StorageConfig, { kind: "azure" }>): StorageDriver {
  const base = new URL(`${config.endpoint.replace(/\/$/u, "")}/${config.container}/`);
  const token = azureToken(config.identity, STORAGE_RESOURCE);

  /** One request, sent again once with a fresh token only when the service refused the token. */
  async function send(
    method: "GET" | "PUT",
    key: string,
    headers: Readonly<Record<string, string>>,
    body?: Uint8Array,
  ): Promise<Response> {
    const signal = AbortSignal.timeout(OPERATION_TIMEOUT_MS);
    const url = new URL(key, base);
    for (let refreshed = false; ; refreshed = true) {
      const bearer = await token.bearer(signal);
      const response = await fetch(url, {
        method,
        redirect: "error",
        signal,
        ...(body ? { body: new Uint8Array(body) } : {}),
        headers: {
          ...headers,
          Authorization: `Bearer ${bearer}`,
          "x-ms-version": BLOB_SERVICE_VERSION,
          "x-ms-date": new Date().toUTCString(),
        },
      });
      if (response.status !== 401 || refreshed) return response;
      await response.body?.cancel();
      token.refuse(bearer);
    }
  }

  return {
    async put(key, bytes) {
      validateKey(key);
      const response = await send(
        "PUT",
        key,
        {
          "x-ms-blob-type": "BlockBlob",
          "Content-Type": "application/pdf",
          "If-None-Match": "*",
          // The service refuses a body whose MD5 changed in transit; reads verify the SHA-256.
          "Content-MD5": createHash("md5").update(bytes).digest("base64"),
          "x-ms-meta-sha256": hashBytes(bytes),
        },
        bytes,
      );
      await response.body?.cancel();
      // An existing blob, or one this identity may not overwrite, counts only once storeBytes has
      // read back the same bytes.
      if ([201, 403, 409, 412].includes(response.status)) return;
      throw new Error(`Storage write failed with status ${String(response.status)}`);
    },
    async get(key) {
      validateKey(key);
      const response = await send("GET", key, {});
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new Error(`Storage read failed with status ${String(response.status)}`);
      }
      return readBoundedBody(response, MAX_OBJECT_BYTES);
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
