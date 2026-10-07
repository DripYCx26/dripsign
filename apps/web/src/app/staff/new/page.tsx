import type { ReactNode } from 'react';
import { Header } from '../../../components/Header';
import { Login } from '../../../components/Login';
import { NewAgreement } from '../../../components/NewAgreement';
import { readActor } from '../../../server/sessions';

export const dynamic = 'force-dynamic';
export default async function NewAgreementPage(): Promise<ReactNode> {
  const actor = await readActor('staff');
  if (!actor) return <><Header isStaff /><Login kind="staff" /></>;
  return <><Header isStaff isSignedIn /><main className="page"><NewAgreement /></main></>;
}
