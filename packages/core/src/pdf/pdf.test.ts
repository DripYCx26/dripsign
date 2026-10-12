import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashBytes } from "../adapters/storage.ts";
import { SIGNING_CONSENT } from "../schema.ts";
import { assertRenderableName } from "./font.ts";
import { prepareDraftPdf } from "./prepare.ts";
import { renderAuditRecord, renderSignedPdf } from "./archive.ts";
import type { ArchiveEvidence } from "./archive.ts";

interface PdfReader {
  getDocument(input: { data: Uint8Array; verbosity: number }): {
    promise: Promise<{
      numPages: number;
      getPage(page: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
    }>;
    destroy(): Promise<void>;
  };
}

/** Every text run in the PDF with the id of the font resource it is drawn in. */
async function pdfRuns(bytes: Uint8Array): Promise<{ str: string; font: string }[]> {
  const require = createRequire(new URL("../../../../package.json", import.meta.url));
  const reader = (await import(require.resolve("pdfjs-dist/legacy/build/pdf.mjs"))) as PdfReader;
  const task = reader.getDocument({ data: bytes.slice(), verbosity: 0 });
  const document = await task.promise;
  try {
    const runs: { str: string; font: string }[] = [];
    for (let page = 1; page <= document.numPages; page++) {
      const content = await (await document.getPage(page)).getTextContent();
      for (const item of content.items) {
        if (typeof item === "object" && item !== null && "str" in item && "fontName" in item)
          runs.push({ str: String(item.str), font: String(item.fontName) });
      }
    }
    return runs;
  } finally {
    await task.destroy();
  }
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  return (await pdfRuns(bytes)).map((run) => run.str).join("\n");
}

afterEach(() => vi.useRealTimers());

describe("PDF evidence", () => {
  it("prepares signer fields and deterministic, redacted evidence", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T10:03:00Z"));
    await expect(assertRenderableName("Jordan 🛸")).rejects.toMatchObject({ code: "invalid" });
    // The preview's verdict: Newsreader Italic for a Latin name, Noto Sans past its glyphs.
    await expect(assertRenderableName(" Jordan Lee ")).resolves.toBe("script");
    await expect(assertRenderableName("Мария Иванова")).resolves.toBe("plain");
    const signers = ["Jordan Lee", "Мария Иванова"].map((name, index) => ({
      id: randomUUID(),
      name,
      email: `signer${String(index)}@example.test`,
    }));
    const prepared = await prepareDraftPdf({
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
    // Each signature is drawn in the face the preflight named: Newsreader Italic for the Latin
    // name, and for the Cyrillic one the same Noto Sans as the evidence line under it.
    const evidenceLine = "Signed 2026-10-11 10:01:00 UTC · Email verified";
    const signedRuns = await pdfRuns(firstSigned);
    const fontOf = (str: string) => signedRuns.filter((run) => run.str === str).at(-1)?.font;
    expect(new TextDecoder("latin1").decode(firstSigned)).toContain("/Newsreader16pt-Italic");
    expect(fontOf(evidenceLine)).toBeDefined();
    expect(fontOf("Jordan Lee")).not.toBe(fontOf(evidenceLine));
    expect(fontOf("Мария Иванова")).toBe(fontOf(evidenceLine));
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
  });
});
