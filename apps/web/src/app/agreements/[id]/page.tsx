import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { StoreError } from '@dripsign/db';
import { Header } from '../../../components/Header';
import { Login } from '../../../components/Login';
import { Workspace } from '../../../components/Workspace';
import { readActor } from '../../../server/sessions';
import { getAgreement } from '../../../server/agreements';
import { idSchema } from '../../../server/api';

export const dynamic = 'force-dynamic';
export default async function AgreementPage({ params }: { readonly params: Promise<{ id: string }> }): Promise<ReactNode> {
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const actor = await readActor('recipient');
  if (!actor) return <><Header /><Login kind="recipient" agreementId={id.data} /></>;
  try {
    const detail = await getAgreement(actor, id.data);
    return <><Header isSignedIn /><main className="page"><Workspace key={detail.agreement.version} detail={detail} isStaff={false} /></main></>;
  } catch (error: unknown) { if (error instanceof StoreError && (error.code === 'not_found' || error.code === 'forbidden')) notFound(); throw error; }
}
