export type AgreementStatus = 'draft' | 'negotiating' | 'signing' | 'signed' | 'void';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'superseded';
export type Actor = StaffActor | RecipientActor;
export interface StaffActor { readonly kind: 'staff'; readonly tenantId: string; readonly userId: string }
export interface RecipientActor {
  readonly kind: 'recipient'; readonly tenantId: string; readonly agreementId: string;
  readonly grantId: string; readonly email: string;
}
export interface RecipientMailboxActor { readonly kind: 'recipient'; readonly email: string }
export interface DocumentAsset {
  readonly objectKey: string; readonly sha256: string; readonly byteLength: number;
  readonly contentType: 'application/pdf';
}
export interface DocumentDraft {
  readonly source: DocumentSource | null; readonly document: DocumentAsset | null;
  readonly originalDocument: DocumentAsset | null;
  readonly signingFields: readonly SigningField[]; readonly requiredGrantIds: readonly string[];
  readonly preparationStatus: 'empty' | 'preparing' | 'ready' | 'failed'; readonly preparationError: string | null;
}
export interface Agreement {
  readonly id: string; readonly tenantId: string; readonly title: string; readonly status: AgreementStatus;
  readonly version: number; readonly currentRevisionId: string | null; readonly createdAt: string;
  readonly publicationNeeded: boolean;
}
export interface RecipientGrant {
  readonly id: string; readonly agreementId: string; readonly email: string; readonly name: string;
  readonly requiredSigner: boolean; readonly revokedAt: string | null;
}
export interface Revision {
  readonly id: string; readonly agreementId: string; readonly number: number;
  readonly document: DocumentAsset; readonly source: DocumentSource | null; readonly publishedAt: string;
  readonly signingFields: readonly SigningField[]; readonly requiredGrantIds: readonly string[];
}
export interface Proposal {
  readonly id: string; readonly agreementId: string; readonly baseRevisionId: string;
  readonly authorKind: Actor['kind']; readonly authorId: string; readonly text: string;
  readonly replacementSource: DocumentSource | null; readonly status: ProposalStatus;
  readonly supersedesId: string | null; readonly createdAt: string;
  readonly originalSource: DocumentSource | null;
}
export interface SharedMessage {
  readonly id: string; readonly agreementId: string; readonly authorKind: Actor['kind'];
  readonly authorId: string; readonly body: string; readonly createdAt: string;
}
export interface PrivateAiMessage {
  readonly id: string; readonly agreementId: string; readonly userId: string;
  readonly role: 'user' | 'assistant'; readonly body: string; readonly createdAt: string;
}
export interface SigningRound {
  readonly id: string; readonly agreementId: string; readonly revisionId: string;
  readonly status: 'preparing' | 'uncertain' | 'active' | 'completed' | 'void'; readonly provider: string;
  readonly providerSubmissionId: string | null; readonly createdAt: string;
  readonly attemptId: string;
  readonly requiredGrantIds: readonly string[];
}
export interface Signature {
  readonly roundId: string; readonly grantId: string; readonly providerEventId: string;
  readonly signedAt: string;
}
export interface ArchivedArtifact {
  readonly id: string; readonly roundId: string; readonly kind: 'signed_document' | 'audit_record';
  readonly document: DocumentAsset; readonly archivedAt: string;
}
export interface AgreementDetail {
  readonly agreement: Agreement; readonly draft: DocumentDraft | null;
  readonly grants: readonly RecipientGrant[]; readonly revisions: readonly Revision[];
  readonly proposals: readonly Proposal[]; readonly messages: readonly SharedMessage[];
  readonly signingRound: SigningRound | null; readonly signatures: readonly Signature[];
  readonly artifacts: readonly ArchivedArtifact[];
  readonly allowedActions: readonly AgreementAction[];
  readonly privateAiMessages: readonly PrivateAiMessage[];
}
export type AgreementAction = 'propose' | 'counter' | 'accept' | 'reject' | 'save_draft' | 'publish' | 'sign' | 'download' | 'message' | 'ask_ai' | 'request_signatures' | 'cancel_signatures';
export interface Mutation {
  readonly actor: Actor; readonly agreementId: string; readonly expectedVersion: number;
  readonly idempotencyKey: string;
}
export interface NewRecipient { readonly email: string; readonly name: string; readonly requiredSigner: boolean }
export interface NewAgreement {
  readonly actor: StaffActor; readonly idempotencyKey: string; readonly title: string;
  readonly draft: DocumentDraft; readonly recipients: readonly NewRecipient[];
  readonly createProvenance: CreateProvenance | null;
}
export interface CreateProvenance { readonly tenantId: string; readonly subject: string; readonly idempotencyKey: string; readonly bodySha256: string }
export interface ProposalChange {
  readonly text: string; readonly replacementSource: DocumentSource | null; readonly supersedesId: string | null;
}
export interface PublishRevision { readonly document: DocumentAsset; readonly source: DocumentSource | null; readonly signingFields: readonly SigningField[]; readonly requiredGrantIds: readonly string[] }
export interface NewSigningRound { readonly provider: string; readonly providerSubmissionId: string; readonly revisionId: string }
export interface SignatureEvent {
  readonly roundId: string; readonly revisionId: string; readonly grantId: string;
  readonly providerEventId: string; readonly signedAt: string;
}
export interface FinalizeAgreement {
  readonly roundId: string; readonly revisionId: string;
  readonly signedDocument: DocumentAsset; readonly auditRecord: DocumentAsset;
}
export interface BootstrapStaff { readonly tenantId: string; readonly tenantName: string; readonly userId: string; readonly email: string }
export type AuthScope =
  | { readonly kind: 'staff'; readonly tenantId: string; readonly email: string }
  | { readonly kind: 'recipient'; readonly email: string };
export interface OtpChallenge {
  readonly id: string; readonly scope: AuthScope; readonly codeHash: string; readonly expiresAt: string;
  readonly challengeTokenHash: string;
}
export interface OtpConsumption {
  readonly challengeId: string; readonly challengeTokenHash: string; readonly codeHash: string;
  readonly sessionTokenHash: string; readonly sessionExpiresAt: string;
}
export interface AuthSession { readonly id: string; readonly actor: StaffActor | RecipientMailboxActor; readonly expiresAt: string }
export type OutboxStatus = 'pending' | 'delivering' | 'delivered' | 'uncertain' | 'failed';
export interface OutboxMessage {
  readonly id: string; readonly tenantId: string; readonly agreementId: string | null;
  readonly kind: 'invitation' | 'otp' | 'revision_published' | 'agreement_executed' | 'signing_create' | 'signing_reconcile' | 'signing_cancel' | 'archive' | 'ai_suggestion' | 'pdf_prepare';
  readonly dedupeKey: string; readonly payload: Readonly<Record<string, unknown>>;
  readonly status: OutboxStatus; readonly leaseToken: string | null; readonly attempts: number;
}
export interface NewOutboxMessage {
  readonly tenantId: string; readonly agreementId: string | null; readonly kind: OutboxMessage['kind'];
  readonly dedupeKey: string; readonly payload: Readonly<Record<string, unknown>>;
}
export interface OutboxContext { readonly message: OutboxMessage; readonly detail: AgreementDetail | null; readonly executedEvent: ExecutedAgreementEvent | null }
export interface AgreementInboxItem extends Agreement {
  readonly pendingProposalAuthorKind: Actor['kind'] | null; readonly signedCount: number; readonly requiredCount: number;
}
export interface JobFence { readonly tenantId: string; readonly id: string; readonly leaseToken: string }
export interface AiReservation {
  readonly tenantId: string; readonly agreementId: string; readonly jobId: string;
  readonly maxCostMicros: number; readonly dailyLimitMicros: number; readonly perRunLimitMicros: number;
  readonly leaseToken: string;
}
export interface OutboxAdmission { readonly globalConcurrency: number; readonly tenantConcurrency: number; readonly globalPerMinute: number; readonly tenantPerMinute: number }
export interface MailJobPayload { readonly email: EmailMessage; readonly expiresAt: string | null }
export interface RevisionNotificationPayload { readonly grantId: string; readonly revisionId: string }
export interface SigningJobPayload { readonly mutation: Mutation; readonly roundId: string; readonly fields: readonly SigningField[] }
export interface AiJobPayload { readonly mutation: Mutation; readonly instruction: string; readonly source: DocumentSource }
export interface PdfPreparationJobPayload { readonly mutation: Mutation; readonly originalDocument: DocumentAsset; readonly requiredGrantIds: readonly string[] }
export interface PdfPreparationResult { readonly document: DocumentAsset; readonly signingFields: readonly SigningField[]; readonly requiredGrantIds: readonly string[] }
export interface ExecutedAgreementEvent {
  readonly eventId: string; readonly tenantId: string; readonly agreementId: string; readonly revisionId: string;
  readonly signedDocumentSha256: string; readonly auditRecordSha256: string;
  readonly createProvenance: CreateProvenance | null;
}
export interface BridgeAssertion {
  readonly nonce: string; readonly actor: StaffActor; readonly agreementId: string | null;
  readonly operation: string; readonly method: string; readonly path: string; readonly bodyHash: string;
  readonly expiresAt: string;
}
export interface DocumentSection { readonly id: string; readonly heading: string; readonly paragraphs: readonly string[] }
export interface DocumentSource { readonly title: string; readonly sections: readonly DocumentSection[] }
export interface SigningField {
  readonly grantId: string; readonly type: 'signature' | 'date' | 'text'; readonly page: number;
  readonly x: number; readonly y: number; readonly width: number; readonly height: number;
}
export interface SigningRequest {
  readonly attemptId: string; readonly title: string; readonly pdf: Uint8Array; readonly sha256: string;
  readonly signers: readonly RecipientGrant[]; readonly fields: readonly SigningField[];
}
export interface PreparedSigningDocument { readonly pdf: Uint8Array; readonly fields: readonly SigningField[]; readonly sha256: string }
export interface SigningAccess { readonly roundId: string; readonly revisionId: string; readonly grantId: string; readonly signingUrl: string }
export interface ProviderSigner {
  readonly grantId: string; readonly providerId: string; readonly email: string; readonly role: string;
  readonly signingUrl: string; readonly completedAt: string | null;
}
export interface ProviderSubmission {
  readonly id: string; readonly status: 'pending' | 'completed' | 'declined' | 'expired' | 'archived';
  readonly signers: readonly ProviderSigner[]; readonly signedDocumentUrl: string | null; readonly auditRecordUrl: string | null;
}
export type SigningOutcome = { readonly status: 'created'; readonly submission: ProviderSubmission }
  | { readonly status: 'uncertain' } | { readonly status: 'rejected'; readonly code: string };
export interface ProviderEvent { readonly eventId: string; readonly submissionId: string; readonly kind: 'changed' | 'completed' | 'declined' | 'expired' | 'archived'; readonly occurredAt: string }
export interface EmailMessage { readonly to: string; readonly subject: string; readonly text: string }
export type EmailOutcome = { readonly status: 'accepted'; readonly messageId: string }
  | { readonly status: 'uncertain' } | { readonly status: 'rejected'; readonly code: string };
export interface PrivateSuggestion { readonly source: DocumentSource; readonly summary: string; readonly questions: readonly string[] }
export interface SuggestionRequest { readonly source: DocumentSource; readonly instruction: string }
export type SuggestionOutcome = { readonly status: 'suggested'; readonly suggestion: PrivateSuggestion; readonly inputTokens: number; readonly outputTokens: number }
  | { readonly status: 'failed' | 'uncertain'; readonly code: string };
export type StoreErrorCode = 'not_found' | 'forbidden' | 'conflict' | 'invalid' | 'rate_limited';
export class StoreError extends Error {
  readonly code: StoreErrorCode;
  constructor(code: StoreErrorCode, message: string) { super(message); this.name = 'StoreError'; this.code = code; }
}
