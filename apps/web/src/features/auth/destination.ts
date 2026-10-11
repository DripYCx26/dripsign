import type { SessionView } from "@dripsign/core/types";

/** Where a signed-in visitor of the sign-in page goes: `next`, else the staff home, else the inbox. */
export function destination(session: SessionView, next: string | null): string {
  if (next !== null && !next.startsWith("/sign-in")) return next;
  return session.staffTenants.length > 0 ? "/staff" : "/";
}
