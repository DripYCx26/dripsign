import type { ReactNode } from 'react';
import { Header } from './Header';
import { Login } from './Login';

/**
 * Signed out at a staff page: the email-code sign-in, or, inside a host app's page, where a
 * cookie from that sign-in would not reach this frame, a note to reopen it from the host.
 */
export function StaffSignIn({ isEmbedded }: { readonly isEmbedded: boolean }): ReactNode {
  if (!isEmbedded) return <><Header isStaff /><Login kind="staff" /></>;
  return <><Header isStaff isEmbedded /><main className="page"><h1>Session ended</h1>
    <p className="notice">Reload the page that opened this workspace to continue.</p></main></>;
}
