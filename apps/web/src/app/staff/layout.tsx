import type { ReactNode } from "react";
import { AppShell } from "@/features/shell/AppShell.tsx";
import { getSession } from "@/server/session.ts";

/**
 * The signed-in frame for every staff page. It only draws the bar from the session; each page
 * still resolves staff authority itself, because a layout does not rerun between navigations.
 * Signed out, the page's own redirect to sign-in is what the visitor sees.
 */
export default async function StaffLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await getSession();
  if (session === null) return children;
  return (
    <AppShell session={session} home="staff">
      {children}
    </AppShell>
  );
}
