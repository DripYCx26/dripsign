// The archive seam: the worker loads a finalizing round's frozen evidence, renders and stores the
// signed PDF and audit record, then commits them here.
import { objectKey } from "../adapters/storage.ts";
import type { StoredObject } from "../adapters/storage.ts";
import type { Db } from "../db.ts";
import { DomainError } from "../errors.ts";
import { lockLease } from "../jobs/outbox.ts";
import type { JobLease } from "../jobs/outbox.ts";
import type { ArchiveEvidence } from "../pdf/archive.ts";
import type { SigningField } from "../schema.ts";
import { exportCompletion } from "./completionExport.ts";
import { liveRecipients, notify } from "./notify.ts";
import { withinTx } from "./state.ts";

export interface ArchiveCompletion {
  readonly tenantId: string;
  readonly roundId: string;
  readonly leaseFence: JobLease;
  readonly signedDocument: StoredObject;
  readonly auditRecord: StoredObject;
}

export type ArchiveOutcome = "completed" | "already_completed" | "lease_lost";

interface EvidenceRow {
  status: string;
  agreementId: string;
  title: string;
  createdAt: Date;
  finalizingAt: Date | null;
  consentVersion: string;
  consentText: string;
  consentHash: string;
  number: number;
  documentSha256: string;
  documentBytes: number;
  signingFields: SigningField[];
}

interface SignerEvidenceRow {
  recipientId: string;
  name: string;
  email: string;
  typedName: string;
  verifiedAt: Date;
  signedAt: Date;
  sessionId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Worker seam: the frozen evidence of a finalizing round; null once the round is completed. */
export async function loadArchiveEvidence(
  db: Db,
  input: { readonly tenantId: string; readonly roundId: string },
): Promise<ArchiveEvidence | null> {
  const { tenantId, roundId } = input;
  const found = await db.query<EvidenceRow>(
    `SELECT g.status, g.agreement_id AS "agreementId", a.title, g.created_at AS "createdAt",
       g.finalizing_at AS "finalizingAt", g.consent_version AS "consentVersion",
       g.consent_text AS "consentText", g.consent_hash AS "consentHash", v.number,
       g.document_sha256 AS "documentSha256", v.document_bytes AS "documentBytes",
       v.signing_fields AS "signingFields"
     FROM dripsign.signing_round g
     JOIN dripsign.agreement a ON a.tenant_id = g.tenant_id AND a.id = g.agreement_id
     JOIN dripsign.revision v ON v.tenant_id = g.tenant_id AND v.id = g.revision_id
     WHERE g.tenant_id = $1 AND g.id = $2`,
    [tenantId, roundId],
  );
  const row = found.rows[0];
  if (row?.status === "completed") return null;
  if (row?.status !== "finalizing" || row.finalizingAt === null) {
    throw new Error(`Round ${roundId} is not finalizing`);
  }
  const round = { ...row, tenantId, roundId, finalizingAt: row.finalizingAt };
  const signers = await db.query<SignerEvidenceRow>(
    `SELECT rs.recipient_id AS "recipientId", rs.name, rs.email, s.typed_name AS "typedName",
       s.verified_at AS "verifiedAt", s.signed_at AS "signedAt", s.session_id AS "sessionId",
       s.ip_address AS "ipAddress", s.user_agent AS "userAgent"
     FROM dripsign.round_signer rs
     JOIN dripsign.signing_round g ON g.tenant_id = rs.tenant_id AND g.id = rs.round_id
     JOIN dripsign.revision v ON v.tenant_id = g.tenant_id AND v.id = g.revision_id
     JOIN dripsign.signature s
       ON s.tenant_id = rs.tenant_id AND s.round_id = rs.round_id
      AND s.recipient_id = rs.recipient_id
     WHERE rs.tenant_id = $1 AND rs.round_id = $2
     ORDER BY array_position(v.signer_ids, rs.recipient_id)`,
    [tenantId, roundId],
  );
  // AI requests are staff-private; the audit record is shared with every party.
  const timeline = await db.query<{ at: Date; kind: string }>(
    `SELECT at, kind FROM dripsign.agreement_timeline
     WHERE tenant_id = $1 AND agreement_id = $2 AND kind <> 'ai_requested' AND at <= $3
     ORDER BY at, kind LIMIT 1000`,
    [tenantId, round.agreementId, round.finalizingAt],
  );
  return toEvidence(round, signers.rows, timeline.rows);
}

function toEvidence(
  round: EvidenceRow & { tenantId: string; roundId: string; finalizingAt: Date },
  signers: readonly SignerEvidenceRow[],
  timeline: readonly { at: Date; kind: string }[],
): ArchiveEvidence {
  return {
    title: round.title,
    revision: {
      number: round.number,
      document: {
        key: objectKey(round.tenantId, round.documentSha256),
        sha256: round.documentSha256,
        byteLength: round.documentBytes,
      },
      fields: round.signingFields,
    },
    round: {
      id: round.roundId,
      createdAt: round.createdAt.toISOString(),
      finalizingAt: round.finalizingAt.toISOString(),
      consent: {
        version: round.consentVersion,
        text: round.consentText,
        sha256: round.consentHash,
      },
    },
    signers: signers.map(({ recipientId, name, email }) => ({ recipientId, name, email })),
    signatures: signers.map((signer) => ({
      recipientId: signer.recipientId,
      typedName: signer.typedName,
      verifiedAt: signer.verifiedAt.toISOString(),
      signedAt: signer.signedAt.toISOString(),
      sessionId: signer.sessionId,
      ipAddress: signer.ipAddress,
      userAgent: signer.userAgent,
    })),
    timeline: timeline.map((item) => ({ at: item.at.toISOString(), kind: item.kind })),
  };
}

/**
 * Worker seam: stores the artifact pair, completes the round and signs the agreement in one
 * transaction under the archive lease. The first committed pair wins; later runs are no-ops.
 */
export async function completeArchive(db: Db, input: ArchiveCompletion): Promise<ArchiveOutcome> {
  const { tenantId, signedDocument, auditRecord } = input;
  for (const object of [signedDocument, auditRecord]) {
    if (object.key !== objectKey(tenantId, object.sha256)) {
      throw new DomainError("invalid", "The archived document belongs to another tenant.");
    }
  }
  return withinTx(db, async (tx) => {
    const round = await tx.query<{ agreementId: string }>(
      `SELECT agreement_id AS "agreementId" FROM dripsign.signing_round
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, input.roundId],
    );
    const agreementId = round.rows[0]?.agreementId;
    if (agreementId === undefined) throw new Error(`Round ${input.roundId} does not exist`);
    // Lock order: agreement row, then the job row.
    const locked = await tx.query<{ title: string }>(
      "SELECT title FROM dripsign.agreement WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
      [tenantId, agreementId],
    );
    const title = locked.rows[0]?.title;
    if (title === undefined) throw new Error(`Agreement ${agreementId} does not exist`);
    if (!(await lockLease(tx, input.leaseFence))) return "lease_lost";
    const status = await tx.query<{ status: string }>(
      "SELECT status FROM dripsign.signing_round WHERE tenant_id = $1 AND id = $2",
      [tenantId, input.roundId],
    );
    if (status.rows[0]?.status === "completed") return "already_completed";
    await commitArchive(tx, { ...input, agreementId, title });
    return "completed";
  });
}

async function commitArchive(
  db: Db,
  input: ArchiveCompletion & { readonly agreementId: string; readonly title: string },
): Promise<void> {
  const { tenantId, agreementId, roundId } = input;
  // The artifact trigger requires a finalizing round; the round and agreement triggers then
  // require every signature and both artifacts.
  await db.query(
    `INSERT INTO dripsign.artifact (tenant_id, agreement_id, round_id, kind, sha256, byte_length)
     VALUES ($1, $2, $3, 'signed_document', $4, $5), ($1, $2, $3, 'audit_record', $6, $7)`,
    [
      tenantId,
      agreementId,
      roundId,
      input.signedDocument.sha256,
      input.signedDocument.byteLength,
      input.auditRecord.sha256,
      input.auditRecord.byteLength,
    ],
  );
  // ended_at is the completion time the executed event reports, in whole microseconds.
  const completed = await db.query<{ revisionId: string; completedMicros: string }>(
    `UPDATE dripsign.signing_round SET status = 'completed', ended_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING revision_id AS "revisionId",
       (extract(epoch FROM ended_at) * 1000000)::bigint::text AS "completedMicros"`,
    [tenantId, roundId],
  );
  const round = completed.rows[0];
  if (round === undefined) throw new Error(`Round ${roundId} does not exist`);
  await db.query(
    `UPDATE dripsign.agreement SET status = 'signed', version = version + 1, updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, agreementId],
  );
  const agreement = { tenantId, id: agreementId, title: input.title };
  const recipients = await liveRecipients(db, tenantId, agreementId);
  await notify(db, { agreement, template: "completed", to: recipients, resourceId: roundId });
  await exportCompletion(db, {
    tenantId,
    agreementId,
    roundId,
    revisionId: round.revisionId,
    completedAtMicros: Number(round.completedMicros),
    signedDocumentSha256: input.signedDocument.sha256,
    auditRecordSha256: input.auditRecord.sha256,
  });
}
