import type { ReactNode } from 'react';
import { Header } from '../components/Header';
import { Login } from '../components/Login';
import { readActor } from '../server/sessions';
import { listAgreements } from '../server/agreements';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export default async function CustomerPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactNode> {
  const actor = await readActor('recipient');
  const query = await searchParams;
  const invitedId = z.uuid().safeParse(query.agreement);
  if (!actor) return <><Header /><Login kind="recipient" {...(invitedId.success ? { agreementId: invitedId.data } : {})} /></>;
  const cursor = z.uuid().safeParse(query.before);
  const agreements = await listAgreements(actor, cursor.success ? cursor.data : null);
  return <><Header isSignedIn /><main className="page"><h1>Your agreements</h1>
    <section className="inbox">{agreements.length === 0 ? <p className="notice">No agreements are available for this email.</p> : agreements.map((agreement) => <a className="agreement-row" key={agreement.id} href={`/agreements/${agreement.id}`}><strong>{agreement.title}</strong><small>{agreement.status}</small></a>)}</section>
    {agreements.length === 50 && <p><a href={`/?before=${agreements.at(-1)?.id}`}>Older agreements</a></p>}
    {invitedId.success && <p><a href={`/agreements/${invitedId.data}`}>Open invited agreement</a></p>}
  </main></>;
}
