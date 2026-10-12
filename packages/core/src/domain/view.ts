// Read models. One REPEATABLE READ snapshot per view; recipients never receive the draft, AI
// suggestions, staff emails or other recipients' emails.
import { objectKey, readBytes } from "../adapters/storage.ts";
import { readTx } from "../db.ts";
import type { Db } from "../db.ts";
import { DomainError, notFound } from "../errors.ts";
import { signatureFaceOf } from "../pdf/font.ts";
import type {
  Actor,
  AgreementFile,
  AgreementFileKind,
  AgreementView,
  ArtifactKind,
  RecipientView,
  RevisionView,
} from "../types.ts";
import { participant, recipientsByEmail, timelineItem } from "./participants.ts";
import type { Labeller } from "./participants.ts";
import { canonicalSha256 } from "./receipts.ts";
import {
  FINALIZING_DELAYED_ATTEMPTS,
  loadArtifacts,
  loadMessages,
  loadProposals,
  loadRecipients,
  loadRevisions,
  loadRounds,
  loadStaffNames,
  loadSuggestions,
  loadTimeline,
} from "./snapshot.ts";
import type {
  ProposalRow,
  RecipientRow,
  RevisionRow,
  RoundRow,
  SuggestionRow,
  TimelineRow,
} from "./snapshot.ts";
import { actionsFor, iso, isoOrNull, loadState, readAgreement, resolveAccess } from "./state.ts";
import type { Access, AgreementRow, AgreementState } from "./state.ts";

export { listInbox, listStaffAgreements } from "./lists.ts";

export interface FileRequest {
  readonly kind: AgreementFileKind;
  /** Required for `revision`. */
  readonly revisionNumber?: number;
}

interface ViewRows {
  readonly access: Access;
  readonly state: AgreementState;
  readonly recipients: RecipientRow[];
  readonly revisions: RevisionRow[];
  readonly proposals: ProposalRow[];
  readonly messages: Awaited<ReturnType<typeof loadMessages>>;
  readonly rounds: RoundRow[];
  readonly artifacts: Awaited<ReturnType<typeof loadArtifacts>>;
  readonly suggestions: SuggestionRow[];
  readonly timeline: TimelineRow[];
  readonly staffNames: ReadonlyMap<string, string>;
}

/** Bounded snapshot in one readTx; capacity is `actor.capacity`. Unavailable => not_found. */
export async function loadAgreementView(actor: Actor, agreementId: string): Promise<AgreementView> {
  const rows = await readTx((db) => loadRows(db, actor, agreementId));
  return buildView(actor, rows);
}

async function loadRows(db: Db, actor: Actor, agreementId: string): Promise<ViewRows> {
  const access = await resolveAccess(db, actor, agreementId);
  const agreement = await readAgreement(db, access.tenantId, agreementId);
  const staff = actor.capacity === "staff";
  const scope = [access.tenantId, agreementId] as const;
  return {
    access,
    state: await loadState(db, agreement, actor),
    recipients: await loadRecipients(db, scope),
    revisions: await loadRevisions(db, scope),
    proposals: await loadProposals(db, scope),
    messages: await loadMessages(db, scope),
    rounds: await loadRounds(db, scope),
    artifacts: await loadArtifacts(db, scope),
    suggestions: staff ? await loadSuggestions(db, scope) : [],
    timeline: await loadTimeline(db, scope, actor),
    staffNames: staff ? await loadStaffNames(db, access.tenantId) : new Map<string, string>(),
  };
}

async function buildView(actor: Actor, rows: ViewRows): Promise<AgreementView> {
  const { state, access } = rows;
  const { agreement } = state;
  const staff = actor.capacity === "staff";
  const labeller: Labeller = {
    viewer: actor,
    orgName: access.orgName,
    staffNames: rows.staffNames,
    recipientsByEmail: recipientsByEmail(rows.recipients),
  };
  const current = rows.revisions.find((revision) => revision.id === agreement.currentRevisionId);
  const live = rows.rounds.find((round) => round.status !== "completed");
  const completed = rows.rounds.find((round) => round.status === "completed");
  const viewerId = state.viewer.recipientId;
  return {
    agreement: {
      id: agreement.id,
      title: visibleTitle(staff, agreement.title, current),
      status: agreement.status,
      version: agreement.version,
      createdAt: iso(agreement.createdAt),
      updatedAt: iso(agreement.updatedAt),
      voidedAt: isoOrNull(agreement.voidedAt),
      voidReason: agreement.voidReason,
      currentRevisionNumber: current?.number ?? null,
      ...draftActivity(staff, agreement),
    },
    draft: staff ? agreement.draft : null,
    recipients: recipientViews(actor, rows.recipients),
    revisions: rows.revisions.map(revisionView),
    proposals: rows.proposals.map((row) => proposalView(labeller, row, rows)),
    messages: rows.messages.map((row) => ({
      id: row.id,
      author: participant(labeller, row.authorCapacity, row.authorEmail),
      body: row.body,
      createdAt: iso(row.createdAt),
    })),
    activeRound: live === undefined ? null : await roundView(actor, live),
    completedRound: completed === undefined ? null : await roundView(actor, completed),
    artifacts: rows.artifacts.map((row) => ({ ...row, createdAt: iso(row.createdAt) })),
    aiSuggestions: rows.suggestions.map((row) => suggestionView(row, state)),
    timeline: rows.timeline.flatMap((row) => timelineItem(labeller, row) ?? []),
    allowedActions: actionsFor(state, actor.capacity),
    viewer: {
      capacity: actor.capacity,
      email: actor.email,
      recipientId: staff ? null : viewerId,
      isRequiredSigner:
        !staff &&
        viewerId !== null &&
        (live === undefined
          ? (current?.signerIds.includes(viewerId) ?? false)
          : state.viewer.isRequiredSigner),
      hasSigned: !staff && state.viewer.hasSigned,
    },
    orgName: access.orgName,
  };
}

/** Draft activity, including its fence, is staff-private: recipients get none of it. */
function draftActivity(staff: boolean, agreement: AgreementRow) {
  if (!staff) return { publicationNeeded: false, preparation: null, draftVersion: null };
  const { status, error } = agreement.draft.preparation;
  return {
    publicationNeeded: agreement.draftDirty,
    preparation: { status, error },
    draftVersion: agreement.draftVersion,
  };
}

/** Staff see the private draft's title; recipients only the current revision's. */
function visibleTitle(
  staff: boolean,
  draftTitle: string,
  current: RevisionRow | undefined,
): string {
  if (staff) return draftTitle;
  if (current === undefined) throw notFound();
  return current.source.title;
}

/** Recipients see the live recipients, with only their own email and invitation time. */
function recipientViews(actor: Actor, rows: readonly RecipientRow[]): RecipientView[] {
  const staff = actor.capacity === "staff";
  return rows
    .filter((row) => staff || row.removedAt === null)
    .map((row) => {
      const visible = staff || row.email === actor.email;
      return {
        id: row.id,
        name: row.name,
        email: visible ? row.email : null,
        isSigner: row.isSigner,
        addedAt: iso(row.addedAt),
        lastInvitedAt: visible ? isoOrNull(row.lastInvitedAt) : null,
        removedAt: isoOrNull(row.removedAt),
      };
    });
}

function revisionView(row: RevisionRow): RevisionView {
  return { ...row, publishedAt: iso(row.publishedAt) };
}

function proposalView(
  labeller: Labeller,
  row: ProposalRow,
  rows: { readonly revisions: readonly RevisionRow[]; readonly proposals: readonly ProposalRow[] },
) {
  const decided = row.decidedAt;
  const publishedIn =
    row.status === "accepted" && decided !== null
      ? rows.revisions.find((revision) => revision.publishedAt > decided)
      : undefined;
  // A withdrawal is the author's own decision; anything else, including a counter, the other side's.
  const withdrawn =
    row.status === "superseded" && !rows.proposals.some((next) => next.supersedesId === row.id);
  const other = row.authorCapacity === "staff" ? "recipient" : "staff";
  const deciderCapacity = withdrawn ? row.authorCapacity : other;
  return {
    id: row.id,
    baseRevisionId: row.baseRevisionId,
    baseRevisionNumber: row.baseRevisionNumber,
    author: participant(labeller, row.authorCapacity, row.authorEmail),
    text: row.text,
    replacementSource: row.replacementSource,
    status: row.status,
    supersedesId: row.supersedesId,
    createdAt: iso(row.createdAt),
    decidedAt: isoOrNull(decided),
    decidedBy:
      row.decidedBy === null ? null : participant(labeller, deciderCapacity, row.decidedBy),
    publishedInRevision: publishedIn?.number ?? null,
  };
}

async function roundView(actor: Actor, row: RoundRow) {
  return {
    id: row.id,
    revisionId: row.revisionId,
    revisionNumber: row.revisionNumber,
    status: row.status,
    documentSha256: row.documentSha256,
    consent: { version: row.consentVersion, text: row.consentText, sha256: row.consentHash },
    createdAt: iso(row.createdAt),
    endedAt: isoOrNull(row.endedAt),
    endReason: row.endReason,
    finalizingDelayed:
      row.status === "finalizing" && row.archiveAttempts >= FINALIZING_DELAYED_ATTEMPTS,
    signers: await Promise.all(
      row.signers.map(async (signer) => ({
        recipientId: signer.recipientId,
        name: signer.name,
        email: actor.capacity === "staff" || signer.email === actor.email ? signer.email : null,
        signature:
          signer.typedName === null || signer.signedAt === null
            ? null
            : {
                typedName: signer.typedName,
                signedAt: new Date(signer.signedAt).toISOString(),
                face: await signatureFaceOf(signer.typedName),
              },
      })),
    ),
  };
}

function suggestionView(row: SuggestionRow, state: AgreementState) {
  return {
    ...row,
    createdAt: iso(row.createdAt),
    appliedAt: isoOrNull(row.appliedAt),
    stale: canonicalSha256(state.agreement.draft.source) !== row.baseSourceSha256,
  };
}

interface FileTarget {
  readonly tenantId: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly filename: string;
}

const ARTIFACT_FILES: Readonly<Record<"signed" | "audit", ArtifactKind>> = {
  signed: "signed_document",
  audit: "audit_record",
};

/** `draft` is staff-only; recipients may read published revisions and artifacts. */
export async function readAgreementFile(
  actor: Actor,
  agreementId: string,
  file: FileRequest,
): Promise<AgreementFile> {
  const target = await readTx((db) => locateFile(db, actor, agreementId, file));
  // Storage IO stays outside the transaction; readBytes verifies the hash.
  const bytes = await readBytes({
    key: objectKey(target.tenantId, target.sha256),
    sha256: target.sha256,
    byteLength: target.byteLength,
  });
  return {
    bytes,
    sha256: target.sha256,
    filename: target.filename,
    contentType: "application/pdf",
  };
}

async function locateFile(
  db: Db,
  actor: Actor,
  agreementId: string,
  file: FileRequest,
): Promise<FileTarget> {
  const { tenantId } = await resolveAccess(db, actor, agreementId);
  const agreement = await readAgreement(db, tenantId, agreementId);
  // Each file is named for its own terms' title: the draft's live one, a revision's frozen one.
  if (file.kind === "draft") {
    const document = agreement.draft.document;
    if (actor.capacity !== "staff" || document === null) throw notFound();
    return { tenantId, ...document, filename: `${filenameBase(agreement.title)}-draft.pdf` };
  }
  if (file.kind === "signed" || file.kind === "audit") {
    const found = await db.query<{ title: string; sha256: string; byteLength: number }>(
      `SELECT v.source ->> 'title' AS title, f.sha256, f.byte_length AS "byteLength"
       FROM dripsign.artifact f
       JOIN dripsign.signing_round g ON g.tenant_id = f.tenant_id AND g.id = f.round_id
       JOIN dripsign.revision v ON v.tenant_id = g.tenant_id AND v.id = g.revision_id
       WHERE f.tenant_id = $1 AND f.agreement_id = $2 AND f.kind = $3`,
      [tenantId, agreementId, ARTIFACT_FILES[file.kind]],
    );
    const artifact = found.rows[0];
    if (artifact === undefined) throw notFound();
    const { title, ...document } = artifact;
    return { tenantId, ...document, filename: `${filenameBase(title)}-${file.kind}.pdf` };
  }
  if (file.kind === "revision" && file.revisionNumber === undefined) {
    throw new DomainError("invalid", "Choose a revision.");
  }
  const found = await db.query<{
    title: string;
    number: number;
    sha256: string;
    byteLength: number;
  }>(
    `SELECT source ->> 'title' AS title, number, document_sha256 AS sha256,
       document_bytes AS "byteLength"
     FROM dripsign.revision
     WHERE tenant_id = $1 AND agreement_id = $2
       AND CASE WHEN $3::int IS NULL THEN id = $4 ELSE number = $3 END`,
    [
      tenantId,
      agreementId,
      file.kind === "revision" ? file.revisionNumber : null,
      agreement.currentRevisionId,
    ],
  );
  const revision = found.rows[0];
  if (revision === undefined) throw notFound();
  const { title, number, ...document } = revision;
  const filename = `${filenameBase(title)}-revision-${String(number)}.pdf`;
  return { tenantId, ...document, filename };
}

function filenameBase(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase()
    .slice(0, 80);
  return slug === "" ? "agreement" : slug;
}
