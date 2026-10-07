import type { ReactNode } from 'react';

export function Header({ isStaff = false, isSignedIn = false }: { readonly isStaff?: boolean; readonly isSignedIn?: boolean }): ReactNode {
  return <header className="site-header"><a className="site-brand" href={isStaff ? '/staff' : '/'}>DripSign</a>
    <nav aria-label="Agreements">{isStaff && isSignedIn && <a href="/staff/new">New agreement</a>} {isSignedIn && <form action="/api/auth/logout" method="post"><button className="secondary">Sign out</button></form>}</nav>
  </header>;
}
