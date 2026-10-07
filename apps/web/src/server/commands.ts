import 'server-only';
import { z } from 'zod';
import { documentSourceSchema, prepareSigningDocument, renderDocumentPdf, S3DocumentStorage } from '@dripsign/core';
import type { Actor, DocumentDraft, DocumentSource, Mutation } from '@dripsign/db';
import { StoreError } from '@dripsign/db';
import { getStore } from './store';
import { requireAdmission } from './http';

const version = z.number().int().min(1);
const key = z.string().min(8).max(200);
const envelope = { expectedVersion: version, idempotencyKey: key };
export const commandSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...envelope, action: z.literal('propose'), text: z.string().min(1).max(10000), replacementSource: documentSourceSchema.nullable(), supersedesId: z.uuid().nullable() }),
  z.strictObject({ ...envelope, action: z.literal('counter'), text: z.string().min(1).max(10000), replacementSource: documentSourceSchema.nullable(), supersedesId: z.uuid() }),
  z.strictObject({ ...envelope, action: z.literal('accept'), proposalId: z.uuid() }),
  z.strictObject({ ...envelope, action: z.literal('reject'), proposalId: z.uuid() }),
  z.strictObject({ ...envelope, action: z.literal('message'), body: z.string().min(1).max(10000) }),
  z.strictObject({ ...envelope, action: z.literal('save_draft'), source: documentSourceSchema }),
  z.strictObject({ ...envelope, action: z.literal('publish'), reviewedSha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ ...envelope, action: z.literal('request_signatures') }),
  z.strictObject({ ...envelope, action: z.literal('cancel_signatures') }),
  z.strictObject({ ...envelope, action: z.literal('ask_ai'), instruction: z.string().min(1).max(10000) }),
]);
export type WebCommand = z.infer<typeof commandSchema>;
let storage: S3DocumentStorage | undefined;

export function getStorage(): S3DocumentStorage {
  if (!storage) storage = new S3DocumentStorage(process.env.AWS_REGION ?? '', process.env.DRIPSIGN_DOCUMENT_BUCKET ?? '', process.env.DRIPSIGN_DOCUMENT_KMS_KEY_ID);
  return storage;
}

/** Prepare immutable preview bytes before committing a private draft; publication stays separate. */
export async function prepareDraft(actor: Actor, agreementId: string, bytes: Uint8Array, source: DocumentSource): Promise<DocumentDraft> {
  if (actor.kind !== 'staff') throw new StoreError('not_found', 'Resource not found');
  const detail = await getStore().getAgreement(actor, agreementId);
  if (!detail.allowedActions.includes('save_draft')) throw new StoreError('conflict', 'Agreement is not open for changes');
  const signers = detail.grants.filter((grant) => grant.requiredSigner && !grant.revokedAt);
  const prepared = await prepareSigningDocument(bytes, signers);
  const document = await getStorage().putImmutable(actor.tenantId, agreementId, 'draft', prepared.pdf);
  return { source, document, originalDocument: null, preparationStatus: 'ready', preparationError: null, signingFields: prepared.fields, requiredGrantIds: signers.map((grant) => grant.id) };
}

/** Dispatch validated commands to the transaction owner; providers run only through durable jobs. */
export async function executeCommand(actor: Actor, agreementId: string, input: WebCommand): Promise<unknown> {
  if (input.action !== 'cancel_signatures') requireAdmission();
  const store = getStore();
  const mutation: Mutation = { actor, agreementId, expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey };
  switch (input.action) {
    case 'propose': return store.proposeChange(mutation, input);
    case 'counter': return store.counterProposal(mutation, input);
    case 'accept': return store.acceptProposal(mutation, input.proposalId);
    case 'reject': return store.rejectProposal(mutation, input.proposalId);
    case 'message': return store.addMessage(mutation, input.body);
    case 'save_draft': {
      if (actor.kind !== 'staff') throw new StoreError('not_found', 'Resource not found');
      const draft = await prepareDraft(actor, agreementId, await renderDocumentPdf(input.source), input.source);
      return store.saveDraft(mutation, draft);
    }
    case 'publish': {
      const detail = await store.getAgreement(actor, agreementId);
      const draft = detail.draft;
      if (actor.kind !== 'staff' || !draft?.document || draft.document.sha256 !== input.reviewedSha256
        || !draft.signingFields || !draft.requiredGrantIds) throw new StoreError('conflict', 'Review the current private document before publishing');
      return store.publishRevision(mutation, { document: draft.document, source: draft.source, signingFields: draft.signingFields, requiredGrantIds: draft.requiredGrantIds });
    }
    case 'request_signatures': return store.requestSigningRound(mutation, 'docuseal');
    case 'cancel_signatures': return store.requestSigningCancellation(mutation);
    case 'ask_ai': return store.requestPrivateSuggestion(mutation, input.instruction);
  }
}
