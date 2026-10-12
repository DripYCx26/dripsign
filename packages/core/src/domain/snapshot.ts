// Bounded reads behind the agreement view. Each runs inside the view's one REPEATABLE READ
// snapshot; visibility filtering happens in view.ts.
import type { Db } from "../db.ts";
import type { AiSuggestionResult, DocumentSource, SigningField } from "../schema.ts";
import type {
  AiSuggestionStatus,
  ArtifactKind,
  Capacity,
  ProposalStatus,
  RoundEndReason,
  RoundStatus,
} from "../types.ts";

/** Archive attempts after which the UI says "Preparing signed files (delayed)". */
export const FINALIZING_DELAYED_ATTEMPTS = 3;

export const VIEW_LIMITS = {
  recipients: 200,
  revisions: 100,
  proposals: 200,
  messages: 500,
  suggestions: 50,
  timeline: 500,
  staff: 500,
} as const;

export interface RecipientRow {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly isSigner: boolean;
  readonly addedAt: Date;
  readonly lastInvitedAt: Date | null;
  readonly removedAt: Date | null;
}

export interface RevisionRow {
  readonly id: string;
  readonly number: number;
  readonly sha256: string;
  readonly byteLength: number;
  readonly pageCount: number;
  readonly publishedAt: Date;
  readonly source: DocumentSource;
  readonly signingFields: SigningField[];
  readonly signerIds: string[];
}

export interface ProposalRow {
  readonly id: string;
  readonly baseRevisionId: string;
  readonly baseRevisionNumber: number;
  readonly authorCapacity: Capacity;
  readonly authorEmail: string;
  readonly text: string;
  readonly replacementSource: DocumentSource | null;
  readonly status: ProposalStatus;
  readonly supersedesId: string | null;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
  readonly decidedBy: string | null;
}

export interface MessageRow {
  readonly id: string;
  readonly authorCapacity: Capacity;
  readonly authorEmail: string;
  readonly body: string;
  readonly createdAt: Date;
}

export interface RoundSignerRow {
  readonly recipientId: string;
  readonly name: string;
  readonly email: string;
  readonly typedName: string | null;
  readonly signedAt: string | null;
}

export interface RoundRow {
  readonly id: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly status: RoundStatus;
  readonly documentSha256: string;
  readonly consentVersion: string;
  readonly consentText: string;
  readonly consentHash: string;
  readonly createdAt: Date;
  readonly endedAt: Date | null;
  readonly endReason: RoundEndReason | null;
  readonly archiveAttempts: number;
  readonly signers: RoundSignerRow[];
}

export interface ArtifactRow {
  readonly roundId: string;
  readonly kind: ArtifactKind;
  readonly sha256: string;
  readonly byteLength: number;
  readonly createdAt: Date;
}

export interface SuggestionRow {
  readonly id: string;
  readonly requestedBy: string;
  readonly instruction: string;
  readonly proposalId: string | null;
  readonly status: AiSuggestionStatus;
  readonly baseSourceSha256: string;
  readonly result: AiSuggestionResult | null;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly appliedAt: Date | null;
}

export interface TimelineRow {
  readonly at: Date;
  readonly kind: string;
  readonly actorCapacity: Capacity | null;
  readonly actorEmail: string | null;
  readonly subjectId: string | null;
  readonly detail: unknown;
}

type Scope = readonly [tenantId: string, agreementId: string];

export async function loadRecipients(db: Db, scope: Scope): Promise<RecipientRow[]> {
  const found = await db.query<RecipientRow>(
    `SELECT id, email, name, is_signer AS "isSigner", added_at AS "addedAt",
       last_invited_at AS "lastInvitedAt", revoked_at AS "removedAt"
     FROM dripsign.recipient WHERE tenant_id = $1 AND agreement_id = $2
     ORDER BY added_at, id LIMIT $3`,
    [...scope, VIEW_LIMITS.recipients],
  );
  return found.rows;
}

/** Oldest first; the newest `VIEW_LIMITS.revisions` when there are more. */
export async function loadRevisions(db: Db, scope: Scope): Promise<RevisionRow[]> {
  const found = await db.query<RevisionRow>(
    `SELECT id, number, document_sha256 AS sha256, document_bytes AS "byteLength",
       page_count AS "pageCount", published_at AS "publishedAt", source,
       signing_fields AS "signingFields", signer_ids AS "signerIds"
     FROM dripsign.revision WHERE tenant_id = $1 AND agreement_id = $2
     ORDER BY number DESC LIMIT $3`,
    [...scope, VIEW_LIMITS.revisions],
  );
  return found.rows.reverse();
}

export async function loadProposals(db: Db, scope: Scope): Promise<ProposalRow[]> {
  const found = await db.query<ProposalRow>(
    `SELECT p.id, p.base_revision_id AS "baseRevisionId", v.number AS "baseRevisionNumber",
       p.author_capacity AS "authorCapacity", p.author_email AS "authorEmail", p.text,
       p.replacement_source AS "replacementSource", p.status, p.supersedes_id AS "supersedesId",
       p.created_at AS "createdAt", p.decided_at AS "decidedAt", p.decided_by AS "decidedBy"
     FROM dripsign.proposal p
     JOIN dripsign.revision v ON v.tenant_id = p.tenant_id AND v.id = p.base_revision_id
     WHERE p.tenant_id = $1 AND p.agreement_id = $2
     ORDER BY p.created_at DESC, p.id DESC LIMIT $3`,
    [...scope, VIEW_LIMITS.proposals],
  );
  return found.rows.reverse();
}

export async function loadMessages(db: Db, scope: Scope): Promise<MessageRow[]> {
  const found = await db.query<MessageRow>(
    `SELECT id, author_capacity AS "authorCapacity", author_email AS "authorEmail", body,
       created_at AS "createdAt"
     FROM dripsign.message WHERE tenant_id = $1 AND agreement_id = $2
     ORDER BY created_at DESC, id DESC LIMIT $3`,
    [...scope, VIEW_LIMITS.messages],
  );
  return found.rows.reverse();
}

/** The live round and the completed one; at most two rows by the one_live_round index. */
export async function loadRounds(db: Db, scope: Scope): Promise<RoundRow[]> {
  const found = await db.query<RoundRow>(
    `SELECT g.id, g.revision_id AS "revisionId", v.number AS "revisionNumber", g.status,
       g.document_sha256 AS "documentSha256", g.consent_version AS "consentVersion",
       g.consent_text AS "consentText", g.consent_hash AS "consentHash",
       g.created_at AS "createdAt", g.ended_at AS "endedAt", g.end_reason AS "endReason",
       (SELECT coalesce(max(o.attempts), 0)::int FROM dripsign.outbox o
        WHERE o.tenant_id = g.tenant_id AND o.agreement_id = g.agreement_id
          AND o.kind = 'archive' AND o.payload->>'roundId' = g.id::text) AS "archiveAttempts",
       (SELECT coalesce(jsonb_agg(jsonb_build_object(
           'recipientId', rs.recipient_id, 'name', rs.name, 'email', rs.email,
           'typedName', s.typed_name, 'signedAt', s.signed_at
         ) ORDER BY array_position(v.signer_ids, rs.recipient_id)), '[]'::jsonb)
        FROM dripsign.round_signer rs
        LEFT JOIN dripsign.signature s
          ON s.tenant_id = rs.tenant_id AND s.round_id = rs.round_id
         AND s.recipient_id = rs.recipient_id
        WHERE rs.tenant_id = g.tenant_id AND rs.round_id = g.id) AS signers
     FROM dripsign.signing_round g
     JOIN dripsign.revision v ON v.tenant_id = g.tenant_id AND v.id = g.revision_id
     WHERE g.tenant_id = $1 AND g.agreement_id = $2
       AND g.status IN ('active', 'finalizing', 'completed')`,
    [...scope],
  );
  return found.rows;
}

export async function loadArtifacts(db: Db, scope: Scope): Promise<ArtifactRow[]> {
  const found = await db.query<ArtifactRow>(
    `SELECT round_id AS "roundId", kind, sha256, byte_length AS "byteLength",
       created_at AS "createdAt"
     FROM dripsign.artifact WHERE tenant_id = $1 AND agreement_id = $2
     ORDER BY kind`,
    [...scope],
  );
  return found.rows;
}

export async function loadSuggestions(db: Db, scope: Scope): Promise<SuggestionRow[]> {
  const found = await db.query<SuggestionRow>(
    `SELECT id, requested_by AS "requestedBy", instruction, proposal_id AS "proposalId", status,
       base_source_sha256 AS "baseSourceSha256", result, error, created_at AS "createdAt",
       applied_at AS "appliedAt"
     FROM dripsign.ai_suggestion WHERE tenant_id = $1 AND agreement_id = $2
     ORDER BY created_at DESC, id DESC LIMIT $3`,
    [...scope, VIEW_LIMITS.suggestions],
  );
  return found.rows;
}

/** Staff-visibility rows reach a recipient only when they are about that recipient. */
export async function loadTimeline(
  db: Db,
  scope: Scope,
  viewer: { readonly capacity: Capacity; readonly email: string },
): Promise<TimelineRow[]> {
  const found = await db.query<TimelineRow>(
    `SELECT at, kind, actor_capacity AS "actorCapacity", actor_email AS "actorEmail",
       subject_id AS "subjectId", detail
     FROM dripsign.agreement_timeline
     WHERE tenant_id = $1 AND agreement_id = $2
       AND (visibility = 'shared' OR $3::text = 'staff' OR subject_email = $4)
     ORDER BY at DESC, kind DESC LIMIT $5`,
    [...scope, viewer.capacity, viewer.email, VIEW_LIMITS.timeline],
  );
  return found.rows.reverse();
}

export async function loadStaffNames(db: Db, tenantId: string): Promise<Map<string, string>> {
  const found = await db.query<{ email: string; name: string | null }>(
    "SELECT email, name FROM dripsign.staff WHERE tenant_id = $1 ORDER BY email LIMIT $2",
    [tenantId, VIEW_LIMITS.staff],
  );
  return new Map(found.rows.map((row) => [row.email, row.name ?? row.email]));
}
