import type { SessionView } from "@dripsign/core/types";

export type Home = "staff" | "recipient";

type StaffTenant = SessionView["staffTenants"][number];

/** The tenant the session works in: the selected one, or the only one the email belongs to. */
export function selectedTenant(session: SessionView): StaffTenant | null {
  const [only, ...others] = session.staffTenants;
  if (only === undefined) return null;
  if (others.length === 0) return only;
  return session.staffTenants.find((tenant) => tenant.id === session.selectedTenantId) ?? null;
}

/** True when the one email holds both a staff seat and a recipient grant. */
export function hasBothHomes(session: SessionView): boolean {
  return session.staffTenants.length > 0 && session.hasRecipientGrants;
}

/** A word for the person's standing, used by the development banner. */
export function standingWord(session: SessionView): string {
  if (hasBothHomes(session)) return "staff and recipient";
  return session.staffTenants.length > 0 ? "staff" : "recipient";
}
