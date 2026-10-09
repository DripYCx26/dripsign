import { freezeCompletionExport } from './completionExport.ts';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AgreementStore, ROUND_COLUMNS, REVISION_COLUMNS, SIGNATURE_COLUMNS } from './agreements.ts';
import { transaction } from './connection.ts';
import { canonicalJson } from './json.ts';
import { asset, isIssuedDraft, parseArchiveJobPayload, requestEvidence, signatureName } from './validation.ts';
import { SIGNING_CONSENT_HASH, SIGNING_CONSENT_TEXT, SIGNING_CONSENT_VERSION, SIGNING_VERIFICATION_MAX_AGE_MS, StoreError } from './types.ts';
import type { Agreement, FinalizeAgreement, FrozenSigner, JobFence, Mutation, NativeSignature, Revision, Signature, SignatureRequestEvidence, SigningArchiveEvidence, SigningRound } from './types.ts';

export class SigningStore extends AgreementStore {
  protected async round(client: PoolClient, tenantId: string, agreementId: string, roundId: string): Promise<SigningRound> {
    const row = (await client.query<Omit<SigningRound, 'requiredGrantIds' | 'signers'>>(`SELECT ${ROUND_COLUMNS} FROM dripsign.signing_round WHERE tenant_id=$1 AND agreement_id=$2 AND id=$3 FOR UPDATE`, [tenantId, agreementId, roundId])).rows[0];
    if (!row) throw new StoreError('not_found', 'Resource not found');
    const signers = (await client.query<FrozenSigner>('SELECT grant_id AS "grantId",name,email FROM dripsign.required_signer WHERE tenant_id=$1 AND round_id=$2 ORDER BY grant_id LIMIT 100', [tenantId, roundId])).rows;
    return { ...row, requiredGrantIds: signers.map((signer) => signer.grantId), signers };
  }

  /** Freezes the published document, signer identities, and exact consent in an immediately active native round. */
  async requestSigningRound(command: Mutation): Promise<SigningRound> {
    return this.mutate(command, 'request_signing', null, async (client, agreement) => {
      if (command.actor.kind !== 'staff') throw new StoreError('forbidden', 'Staff permission is required');
      if (agreement.status !== 'negotiating' || !agreement.currentRevisionId) throw new StoreError('conflict', 'Agreement is not ready for signing');
      if ((await client.query('SELECT 1 FROM dripsign.proposal WHERE tenant_id=$1 AND agreement_id=$2 AND status=\'pending\' LIMIT 1', [agreement.tenantId, agreement.id])).rowCount) throw new StoreError('conflict', 'Resolve the pending proposal first');
      const revision = (await client.query<Revision>(`SELECT ${REVISION_COLUMNS} FROM dripsign.revision WHERE tenant_id=$1 AND agreement_id=$2 AND id=$3`, [agreement.tenantId, agreement.id, agreement.currentRevisionId])).rows[0];
      if (!revision || agreement.publicationNeeded || !isIssuedDraft(agreement.draft, revision)) throw new StoreError('conflict', 'Publish the working draft before requesting signatures');
      const signers = (await client.query<FrozenSigner>('SELECT id AS "grantId",name,email FROM dripsign.recipient_grant WHERE tenant_id=$1 AND agreement_id=$2 AND required_signer=true AND revoked_at IS NULL ORDER BY id FOR SHARE', [agreement.tenantId, agreement.id])).rows;
      if (!signers.length || signers.length > 10 || signers.length !== revision.requiredGrantIds.length || signers.some((signer) => !revision.requiredGrantIds.includes(signer.grantId))) throw new StoreError('conflict', 'Required parties changed');
      const id = randomUUID();
      await client.query(`INSERT INTO dripsign.signing_round(tenant_id,agreement_id,id,revision_id,status,document_sha256,consent_version,consent_text,consent_hash)
        VALUES($1,$2,$3,$4,'active',$5,$6,$7,$8)`, [agreement.tenantId, agreement.id, id, revision.id, revision.document.sha256, SIGNING_CONSENT_VERSION, SIGNING_CONSENT_TEXT, SIGNING_CONSENT_HASH]);
      for (const signer of signers) await client.query('INSERT INTO dripsign.required_signer(tenant_id,agreement_id,round_id,grant_id,name,email) VALUES($1,$2,$3,$4,$5,$6)', [agreement.tenantId, agreement.id, id, signer.grantId, signer.name, signer.email]);
      await client.query('UPDATE dripsign.agreement SET status=\'signing\',version=version+1 WHERE tenant_id=$1 AND id=$2', [agreement.tenantId, agreement.id]);
      return this.round(client, agreement.tenantId, agreement.id, id);
    });
  }

  /** Rechecks the live mailbox session within the same transaction as the immutable signature. */
  async signAgreement(command: Mutation, value: NativeSignature, sessionTokenHash: string, evidence: SignatureRequestEvidence): Promise<Signature> {
    signatureName(value.typedName); requestEvidence(evidence);
    if (value.consentAccepted !== true || !/^[a-f0-9]{64}$/.test(value.documentSha256) || !/^[a-f0-9]{64}$/.test(value.consentHash) || !/^[a-f0-9]{64}$/.test(sessionTokenHash)) throw new StoreError('invalid', 'Signature is invalid');
    let session: { id: string; verifiedAt: string } | undefined;
    return this.mutate(command, 'signature', value, async (client, agreement) => {
      if (command.actor.kind !== 'recipient' || !session) throw new StoreError('not_found', 'Resource not found');
      const recipient = command.actor;
      const round = await this.round(client, agreement.tenantId, agreement.id, value.roundId);
      if (agreement.status !== 'signing' || round.status !== 'active' || agreement.currentRevisionId !== value.revisionId || round.revisionId !== value.revisionId || round.documentSha256 !== value.documentSha256) throw new StoreError('conflict', 'Review the current signing document');
      if (round.consentVersion !== value.consentVersion || round.consentHash !== value.consentHash) throw new StoreError('conflict', 'Review the current electronic signature consent');
      const signer = round.signers.find((item) => item.grantId === recipient.grantId);
      if (!signer || signer.email !== command.actor.email) throw new StoreError('not_found', 'Resource not found');
      const live = (await client.query<{ name: string; email: string }>('SELECT name,email FROM dripsign.recipient_grant WHERE tenant_id=$1 AND agreement_id=$2 AND id=$3 AND required_signer=true AND revoked_at IS NULL FOR SHARE', [agreement.tenantId, agreement.id, command.actor.grantId])).rows[0];
      if (!live || live.email !== signer.email || live.name !== signer.name) throw new StoreError('conflict', 'Required parties changed');
      if ((await client.query('SELECT 1 FROM dripsign.signature WHERE tenant_id=$1 AND round_id=$2 AND grant_id=$3', [agreement.tenantId, round.id, signer.grantId])).rowCount) throw new StoreError('conflict', 'This signature was already recorded');
      const signature = (await client.query<Signature>(`INSERT INTO dripsign.signature(tenant_id,round_id,grant_id,typed_name,consent_version,consent_text,consent_hash,document_sha256,auth_session_id,verified_at,request_evidence)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${SIGNATURE_COLUMNS}`, [agreement.tenantId, round.id, signer.grantId, value.typedName, round.consentVersion, round.consentText, round.consentHash, round.documentSha256, session.id, session.verifiedAt, JSON.stringify({ipAddress:evidence.ipAddress,userAgent:evidence.userAgent,requestId:evidence.requestId})])).rows[0];
      if (!signature) throw new Error('Signature insert returned no row');
      const missing = (await client.query('SELECT 1 FROM dripsign.required_signer r LEFT JOIN dripsign.signature s ON s.tenant_id=r.tenant_id AND s.round_id=r.round_id AND s.grant_id=r.grant_id WHERE r.tenant_id=$1 AND r.round_id=$2 AND s.grant_id IS NULL LIMIT 1', [agreement.tenantId, round.id])).rowCount;
      if (!missing) {
        await client.query('UPDATE dripsign.signing_round SET status=\'finalizing\' WHERE tenant_id=$1 AND id=$2', [agreement.tenantId, round.id]);
        await this.enqueue(client, { tenantId: agreement.tenantId, agreementId: agreement.id, kind: 'archive', dedupeKey: `signing:archive:${round.id}`, payload: { roundId: round.id, revisionId: round.revisionId } });
      }
      await this.bump(client, agreement);
      return signature;
    }, undefined, async (client) => {
      if (command.actor.kind !== 'recipient') throw new StoreError('not_found', 'Resource not found');
      const row = (await client.query<{ id: string; verifiedAt: string }>(`SELECT id,verified_at::text AS "verifiedAt" FROM dripsign.auth_session WHERE token_hash=$1
        AND actor->>'kind'='recipient' AND actor->>'email'=$2 AND revoked_at IS NULL AND expires_at>now()
        AND verified_at<=now() AND verified_at>now()-($3::int*interval '1 millisecond') FOR SHARE`, [sessionTokenHash, command.actor.email, SIGNING_VERIFICATION_MAX_AGE_MS])).rows[0];
      if (!row) throw new StoreError('verification_required', 'Verify your email again before signing');
      session = row;
    });
  }

  /** Cancellation retains partial signatures and immediately closes an unfinished round. */
  async requestSigningCancellation(command: Mutation): Promise<SigningRound> {
    return this.mutate(command, 'request_cancel', null, async (client, agreement) => {
      if (command.actor.kind !== 'staff') throw new StoreError('forbidden', 'Staff permission is required');
      const id = await this.voidActiveRound(client, agreement);
      await this.bump(client, agreement);
      return this.round(client, agreement.tenantId, agreement.id, id);
    });
  }

  protected async archiveEvidence(client: PoolClient, tenantId: string, agreementId: string, roundId: string, revisionId: string): Promise<SigningArchiveEvidence> {
    const agreement = await this.lockedRecovery(client, tenantId, agreementId, roundId);
    const round = await this.round(client, tenantId, agreementId, roundId);
    if (!['finalizing', 'completed'].includes(round.status) || round.revisionId !== revisionId || agreement.currentRevisionId !== revisionId) throw new StoreError('conflict', 'Signing evidence changed');
    const revision = (await client.query<Revision>(`SELECT ${REVISION_COLUMNS} FROM dripsign.revision WHERE tenant_id=$1 AND agreement_id=$2 AND id=$3`, [tenantId, agreementId, round.revisionId])).rows[0];
    const signatures = (await client.query<Signature>(`SELECT ${SIGNATURE_COLUMNS} FROM dripsign.signature WHERE tenant_id=$1 AND round_id=$2 ORDER BY grant_id LIMIT 100`, [tenantId, roundId])).rows;
    if (!revision || revision.document.sha256 !== round.documentSha256 || signatures.length !== round.requiredGrantIds.length || !signatures.length || round.requiredGrantIds.some((id) => !signatures.some((signature) => signature.grantId === id))) throw new StoreError('conflict', 'Signing evidence is incomplete');
    return { title: agreement.title, revision, round, signatures };
  }

  /** Archival completion uses only a current archive lease and the exact frozen evidence. */
  async applyArchivedEvidence(fence: JobFence, value: FinalizeAgreement): Promise<Agreement> {
    return transaction(this.pool, async (client) => {
      await this.fence(client, fence);
      const job = (await client.query<{ agreement_id: string | null; kind: string; payload: unknown }>('SELECT agreement_id,kind,payload FROM dripsign.outbox WHERE tenant_id=$1 AND id=$2', [fence.tenantId, fence.id])).rows[0];
      if (!job?.agreement_id || job.kind !== 'archive') throw new StoreError('not_found', 'Resource not found');
      const payload = parseArchiveJobPayload(job.payload);
      if (payload.roundId !== value.roundId || payload.revisionId !== value.revisionId) throw new StoreError('conflict', 'Archive job changed');
      asset(value.signedDocument, fence.tenantId, job.agreement_id); asset(value.auditRecord, fence.tenantId, job.agreement_id);
      const prefix = `tenants/${fence.tenantId}/agreements/${job.agreement_id}/`;
      if (value.signedDocument.objectKey !== `${prefix}signed_document/${value.signedDocument.sha256}.pdf` || value.auditRecord.objectKey !== `${prefix}audit_record/${value.auditRecord.sha256}.pdf`) throw new StoreError('invalid', 'Archived documents are invalid');
      const evidence = await this.archiveEvidence(client, fence.tenantId, job.agreement_id, value.roundId, value.revisionId);
      const agreement = await this.lockedRecovery(client, fence.tenantId, job.agreement_id, value.roundId);
      const existing = (await client.query<{ kind: string; document: unknown }>('SELECT kind,document FROM dripsign.archived_artifact WHERE tenant_id=$1 AND round_id=$2 LIMIT 2', [fence.tenantId, value.roundId])).rows;
      if (evidence.round.status === 'completed') {
        if (agreement.status !== 'signed' || existing.length !== 2 || existing.some((item) => canonicalJson(item.document) !== canonicalJson(item.kind === 'signed_document' ? value.signedDocument : value.auditRecord))) throw new StoreError('conflict', 'Archived evidence changed');
        return agreement;
      }
      if (existing.length || agreement.status !== 'signing') throw new StoreError('conflict', 'Archived evidence changed');
      for (const [kind, document] of [['signed_document', value.signedDocument], ['audit_record', value.auditRecord]] as const) await client.query('INSERT INTO dripsign.archived_artifact(tenant_id,round_id,id,kind,document) VALUES($1,$2,$3,$4,$5)', [fence.tenantId, value.roundId, randomUUID(), kind, JSON.stringify(document)]);
      await client.query('UPDATE dripsign.signing_round SET status=\'completed\',completed_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2', [fence.tenantId, value.roundId]);
      await client.query('UPDATE dripsign.agreement SET status=\'signed\' WHERE tenant_id=$1 AND id=$2', [fence.tenantId, agreement.id]);
      await this.enqueue(client, { tenantId: fence.tenantId, agreementId: agreement.id, kind: 'agreement_executed', dedupeKey: `executed:${value.roundId}`, payload: { roundId: value.roundId, revisionId: value.revisionId } });
      await freezeCompletionExport(client, fence.tenantId, agreement.id, value.roundId);
      return this.bump(client, agreement);
    });
  }
}
