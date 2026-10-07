import type { ReactNode } from 'react';
import { z } from 'zod';
import { Header } from '../../components/Header';
import { Login } from '../../components/Login';
import { readActor } from '../../server/sessions';
import { getStore } from '../../server/store';

export const dynamic = 'force-dynamic';

export default async function StaffPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactNode> {
  const actor = await readActor('staff');
  if (!actor || actor.kind !== 'staff') return <><Header isStaff /><Login kind="staff" /></>;
  const cursor = z.uuid().safeParse((await searchParams).before);
  const agreements = await getStore().listAgreementInbox(actor, 50, cursor.success ? cursor.data : null);
  return <><Header isStaff isSignedIn /><main className="page"><h1>Agreement inbox</h1>
    <section className="inbox">{agreements.length === 0 ? <p className="notice">Create an agreement to begin.</p> : agreements.map((agreement) => <a className="agreement-row" key={agreement.id} href={`/staff/agreements/${agreement.id}`}><strong>{agreement.title}</strong><span><small>{agreement.status} · version {agreement.version}</small><br /><small>{agreement.pendingProposalAuthorKind === 'recipient' ? 'Your turn to review a proposal' : agreement.pendingProposalAuthorKind === 'staff' ? 'Waiting for recipient' : 'No open proposal'}{agreement.requiredCount > 0 ? ` · ${agreement.signedCount}/${agreement.requiredCount} signed` : ''}</small></span></a>)}</section>
    {agreements.length === 50 && <p><a href={`/staff?before=${agreements.at(-1)?.id}`}>Older agreements</a></p>}
  </main></>;
}
