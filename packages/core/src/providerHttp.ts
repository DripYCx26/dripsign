/** Reads provider responses with a byte cap before parsing, including chunked bodies. */
export async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maxBytes)) {
    await response.body?.cancel();
    throw new Error('Provider response exceeds its limit.');
  }
  if (!response.body) throw new Error('Provider response is missing.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > maxBytes) { await reader.cancel(); throw new Error('Provider response exceeds its limit.'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}

export async function readProviderJson(response: Response): Promise<unknown> {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedBody(response, 512 * 1024))) as unknown;
}

export function configuredHttpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Provider URL must use HTTPS.');
  return url;
}
