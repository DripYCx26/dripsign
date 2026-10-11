import { Readable } from "node:stream";
import { createDeflate } from "node:zlib";
import { expect } from "vitest";
import { prepareDraftPdf } from "./prepare.ts";

async function inflationBomb(): Promise<Uint8Array> {
  const block = Buffer.alloc(1024 * 1024);
  const input = Readable.from(
    (function* () {
      for (let index = 0; index < 300; index++) yield block;
    })(),
  );
  const compressed: Uint8Array[] = [];
  for await (const chunk of input.pipe(createDeflate({ level: 1 }))) {
    if (!(chunk instanceof Uint8Array)) throw new Error("Unexpected fixture compression output");
    compressed.push(chunk);
  }
  const stream = Buffer.concat(compressed);
  const prefix = Buffer.from(`%PDF-1.7
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
4 0 obj << /Type /ObjStm /N 0 /First 0 /Filter /FlateDecode /Length ${String(stream.byteLength)} >> stream
`);
  return Buffer.concat([
    prefix,
    stream,
    Buffer.from("\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF"),
  ]);
}

export async function assertUploadMemoryBound(): Promise<void> {
  const uploadBytes = await inflationBomb();
  expect(uploadBytes.byteLength).toBeLessThan(2 * 1024 * 1024);
  const baseline = process.memoryUsage.rss();
  let peak = baseline;
  const sampling = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage.rss());
  }, 5);
  try {
    const outcome = await prepareDraftPdf({
      title: "Synthetic inflation bomb",
      signers: [],
      uploadBytes,
    }).then(
      () => "accepted",
      (error: unknown) => {
        if (error instanceof Error && "code" in error) return error.code;
        throw error;
      },
    );
    expect(peak - baseline).toBeLessThan(192 * 1024 * 1024);
    expect(outcome).toBe("invalid");
  } finally {
    clearInterval(sampling);
  }
}
