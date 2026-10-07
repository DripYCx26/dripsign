import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AgreementStore, ROUND_COLUMNS } from './agreements.ts';
import { transaction } from './connection.ts';
import { asset, bounded, isIssuedDraft } from './validation.ts';
import { StoreError } from './types.ts';
import type { Agreement, FinalizeAgreement, JobFence, Mutation, ProviderSubmission, Signature, SignatureEvent, SigningAccess, ProviderEvent, Revision, SigningRound, SigningOutcome } from './types.ts';

export class SigningStore extends AgreementStore {
  private async round(client: PoolClient, tenantId: string, agreementId: string, roundId: string): Promise<SigningRound> {
    const row = (await client.query<Omit<SigningRound,'requiredGrantIds'>>(`SELECT ${ROUND_COLUMNS} FROM dripsign.signing_round WHERE tenant_id=$1 AND agreement_id=$2 AND id=$3 FOR UPDATE`,[tenantId,agreementId,roundId])).rows[0];
    if(!row) throw new StoreError('not_found','Resource not found');
    const required=(await client.query<{grant_id:string}>('SELECT grant_id FROM dripsign.required_signer WHERE tenant_id=$1 AND round_id=$2 ORDER BY grant_id LIMIT 100',[tenantId,roundId])).rows.map((r)=>r.grant_id);
    return {...row,requiredGrantIds:required};
  }
  async requestSigningRound(command: Mutation, provider: string): Promise<SigningRound> {
    bounded(provider,'Signing provider',100);
    return this.mutate(command,'request_signing',{provider},async(client,agreement)=>{
      if(command.actor.kind!=='staff') throw new StoreError('forbidden','Staff permission is required');
      if(agreement.status!=='negotiating'||!agreement.currentRevisionId) throw new StoreError('conflict','Agreement is not ready for signing');
      if((await client.query('SELECT 1 FROM dripsign.proposal WHERE tenant_id=$1 AND agreement_id=$2 AND status=\'pending\'',[agreement.tenantId,agreement.id])).rowCount) throw new StoreError('conflict','Resolve the pending proposal first');
      const revision=(await client.query<Pick<Revision,'document'|'source'|'signingFields'|'requiredGrantIds'>>('SELECT document,source,signing_fields AS \"signingFields\",required_grant_ids AS \"requiredGrantIds\" FROM dripsign.revision WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,agreement.currentRevisionId])).rows[0];
      if(!revision)throw new StoreError('conflict','Published signing preview is missing');
      if(agreement.publicationNeeded||!isIssuedDraft(agreement.draft,revision))throw new StoreError('conflict','Publish the working draft before requesting signatures');
      const fields=revision.signingFields;
      const grants=(await client.query<{id:string}>('SELECT id FROM dripsign.recipient_grant WHERE tenant_id=$1 AND agreement_id=$2 AND required_signer=true AND revoked_at IS NULL ORDER BY id FOR SHARE',[agreement.tenantId,agreement.id])).rows;
      if(grants.length!==revision.requiredGrantIds.length||grants.some((g)=>!revision.requiredGrantIds.includes(g.id)))throw new StoreError('conflict','Required parties changed');
      if(!grants.length||grants.some((g)=>!fields.some((f)=>f.grantId===g.id&&f.type==='signature'))||fields.some((f)=>!grants.some((g)=>g.id===f.grantId))) throw new StoreError('invalid','Every required signer needs a signature field');
      const id=randomUUID();
      await client.query('INSERT INTO dripsign.signing_round(tenant_id,agreement_id,id,revision_id,status,provider) VALUES($1,$2,$3,$4,\'preparing\',$5)',[agreement.tenantId,agreement.id,id,agreement.currentRevisionId,provider]);
      for(const grant of grants) await client.query('INSERT INTO dripsign.required_signer(tenant_id,agreement_id,round_id,grant_id) VALUES($1,$2,$3,$4)',[agreement.tenantId,agreement.id,id,grant.id]);
      await client.query('UPDATE dripsign.agreement SET status=\'signing\',version=version+1 WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,agreement.id]);
      await this.enqueue(client,{tenantId:agreement.tenantId,agreementId:agreement.id,kind:'signing_create',dedupeKey:`signing:create:${id}`,payload:{mutation:{...command,expectedVersion:agreement.version+1,idempotencyKey:`signing:create:${id}`},roundId:id,fields}});
      return this.round(client,agreement.tenantId,agreement.id,id);
    });
  }
  async confirmSigningSubmission(command: Mutation, roundId: string, providerSubmissionId: string, fence?: JobFence): Promise<SigningRound> {
    bounded(providerSubmissionId,'Provider submission',200);
    return this.mutate(command,'confirm_signing',{roundId,providerSubmissionId},async(client,agreement)=>{
      if(command.actor.kind!=='staff') throw new StoreError('forbidden','Staff permission is required');
      const round=await this.round(client,agreement.tenantId,agreement.id,roundId);
      if(agreement.status!=='signing'||round.revisionId!==agreement.currentRevisionId||!['preparing','uncertain','active'].includes(round.status)|| (round.providerSubmissionId && round.providerSubmissionId!==providerSubmissionId)) throw new StoreError('conflict','Signing round changed');
      await client.query('UPDATE dripsign.signing_round SET status=\'active\',provider_submission_id=$3 WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,roundId,providerSubmissionId]);
      await this.bump(client,agreement);return this.round(client,agreement.tenantId,agreement.id,roundId);
    },fence);
  }
  async markSigningUncertain(command: Mutation, roundId: string, fence?: JobFence): Promise<SigningRound> {
    return this.mutate(command,'signing_uncertain',{roundId},async(client,agreement)=>{
      if(command.actor.kind!=='staff') throw new StoreError('forbidden','Staff permission is required');
      const round=await this.round(client,agreement.tenantId,agreement.id,roundId);
      if(round.status!=='preparing'||round.revisionId!==agreement.currentRevisionId) throw new StoreError('conflict','Signing round changed');
      await client.query('UPDATE dripsign.signing_round SET status=\'uncertain\' WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,roundId]);
      const create=(await client.query<{payload:Record<string,unknown>}>('SELECT payload FROM dripsign.outbox WHERE tenant_id=$1 AND dedupe_key=$2',[agreement.tenantId,`signing:create:${roundId}`])).rows[0];
      if(create)await this.enqueue(client,{tenantId:agreement.tenantId,agreementId:agreement.id,kind:'signing_reconcile',dedupeKey:`signing:reconcile:${roundId}`,payload:create.payload});
      await this.bump(client,agreement);return this.round(client,agreement.tenantId,agreement.id,roundId);
    },fence);
  }
  private async signature(client: PoolClient, agreement: Agreement, event: SignatureEvent): Promise<Signature> {
    const round=await this.round(client,agreement.tenantId,agreement.id,event.roundId);
    if(agreement.status!=='signing'||round.status!=='active'||round.revisionId!==event.revisionId||round.revisionId!==agreement.currentRevisionId||!round.requiredGrantIds.includes(event.grantId)) throw new StoreError('conflict','Signing round changed');
    if(!(await client.query('SELECT 1 FROM dripsign.signing_consent WHERE tenant_id=$1 AND round_id=$2 AND grant_id=$3',[agreement.tenantId,event.roundId,event.grantId])).rowCount)throw new StoreError('conflict','Signer consent is required');
    bounded(event.providerEventId,'Provider event',200);
    if(!Number.isFinite(Date.parse(event.signedAt))) throw new StoreError('invalid','Signing time is invalid');
    await client.query('INSERT INTO dripsign.signature(tenant_id,round_id,grant_id,provider_event_id,signed_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,round_id,grant_id) DO NOTHING',[agreement.tenantId,event.roundId,event.grantId,event.providerEventId,event.signedAt]);
    const result=(await client.query<Signature>('SELECT round_id AS "roundId",grant_id AS "grantId",provider_event_id AS "providerEventId",signed_at::text AS "signedAt" FROM dripsign.signature WHERE tenant_id=$1 AND round_id=$2 AND grant_id=$3',[agreement.tenantId,event.roundId,event.grantId])).rows[0];
    if(!result) throw new Error('Signature insert returned no row');return result;
  }
  async recordSignature(command: Mutation,event:SignatureEvent,fence?:JobFence):Promise<Signature> {
    return this.mutate(command,'signature',event,async(client,agreement)=>{if(command.actor.kind!=='staff')throw new StoreError('forbidden','Provider authority is required');const result=await this.signature(client,agreement,event);await this.bump(client,agreement);return result;},fence);
  }
  // A provider observation is pinned to a frozen round, independent of shared-message version bumps.
  async applySigningObservation(fence: JobFence, command: Mutation, roundId: string, submission: ProviderSubmission): Promise<SigningRound> {
    return transaction(this.pool,async(client)=>{
      await this.fence(client,fence);
      if(command.actor.kind!=='staff'||command.actor.tenantId!==fence.tenantId) throw new StoreError('forbidden','Provider authority is required');
      const agreement=await this.lockedRecovery(client,fence.tenantId,command.agreementId,roundId);
      const round=await this.round(client,agreement.tenantId,agreement.id,roundId);
      const job=(await client.query<{agreement_id:string;payload:{roundId?:string}}>('SELECT agreement_id,payload FROM dripsign.outbox WHERE tenant_id=$1 AND id=$2',[fence.tenantId,fence.id])).rows[0];
      if(job?.agreement_id!==agreement.id||job.payload.roundId!==roundId||agreement.currentRevisionId!==round.revisionId||agreement.status!=='signing'||!['preparing','uncertain','active'].includes(round.status)||(round.providerSubmissionId&&round.providerSubmissionId!==submission.id)) throw new StoreError('conflict','Signing round changed');
      bounded(submission.id,'Provider submission',200);
      const grants=(await client.query<{id:string;email:string}>('SELECT id,email FROM dripsign.recipient_grant WHERE tenant_id=$1 AND agreement_id=$2 AND id=ANY($3::uuid[]) AND revoked_at IS NULL',[agreement.tenantId,agreement.id,round.requiredGrantIds])).rows;
      if(submission.signers.length!==round.requiredGrantIds.length||new Set(submission.signers.map((s)=>s.grantId)).size!==round.requiredGrantIds.length||submission.signers.some((s)=>!grants.some((g)=>g.id===s.grantId&&g.email===s.email.toLowerCase()))) throw new StoreError('conflict','Provider signers do not match required parties');
      if(['declined','expired','archived'].includes(submission.status)) throw new StoreError('conflict','Provider submission is not open');
      await client.query('UPDATE dripsign.signing_round SET status=\'active\',provider_submission_id=$3 WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,roundId,submission.id]);
      for(const signer of submission.signers) {
        if(!/^https:\/\//.test(signer.signingUrl))throw new StoreError('invalid','Provider signing URL is invalid');
        await client.query('INSERT INTO dripsign.provider_signer(tenant_id,round_id,grant_id,provider_id,email,role,signing_url) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,round_id,grant_id) DO UPDATE SET signing_url=EXCLUDED.signing_url',[agreement.tenantId,roundId,signer.grantId,signer.providerId,signer.email,signer.role,signer.signingUrl]);
      }
      for(const signer of submission.signers) if(signer.completedAt) await this.signature(client,agreement,{roundId,revisionId:round.revisionId,grantId:signer.grantId,providerEventId:`${submission.id}:${signer.providerId}:completed`,signedAt:signer.completedAt});
      const original=(await client.query<{payload:Record<string,unknown>}>('SELECT payload FROM dripsign.outbox WHERE tenant_id=$1 AND id=$2',[fence.tenantId,fence.id])).rows[0];
      if(!original)throw new StoreError('not_found','Resource not found');
      const complete=submission.status==='completed'&&submission.signers.every((party)=>party.completedAt!==null);
      if(complete)await this.enqueue(client,{tenantId:agreement.tenantId,agreementId:agreement.id,kind:'archive',dedupeKey:`signing:archive:${roundId}`,payload:original.payload});
      else if((await client.query<{kind:string}>('SELECT kind FROM dripsign.outbox WHERE tenant_id=$1 AND id=$2',[fence.tenantId,fence.id])).rows[0]?.kind==='signing_create')await this.enqueue(client,{tenantId:agreement.tenantId,agreementId:agreement.id,kind:'signing_reconcile',dedupeKey:`signing:reconcile:${roundId}`,payload:original.payload});
      await this.bump(client,agreement);
      return this.round(client,agreement.tenantId,agreement.id,roundId);
    });
  }
  async finalizeAgreement(command: Mutation,value:FinalizeAgreement,fence?:JobFence):Promise<Agreement> {
    asset(value.signedDocument,command.actor.tenantId,command.agreementId);asset(value.auditRecord,command.actor.tenantId,command.agreementId);
    return this.mutate(command,'finalize',value,(client,agreement)=>this.complete(client,command,agreement,value),fence);
  }
  private async complete(client:PoolClient,command:Mutation,agreement:Agreement,value:FinalizeAgreement):Promise<Agreement> {
      if(command.actor.kind!=='staff') throw new StoreError('forbidden','Provider authority is required');
      const round=await this.round(client,agreement.tenantId,agreement.id,value.roundId);
      if(agreement.status!=='signing'||round.status!=='active'||round.revisionId!==value.revisionId||agreement.currentRevisionId!==value.revisionId||!round.requiredGrantIds.length) throw new StoreError('conflict','Signing round changed');
      const missing=(await client.query('SELECT 1 FROM dripsign.required_signer r LEFT JOIN dripsign.signature s ON s.tenant_id=r.tenant_id AND s.round_id=r.round_id AND s.grant_id=r.grant_id WHERE r.tenant_id=$1 AND r.round_id=$2 AND s.grant_id IS NULL LIMIT 1',[agreement.tenantId,round.id])).rowCount;
      if(missing) throw new StoreError('conflict','Every required party must sign');
      for(const [kind,document] of [['signed_document',value.signedDocument],['audit_record',value.auditRecord]] as const) await client.query('INSERT INTO dripsign.archived_artifact(tenant_id,round_id,id,kind,document) VALUES($1,$2,$3,$4,$5)',[agreement.tenantId,round.id,randomUUID(),kind,JSON.stringify(document)]);
      await client.query('UPDATE dripsign.signing_round SET status=\'completed\' WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,round.id]);
      await client.query('UPDATE dripsign.agreement SET status=\'signed\' WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,agreement.id]);
      const eventId=randomUUID();
      const provenance=(await client.query<{createProvenance:import('./types.ts').CreateProvenance|null}>('SELECT create_provenance AS \"createProvenance\" FROM dripsign.agreement WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,agreement.id])).rows[0]?.createProvenance??null;
      await this.enqueue(client,{tenantId:agreement.tenantId,agreementId:agreement.id,kind:'agreement_executed',dedupeKey:`executed:${round.id}`,payload:{eventId,tenantId:agreement.tenantId,agreementId:agreement.id,revisionId:round.revisionId,signedDocumentSha256:value.signedDocument.sha256,auditRecordSha256:value.auditRecord.sha256,createProvenance:provenance}});
      return this.bump(client,agreement);
  }
  async applyArchivedEvidence(fence:JobFence,command:Mutation,value:FinalizeAgreement):Promise<Agreement> {
    asset(value.signedDocument,command.actor.tenantId,command.agreementId);asset(value.auditRecord,command.actor.tenantId,command.agreementId);
    return transaction(this.pool,async(client)=>{
      await this.fence(client,fence);
      if(fence.tenantId!==command.actor.tenantId)throw new StoreError('not_found','Resource not found');
      const job=(await client.query<{agreement_id:string;payload:{roundId?:string}}>('SELECT agreement_id,payload FROM dripsign.outbox WHERE tenant_id=$1 AND id=$2',[fence.tenantId,fence.id])).rows[0];
      if(job?.agreement_id!==command.agreementId||job.payload.roundId!==value.roundId)throw new StoreError('conflict','Archive job changed');
      const agreement=await this.lockedRecovery(client,fence.tenantId,command.agreementId,value.roundId);
      if(agreement.status==='signed'&&agreement.currentRevisionId===value.revisionId)return agreement;
      return this.complete(client,command,agreement,value);
    });
  }
  async getSignerAccess(command:Mutation,revisionId:string,documentSha256:string,consentHash:string):Promise<SigningAccess> {
    bounded(consentHash,'Consent hash',64,64);
    return transaction(this.pool,async(client)=>{
      const agreement=await this.locked(client,command.actor,command.agreementId);
      if(agreement.version!==command.expectedVersion)throw new StoreError('conflict','Agreement changed; reload it');
      if(command.actor.kind!=='recipient'||agreement.status!=='signing'||agreement.currentRevisionId!==revisionId)throw new StoreError('conflict','Signing revision changed');
      const revision=(await client.query<{sha256:string}>('SELECT document->>\'sha256\' AS sha256 FROM dripsign.revision WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,revisionId])).rows[0];
      if(revision?.sha256!==documentSha256)throw new StoreError('conflict','Review the current document');
      const row=(await client.query<{roundId:string;signingUrl:string}>('SELECT r.id AS "roundId",s.signing_url AS "signingUrl" FROM dripsign.signing_round r JOIN dripsign.provider_signer s ON s.tenant_id=r.tenant_id AND s.round_id=r.id WHERE r.tenant_id=$1 AND r.agreement_id=$2 AND r.revision_id=$3 AND r.status=\'active\' AND s.grant_id=$4 AND NOT EXISTS(SELECT 1 FROM dripsign.signature x WHERE x.tenant_id=r.tenant_id AND x.round_id=r.id AND x.grant_id=s.grant_id)',[agreement.tenantId,agreement.id,revisionId,command.actor.grantId])).rows[0];
      if(!row)throw new StoreError('conflict','Signature is not available');
      await client.query('INSERT INTO dripsign.signing_consent(tenant_id,round_id,grant_id,consent_hash) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,round_id,grant_id) DO NOTHING',[agreement.tenantId,row.roundId,command.actor.grantId,consentHash]);
      return {roundId:row.roundId,revisionId,grantId:command.actor.grantId,signingUrl:row.signingUrl};
    });
  }
  async requestSigningCancellation(command:Mutation):Promise<string> {
    return this.mutate(command,'request_cancel',null,async(client,agreement)=>{
      if(command.actor.kind!=='staff'||agreement.status!=='signing')throw new StoreError('conflict','No active signing round');
      const round=(await client.query<{id:string}>('SELECT id FROM dripsign.signing_round WHERE tenant_id=$1 AND agreement_id=$2 AND status IN (\'active\',\'preparing\',\'uncertain\') FOR UPDATE',[agreement.tenantId,agreement.id])).rows[0];
      if(!round)throw new StoreError('conflict','No active signing round');
      return this.enqueue(client,{tenantId:agreement.tenantId,agreementId:agreement.id,kind:'signing_cancel',dedupeKey:`signing:cancel:${round.id}`,payload:{mutation:{...command,idempotencyKey:`signing:cancel:${round.id}`},roundId:round.id,fields:[]}});
    });
  }
  async ingestProviderEvent(event:ProviderEvent):Promise<boolean> {
    bounded(event.eventId,'Provider event',200);bounded(event.submissionId,'Provider submission',200);
    return transaction(this.pool,async(client)=>{
      const round=(await client.query<{tenant_id:string;agreement_id:string;id:string;payload:Record<string,unknown>}>('SELECT r.tenant_id,r.agreement_id,r.id,o.payload FROM dripsign.signing_round r JOIN dripsign.outbox o ON o.tenant_id=r.tenant_id AND o.dedupe_key=\'signing:create:\'||r.id::text WHERE r.provider_submission_id=$1 AND r.status IN (\'active\',\'uncertain\') LIMIT 1 FOR UPDATE OF r',[event.submissionId])).rows[0];
      if(!round)return false;
      await this.enqueue(client,{tenantId:round.tenant_id,agreementId:round.agreement_id,kind:'signing_reconcile',dedupeKey:`provider:event:${event.eventId}`,payload:round.payload});
      return true;
    });
  }
  async applySigningCancellation(fence:JobFence,command:Mutation,roundId:string,evidence:ProviderSubmission):Promise<Agreement> {
    return transaction(this.pool,async(client)=>{
      await this.fence(client,fence);
      if(command.actor.kind!=='staff'||command.actor.tenantId!==fence.tenantId)throw new StoreError('forbidden','Provider authority is required');
      const job=(await client.query<{agreement_id:string;payload:{roundId?:string}}>('SELECT agreement_id,payload FROM dripsign.outbox WHERE tenant_id=$1 AND id=$2',[fence.tenantId,fence.id])).rows[0];
      if(job?.agreement_id!==command.agreementId||job.payload.roundId!==roundId)throw new StoreError('conflict','Cancellation job changed');
      const agreement=await this.lockedRecovery(client,fence.tenantId,command.agreementId,roundId);
      const round=await this.round(client,agreement.tenantId,agreement.id,roundId);
      if(evidence.status!=='expired'||(round.providerSubmissionId&&evidence.id!==round.providerSubmissionId))throw new StoreError('conflict','Provider cancellation evidence is required');
      if(!round.providerSubmissionId){
        const parties=(await client.query<{id:string;email:string}>('SELECT id,email FROM dripsign.recipient_grant WHERE tenant_id=$1 AND agreement_id=$2 AND id=ANY($3::uuid[])',[agreement.tenantId,agreement.id,round.requiredGrantIds])).rows;
        if(evidence.signers.length!==round.requiredGrantIds.length||new Set(evidence.signers.map((s)=>s.grantId)).size!==round.requiredGrantIds.length||evidence.signers.some((s)=>!parties.some((p)=>p.id===s.grantId&&p.email===s.email.toLowerCase())))throw new StoreError('conflict','Recovered provider parties do not match');
        await client.query('UPDATE dripsign.signing_round SET provider_submission_id=$3 WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,roundId,evidence.id]);
      }
      if(round.status==='void'&&round.revisionId===agreement.currentRevisionId)return agreement;
      if(agreement.status!=='signing'||round.revisionId!==agreement.currentRevisionId||round.status==='completed')throw new StoreError('conflict','Signing round changed');
      await client.query('UPDATE dripsign.signing_round SET status=\'void\' WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,roundId]);
      await client.query('UPDATE dripsign.agreement SET status=\'negotiating\' WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,agreement.id]);
      return this.bump(client,agreement);
    });
  }
  async markCancellationUncertain(fence:JobFence,payload:import('./types.ts').SigningJobPayload):Promise<string> {
    return transaction(this.pool,async(client)=>{
      await this.fence(client,fence);
      if(payload.mutation.actor.kind!=='staff'||payload.mutation.actor.tenantId!==fence.tenantId)throw new StoreError('forbidden','Provider authority is required');
      const job=(await client.query<{agreement_id:string}>('SELECT agreement_id FROM dripsign.outbox WHERE tenant_id=$1 AND id=$2',[fence.tenantId,fence.id])).rows[0];
      if(job?.agreement_id!==payload.mutation.agreementId)throw new StoreError('not_found','Resource not found');
      return this.enqueue(client,{tenantId:fence.tenantId,agreementId:payload.mutation.agreementId,kind:'signing_reconcile',dedupeKey:`signing:cancel-reconcile:${payload.roundId}`,payload:{mutation:payload.mutation,roundId:payload.roundId,fields:payload.fields}});
    });
  }
  protected async voidUncreatedSigningRound(client:PoolClient,fence:JobFence):Promise<boolean> {
    const job=(await client.query<{agreement_id:string|null;roundId:string|null}>('SELECT agreement_id,payload->>\'roundId\' AS "roundId" FROM dripsign.outbox WHERE tenant_id=$1 AND id=$2 AND lease_token=$3 AND status=\'delivering\' AND lease_until>now() AND kind=\'signing_create\' AND effect_started_at IS NULL FOR UPDATE',[fence.tenantId,fence.id,fence.leaseToken])).rows[0];
    if(!job?.agreement_id||!job.roundId||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(job.roundId))return false;
    const agreement=(await client.query<Pick<Agreement,'id'|'status'|'currentRevisionId'>>('SELECT id,status,current_revision_id AS "currentRevisionId" FROM dripsign.agreement WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[fence.tenantId,job.agreement_id])).rows[0];
    if(!agreement||agreement.status!=='signing'||!agreement.currentRevisionId)return false;
    const round=(await client.query<Pick<SigningRound,'status'|'revisionId'|'providerSubmissionId'>>('SELECT status,revision_id AS "revisionId",provider_submission_id AS "providerSubmissionId" FROM dripsign.signing_round WHERE tenant_id=$1 AND agreement_id=$2 AND id=$3 FOR UPDATE',[fence.tenantId,agreement.id,job.roundId])).rows[0];
    if(!round||round.status!=='preparing'||round.providerSubmissionId!==null||round.revisionId!==agreement.currentRevisionId)return false;
    await client.query('UPDATE dripsign.signing_round SET status=\'void\' WHERE tenant_id=$1 AND id=$2',[fence.tenantId,job.roundId]);
    await client.query('UPDATE dripsign.agreement SET status=\'negotiating\',version=version+1 WHERE tenant_id=$1 AND id=$2',[fence.tenantId,agreement.id]);
    return true;
  }
  async rejectSigningCreation(fence:JobFence,command:Mutation,roundId:string,rejection:Extract<SigningOutcome,{status:'rejected'}>):Promise<Agreement> {
    if(rejection.status!=='rejected')throw new StoreError('invalid','Definitive creation rejection is required');
    bounded(rejection.code,'Creation rejection',100);
    return transaction(this.pool,async(client)=>{
      await this.fence(client,fence);
      if(command.actor.kind!=='staff'||command.actor.tenantId!==fence.tenantId)throw new StoreError('forbidden','Provider authority is required');
      const job=(await client.query<{agreement_id:string;kind:string;effect_started_at:string|null;payload:{roundId?:string}}>('SELECT agreement_id,kind,effect_started_at::text,payload FROM dripsign.outbox WHERE tenant_id=$1 AND id=$2',[fence.tenantId,fence.id])).rows[0];
      if(job?.kind!=='signing_create'||job.effect_started_at===null||job.agreement_id!==command.agreementId||job.payload.roundId!==roundId)throw new StoreError('conflict','Signing creation job changed');
      const agreement=await this.lockedRecovery(client,fence.tenantId,command.agreementId,roundId);
      const round=await this.round(client,agreement.tenantId,agreement.id,roundId);
      if(round.providerSubmissionId!==null||round.revisionId!==agreement.currentRevisionId)throw new StoreError('conflict','Signing round changed');
      if(round.status==='void'&&agreement.status==='negotiating')return agreement;
      if(round.status!=='preparing'||agreement.status!=='signing')throw new StoreError('conflict','Signing creation is no longer awaiting a result');
      await client.query('UPDATE dripsign.signing_round SET status=\'void\' WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,roundId]);
      await client.query('UPDATE dripsign.agreement SET status=\'negotiating\' WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,agreement.id]);
      return this.bump(client,agreement);
    });
  }
}
