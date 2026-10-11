import { Readable } from "node:stream";
import { createDeflate } from "node:zlib";
import { randomBytes } from "node:crypto";
import { PDFDocument, PDFName } from "pdf-lib";
import { expect } from "vitest";
import { prepareDraftPdf } from "./prepare.ts";

async function inflationBomb(megabytes = 300, streamCount = 1): Promise<Uint8Array> {
  const block = Buffer.alloc(1024 * 1024);
  const input = Readable.from(
    (function* () {
      for (let index = 0; index < megabytes; index++) yield block;
    })(),
  );
  const compressed: Uint8Array[] = [];
  for await (const chunk of input.pipe(createDeflate({ level: 1 }))) {
    if (!(chunk instanceof Uint8Array)) throw new Error("Unexpected fixture compression output");
    compressed.push(chunk);
  }
  const stream = Buffer.concat(compressed);
  const parts = [
    Buffer.from(`%PDF-1.7
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
`),
  ];
  for (let index = 0; index < streamCount; index++)
    parts.push(
      Buffer.from(
        `${String(index + 4)} 0obj << /Type /ObjStm /N 0 /First 0 /Filter /Fl#61teDecode /Length ${String(stream.byteLength)} >> stream\n`,
      ),
      stream,
      Buffer.from("\nendstream\nendobj\n"),
    );
  parts.push(Buffer.from("trailer << /Root 1 0 R >>\n%%EOF"));
  return Buffer.concat(parts);
}

export async function assertUploadInflationBound(): Promise<void> {
  const uploadBytes = await inflationBomb();
  expect(uploadBytes.byteLength).toBeLessThan(2 * 1024 * 1024);
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
  expect(outcome).toBe("invalid");
  await expect(
    prepareDraftPdf({
      title: "Cumulative inflation bomb",
      signers: [],
      uploadBytes: await inflationBomb(40, 2),
    }),
  ).rejects.toMatchObject({ code: "invalid" });
}

export async function assertLargeConcurrentUploads(): Promise<void> {
  const document = await PDFDocument.create();
  for (let index = 0; index < 20; index++) {
    const page = document.addPage();
    const image = document.context.register(
      document.context.flateStream(randomBytes(256 * 256 * 3), {
        Type: "XObject",
        Subtype: "Image",
        Width: 256,
        Height: 256,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
      }),
    );
    page.node.setXObject(PDFName.of("SyntheticImage"), image);
    page.node.addContentStream(
      document.context.register(
        document.context.stream("q 256 0 0 256 54 400 cm /SyntheticImage Do Q"),
      ),
    );
  }
  const uploadBytes = await document.save();
  expect(uploadBytes.byteLength).toBeGreaterThan(3 * 1024 * 1024);
  const results = await Promise.all(
    [0, 1].map(() =>
      prepareDraftPdf({
        title: "Synthetic large image agreement",
        signers: [],
        uploadBytes,
      }),
    ),
  );
  for (const result of results) {
    expect(result.pageCount).toBe(20);
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(20);
  }
}
