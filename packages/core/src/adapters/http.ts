// Provider and host answers are read with a byte cap before anything parses them.

/** The response body, refused once it passes `maxBytes`, including chunked bodies. */
export async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maxBytes)) {
    await response.body?.cancel();
    throw new Error("Response exceeds its limit");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const chunk: unknown = next.value;
      if (!(chunk instanceof Uint8Array)) throw new Error("Response body is invalid");
      size += chunk.byteLength;
      if (size > maxBytes) throw new Error("Response exceeds its limit");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

/** Strict UTF-8 JSON within the cap; null when the body is not JSON. */
export async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const bytes = await readBoundedBody(response, maxBytes);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return null;
  }
}
