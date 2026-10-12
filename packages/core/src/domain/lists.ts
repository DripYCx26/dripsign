// The staff dashboard and the recipient inbox: one bounded query each, newest activity first. Each
// row carries the policy's allowed actions, so a list names the same next step as the workspace.
import { loadConfig } from "../config.ts";
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
import { allowedActions } from "./policy.ts";
import type { PolicySnapshot } from "./policy.ts";
import { FINALIZING_DELAYED_ATTEMPTS } from "./snapshot.ts";
import { iso, parseOrInvalid } from "./state.ts";

const INBOX_LIMIT = 200;

// What the policy reads besides the pending proposal and the round, as one list row selects it.
const POLICY_COLUMNS = `a.status, a.draft_dirty AS "draftDirty",
  a.current_revision_id IS NOT NULL AS "hasRevision",
  a.draft->'preparation'->>'status' AS preparation,
  (SELECT count(*)::int FROM dripsign.recipient s
   WHERE s.tenant_id = a.tenant_id AND s.agreement_id = a.id AND s.is_signer
     AND s.revoked_at IS NULL) AS "draftSigners",
  (SELECT count(*)::int FROM dripsign.ai_suggestion i
   WHERE i.tenant_id = a.tenant_id AND i.agreement_id = a.id AND i.status = 'ready') AS "readyAi",
  p.by AS "pendingBy", p.email AS "pendingEmail", g.status AS "roundStatus"`;

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

interface Progress {
  roundStatus: RoundStatus | null;
  signed: number | null;
  required: number | null;
  attempts: number | null;
}

interface PolicyRow {
  status: AgreementStatus;
  draftDirty: boolean;
  hasRevision: boolean;
  preparation: PreparationStatus;
  draftSigners: number;
  readyAi: number;
  pendingBy: Capacity | null;
  pendingEmail: string | null;
  roundStatus: RoundStatus | null;
}

function policySnapshot(row: PolicyRow): PolicySnapshot {
  const round = row.roundStatus;
  return {
    status: row.status,
    hasRevision: row.hasRevision,
    publicationNeeded: row.draftDirty,
    preparation: row.preparation,
    draftSignerCount: row.draftSigners,
    pendingProposalBy: row.pendingBy,
    round: round === "active" || round === "finalizing" ? round : null,
    aiEnabled: loadConfig().ai !== null,
    readyAiSuggestions: row.readyAi,
  };
}

interface StaffRow extends Progress, PolicyRow {
  id: string;
  title: string;
  version: number;
  updatedAt: Date;
  cursorAt: string;
  pendingAuthor: string | null;
  recipients: { name: string; isSigner: boolean }[];
}

export async function listStaffAgreements(
  actor: StaffActor,
  query: StaffListQuery,
): Promise<Page<StaffListItem>> {
  const { q, cursor } = parseOrInvalid(staffListQuerySchema, query);
  const after = cursor === undefined ? null : decodeCursor(cursor);
  const pattern = q === undefined || q === "" ? null : `%${q.replace(/[\\%_]/gu, "\\$&")}%`;
  return readTx(async (db) => {
    const staff = await db.query(
      "SELECT 1 FROM dripsign.staff WHERE tenant_id = $1 AND email = $2 AND revoked_at IS NULL",
      [actor.tenantId, actor.email],
    );
    if (staff.rowCount !== 1) throw notFound();
    const found = await db.query<StaffRow>(
      `SELECT a.id, a.title, a.version, a.updated_at AS "updatedAt",
         (extract(epoch FROM a.updated_at) * 1000000)::bigint::text AS "cursorAt",
         ${POLICY_COLUMNS},
         CASE p.by
           WHEN 'recipient' THEN (SELECT r.name FROM dripsign.recipient r
             WHERE r.tenant_id = a.tenant_id AND r.agreement_id = a.id AND r.email = p.email
             ORDER BY r.revoked_at DESC NULLS FIRST LIMIT 1)
           WHEN 'staff' THEN (SELECT coalesce(s.name, s.email) FROM dripsign.staff s
             WHERE s.tenant_id = a.tenant_id AND s.email = p.email)
         END AS "pendingAuthor",
         g.signed, g.required, g.attempts, rc.recipients
       FROM dripsign.agreement a
       ${PENDING_PROPOSAL}
       ${ROUND_PROGRESS}
       LEFT JOIN LATERAL (
         SELECT coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'isSigner', r.is_signer)
             ORDER BY r.added_at, r.id), '[]'::jsonb) AS recipients
         FROM dripsign.recipient r
         WHERE r.tenant_id = a.tenant_id AND r.agreement_id = a.id AND r.revoked_at IS NULL
       ) rc ON true
       WHERE a.tenant_id = $1
         AND ($2::text IS NULL OR a.title ILIKE $2 OR EXISTS (
           SELECT 1 FROM dripsign.recipient r
           WHERE r.tenant_id = a.tenant_id AND r.agreement_id = a.id
             AND (r.name ILIKE $2 OR r.email ILIKE $2)))
         AND ($3::bigint IS NULL OR (a.updated_at, a.id)
           < (timestamptz 'epoch' + $3::bigint * interval '1 microsecond', $4::uuid))
       ORDER BY a.updated_at DESC, a.id DESC
       LIMIT $5`,
      [actor.tenantId, pattern, after?.micros ?? null, after?.id ?? null, LIMITS.pageSize + 1],
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

/** Staff stand on the staff side: any of them owns the staff side's pending proposal. */
function staffItem(row: StaffRow): StaffListItem {
  const viewer = { isRequiredSigner: false, hasSigned: false };
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    version: row.version,
    updatedAt: iso(row.updatedAt),
    recipients: row.recipients,
    preparation: row.preparation,
    pendingProposalAuthor: row.pendingAuthor,
    allowedActions: allowedActions(policySnapshot(row), "staff", {
      ...viewer,
      ownsPendingProposal: row.pendingBy === "staff",
    }),
    ...progress(row, row.draftSigners),
  };
}

interface InboxRow extends Progress, PolicyRow {
  id: string;
  title: string;
  orgName: string;
  updatedAt: Date;
  roundSigner: boolean;
  viewerSigned: boolean;
  revisionSigners: number;
}

/**
 * Agreements shared with the address, across tenants, once they have a first revision. Only a
 * live first-party session reads it: a host bridge session is scoped to one staff tenant.
 */
export function listInbox(actor: RecipientActor): Promise<readonly InboxItem[]> {
  return readTx(async (db) => {
    const session = await db.query(
      `SELECT 1 FROM dripsign.auth_session
       WHERE id = $1 AND email = $2 AND NOT embed AND revoked_at IS NULL AND expires_at > now()`,
      [actor.sessionId, actor.email],
    );
    if (session.rowCount !== 1) throw notFound();
    const found = await db.query<InboxRow>(
      `SELECT a.id, a.title, t.name AS "orgName", a.updated_at AS "updatedAt",
         ${POLICY_COLUMNS}, g.signed, g.required, g.attempts,
         EXISTS (SELECT 1 FROM dripsign.round_signer rs
                 WHERE rs.tenant_id = a.tenant_id AND rs.round_id = g.id
                   AND rs.recipient_id = r.id) AS "roundSigner",
         EXISTS (SELECT 1 FROM dripsign.signature s
                 WHERE s.tenant_id = a.tenant_id AND s.round_id = g.id
                   AND s.recipient_id = r.id) AS "viewerSigned",
         cardinality(v.signer_ids) AS "revisionSigners"
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
    return found.rows.map((row) => inboxItem(row, actor.email));
  });
}

function inboxItem(row: InboxRow, email: string): InboxItem {
  const viewer = {
    isRequiredSigner: row.roundSigner,
    hasSigned: row.viewerSigned,
    ownsPendingProposal: row.pendingBy === "recipient" && row.pendingEmail === email,
  };
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    orgName: row.orgName,
    updatedAt: iso(row.updatedAt),
    viewerHasSigned: row.viewerSigned,
    allowedActions: allowedActions(policySnapshot(row), "recipient", viewer),
    ...progress(row, row.revisionSigners),
  };
}
