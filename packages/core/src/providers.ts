import { AzureBlobDocumentStorage } from './azureBlob.ts';
import { AzureCommunicationMail } from './azureMail.ts';
import type { EmailSender } from './email.ts';
import { SesEmailClient } from './email.ts';
import { DirectoryMail, FilesystemDocumentStorage } from './filesystem.ts';
import type { ManagedIdentity } from './managedIdentity.ts';
import type { DocumentStorage } from './storage.ts';
import { S3DocumentStorage } from './storage.ts';

type Environment = Readonly<Record<string, string | undefined>>;

export type StorageSettings =
  | { readonly provider: 's3'; readonly region: string; readonly bucket: string; readonly kmsKeyId: string | undefined }
  | { readonly provider: 'azure'; readonly endpoint: string; readonly container: string; readonly identity: ManagedIdentity }
  | { readonly provider: 'filesystem'; readonly directory: string };

export type MailSettings =
  | { readonly provider: 'ses'; readonly region: string; readonly from: string }
  | { readonly provider: 'azure'; readonly endpoint: string; readonly from: string; readonly identity: ManagedIdentity }
  | { readonly provider: 'directory'; readonly directory: string; readonly from: string };

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

/** `DRIPSIGN_STORAGE_PROVIDER` chooses the document store: `s3` (default), `azure`, or `filesystem` (one host). */
export function readStorageSettings(env: Environment): StorageSettings {
  switch (choice(env, 'DRIPSIGN_STORAGE_PROVIDER', ['s3', 'azure', 'filesystem'])) {
    case 's3': return { provider: 's3', region: required(env, 'AWS_REGION'), bucket: required(env, 'DRIPSIGN_DOCUMENT_BUCKET'), kmsKeyId: env['DRIPSIGN_KMS_KEY_ID']?.trim() || undefined };
    case 'azure': return { provider: 'azure', endpoint: required(env, 'DRIPSIGN_BLOB_ENDPOINT'), container: required(env, 'DRIPSIGN_DOCUMENT_CONTAINER'), identity: managedIdentity(env) };
    case 'filesystem': return { provider: 'filesystem', directory: required(env, 'DRIPSIGN_DOCUMENT_DIRECTORY') };
  }
}

/** `DRIPSIGN_MAIL_PROVIDER` chooses the mail sender: `ses` (default), `azure`, or `directory` (a local spool). */
export function readMailSettings(env: Environment): MailSettings {
  switch (choice(env, 'DRIPSIGN_MAIL_PROVIDER', ['ses', 'azure', 'directory'])) {
    case 'ses': return { provider: 'ses', region: required(env, 'AWS_REGION'), from: required(env, 'DRIPSIGN_EMAIL_FROM') };
    case 'azure': return { provider: 'azure', endpoint: required(env, 'DRIPSIGN_EMAIL_ENDPOINT'), from: required(env, 'DRIPSIGN_EMAIL_FROM'), identity: managedIdentity(env) };
    case 'directory': return { provider: 'directory', directory: required(env, 'DRIPSIGN_MAIL_DIRECTORY'), from: required(env, 'DRIPSIGN_EMAIL_FROM') };
  }
}

/** The one place a storage adapter is chosen; callers hold only the port. */
export function createDocumentStorage(settings: StorageSettings): DocumentStorage {
  switch (settings.provider) {
    case 's3': return new S3DocumentStorage(settings.region, settings.bucket, settings.kmsKeyId);
    case 'azure': return new AzureBlobDocumentStorage(settings);
    case 'filesystem': return new FilesystemDocumentStorage(settings.directory);
  }
}

/** The one place a mail adapter is chosen; callers hold only the port. */
export function createEmailSender(settings: MailSettings): EmailSender {
  switch (settings.provider) {
    case 'ses': return new SesEmailClient(settings.region, settings.from);
    case 'azure': return new AzureCommunicationMail(settings);
    case 'directory': return new DirectoryMail(settings.directory, settings.from);
  }
}
