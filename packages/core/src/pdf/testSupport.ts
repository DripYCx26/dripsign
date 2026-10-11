import { Readable } from "node:stream";
import { createDeflate, deflateSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { PDFDocument, PDFName } from "pdf-lib";
import { expect } from "vitest";
import { prepareDraftPdf } from "./prepare.ts";
import { assertInflationBound } from "./preflight.ts";

export function assertPreflightWorkBound(): void {
  const input = Buffer.from(`%PDF-1.7\n1${"%\r\n".repeat(40)}bad`);
  expect(input.byteLength).toBe(133);
  const started = performance.now();
  assertInflationBound(input);
  expect(performance.now() - started).toBeLessThan(100);
  expect(() => {
    assertInflationBound(
      Buffer.from("1 0 obj << /Type 2 0 R /Length 0 >> stream\n\nendstream\nendobj"),
    );
  }).toThrow(expect.objectContaining({ code: "invalid" }));

  const header = "1 0 obj << /Length 0000000000 >> stream\n";
  const headers = Array.from({ length: 64 }, () => header).join("");
  const body = Buffer.concat([Buffer.from(headers), Buffer.alloc(2 * 1024 * 1024, 32)]);
  for (let index = 0; index < 64; index++) {
    const start = index * header.length;
    body.write(
      String(body.byteLength - start - header.length).padStart(10, "0"),
      start + header.indexOf("0000000000"),
    );
  }
  const overlapping = Buffer.concat([body, Buffer.from("\nendstream\nendobj")]);
  expect(() => {
    assertInflationBound(overlapping);
  }).toThrow(expect.objectContaining({ code: "invalid" }));
}

export async function assertUploadQueueBound(uploadBytes: Uint8Array): Promise<void> {
  const controllers = Array.from({ length: 9 }, () => new AbortController());
  const pending = controllers.map((controller) =>
    prepareDraftPdf(
      { title: "Queue bound fixture", signers: [], uploadBytes },
      controller.signal,
    ).then(
      () => "accepted",
      (error: unknown) => error,
    ),
  );
  try {
    await expect(
      prepareDraftPdf({ title: "Overloaded fixture", signers: [], uploadBytes }),
    ).rejects.toMatchObject({ code: "unavailable" });
    controllers[1]?.abort(new Error("Queued cancellation"));
    await expect(
      Promise.race([
        pending[1],
        new Promise((resolve) =>
          setTimeout(() => {
            resolve("Cancellation delayed");
          }, 100),
        ),
      ]),
    ).resolves.toMatchObject({ message: "Queued cancellation" });
  } finally {
    for (const controller of controllers) controller.abort(new Error("Fixture cleanup"));
    await Promise.all(pending);
  }
}

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
  const width = 1152;
  const pixels = Buffer.alloc(width * width * 3);
  const imageBytes = deflateSync(pixels);
  expect(pixels.byteLength * 20).toBeGreaterThan(64 * 1024 * 1024);
  for (let index = 0; index < 20; index++) {
    const page = document.addPage();
    const image = document.context.register(
      document.context.stream(imageBytes, {
        Type: "XObject",
        Subtype: "Image",
        Width: width,
        Height: width,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
        Filter: "FlateDecode",
      }),
    );
    page.node.setXObject(PDFName.of("SyntheticImage"), image);
    page.node.addContentStream(
      document.context.register(
        document.context.stream("Gap9`0JYLa0E=END/,eQ@UPjjS?&;)>a\\ZVO]mp9m$X?1SuU_3Y7Ls>l@TK0~>", {
          Filter: ["ASCII85Decode", "FlateDecode"],
        }),
      ),
    );
  }
  const uploadBytes = await document.save();
  expect(uploadBytes.byteLength).toBeLessThan(100 * 1024);
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
