import { AzureBlobDocumentStorage } from './azureBlob.ts';
import { AzureCommunicationMail } from './azureMail.ts';
import type { EmailSender } from './email.ts';
import { SesEmailClient } from './email.ts';
import type { ManagedIdentity } from './managedIdentity.ts';
import type { DocumentStorage } from './storage.ts';
import { S3DocumentStorage } from './storage.ts';

type Environment = Readonly<Record<string, string | undefined>>;

export type StorageSettings =
  | { readonly provider: 's3'; readonly region: string; readonly bucket: string; readonly kmsKeyId: string | undefined }
  | { readonly provider: 'azure'; readonly endpoint: string; readonly container: string; readonly identity: ManagedIdentity };

export type MailSettings =
  | { readonly provider: 'ses'; readonly region: string; readonly from: string }
  | { readonly provider: 'azure'; readonly endpoint: string; readonly from: string; readonly identity: ManagedIdentity };

function required(env: Environment, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing provider configuration: ${key}`);
  return value;
}

function choice<T extends string>(env: Environment, key: string, values: readonly T[]): T {
  const value = env[key]?.trim() || values[0];
  if (!values.includes(value as T)) throw new Error(`Invalid provider configuration: ${key}`);
  return value as T;
}

function managedIdentity(env: Environment): ManagedIdentity {
  return { endpoint: required(env, 'IDENTITY_ENDPOINT'), header: required(env, 'IDENTITY_HEADER'), clientId: required(env, 'AZURE_CLIENT_ID') };
}

/** `DRIPSIGN_STORAGE_PROVIDER` chooses the document store: `s3` (default) or `azure`. */
export function readStorageSettings(env: Environment): StorageSettings {
  return choice(env, 'DRIPSIGN_STORAGE_PROVIDER', ['s3', 'azure']) === 's3'
    ? { provider: 's3', region: required(env, 'AWS_REGION'), bucket: required(env, 'DRIPSIGN_DOCUMENT_BUCKET'), kmsKeyId: env['DRIPSIGN_KMS_KEY_ID']?.trim() || undefined }
    : { provider: 'azure', endpoint: required(env, 'DRIPSIGN_BLOB_ENDPOINT'), container: required(env, 'DRIPSIGN_DOCUMENT_CONTAINER'), identity: managedIdentity(env) };
}

/** `DRIPSIGN_MAIL_PROVIDER` chooses the mail sender: `ses` (default) or `azure`. */
export function readMailSettings(env: Environment): MailSettings {
  return choice(env, 'DRIPSIGN_MAIL_PROVIDER', ['ses', 'azure']) === 'ses'
    ? { provider: 'ses', region: required(env, 'AWS_REGION'), from: required(env, 'DRIPSIGN_EMAIL_FROM') }
    : { provider: 'azure', endpoint: required(env, 'DRIPSIGN_EMAIL_ENDPOINT'), from: required(env, 'DRIPSIGN_EMAIL_FROM'), identity: managedIdentity(env) };
}

/** The one place a storage adapter is chosen; callers hold only the port. */
export function createDocumentStorage(settings: StorageSettings): DocumentStorage {
  return settings.provider === 's3'
    ? new S3DocumentStorage(settings.region, settings.bucket, settings.kmsKeyId)
    : new AzureBlobDocumentStorage(settings);
}

/** The one place a mail adapter is chosen; callers hold only the port. */
export function createEmailSender(settings: MailSettings): EmailSender {
  return settings.provider === 'ses' ? new SesEmailClient(settings.region, settings.from) : new AzureCommunicationMail(settings);
}
