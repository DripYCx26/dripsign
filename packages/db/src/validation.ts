import { canonicalJson } from './json.ts';
import { StoreError } from './types.ts';
import type { DocumentAsset, DocumentDraft, DocumentSource, Revision } from './types.ts';

export function bounded(value: string, name: string, max: number, min = 1): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) throw new StoreError('invalid', `${name} is invalid`);
  return value;
}
export function emailAddress(value: string): string {
  const email = bounded(value.trim().toLowerCase(), 'Email', 320, 3);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new StoreError('invalid', 'Email is invalid');
  return email;
}
export function asset(value: DocumentAsset, tenantId: string, agreementId: string): void {
  bounded(value.objectKey, 'Document key', 1000);
  if (!value.objectKey.startsWith(`tenants/${tenantId}/agreements/${agreementId}/`) || value.objectKey.includes('..') || value.objectKey.includes('\\') || value.objectKey.includes('//')) throw new StoreError('invalid', 'Document scope is invalid');
  if (!/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1 || value.byteLength > 25_000_000 || value.contentType !== 'application/pdf') throw new StoreError('invalid', 'Document is invalid');
}
export function source(value: DocumentSource | null): void {
  if (value === null) return;
  bounded(value.title, 'Document title', 300);
  if (!Array.isArray(value.sections) || value.sections.length < 1 || value.sections.length > 200) throw new StoreError('invalid', 'Document sections are invalid');
  const ids = new Set<string>();
  for (const section of value.sections) {
    bounded(section.id, 'Section ID', 100); bounded(section.heading, 'Section heading', 300, 0);
    if (ids.has(section.id) || !Array.isArray(section.paragraphs) || section.paragraphs.length > 200) throw new StoreError('invalid', 'Document section is invalid');
    ids.add(section.id);
    for (const paragraph of section.paragraphs) bounded(paragraph, 'Paragraph', 20000, 0);
  }
  if (JSON.stringify(value).length > 500000) throw new StoreError('invalid', 'Document source is too large');
}
export function draft(value: DocumentDraft, tenantId: string, agreementId: string): void {
  source(value.source);
  if (value.document !== null) asset(value.document, tenantId, agreementId);
  if (value.originalDocument !== null) asset(value.originalDocument, tenantId, agreementId);
  signingFields(value.signingFields,value.requiredGrantIds);
}

function object(value: unknown, keys: readonly string[]): Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new StoreError('invalid','Job payload is invalid');
  const record:Record<string,unknown>=Object.fromEntries(Object.entries(value));
  if(Object.keys(record).some((key)=>!keys.includes(key))||keys.some((key)=>!(key in record)))throw new StoreError('invalid','Job payload fields are invalid');
  return record;
}
function stringField(value: unknown,max=200): string {
  if(typeof value!=='string')throw new StoreError('invalid','Job string is invalid');return bounded(value,'Job field',max);
}
export function jobMutation(value:unknown): import('./types.ts').Mutation {
  const data=object(value,['actor','agreementId','expectedVersion','idempotencyKey']);
  const actor=object(data.actor,['kind','tenantId','userId']);
  if(actor.kind!=='staff'||typeof data.expectedVersion!=='number'||!Number.isSafeInteger(data.expectedVersion)||data.expectedVersion<1)throw new StoreError('invalid','Job authority is invalid');
  return {actor:{kind:'staff',tenantId:stringField(actor.tenantId),userId:stringField(actor.userId)},agreementId:stringField(data.agreementId),expectedVersion:data.expectedVersion,idempotencyKey:bounded(stringField(data.idempotencyKey),'Job key',200,8)};
}
export function parseMailJobPayload(value:unknown): import('./types.ts').MailJobPayload {
  const data=object(value,['email','expiresAt']),message=object(data.email,['to','subject','text']);
  if(data.expiresAt!==null&&(typeof data.expiresAt!=='string'||!Number.isFinite(Date.parse(data.expiresAt))))throw new StoreError('invalid','Mail expiry is invalid');
  return {email:{to:emailAddress(stringField(message.to,320)),subject:stringField(message.subject,300),text:stringField(message.text,20000)},expiresAt:data.expiresAt};
}
export function parseSigningJobPayload(value:unknown): import('./types.ts').SigningJobPayload {
  const data=object(value,['mutation','roundId','fields']);
  if(!Array.isArray(data.fields)||data.fields.length>1000)throw new StoreError('invalid','Signing fields are invalid');
  const fields:import('./types.ts').SigningField[]=data.fields.map((value:unknown)=>{
    const field=object(value,['grantId','type','page','x','y','width','height']);
    if(field.type!=='signature'&&field.type!=='date'&&field.type!=='text')throw new StoreError('invalid','Signing field type is invalid');
    if(typeof field.page!=='number'||!Number.isInteger(field.page)||field.page<1||field.page>500)throw new StoreError('invalid','Signing page is invalid');
    for(const key of ['x','y','width','height'])if(typeof field[key]!=='number'||!Number.isFinite(field[key])||field[key]<0||field[key]>1)throw new StoreError('invalid','Signing coordinates are invalid');
    // SAFETY: each coordinate was narrowed to a finite bounded number above.
    const x=field.x as number,y=field.y as number,width=field.width as number,height=field.height as number;
    if(width<=0||height<=0||x+width>1||y+height>1)throw new StoreError('invalid','Signing bounds are invalid');
    return {grantId:stringField(field.grantId),type:field.type,page:field.page,x,y,width,height};
  });
  return {mutation:jobMutation(data.mutation),roundId:stringField(data.roundId),fields};
}
export function parseAiJobPayload(value:unknown): import('./types.ts').AiJobPayload {
  const data=object(value,['mutation','instruction','source']);
  const raw=object(data.source,['title','sections']);
  if(!Array.isArray(raw.sections))throw new StoreError('invalid','Document source is invalid');
  const document:DocumentSource={title:stringField(raw.title,300),sections:raw.sections.map((item:unknown)=>{
    const section=object(item,['id','heading','paragraphs']);
    if(typeof section.heading!=='string'||!Array.isArray(section.paragraphs)||section.paragraphs.some((p:unknown)=>typeof p!=='string'))throw new StoreError('invalid','Document section is invalid');
    return {id:stringField(section.id,100),heading:section.heading,paragraphs:section.paragraphs.map((p:unknown)=>stringField(p,20000))};
  })};
  source(document);
  return {mutation:jobMutation(data.mutation),instruction:stringField(data.instruction,20000),source:document};
}

export function signingFields(fields: readonly import('./types.ts').SigningField[],grantIds: readonly string[]):void {
  if(!Array.isArray(fields)||fields.length>1000||!Array.isArray(grantIds)||grantIds.length>100||new Set(grantIds).size!==grantIds.length)throw new StoreError('invalid','Signing preview is invalid');
  for(const field of fields) {
    if(!Number.isInteger(field.page)||field.page<1||field.page>500||![field.x,field.y,field.width,field.height].every((v)=>Number.isFinite(v)&&v>=0&&v<=1)||field.width===0||field.height===0||field.x+field.width>1||field.y+field.height>1||!grantIds.includes(field.grantId)||!['signature','date','text'].includes(field.type))throw new StoreError('invalid','Signing field is invalid');
  }
  if(grantIds.some((id)=>!fields.some((f)=>f.grantId===id&&f.type==='signature')))throw new StoreError('invalid','A required signature field is missing');
}

export function parsePdfPreparationJobPayload(value:unknown): import('./types.ts').PdfPreparationJobPayload {
  const data=object(value,['mutation','originalDocument','requiredGrantIds']);
  const command=jobMutation(data.mutation),raw=object(data.originalDocument,['objectKey','sha256','byteLength','contentType']);
  if(typeof raw.byteLength!=='number'||raw.contentType!=='application/pdf'||!Array.isArray(data.requiredGrantIds)||data.requiredGrantIds.length<1||data.requiredGrantIds.length>100)throw new StoreError('invalid','PDF preparation payload is invalid');
  const document:DocumentAsset={objectKey:stringField(raw.objectKey,1000),sha256:stringField(raw.sha256,64),byteLength:raw.byteLength,contentType:'application/pdf'};
  asset(document,command.actor.tenantId,command.agreementId);
  const requiredGrantIds=data.requiredGrantIds.map((id:unknown)=>stringField(id));
  if(new Set(requiredGrantIds).size!==requiredGrantIds.length)throw new StoreError('invalid','Required parties are invalid');
  return {mutation:command,originalDocument:document,requiredGrantIds};
}

export function isIssuedDraft(draft:DocumentDraft,revision:Pick<Revision,'document'|'source'|'signingFields'|'requiredGrantIds'>):boolean {
  return draft.preparationStatus==='ready'&&draft.document!==null&&canonicalJson(draft.document)===canonicalJson(revision.document)
    &&canonicalJson(draft.source)===canonicalJson(revision.source)&&canonicalJson(draft.signingFields)===canonicalJson(revision.signingFields)
    &&canonicalJson(draft.requiredGrantIds)===canonicalJson(revision.requiredGrantIds);
}
