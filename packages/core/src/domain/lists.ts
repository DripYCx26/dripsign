// The staff dashboard and the recipient inbox: one bounded query each, newest activity first.
import { readTx } from "../db.ts";
import { DomainError, notFound } from "../errors.ts";
import { LIMITS, staffListQuerySchema, uuidSchema } from "../schema.ts";
import type { PreparationStatus, StaffListQuery } from "../schema.ts";
import type {
  AgreementStatus,
  Capacity,
  InboxItem,
  Page,
  RecipientActor,
  RoundStatus,
  StaffActor,
  StaffListItem,
} from "../types.ts";
import { FINALIZING_DELAYED_ATTEMPTS } from "./snapshot.ts";
import { iso, parseOrInvalid } from "./state.ts";

const INBOX_LIMIT = 200;

const PENDING_PROPOSAL = `LEFT JOIN LATERAL (
    SELECT q.author_capacity AS by, q.author_email AS email FROM dripsign.proposal q
    WHERE q.tenant_id = a.tenant_id AND q.agreement_id = a.id AND q.status = 'pending'
  ) p ON true`;

// The newest live or completed round, with its progress and archive attempts.
const ROUND_PROGRESS = `LEFT JOIN LATERAL (
    SELECT g.id, g.status,
      (SELECT count(*)::int FROM dripsign.signature s
       WHERE s.tenant_id = g.tenant_id AND s.round_id = g.id) AS signed,
      (SELECT count(*)::int FROM dripsign.round_signer rs
       WHERE rs.tenant_id = g.tenant_id AND rs.round_id = g.id) AS required,
      (SELECT coalesce(max(o.attempts), 0)::int FROM dripsign.outbox o
       WHERE o.tenant_id = g.tenant_id AND o.agreement_id = g.agreement_id
         AND o.kind = 'archive' AND o.payload->>'roundId' = g.id::text) AS attempts
    FROM dripsign.signing_round g
    WHERE g.tenant_id = a.tenant_id AND g.agreement_id = a.id
      AND g.status IN ('active', 'finalizing', 'completed')
    ORDER BY g.created_at DESC LIMIT 1
  ) g ON true`;

// Mirrors the staff actions policy.ts offers outside signing: answer a recipient proposal,
// publish draft changes, retry a failed preparation, or request signatures.
const NEEDS_YOU = `(a.status IN ('draft', 'negotiating') AND a.draft->'preparation'->>'status' = 'failed')
    OR (a.status = 'negotiating' AND (p.by IS DISTINCT FROM 'staff' OR a.draft_dirty))`;

interface Progress {
  roundStatus: RoundStatus | null;
  signed: number | null;
  required: number | null;
  attempts: number | null;
}

interface StaffRow extends Progress {
  id: string;
  title: string;
  status: AgreementStatus;
  version: number;
  updatedAt: Date;
  cursorAt: string;
  draftDirty: boolean;
  hasRevision: boolean;
  preparation: PreparationStatus;
  pendingBy: Capacity | null;
  pendingAuthor: string | null;
  recipients: { name: string; isSigner: boolean }[];
  signers: number;
}

export async function listStaffAgreements(
  actor: StaffActor,
  query: StaffListQuery,
): Promise<Page<StaffListItem>> {
  const { q, status = "all", cursor } = parseOrInvalid(staffListQuerySchema, query);
  const after = cursor === undefined ? null : decodeCursor(cursor);
  const pattern = q === undefined || q === "" ? null : `%${q.replace(/[\\%_]/gu, "\\$&")}%`;
  return readTx(async (db) => {
    const staff = await db.query(
      "SELECT 1 FROM dripsign.staff WHERE tenant_id = $1 AND email = $2 AND revoked_at IS NULL",
      [actor.tenantId, actor.email],
    );
    if (staff.rowCount !== 1) throw notFound();
    const found = await db.query<StaffRow>(
      `SELECT a.id, a.title, a.status, a.version, a.updated_at AS "updatedAt",
         (extract(epoch FROM a.updated_at) * 1000000)::bigint::text AS "cursorAt",
         a.draft_dirty AS "draftDirty", a.current_revision_id IS NOT NULL AS "hasRevision",
         a.draft->'preparation'->>'status' AS preparation, p.by AS "pendingBy",
         CASE p.by
           WHEN 'recipient' THEN (SELECT r.name FROM dripsign.recipient r
             WHERE r.tenant_id = a.tenant_id AND r.agreement_id = a.id AND r.email = p.email
             ORDER BY r.revoked_at DESC NULLS FIRST LIMIT 1)
           WHEN 'staff' THEN (SELECT coalesce(s.name, s.email) FROM dripsign.staff s
             WHERE s.tenant_id = a.tenant_id AND s.email = p.email)
         END AS "pendingAuthor",
         g.status AS "roundStatus", g.signed, g.required, g.attempts, rc.recipients, rc.signers
       FROM dripsign.agreement a
       ${PENDING_PROPOSAL}
       ${ROUND_PROGRESS}
       LEFT JOIN LATERAL (
         SELECT coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'isSigner', r.is_signer)
             ORDER BY r.added_at, r.id), '[]'::jsonb) AS recipients,
           (count(*) FILTER (WHERE r.is_signer))::int AS signers
         FROM dripsign.recipient r
         WHERE r.tenant_id = a.tenant_id AND r.agreement_id = a.id AND r.revoked_at IS NULL
       ) rc ON true
       WHERE a.tenant_id = $1
         AND ($2::text IS NULL OR a.title ILIKE $2 OR EXISTS (
           SELECT 1 FROM dripsign.recipient r
           WHERE r.tenant_id = a.tenant_id AND r.agreement_id = a.id
             AND (r.name ILIKE $2 OR r.email ILIKE $2)))
         AND CASE $3::text WHEN 'all' THEN true WHEN 'needs_you' THEN ${NEEDS_YOU}
           ELSE a.status = $3::text END
         AND ($4::bigint IS NULL OR (a.updated_at, a.id)
           < (timestamptz 'epoch' + $4::bigint * interval '1 microsecond', $5::uuid))
       ORDER BY a.updated_at DESC, a.id DESC
       LIMIT $6`,
      [
        actor.tenantId,
        pattern,
        status,
        after?.micros ?? null,
        after?.id ?? null,
        LIMITS.pageSize + 1,
      ],
    );
    const rows = found.rows.slice(0, LIMITS.pageSize);
    const last = rows.at(-1);
    const more = found.rows.length > LIMITS.pageSize && last !== undefined;
    return {
      items: rows.map(staffItem),
      nextCursor: more ? `${last.cursorAt}_${last.id}` : null,
    };
  });
}

function decodeCursor(cursor: string): { micros: string; id: string } {
  const match = /^(\d{1,20})_(.+)$/u.exec(cursor);
  const micros = match?.[1];
  const id = match?.[2];
  if (micros === undefined || id === undefined || !uuidSchema.safeParse(id).success) {
    throw new DomainError("invalid", "The page cursor is invalid.");
  }
  return { micros, id };
}

function progress(row: Progress, requiredWithoutRound: number) {
  const finalizing = row.roundStatus === "finalizing";
  return {
    signedCount: row.signed ?? 0,
    requiredCount: row.required ?? requiredWithoutRound,
    finalizing,
    finalizingDelayed: finalizing && (row.attempts ?? 0) >= FINALIZING_DELAYED_ATTEMPTS,
  };
}

function staffItem(row: StaffRow): StaffListItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    version: row.version,
    updatedAt: iso(row.updatedAt),
    recipients: row.recipients,
    publicationNeeded: row.draftDirty,
    hasRevision: row.hasRevision,
    preparation: row.preparation,
    pendingProposalBy: row.pendingBy,
    pendingProposalAuthor: row.pendingAuthor,
    ...progress(row, row.signers),
  };
}

interface InboxRow extends Progress {
  id: string;
  title: string;
  status: AgreementStatus;
  orgName: string;
  updatedAt: Date;
  pendingBy: Capacity | null;
  roundSigner: boolean;
  viewerSigned: boolean;
  revisionSigners: number;
  revisionSigner: boolean;
}

/** Agreements shared with the address, across tenants, once they have a first revision. */
export function listInbox(actor: RecipientActor): Promise<readonly InboxItem[]> {
  return readTx(async (db) => {
    const found = await db.query<InboxRow>(
      `SELECT a.id, a.title, a.status, t.name AS "orgName", a.updated_at AS "updatedAt",
         p.by AS "pendingBy", g.status AS "roundStatus", g.signed, g.required, g.attempts,
         EXISTS (SELECT 1 FROM dripsign.round_signer rs
                 WHERE rs.tenant_id = a.tenant_id AND rs.round_id = g.id
                   AND rs.recipient_id = r.id) AS "roundSigner",
         EXISTS (SELECT 1 FROM dripsign.signature s
                 WHERE s.tenant_id = a.tenant_id AND s.round_id = g.id
                   AND s.recipient_id = r.id) AS "viewerSigned",
         cardinality(v.signer_ids) AS "revisionSigners",
         r.id = ANY(v.signer_ids) AS "revisionSigner"
       FROM dripsign.recipient r
       JOIN dripsign.agreement a ON a.tenant_id = r.tenant_id AND a.id = r.agreement_id
       JOIN dripsign.tenant t ON t.id = a.tenant_id
       JOIN dripsign.revision v ON v.tenant_id = a.tenant_id AND v.id = a.current_revision_id
       ${PENDING_PROPOSAL}
       ${ROUND_PROGRESS}
       WHERE r.email = $1 AND r.revoked_at IS NULL
       ORDER BY a.updated_at DESC, a.id DESC
       LIMIT $2`,
      [actor.email, INBOX_LIMIT],
    );
    return found.rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      orgName: row.orgName,
      updatedAt: iso(row.updatedAt),
      pendingProposalBy: row.pendingBy,
      viewerIsRequiredSigner: row.roundStatus === null ? row.revisionSigner : row.roundSigner,
      viewerHasSigned: row.viewerSigned,
      ...progress(row, row.revisionSigners),
    }));
  });
}
