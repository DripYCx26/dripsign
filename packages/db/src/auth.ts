import { randomUUID, timingSafeEqual } from 'node:crypto';
import { transaction } from './connection.ts';
import { SigningStore } from './signing.ts';
import { bounded, emailAddress } from './validation.ts';
import { StoreError } from './types.ts';
import type { Agreement, AuthScope, AuthSession, BridgeAssertion, EmailMessage, OtpChallenge, OtpConsumption, RecipientActor, RecipientMailboxActor, StaffActor } from './types.ts';
import type { PoolClient } from 'pg';

export class AuthStore extends SigningStore {
  async findStaffScope(tenantId: string,email:string):Promise<AuthScope|null> {
    const address=emailAddress(email);
    return transaction(this.pool,async(client)=>{
      const exists=(await client.query('SELECT 1 FROM dripsign.staff_membership WHERE tenant_id=$1 AND email=$2 AND revoked_at IS NULL',[tenantId,address])).rowCount;
      return exists?{kind:'staff',tenantId,email:address}:null;
    });
  }
  async findRecipientScope(email:string):Promise<AuthScope|null> {
    const address=emailAddress(email);
    return transaction(this.pool,async(client)=>{
      const exists=(await client.query('SELECT 1 FROM dripsign.recipient_grant WHERE email=$1 AND revoked_at IS NULL LIMIT 1',[address])).rowCount;
      return exists?{kind:'recipient',email:address}:null;
    });
  }
  async resolveRecipientActor(mailbox:RecipientMailboxActor,agreementId:string):Promise<RecipientActor> {
    const email=emailAddress(mailbox.email);
    return transaction(this.pool,async(client)=>{
      const grant=(await client.query<{tenant_id:string;id:string}>('SELECT tenant_id,id FROM dripsign.recipient_grant WHERE agreement_id=$1 AND email=$2 AND revoked_at IS NULL LIMIT 1',[agreementId,email])).rows[0];
      if(!grant)throw new StoreError('not_found','Resource not found');
      return {kind:'recipient',tenantId:grant.tenant_id,agreementId,grantId:grant.id,email};
    });
  }
  async listRecipientAgreements(mailbox:RecipientMailboxActor,limit=50,beforeId:string|null=null):Promise<readonly Agreement[]> {
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new StoreError('invalid','Page size is invalid');
    return transaction(this.pool,async(client)=>(await client.query<Agreement>(`SELECT a.id,a.tenant_id AS "tenantId",a.title,a.status,a.version,a.draft_dirty AS "publicationNeeded",a.current_revision_id AS "currentRevisionId",a.created_at::text AS "createdAt" FROM dripsign.agreement a JOIN dripsign.recipient_grant g ON g.tenant_id=a.tenant_id AND g.agreement_id=a.id WHERE g.email=$1 AND g.revoked_at IS NULL AND a.current_revision_id IS NOT NULL AND ($2::uuid IS NULL OR a.id<$2) ORDER BY a.id DESC LIMIT $3`,[emailAddress(mailbox.email),beforeId,limit])).rows);
  }
  private async scopeActor(client:PoolClient,scope:AuthScope):Promise<StaffActor|RecipientMailboxActor|null> {
    if(scope.kind==='recipient') {
      const grant=(await client.query('SELECT 1 FROM dripsign.recipient_grant WHERE email=$1 AND revoked_at IS NULL LIMIT 1',[emailAddress(scope.email)])).rowCount;
      return grant?{kind:'recipient',email:emailAddress(scope.email)}:null;
    }
    const membership=(await client.query<{user_id:string}>('SELECT user_id FROM dripsign.staff_membership WHERE tenant_id=$1 AND email=$2 AND revoked_at IS NULL FOR SHARE',[scope.tenantId,emailAddress(scope.email)])).rows[0];
    return membership?{kind:'staff',tenantId:scope.tenantId,userId:membership.user_id}:null;
  }
  async issueOtpChallenge(challenge:OtpChallenge,message?:EmailMessage):Promise<boolean> {
    const email=emailAddress(challenge.scope.email);bounded(challenge.codeHash,'Code hash',128,64);
    if(!/^[a-f0-9]{64}$/.test(challenge.challengeTokenHash))throw new StoreError('invalid','Challenge token hash is invalid');
    const expiry=Date.parse(challenge.expiresAt);
    if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+15*60_000)throw new StoreError('invalid','Challenge expiry is invalid');
    return transaction(this.pool,async(client)=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`otp:${email}`]);
      const recent=(await client.query<{count:string}>('SELECT count(*)::text AS count FROM dripsign.otp_request WHERE email=$1 AND created_at>now()-interval \'15 minutes\'',[email])).rows[0];
      if(Number(recent?.count??0)>=5)throw new StoreError('rate_limited','Please wait before requesting another code');
      await client.query('INSERT INTO dripsign.otp_request(id,email) VALUES($1,$2)',[randomUUID(),email]);
      const actor=await this.scopeActor(client,challenge.scope);
      if(!actor)return false;
      let tenantId:string;
      if(actor.kind==='staff')tenantId=actor.tenantId;
      else {
        const grant=(await client.query<{tenant_id:string}>('SELECT tenant_id FROM dripsign.recipient_grant WHERE email=$1 AND revoked_at IS NULL ORDER BY tenant_id LIMIT 1',[email])).rows[0];
        if(!grant)return false;tenantId=grant.tenant_id;
      }
      await client.query('INSERT INTO dripsign.otp_challenge(tenant_id,id,scope,email,code_hash,challenge_token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[actor.kind==='staff'?tenantId:null,challenge.id,JSON.stringify(challenge.scope),email,challenge.codeHash,challenge.challengeTokenHash,challenge.expiresAt]);
      if(message) {
        if(emailAddress(message.to)!==email)throw new StoreError('invalid','Challenge recipient is invalid');
        bounded(message.subject,'Subject',300);bounded(message.text,'Email body',20000);
        await this.enqueue(client,{tenantId,agreementId:null,kind:'otp',dedupeKey:`otp:${challenge.id}`,payload:{email:message,expiresAt:challenge.expiresAt}});
      }
      return true;
    });
  }
  async consumeOtpChallenge(input:OtpConsumption):Promise<AuthSession|null> {
    bounded(input.codeHash,'Code hash',128,64);
    if(!/^[a-f0-9]{64}$/.test(input.challengeTokenHash))throw new StoreError('invalid','Challenge token hash is invalid');bounded(input.sessionTokenHash,'Session hash',128,64);
    const expiry=Date.parse(input.sessionExpiresAt);
    if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+24*60*60_000)throw new StoreError('invalid','Session expiry is invalid');
    return transaction(this.pool,async(client)=>{
      const row=(await client.query<{scope:AuthScope;code_hash:string;attempts:number}>('SELECT scope,code_hash,attempts FROM dripsign.otp_challenge WHERE id=$1 AND challenge_token_hash=$2 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE',[input.challengeId,input.challengeTokenHash])).rows[0];
      if(!row||row.attempts>=5)return null;
      await client.query('UPDATE dripsign.otp_challenge SET attempts=attempts+1 WHERE id=$1',[input.challengeId]);
      const provided=Buffer.from(input.codeHash,'utf8'),stored=Buffer.from(row.code_hash,'utf8');
      if(provided.length!==stored.length||!timingSafeEqual(provided,stored))return null;
      const actor=await this.scopeActor(client,row.scope);
      if(!actor)return null;
      const id=randomUUID();
      await client.query('UPDATE dripsign.otp_challenge SET consumed_at=now() WHERE id=$1',[input.challengeId]);
      await client.query('INSERT INTO dripsign.auth_session(tenant_id,id,token_hash,actor,expires_at) VALUES($1,$2,$3,$4,$5)',[actor.kind==='staff'?actor.tenantId:null,id,input.sessionTokenHash,JSON.stringify(actor),input.sessionExpiresAt]);
      return {id,actor,expiresAt:input.sessionExpiresAt};
    });
  }
  async findSession(tokenHash:string):Promise<AuthSession|null> {
    bounded(tokenHash,'Session hash',128,64);
    return transaction(this.pool,async(client)=>{
      const session=(await client.query<AuthSession>('SELECT id,actor,expires_at::text AS "expiresAt" FROM dripsign.auth_session WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()',[tokenHash])).rows[0];
      if(!session)return null;
      if(session.actor.kind==='staff') { await this.staff(client,session.actor);return session; }
      return session;
    });
  }
  async getSession(tenantId:string,tokenHash:string):Promise<AuthSession|null> {
    const session=await this.findSession(tokenHash);
    return session?.actor.kind==='staff'&&session.actor.tenantId===tenantId?session:null;
  }
  async revokeSession(tokenHash:string):Promise<void> {
    await transaction(this.pool,async(client)=>{await client.query('UPDATE dripsign.auth_session SET revoked_at=now() WHERE token_hash=$1',[tokenHash]);});
  }
  async consumeBridgeAssertion(assertion:BridgeAssertion):Promise<boolean> {
    bounded(assertion.nonce,'Bridge nonce',200,16);bounded(assertion.operation,'Bridge operation',100);bounded(assertion.path,'Bridge path',1000);
    if(!/^[a-f0-9]{64}$/.test(assertion.bodyHash)||!Number.isFinite(Date.parse(assertion.expiresAt))||Date.parse(assertion.expiresAt)<=Date.now()||Date.parse(assertion.expiresAt)>Date.now()+30_000)throw new StoreError('invalid','Bridge assertion is invalid');
    return transaction(this.pool,async(client)=>{
      await this.staff(client,assertion.actor);
      if(assertion.agreementId)await this.locked(client,assertion.actor,assertion.agreementId);
      const row=await client.query('INSERT INTO dripsign.bridge_nonce(tenant_id,nonce,assertion,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,nonce) DO NOTHING',[assertion.actor.tenantId,assertion.nonce,JSON.stringify(assertion),assertion.expiresAt]);
      return Boolean(row.rowCount);
    });
  }
}
