import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { StoreError } from '@dripsign/db';
import { Header } from '../../../../components/Header';
import { Login } from '../../../../components/Login';
import { Workspace } from '../../../../components/Workspace';
import { readActor } from '../../../../server/sessions';
import { getAgreement } from '../../../../server/agreements';
import { idSchema } from '../../../../server/api';

export const dynamic = 'force-dynamic';
export default async function StaffAgreementPage({ params }: { readonly params: Promise<{ id: string }> }): Promise<ReactNode> {
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const actor = await readActor('staff');
  if (!actor) return <><Header isStaff /><Login kind="staff" /></>;
  try {
    const detail = await getAgreement(actor, id.data);
    return <><Header isStaff isSignedIn /><main className="page"><Workspace key={detail.agreement.version} detail={detail} isStaff /></main></>;
  } catch (error: unknown) { if (error instanceof StoreError && (error.code === 'not_found' || error.code === 'forbidden')) notFound(); throw error; }
}
