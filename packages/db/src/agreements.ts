import { canonicalJson } from './json.ts';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { transaction } from './connection.ts';
import { AGREEMENT_COLUMNS, StoreBase, actorKey } from './storeBase.ts';
import { asset, bounded, draft, emailAddress, source, isIssuedDraft } from './validation.ts';
import { StoreError } from './types.ts';
import type { Actor, Agreement, AgreementInboxItem, AgreementAction, AgreementDetail, ArchivedArtifact, BootstrapStaff, DocumentDraft, Mutation, NewAgreement, PrivateAiMessage, Proposal, ProposalChange, PublishRevision, PdfPreparationJobPayload, PdfPreparationResult, JobFence, DocumentAsset, RecipientGrant, Revision, SharedMessage, Signature, SigningRound, StaffActor } from './types.ts';

const GRANT_COLUMNS = 'id,agreement_id AS "agreementId",email,name,required_signer AS "requiredSigner",revoked_at::text AS "revokedAt"';
const REVISION_COLUMNS = 'id,agreement_id AS "agreementId",number,document,source,signing_fields AS "signingFields",required_grant_ids AS "requiredGrantIds",published_at::text AS "publishedAt"';
const PROPOSAL_COLUMNS = 'id,agreement_id AS "agreementId",base_revision_id AS "baseRevisionId",author_kind AS "authorKind",author_id AS "authorId",text,replacement_source AS "replacementSource",original_source AS "originalSource",status,supersedes_id AS "supersedesId",created_at::text AS "createdAt"';
export const ROUND_COLUMNS = 'id, id AS "attemptId", agreement_id AS "agreementId", revision_id AS "revisionId",status,provider,provider_submission_id AS "providerSubmissionId",created_at::text AS "createdAt"';

export class AgreementStore extends StoreBase {
  async bootstrapStaff(input: BootstrapStaff): Promise<StaffActor> {
    bounded(input.tenantName, 'Tenant name', 200); bounded(input.userId, 'Staff ID', 200);
    const email = emailAddress(input.email);
    return transaction(this.pool, async (client) => {
      await client.query('INSERT INTO dripsign.tenant(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [input.tenantId, input.tenantName]);
      await client.query('INSERT INTO dripsign.staff_membership(tenant_id,user_id,email) VALUES($1,$2,$3) ON CONFLICT(tenant_id,user_id) DO NOTHING', [input.tenantId, input.userId, email]);
      const existing = await client.query('SELECT 1 FROM dripsign.staff_membership WHERE tenant_id=$1 AND user_id=$2 AND email=$3 AND revoked_at IS NULL', [input.tenantId,input.userId,email]);
      if (!existing.rowCount) throw new StoreError('conflict','Staff bootstrap conflicts with existing membership');
      return { kind: 'staff', tenantId: input.tenantId, userId: input.userId };
    });
  }
  async listAgreements(actor: Actor, limit = 50, beforeId: string | null = null): Promise<readonly Agreement[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new StoreError('invalid', 'Page size is invalid');
    return transaction(this.pool, async (client) => {
      if (actor.kind === 'recipient') {
        await this.authorize(client,actor,actor.agreementId);
        return (await client.query<Agreement>(`SELECT ${AGREEMENT_COLUMNS} FROM dripsign.agreement WHERE tenant_id=$1 AND id=$2 AND current_revision_id IS NOT NULL`, [actor.tenantId,actor.agreementId])).rows;
      }
      await this.staff(client,actor);
      return (await client.query<Agreement>(`SELECT ${AGREEMENT_COLUMNS} FROM dripsign.agreement WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT $3`, [actor.tenantId,beforeId,limit])).rows;
    });
  }
  async listAgreementInbox(actor:StaffActor,limit=50,beforeId:string|null=null):Promise<readonly AgreementInboxItem[]> {
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new StoreError('invalid','Page size is invalid');
    return transaction(this.pool,async(client)=>{
      await this.staff(client,actor);
      return (await client.query<AgreementInboxItem>(`WITH page AS (
        SELECT * FROM dripsign.agreement WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT $3
      ), latest_round AS (
        SELECT DISTINCT ON(r.agreement_id) r.id,r.agreement_id FROM dripsign.signing_round r JOIN page p ON p.tenant_id=r.tenant_id AND p.id=r.agreement_id WHERE r.tenant_id=$1 ORDER BY r.agreement_id,r.created_at DESC,r.id DESC
      ), signatures AS (
        SELECT r.agreement_id,count(s.grant_id)::int AS signed_count FROM latest_round r LEFT JOIN dripsign.signature s ON s.tenant_id=$1 AND s.round_id=r.id GROUP BY r.agreement_id
      ), required AS (
        SELECT r.agreement_id,count(s.grant_id)::int AS required_count FROM latest_round r LEFT JOIN dripsign.required_signer s ON s.tenant_id=$1 AND s.round_id=r.id GROUP BY r.agreement_id
      ) SELECT p.id,p.tenant_id AS "tenantId",p.title,p.status,p.version,p.draft_dirty AS \"publicationNeeded\",p.current_revision_id AS "currentRevisionId",p.created_at::text AS "createdAt",q.author_kind AS "pendingProposalAuthorKind",COALESCE(s.signed_count,0) AS "signedCount",COALESCE(r.required_count,0) AS "requiredCount"
       FROM page p LEFT JOIN dripsign.proposal q ON q.tenant_id=p.tenant_id AND q.agreement_id=p.id AND q.status='pending' LEFT JOIN signatures s ON s.agreement_id=p.id LEFT JOIN required r ON r.agreement_id=p.id ORDER BY p.id DESC`,[actor.tenantId,beforeId,limit])).rows;
    });
  }
  protected async detail(client: PoolClient, actor: Actor, agreementId: string, recoveryRoundId:string|null=null): Promise<AgreementDetail> {
    const agreement = recoveryRoundId?await this.lockedRecovery(client,actor.tenantId,agreementId,recoveryRoundId):await this.locked(client,actor,agreementId);
    const tenant = actor.tenantId;
    const grants = (await client.query<RecipientGrant>(`SELECT ${GRANT_COLUMNS} FROM dripsign.recipient_grant WHERE tenant_id=$1 AND agreement_id=$2 ORDER BY id LIMIT 100`, [tenant,agreementId])).rows;
    const revisions = (await client.query<Revision>(`SELECT ${REVISION_COLUMNS} FROM dripsign.revision WHERE tenant_id=$1 AND agreement_id=$2 ORDER BY number DESC LIMIT 100`, [tenant,agreementId])).rows;
    const proposals = (await client.query<Proposal>(`SELECT ${PROPOSAL_COLUMNS} FROM dripsign.proposal WHERE tenant_id=$1 AND agreement_id=$2 ORDER BY created_at DESC,id DESC LIMIT 200`, [tenant,agreementId])).rows;
    const messages = (await client.query<SharedMessage>('SELECT id,agreement_id AS "agreementId",author_kind AS "authorKind",author_id AS "authorId",body,created_at::text AS "createdAt" FROM dripsign.shared_message WHERE tenant_id=$1 AND agreement_id=$2 ORDER BY created_at DESC,id DESC LIMIT 200', [tenant,agreementId])).rows;
    const round = (await client.query<Omit<SigningRound,'requiredGrantIds'>>(`SELECT ${ROUND_COLUMNS} FROM dripsign.signing_round WHERE tenant_id=$1 AND agreement_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1`, [tenant,agreementId])).rows[0];
    const required = round ? (await client.query<{grant_id: string}>('SELECT grant_id FROM dripsign.required_signer WHERE tenant_id=$1 AND round_id=$2 ORDER BY grant_id LIMIT 100', [tenant,round.id])).rows.map((r) => r.grant_id) : [];
    const signatures = round ? (await client.query<Signature>('SELECT round_id AS "roundId",grant_id AS "grantId",provider_event_id AS "providerEventId",signed_at::text AS "signedAt" FROM dripsign.signature WHERE tenant_id=$1 AND round_id=$2 LIMIT 100', [tenant,round.id])).rows : [];
    const artifacts = round ? (await client.query<ArchivedArtifact>('SELECT id,round_id AS "roundId",kind,document,archived_at::text AS "archivedAt" FROM dripsign.archived_artifact WHERE tenant_id=$1 AND round_id=$2 LIMIT 2', [tenant,round.id])).rows : [];
    const privateAiMessages = !recoveryRoundId && actor.kind === 'staff' ? await this.privateMessages(client,actor,agreementId) : [];
    const actions: AgreementAction[] = ['message'];
    if(agreement.currentRevisionId || (actor.kind==='staff' && agreement.draft.document))actions.push('download');
    const issued= revisions.find((revision)=>revision.id===agreement.currentRevisionId);
    if(actor.kind==='staff' && agreement.status==='negotiating' && !agreement.publicationNeeded && issued && isIssuedDraft(agreement.draft,issued) && !proposals.some((p)=>p.status==='pending'))actions.push('request_signatures');
    if(actor.kind==='staff' && agreement.status==='signing')actions.push('cancel_signatures');
    const editable = agreement.status === 'draft' || agreement.status === 'negotiating';
    const pending = proposals.find((p) => p.status === 'pending');
    if (editable && agreement.currentRevisionId) {
      if (pending) { if (pending.authorKind !== actor.kind) actions.push('counter','accept','reject'); }
      else actions.push('propose');
    }
    if (actor.kind === 'staff' && editable) { actions.push('save_draft','ask_ai'); if (!pending && agreement.draft.preparationStatus==='ready' && agreement.draft.document) actions.push('publish'); }
    if (actor.kind === 'recipient' && round?.status === 'active' && required.includes(actor.grantId) && !signatures.some((s) => s.grantId === actor.grantId)) actions.push('sign');
    return {
      agreement: { id: agreement.id,tenantId: agreement.tenantId,title: agreement.title,status: agreement.status,version: agreement.version,currentRevisionId: agreement.currentRevisionId,publicationNeeded: agreement.publicationNeeded,createdAt: agreement.createdAt },
      draft: !recoveryRoundId && actor.kind === 'staff' ? agreement.draft : null,
      grants: actor.kind === 'staff' ? grants : grants.filter((g) => g.id === actor.grantId),
      revisions,proposals: actor.kind==='staff'?proposals:proposals.map((p)=>({...p,authorId:p.authorKind==='staff'?'staff':p.authorId})),messages:actor.kind==='staff'?messages:messages.map((m)=>({...m,authorId:m.authorKind==='staff'?'staff':m.authorId})), signingRound: round ? { ...round,requiredGrantIds: required } : null,
      signatures,artifacts,allowedActions: recoveryRoundId?[]:actions,privateAiMessages,
    };
  }
  protected async recoveryDetail(client:PoolClient,tenantId:string,agreementId:string,roundId:string):Promise<AgreementDetail> {
    return this.detail(client,{kind:'staff',tenantId,userId:'recovery'},agreementId,roundId);
  }
  async getBridgeCreatedAgreement(actor:StaffActor,subject:string,key:string,bodySha256:string):Promise<Agreement|null> {
    bounded(subject,'Creator subject',200);bounded(key,'Create key',200,8);
    if(actor.userId!==subject||!/^[a-f0-9]{64}$/.test(bodySha256))throw new StoreError('invalid','Create lookup is invalid');
    return transaction(this.pool,async(client)=>{
      await this.staff(client,actor);
      return (await client.query<Agreement>(`SELECT ${AGREEMENT_COLUMNS} FROM dripsign.agreement WHERE tenant_id=$1 AND create_provenance->>'subject'=$2 AND create_provenance->>'idempotencyKey'=$3 AND create_provenance->>'bodySha256'=$4 LIMIT 1`,[actor.tenantId,subject,key,bodySha256])).rows[0]??null;
    });
  }
  async getAgreement(actor: Actor, agreementId: string): Promise<AgreementDetail> { return transaction(this.pool,(client) => this.detail(client,actor,agreementId)); }
  async createAgreement(input: NewAgreement): Promise<Agreement> {
    bounded(input.title,'Title',300); bounded(input.idempotencyKey,'Idempotency key',200,8);
    if (input.recipients.length < 1 || input.recipients.length > 100 || !input.recipients.some((r) => r.requiredSigner)) throw new StoreError('invalid','At least one required signer is needed');
    if(input.createProvenance&&(input.createProvenance.tenantId!==input.actor.tenantId||input.createProvenance.subject!==input.actor.userId||input.createProvenance.idempotencyKey!==input.idempotencyKey||!/^[a-f0-9]{64}$/.test(input.createProvenance.bodySha256)))throw new StoreError('invalid','Create provenance is invalid');
    const emails = new Set<string>();
    for (const recipient of input.recipients) { const email = emailAddress(recipient.email); bounded(recipient.name,'Recipient name',200); if (emails.has(email)) throw new StoreError('invalid','Recipient is duplicated'); emails.add(email); }
    return transaction(this.pool, async (client) => {
      await this.staff(client,input.actor);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${input.actor.tenantId}:${actorKey(input.actor)}:create:${input.idempotencyKey}`]);
      const hash = createHash('sha256').update(canonicalJson(input)).digest('hex');
      const previous = (await client.query<{request_hash:string;result:Agreement}>('SELECT request_hash,result FROM dripsign.idempotency WHERE tenant_id=$1 AND actor_key=$2 AND operation=\'create\' AND key=$3',[input.actor.tenantId,actorKey(input.actor),input.idempotencyKey])).rows[0];
      if (previous) { if (previous.request_hash !== hash) throw new StoreError('conflict','Idempotency key was already used'); return previous.result; }
      const id = randomUUID(); draft(input.draft,input.actor.tenantId,id);
      const agreement = (await client.query<Agreement>(`INSERT INTO dripsign.agreement(tenant_id,id,title,draft,create_provenance) VALUES($1,$2,$3,$4,$5) RETURNING ${AGREEMENT_COLUMNS}`,[input.actor.tenantId,id,input.title,JSON.stringify(input.draft),input.createProvenance?JSON.stringify(input.createProvenance):null])).rows[0];
      if (!agreement) throw new Error('Agreement insert returned no row');
      for (const recipient of input.recipients) await client.query('INSERT INTO dripsign.recipient_grant(tenant_id,agreement_id,id,email,name,required_signer) VALUES($1,$2,$3,$4,$5,$6)',[input.actor.tenantId,id,randomUUID(),emailAddress(recipient.email),recipient.name,recipient.requiredSigner]);
      await client.query('INSERT INTO dripsign.idempotency(tenant_id,actor_key,operation,key,request_hash,result) VALUES($1,$2,\'create\',$3,$4,$5)',[input.actor.tenantId,actorKey(input.actor),input.idempotencyKey,hash,JSON.stringify(agreement)]);
      return agreement;
    });
  }
  async saveDraft(command: Mutation, value: DocumentDraft): Promise<Agreement> {
    draft(value,command.actor.tenantId,command.agreementId);
    return this.mutate(command,'save_draft',value,async (client,agreement) => {
      this.requireEditable(agreement.status);
      if (command.actor.kind !== 'staff') throw new StoreError('forbidden','Staff permission is required');
      await client.query('UPDATE dripsign.agreement SET draft=$3,draft_dirty=true WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,agreement.id,JSON.stringify(value)]);
      return this.bump(client,agreement);
    });
  }
  protected requireEditable(status: Agreement['status']): void { if (status !== 'draft' && status !== 'negotiating') throw new StoreError('conflict','Agreement is not open for changes'); }
  async proposeChange(command: Mutation, change: ProposalChange): Promise<Proposal> { return this.proposal(command,change,false); }
  async counterProposal(command: Mutation, change: ProposalChange): Promise<Proposal> { return this.proposal(command,change,true); }
  private async proposal(command: Mutation, change: ProposalChange, counter: boolean): Promise<Proposal> {
    bounded(change.text,'Proposal',20000); source(change.replacementSource);
    return this.mutate(command,counter?'counter':'propose',change,async (client,agreement) => {
      this.requireEditable(agreement.status);
      if (!agreement.currentRevisionId) throw new StoreError('conflict','Publish a revision before negotiation');
      const pending = (await client.query<Proposal>(`SELECT ${PROPOSAL_COLUMNS} FROM dripsign.proposal WHERE tenant_id=$1 AND agreement_id=$2 AND status='pending' FOR UPDATE`,[agreement.tenantId,agreement.id])).rows[0];
      if (counter) {
        if (!pending || pending.id !== change.supersedesId || pending.authorKind === command.actor.kind) throw new StoreError('conflict','Counterproposal turn changed');
        await client.query('UPDATE dripsign.proposal SET status=\'superseded\' WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,pending.id]);
      } else if (pending || change.supersedesId) throw new StoreError('conflict','A proposal is already pending');
      const revision = (await client.query<{source: DocumentDraft['source']}>('SELECT source FROM dripsign.revision WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,agreement.currentRevisionId])).rows[0];
      const result = (await client.query<Proposal>(`INSERT INTO dripsign.proposal(tenant_id,agreement_id,id,base_revision_id,author_kind,author_id,text,replacement_source,original_source,supersedes_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${PROPOSAL_COLUMNS}`,[agreement.tenantId,agreement.id,randomUUID(),agreement.currentRevisionId,command.actor.kind,command.actor.kind==='staff'?command.actor.userId:command.actor.grantId,change.text,JSON.stringify(change.replacementSource),JSON.stringify(revision?.source ?? null),change.supersedesId])).rows[0];
      if (!result) throw new Error('Proposal insert returned no row');
      await this.bump(client,agreement); return result;
    });
  }
  async acceptProposal(command: Mutation, proposalId: string): Promise<Agreement> { return this.resolveProposal(command,proposalId,true); }
  async rejectProposal(command: Mutation, proposalId: string): Promise<Agreement> { return this.resolveProposal(command,proposalId,false); }
  private async resolveProposal(command: Mutation, proposalId: string, accept: boolean): Promise<Agreement> {
    return this.mutate(command,accept?'accept':'reject',{proposalId},async (client,agreement) => {
      this.requireEditable(agreement.status);
      const proposal = (await client.query<Proposal>(`SELECT ${PROPOSAL_COLUMNS} FROM dripsign.proposal WHERE tenant_id=$1 AND agreement_id=$2 AND id=$3 AND status='pending' FOR UPDATE`,[agreement.tenantId,agreement.id,proposalId])).rows[0];
      if (!proposal || proposal.baseRevisionId !== agreement.currentRevisionId || proposal.authorKind === command.actor.kind) throw new StoreError('conflict','Proposal turn changed');
      if (accept && proposal.replacementSource) {
        await client.query('UPDATE dripsign.agreement SET draft=$3,draft_dirty=true WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,agreement.id,JSON.stringify({source:proposal.replacementSource,document:null,originalDocument:null,signingFields:[],requiredGrantIds:[],preparationStatus:'empty',preparationError:null})]);
      }
      if(accept)await client.query('UPDATE dripsign.agreement SET draft_dirty=true WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,agreement.id]);
      await client.query('UPDATE dripsign.proposal SET status=$3 WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,proposal.id,accept?'accepted':'rejected']);
      return this.bump(client,agreement);
    });
  }
  async publishRevision(command: Mutation, value: PublishRevision): Promise<Revision> {
    asset(value.document,command.actor.tenantId,command.agreementId); source(value.source);
    return this.mutate(command,'publish',value,async (client,agreement) => {
      this.requireEditable(agreement.status);
      if (command.actor.kind !== 'staff') throw new StoreError('forbidden','Staff permission is required');
      if (agreement.draft.preparationStatus!=='ready' || !agreement.draft.document || agreement.draft.document.sha256 !== value.document.sha256 || agreement.draft.document.objectKey !== value.document.objectKey || canonicalJson(agreement.draft.source) !== canonicalJson(value.source) || canonicalJson(agreement.draft.signingFields) !== canonicalJson(value.signingFields) || canonicalJson(agreement.draft.requiredGrantIds) !== canonicalJson(value.requiredGrantIds)) throw new StoreError('conflict','Review the prepared draft before publishing');
      const required=(await client.query<{id:string}>('SELECT id FROM dripsign.recipient_grant WHERE tenant_id=$1 AND agreement_id=$2 AND required_signer=true AND revoked_at IS NULL ORDER BY id FOR SHARE',[agreement.tenantId,agreement.id])).rows.map((r)=>r.id);
      if (!required.length || required.length !== value.requiredGrantIds.length || required.some((id)=>!value.requiredGrantIds.includes(id)) || value.signingFields.some((f)=>!required.includes(f.grantId)) || required.some((id)=>!value.signingFields.some((f)=>f.grantId===id&&f.type==='signature'))) throw new StoreError('conflict','Required parties changed');
      if ((await client.query('SELECT 1 FROM dripsign.proposal WHERE tenant_id=$1 AND agreement_id=$2 AND status=\'pending\'',[agreement.tenantId,agreement.id])).rowCount) throw new StoreError('conflict','Resolve the pending proposal first');
      const result = (await client.query<Revision>(`INSERT INTO dripsign.revision(tenant_id,agreement_id,id,number,document,source,signing_fields,required_grant_ids) SELECT $1,$2,$3,COALESCE(MAX(number),0)+1,$4,$5,$6,$7 FROM dripsign.revision WHERE tenant_id=$1 AND agreement_id=$2 RETURNING ${REVISION_COLUMNS}`,[agreement.tenantId,agreement.id,randomUUID(),JSON.stringify(value.document),JSON.stringify(value.source),JSON.stringify(value.signingFields),value.requiredGrantIds])).rows[0];
      if (!result) throw new Error('Revision insert returned no row');
      await client.query('UPDATE dripsign.agreement SET current_revision_id=$3,status=\'negotiating\',draft=$4,draft_dirty=false,version=version+1 WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,agreement.id,result.id,JSON.stringify({document:value.document,originalDocument:agreement.draft.originalDocument,source:value.source,signingFields:value.signingFields,requiredGrantIds:value.requiredGrantIds,preparationStatus:'ready',preparationError:null})]);
      const grants = (await client.query<RecipientGrant>(`SELECT ${GRANT_COLUMNS} FROM dripsign.recipient_grant WHERE tenant_id=$1 AND agreement_id=$2 AND revoked_at IS NULL LIMIT 100`,[agreement.tenantId,agreement.id])).rows;
      for (const grant of grants) await this.enqueue(client,{tenantId:agreement.tenantId,agreementId:agreement.id,kind:'revision_published',dedupeKey:`revision:${result.id}:${grant.id}`,payload:{grantId:grant.id,revisionId:result.id}});
      return result;
    });
  }
  async addMessage(command: Mutation, body: string): Promise<SharedMessage> {
    bounded(body,'Message',20000);
    return this.mutate(command,'message',{body},async (client,agreement) => {
      const message = (await client.query<SharedMessage>('INSERT INTO dripsign.shared_message(tenant_id,agreement_id,id,author_kind,author_id,body) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,agreement_id AS "agreementId",author_kind AS "authorKind",author_id AS "authorId",body,created_at::text AS "createdAt"',[agreement.tenantId,agreement.id,randomUUID(),command.actor.kind,command.actor.kind==='staff'?command.actor.userId:command.actor.grantId,body])).rows[0];
      if (!message) throw new Error('Message insert returned no row'); return message;
    });
  }
  protected async privateMessages(client: PoolClient, actor: StaffActor, agreementId: string): Promise<readonly PrivateAiMessage[]> {
    return (await client.query<PrivateAiMessage>('SELECT id,agreement_id AS "agreementId",user_id AS "userId",role,body,created_at::text AS "createdAt" FROM dripsign.private_ai_message WHERE tenant_id=$1 AND agreement_id=$2 AND user_id=$3 ORDER BY created_at DESC,id DESC LIMIT 100',[actor.tenantId,agreementId,actor.userId])).rows;
  }
  async getPrivateAiMessages(actor: StaffActor, agreementId: string): Promise<readonly PrivateAiMessage[]> { return transaction(this.pool,async(client)=>{await this.locked(client,actor,agreementId);return this.privateMessages(client,actor,agreementId);}); }
  async recordPrivateAiMessage(command: Mutation, role: PrivateAiMessage['role'], body: string, fence?: import('./types.ts').JobFence): Promise<PrivateAiMessage> {
    bounded(body,'AI message',500000);
    return this.mutate(command,'private_ai',{role,body},async(client,agreement)=>{
      if(command.actor.kind!=='staff') throw new StoreError('forbidden','Staff permission is required');
      const row=(await client.query<PrivateAiMessage>('INSERT INTO dripsign.private_ai_message(tenant_id,agreement_id,id,user_id,role,body) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,agreement_id AS "agreementId",user_id AS "userId",role,body,created_at::text AS "createdAt"',[agreement.tenantId,agreement.id,randomUUID(),command.actor.userId,role,body])).rows[0];
      if(!row) throw new Error('AI insert returned no row');return row;
    },fence);
  }
  async requestPrivateSuggestion(command: Mutation,instruction: string):Promise<string> {
    bounded(instruction,'AI instruction',20000);
    return this.mutate(command,'request_ai',{instruction},async(client,agreement)=>{
      if(command.actor.kind!=='staff')throw new StoreError('forbidden','Staff permission is required');
      this.requireEditable(agreement.status);
      if(!agreement.draft.source)throw new StoreError('conflict','Editable source is required');
      return this.enqueue(client,{tenantId:agreement.tenantId,agreementId:agreement.id,kind:'ai_suggestion',dedupeKey:this.derivedKey('ai',`${command.actor.userId}:${command.idempotencyKey}`),payload:{mutation:{...command,idempotencyKey:this.derivedKey('ai:result',command.idempotencyKey)},instruction,source:agreement.draft.source}});
    });
  }
  async queueUploadedPdf(command:Mutation,originalDocument:DocumentAsset):Promise<string> {
    asset(originalDocument,command.actor.tenantId,command.agreementId);
    return this.mutate(command,'queue_pdf',originalDocument,async(client,agreement)=>{
      if(command.actor.kind!=='staff')throw new StoreError('forbidden','Staff permission is required');
      this.requireEditable(agreement.status);
      const requiredGrantIds=(await client.query<{id:string}>('SELECT id FROM dripsign.recipient_grant WHERE tenant_id=$1 AND agreement_id=$2 AND required_signer=true AND revoked_at IS NULL ORDER BY id FOR SHARE',[agreement.tenantId,agreement.id])).rows.map((r)=>r.id);
      if(!requiredGrantIds.length)throw new StoreError('conflict','At least one required signer is needed');
      if((await client.query('SELECT 1 FROM dripsign.outbox WHERE tenant_id=$1 AND dedupe_key=$2',[agreement.tenantId,`pdf:prepare:${agreement.id}:${originalDocument.sha256}`])).rowCount)throw new StoreError('conflict','This uploaded document was already processed');
      const value:DocumentDraft={source:null,originalDocument,document:null,signingFields:[],requiredGrantIds,preparationStatus:'preparing',preparationError:null};
      await client.query('UPDATE dripsign.agreement SET draft=$3,draft_dirty=true,version=version+1 WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,agreement.id,JSON.stringify(value)]);
      return this.enqueue(client,{tenantId:agreement.tenantId,agreementId:agreement.id,kind:'pdf_prepare',dedupeKey:`pdf:prepare:${agreement.id}:${originalDocument.sha256}`,payload:{mutation:{...command,expectedVersion:agreement.version+1,idempotencyKey:this.derivedKey('pdf:result',command.idempotencyKey)},originalDocument,requiredGrantIds}});
    });
  }
  async completePdfPreparation(fence:JobFence,payload:PdfPreparationJobPayload,result:PdfPreparationResult):Promise<Agreement> {
    asset(result.document,payload.mutation.actor.tenantId,payload.mutation.agreementId);
    return this.mutate(payload.mutation,'complete_pdf',{originalDocument:payload.originalDocument,result},async(client,agreement)=>{
      if(payload.mutation.actor.kind!=='staff'||agreement.draft.preparationStatus!=='preparing'||agreement.draft.originalDocument?.sha256!==payload.originalDocument.sha256||agreement.draft.originalDocument.objectKey!==payload.originalDocument.objectKey)throw new StoreError('conflict','Uploaded document changed');
      this.requireEditable(agreement.status);
      const current=(await client.query<{id:string}>('SELECT id FROM dripsign.recipient_grant WHERE tenant_id=$1 AND agreement_id=$2 AND required_signer=true AND revoked_at IS NULL ORDER BY id FOR SHARE',[agreement.tenantId,agreement.id])).rows.map((r)=>r.id);
      if(canonicalJson(current)!==canonicalJson(payload.requiredGrantIds)||canonicalJson(current)!==canonicalJson(result.requiredGrantIds))throw new StoreError('conflict','Required parties changed');
      const value:DocumentDraft={...agreement.draft,document:result.document,signingFields:result.signingFields,requiredGrantIds:result.requiredGrantIds,preparationStatus:'ready',preparationError:null};
      draft(value,agreement.tenantId,agreement.id);
      await client.query('UPDATE dripsign.agreement SET draft=$3,draft_dirty=true WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,agreement.id,JSON.stringify(value)]);
      return this.bump(client,agreement);
    },fence);
  }
  async failPdfPreparation(fence:JobFence,payload:PdfPreparationJobPayload,reason:string):Promise<boolean> {
    bounded(reason,'Document processing failure',100);
    return transaction(this.pool,async(client)=>{
      await this.fence(client,fence);
      if(payload.mutation.actor.kind!=='staff'||payload.mutation.actor.tenantId!==fence.tenantId)throw new StoreError('forbidden','Staff permission is required');
      const job=(await client.query<{agreement_id:string}>('SELECT agreement_id FROM dripsign.outbox WHERE tenant_id=$1 AND id=$2',[fence.tenantId,fence.id])).rows[0];
      if(job?.agreement_id!==payload.mutation.agreementId)throw new StoreError('not_found','Resource not found');
      const agreement=await this.locked(client,payload.mutation.actor,payload.mutation.agreementId);
      if(agreement.draft.preparationStatus!=='preparing'||agreement.draft.originalDocument?.sha256!==payload.originalDocument.sha256||agreement.draft.originalDocument.objectKey!==payload.originalDocument.objectKey)return false;
      await client.query('UPDATE dripsign.agreement SET draft=$3,draft_dirty=true,version=version+1 WHERE tenant_id=$1 AND id=$2',[agreement.tenantId,agreement.id,JSON.stringify({...agreement.draft,preparationStatus:'failed',preparationError:reason})]);
      return true;
    });
  }
}
