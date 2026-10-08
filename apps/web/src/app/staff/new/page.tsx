import type { ReactNode } from 'react';
import { Header } from '../../../components/Header';
import { NewAgreement } from '../../../components/NewAgreement';
import { StaffSignIn } from '../../../components/StaffSignIn';
import { readStaffEntry } from '../../../server/sessions';

export const dynamic = 'force-dynamic';
export default async function NewAgreementPage(): Promise<ReactNode> {
  const { actor, isEmbedded } = await readStaffEntry();
  if (!actor) return <StaffSignIn isEmbedded={isEmbedded} />;
  return <><Header isStaff isSignedIn isEmbedded={isEmbedded} /><main className="page"><NewAgreement /></main></>;
}
