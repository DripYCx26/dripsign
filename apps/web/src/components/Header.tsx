import type { ReactNode } from 'react';

/** One host serves both entries: signed out, each offers the other's sign-in at the top. */
export function Header({ isStaff = false, isSignedIn = false }: { readonly isStaff?: boolean; readonly isSignedIn?: boolean }): ReactNode {
  return <header className="site-header"><a className="site-brand" href={isStaff ? '/staff' : '/'}>DripSign</a>
    <nav aria-label={isSignedIn ? 'Agreements' : 'Sign in'}>
      {isStaff && isSignedIn && <a href="/staff/new">New agreement</a>}
      {!isSignedIn && (isStaff ? <a href="/">Recipient access</a> : <a href="/staff">Staff sign-in</a>)}
      {isSignedIn && <form action="/api/auth/logout" method="post"><button className="secondary">Sign out</button></form>}
    </nav>
  </header>;
}
