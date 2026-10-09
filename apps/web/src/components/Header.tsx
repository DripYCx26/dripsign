import type { ReactNode } from 'react';

type Props = { readonly isStaff?: boolean; readonly isSignedIn?: boolean; readonly isEmbedded?: boolean };

/**
 * One host serves both entries: signed out, each offers the other's sign-in at the top. Inside a
 * host app's page the host owns sign-in and sign-out, so neither is offered there.
 */
export function Header({ isStaff = false, isSignedIn = false, isEmbedded = false }: Props): ReactNode {
  return <header className="site-header"><a className="site-brand" href={isStaff ? '/staff' : '/'}>DripSign</a>
    <nav aria-label={isSignedIn ? 'Agreements' : 'Sign in'}>
      {isStaff && isSignedIn && <a href="/staff/new">New agreement</a>}
      {isStaff && isSignedIn && !isEmbedded && <a href="/staff/completion-export">Completion exports</a>}
      {!isSignedIn && !isEmbedded && (isStaff ? <a href="/">Recipient access</a> : <a href="/staff">Staff sign-in</a>)}
      {isSignedIn && !isEmbedded && <form action="/api/auth/logout" method="post"><button className="secondary">Sign out</button></form>}
    </nav>
  </header>;
}
