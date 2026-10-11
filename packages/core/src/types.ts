// Read models the web renders. Validated inputs and stored JSON shapes live in schema.ts.
import type {
  AiSuggestionResult,
  CommandKind,
  CompletionExportConfig,
  DocumentSource,
  Draft,
  PreparationStatus,
  SigningField,
} from "./schema.ts";

export type Capacity = "staff" | "recipient";
export type StaffRole = "admin" | "member";
export type AgreementStatus = "draft" | "negotiating" | "signing" | "signed" | "void";
export type RoundStatus = "active" | "finalizing" | "completed" | "void";
export type RoundEndReason =
  "cancelled" | "signer_proposal" | "signer_removed" | "agreement_voided";
export type ProposalStatus = "pending" | "accepted" | "rejected" | "superseded";
export type AiSuggestionStatus = "queued" | "ready" | "failed" | "applied";
export type ArtifactKind = "signed_document" | "audit_record";
export type AgreementFileKind = "draft" | "current" | "revision" | "signed" | "audit";

/** Derived by the web server from the HTTP request; a signature records it. Absent off-request. */
export interface RequestEvidence {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

/** Resolved from the database on every request; never cached in the session. */
export interface StaffActor {
  readonly capacity: "staff";
  readonly tenantId: string;
  readonly email: string;
  readonly sessionId: string;
  readonly verifiedAt: string;
  readonly role: StaffRole;
  readonly request?: RequestEvidence;
}

/** Recipient standing is per agreement; domain calls recheck the live grant. */
export interface RecipientActor {
  readonly capacity: "recipient";
  readonly email: string;
  readonly sessionId: string;
  readonly verifiedAt: string;
  readonly request?: RequestEvidence;
}

export type Actor = StaffActor | RecipientActor;

export type AgreementAction = CommandKind | "download";

export interface PreparationState {
  readonly status: PreparationStatus;
  readonly error: string | null;
}

export interface AgreementSummary {
  readonly id: string;
  readonly title: string;
  readonly status: AgreementStatus;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly voidedAt: string | null;
  readonly voidReason: string | null;
  readonly publicationNeeded: boolean;
  readonly currentRevisionNumber: number | null;
  /** Null for recipients: draft activity is staff-private. */
  readonly preparation: PreparationState | null;
}

/** A person in the thread. Recipients see staff as the organisation, with no email. */
export interface ParticipantRef {
  readonly capacity: Capacity;
  readonly recipientId: string | null;
  readonly label: string;
  readonly email: string | null;
}

/** Recipients see other recipients' names and signer flags; `email` is null except their own. */
export interface RecipientView {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly isSigner: boolean;
  readonly addedAt: string;
  readonly lastInvitedAt: string | null;
  readonly removedAt: string | null;
}

export interface RevisionView {
  readonly id: string;
  readonly number: number;
  readonly sha256: string;
  readonly byteLength: number;
  readonly pageCount: number;
  readonly uploadSha256: string | null;
  readonly publishedAt: string;
  readonly source: DocumentSource | null;
  readonly signingFields: readonly SigningField[];
  readonly signerIds: readonly string[];
}

export interface ProposalView {
  readonly id: string;
  readonly baseRevisionId: string;
  readonly baseRevisionNumber: number;
  readonly author: ParticipantRef;
  readonly text: string;
  readonly replacementSource: DocumentSource | null;
  readonly status: ProposalStatus;
  readonly supersedesId: string | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: ParticipantRef | null;
  /** First revision published after acceptance; null while the change waits in the draft. */
  readonly publishedInRevision: number | null;
}

export interface MessageView {
  readonly id: string;
  readonly author: ParticipantRef;
  readonly body: string;
  readonly createdAt: string;
}

export interface RoundSignerView {
  readonly recipientId: string;
  readonly name: string;
  /** Null for recipients viewing someone else. */
  readonly email: string | null;
  readonly signature: { readonly typedName: string; readonly signedAt: string } | null;
}

export interface RoundView {
  readonly id: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly status: RoundStatus;
  readonly documentSha256: string;
  readonly consent: { readonly version: string; readonly text: string; readonly sha256: string };
  readonly createdAt: string;
  readonly endedAt: string | null;
  readonly endReason: RoundEndReason | null;
  /** True after three archive attempts: the UI shows "Preparing signed files (delayed)". */
  readonly finalizingDelayed: boolean;
  readonly signers: readonly RoundSignerView[];
}

export interface ArtifactView {
  readonly roundId: string;
  readonly kind: ArtifactKind;
  readonly sha256: string;
  readonly byteLength: number;
  readonly createdAt: string;
}

export interface AiSuggestionView {
  readonly id: string;
  readonly requestedBy: string;
  readonly instruction: string;
  readonly proposalId: string | null;
  readonly status: AiSuggestionStatus;
  readonly baseSourceSha256: string;
  readonly result: AiSuggestionResult | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly appliedAt: string | null;
  /** The draft source changed since the request; applying would be refused. */
  readonly stale: boolean;
}

export type TimelineKind =
  | "agreement_created"
  | "recipient_added"
  | "recipient_removed"
  | "revision_published"
  | "proposal_created"
  | "proposal_accepted"
  | "proposal_rejected"
  | "signing_requested"
  | "signature_recorded"
  | "signing_ended"
  | "signing_completed"
  | "agreement_voided"
  | "ai_requested";

/** Rows of the `agreement_timeline` view after visibility filtering for the viewer. */
export interface TimelineItem {
  readonly at: string;
  readonly kind: TimelineKind;
  readonly actor: ParticipantRef | null;
  readonly subjectId: string | null;
  readonly detail: Readonly<Record<string, string | number | boolean | null | readonly string[]>>;
}

export interface ViewerView {
  readonly capacity: Capacity;
  readonly email: string;
  readonly recipientId: string | null;
  /** Required signer of the live round, else of the current revision. */
  readonly isRequiredSigner: boolean;
  readonly hasSigned: boolean;
}

export interface AgreementView {
  readonly agreement: AgreementSummary;
  /** Staff only. */
  readonly draft: Draft | null;
  readonly recipients: readonly RecipientView[];
  readonly revisions: readonly RevisionView[];
  readonly proposals: readonly ProposalView[];
  readonly messages: readonly MessageView[];
  /** The round in `active` or `finalizing`. */
  readonly activeRound: RoundView | null;
  /** The round whose artifacts made the agreement signed. */
  readonly completedRound: RoundView | null;
  readonly artifacts: readonly ArtifactView[];
  /** Staff only; empty for recipients. */
  readonly aiSuggestions: readonly AiSuggestionView[];
  readonly timeline: readonly TimelineItem[];
  readonly allowedActions: readonly AgreementAction[];
  readonly viewer: ViewerView;
  readonly orgName: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface StaffListItem {
  readonly id: string;
  readonly title: string;
  readonly status: AgreementStatus;
  readonly version: number;
  readonly updatedAt: string;
  readonly recipients: readonly { readonly name: string; readonly isSigner: boolean }[];
  readonly publicationNeeded: boolean;
  readonly hasRevision: boolean;
  readonly preparation: PreparationStatus;
  readonly pendingProposalBy: Capacity | null;
  readonly pendingProposalAuthor: string | null;
  readonly signedCount: number;
  readonly requiredCount: number;
  readonly finalizing: boolean;
  readonly finalizingDelayed: boolean;
}

export interface InboxItem {
  readonly id: string;
  readonly title: string;
  readonly status: AgreementStatus;
  readonly orgName: string;
  readonly updatedAt: string;
  readonly pendingProposalBy: Capacity | null;
  readonly signedCount: number;
  readonly requiredCount: number;
  readonly viewerIsRequiredSigner: boolean;
  readonly viewerHasSigned: boolean;
  readonly finalizing: boolean;
  readonly finalizingDelayed: boolean;
}

export interface SessionView {
  readonly email: string;
  readonly verifiedAt: string;
  readonly expiresAt: string;
  readonly staffTenants: readonly {
    readonly id: string;
    readonly name: string;
    readonly role: StaffRole;
  }[];
  readonly selectedTenantId: string | null;
  readonly hasRecipientGrants: boolean;
  readonly embed: boolean;
  readonly devLogin: boolean;
}

export interface AgreementFile {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly filename: string;
  readonly contentType: "application/pdf";
}

export interface CompletionExportRevision {
  readonly revision: number;
  readonly config: CompletionExportConfig;
  readonly createdBy: string;
  readonly createdAt: string;
}

/** queued: a delivery attempt is due or running; failed: attempts stopped, an admin may retry. */
export type CompletionDeliveryState = "queued" | "failed";

/** A frozen executed event the host has not yet acknowledged. */
export interface UndeliveredCompletion {
  readonly roundId: string;
  readonly agreementId: string;
  readonly title: string;
  readonly eventId: string;
  readonly completedAt: string;
  readonly state: CompletionDeliveryState;
}

export interface CompletionExportSettings {
  /** False when this deployment has no event URL and keys: nothing is frozen or sent. */
  readonly deliveryEnabled: boolean;
  /** What a delivered event must carry: this deployment's origin and the event URL's origin. */
  readonly expected: { readonly issuer: string; readonly audience: string | null };
  readonly current: CompletionExportRevision | null;
  /** Newest first, including the current revision. */
  readonly history: readonly CompletionExportRevision[];
  readonly undelivered: readonly UndeliveredCompletion[];
}
