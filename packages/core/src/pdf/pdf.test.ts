import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashBytes } from "../adapters/storage.ts";
import { SIGNING_CONSENT } from "../schema.ts";
import { assertRenderableName } from "./font.ts";
import { prepareDraftPdf } from "./prepare.ts";
import { renderAuditRecord, renderSignedPdf } from "./archive.ts";
import type { ArchiveEvidence } from "./archive.ts";

describe("PDF evidence", () => {
  it("refuses unsupported names before rendering, prepares signer fields and renders evidence deterministically", async () => {
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
    const reordered = {
      ...evidence,
      signatures: [...evidence.signatures].reverse(),
      signers: [...evidence.signers].reverse(),
    };
    expect(hashBytes(await renderSignedPdf(reordered, prepared.bytes))).toBe(
      hashBytes(firstSigned),
    );
    expect(hashBytes(await renderAuditRecord(reordered))).toBe(hashBytes(firstAudit));
  });
});
