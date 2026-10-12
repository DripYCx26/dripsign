import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashBytes } from "../adapters/storage.ts";
import { SIGNING_CONSENT } from "../schema.ts";
import { assertRenderableName } from "./font.ts";
import { prepareDraftPdf, preparePdfInProcess } from "./prepare.ts";
import { renderAuditRecord, renderSignedPdf } from "./archive.ts";
import type { ArchiveEvidence } from "./archive.ts";
import {
  assertLargeConcurrentUploads,
  assertUploadInflationBound,
  assertPreflightWorkBound,
  assertUploadQueueBound,
} from "./testSupport.ts";

interface PdfReader {
  getDocument(input: { data: Uint8Array; verbosity: number }): {
    promise: Promise<{
      numPages: number;
      getPage(page: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
    }>;
    destroy(): Promise<void>;
  };
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const require = createRequire(new URL("../../../../package.json", import.meta.url));
  const reader = (await import(require.resolve("pdfjs-dist/legacy/build/pdf.mjs"))) as PdfReader;
  const task = reader.getDocument({ data: bytes.slice(), verbosity: 0 });
  const document = await task.promise;
  try {
    const lines: string[] = [];
    for (let page = 1; page <= document.numPages; page++) {
      const content = await (await document.getPage(page)).getTextContent();
      for (const item of content.items) {
        if (typeof item === "object" && item !== null && "str" in item)
          lines.push(String(item.str));
      }
    }
    return lines.join("\n");
  } finally {
    await task.destroy();
  }
}

afterEach(() => vi.useRealTimers());

async function expectRefusedUpload(uploaded: PDFDocument): Promise<void> {
  await expect(
    preparePdfInProcess({
      title: "Unsupported upload",
      signers: [],
      uploadBytes: await uploaded.save(),
    }),
  ).rejects.toMatchObject({
    code: "invalid",
    message: "The PDF contains unsupported active content.",
  });
}

describe("PDF evidence", () => {
  it("accepts discarded OpenAction, navigation, Link URIs and unsigned fields; refuses unsafe actions and signed fields", async () => {
    const uploaded = await PDFDocument.create();
    const page = uploaded.addPage();
    const destination = uploaded.context.obj([page.ref, PDFName.of("Fit")]);
    uploaded.catalog.set(
      PDFName.of("OpenAction"),
      uploaded.context.obj({ S: PDFName.of("JavaScript"), JS: PDFString.of("") }),
    );
    page.node.set(
      PDFName.of("AA"),
      uploaded.context.obj({
        O: {
          S: PDFName.of("GoTo"),
          D: destination,
          Next: ["NextPage", "PrevPage", "FirstPage", "LastPage"].map((name) => ({
            S: PDFName.of("Named"),
            N: PDFName.of(name),
          })),
        },
      }),
    );
    const signature = uploaded.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Widget"),
      FT: PDFName.of("Sig"),
      Rect: [0, 0, 100, 30],
      T: PDFString.of("Unsigned signature"),
    });
    const uri = uploaded.context.register(
      uploaded.context.obj({
        S: PDFName.of("URI"),
        URI: PDFString.of("https://example.test"),
        Next: { S: PDFName.of("URI"), URI: PDFString.of("mailto:recipient@example.test") },
      }),
    );
    const link = uploaded.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Link"),
      Rect: [0, 40, 100, 70],
      A: uri,
    });
    page.node.set(PDFName.of("Annots"), uploaded.context.obj([signature, link]));
    const prepared = await prepareDraftPdf({
      title: "Benign navigation and unsigned signature",
      signers: [],
      uploadBytes: await uploaded.save(),
    });
    expect(prepared.pageCount).toBe(1);
    const copied = await PDFDocument.load(prepared.bytes);
    expect(copied.catalog.has(PDFName.of("OpenAction"))).toBe(false);
    uploaded
      .addPage()
      .node.set(
        PDFName.of("AA"),
        uploaded.context.obj({ O: { S: PDFName.of("GoTo"), D: destination, Next: uri } }),
      );
    await expectRefusedUpload(uploaded);
    uploaded.removePage(1);
    signature.set(PDFName.of("V"), uploaded.context.obj({}));
    await expectRefusedUpload(uploaded);
    signature.delete(PDFName.of("V"));
    link.set(PDFName.of("Subtype"), PDFName.of("Widget"));
    await expectRefusedUpload(uploaded);
    link.set(PDFName.of("Subtype"), PDFName.of("Link"));
    page.node.set(
      PDFName.of("AA"),
      uploaded.context.obj({
        O: {
          S: PDFName.of("GoTo"),
          D: destination,
          Next: [{ S: PDFName.of("Named"), N: PDFName.of("Print") }],
        },
      }),
    );
    await expectRefusedUpload(uploaded);
    page.node.delete(PDFName.of("AA"));
    signature.set(
      PDFName.of("Parent"),
      uploaded.context.obj({
        AA: { K: { S: PDFName.of("URI"), URI: PDFString.of("https://example.test") } },
      }),
    );
    await expectRefusedUpload(uploaded);
    signature.delete(PDFName.of("Parent"));
    page.node.set(
      PDFName.of("Annots"),
      uploaded.context.obj([
        {
          Type: PDFName.of("Annot"),
          Subtype: PDFName.of("FileAttachment"),
          Rect: [0, 0, 10, 10],
          FS: {
            Type: PDFName.of("Filespec"),
            F: PDFString.of("synthetic.txt"),
            EF: { F: uploaded.context.register(uploaded.context.stream("Harmless fixture")) },
          },
        },
      ]),
    );
    await expectRefusedUpload(uploaded);
  });

  it("prepares fields and deterministic redacted evidence, bounds upload inflation, rejects unsafe PDFs and accepts large concurrent uploads", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T10:03:00Z"));
    await expect(assertRenderableName("Jordan 🛸")).rejects.toMatchObject({ code: "invalid" });
    const signers = ["Jordan Lee", "Morgan Diaz"].map((name, index) => ({
      id: randomUUID(),
      name,
      email: `signer${String(index)}@example.test`,
    }));
    const prepared = await prepareDraftPdf({
      title: "Services agreement",
      source: {
        title: "Services agreement",
        sections: [
          {
            id: "scope",
            heading: "Scope",
            paragraphs: ["Provide the services described in this agreement."],
          },
        ],
      },
      signers,
    });
    expect(prepared.fields).toHaveLength(signers.length * 2);
    for (const signer of signers) {
      expect(
        prepared.fields
          .filter((field) => field.recipientId === signer.id)
          .map((field) => field.type)
          .sort(),
      ).toEqual(["date", "signature"]);
    }
    const evidence: ArchiveEvidence = {
      title: "Services agreement",
      revision: {
        number: 1,
        document: {
          key: "unused",
          sha256: hashBytes(prepared.bytes),
          byteLength: prepared.bytes.byteLength,
        },
        fields: prepared.fields,
      },
      round: {
        id: randomUUID(),
        createdAt: "2026-10-11T10:00:00.000Z",
        finalizingAt: "2026-10-11T10:02:00.000Z",
        consent: SIGNING_CONSENT,
      },
      signers: signers.map((signer) => ({ ...signer, recipientId: signer.id })),
      signatures: signers.map((signer) => ({
        recipientId: signer.id,
        typedName: signer.name,
        signedAt: "2026-10-11T10:01:00.000Z",
        verifiedAt: "2026-10-11T09:59:00.000Z",
        sessionId: randomUUID(),
        ipAddress: "127.0.0.1",
        userAgent: "Synthetic 🛸 browser\nfixture",
      })),
      timeline: [{ at: "2026-10-11T10:01:00.000Z", kind: "signature_recorded" }],
    };
    const firstSigned = await renderSignedPdf(evidence, prepared.bytes);
    const firstAudit = await renderAuditRecord(evidence);
    expect(hashBytes(firstSigned)).not.toBe(evidence.revision.document.sha256);
    const revisionText = await pdfText(prepared.bytes);
    const signedText = await pdfText(firstSigned);
    const auditText = await pdfText(firstAudit);
    for (const signer of signers) {
      expect(revisionText).toContain(signer.name);
      expect(signedText).toContain(signer.name);
      expect(auditText).toContain(signer.name);
      for (const text of [revisionText, signedText, auditText])
        expect(text).not.toContain(signer.email);
    }
    expect(auditText).toContain("s***@example.test");
    expect(auditText).toContain("IP address: 127.0.0.1");
    const renamed = {
      ...evidence,
      signatures: evidence.signatures.map((signature) => ({ ...signature, typedName: "J. Lee" })),
    };
    expect(hashBytes(await renderSignedPdf(renamed, prepared.bytes))).not.toBe(
      hashBytes(firstSigned),
    );
    expect(
      hashBytes(
        await renderAuditRecord({
          ...evidence,
          signatures: evidence.signatures.map((signature) => ({
            ...signature,
            ipAddress: "127.0.0.2",
          })),
        }),
      ),
    ).not.toBe(hashBytes(firstAudit));
    const reordered = {
      ...evidence,
      signatures: [...evidence.signatures].reverse(),
    };
    vi.setSystemTime(new Date("2026-10-12T10:03:00Z"));
    expect(hashBytes(await renderSignedPdf(reordered, prepared.bytes))).toBe(
      hashBytes(firstSigned),
    );
    expect(hashBytes(await renderAuditRecord(reordered))).toBe(hashBytes(firstAudit));
    const uploaded = await PDFDocument.create();
    const uploadedPage = uploaded.addPage();
    const uploadBytes = await uploaded.save();
    assertPreflightWorkBound();
    await assertUploadQueueBound(uploadBytes);
    const copied = await prepareDraftPdf({ title: evidence.title, signers, uploadBytes });
    expect(copied.pageCount).toBe(2);
    const cancellation = new AbortController();
    const cancelled = prepareDraftPdf(
      { title: evidence.title, signers, uploadBytes },
      cancellation.signal,
    );
    cancellation.abort(new Error("Synthetic cancellation"));
    await expect(cancelled).rejects.toThrow("Synthetic cancellation");
    uploadedPage.node.set(
      PDFName.of("AA"),
      uploaded.context.obj({
        O: {
          S: PDFName.of("JavaScript"),
          JS: PDFString.of(""),
        },
      }),
    );
    await expect(
      prepareDraftPdf({ title: evidence.title, signers, uploadBytes: await uploaded.save() }),
    ).rejects.toMatchObject({ code: "invalid" });
    await assertUploadInflationBound();
    await assertLargeConcurrentUploads();
    uploadedPage.node.delete(PDFName.of("AA"));
    uploaded.context.trailerInfo.Encrypt = uploaded.context.register(
      PDFDict.withContext(uploaded.context),
    );
    await expect(
      prepareDraftPdf({ title: evidence.title, signers, uploadBytes: await uploaded.save() }),
    ).rejects.toMatchObject({ code: "invalid" });
  }, 20_000);
});
