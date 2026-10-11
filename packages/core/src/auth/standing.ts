// What an email may reach, as SQL over the live rows. Sign-in mail, the session view and recipient
// resolution share these predicates so "may receive a code" and "may open something" never drift.
import type { Db } from "../db.ts";

/** Live staff rows for the email expression; aliased `st`. */
export function liveStaffSql(email: string): string {
  return `SELECT 1 FROM dripsign.staff st WHERE st.email = ${email} AND st.revoked_at IS NULL`;
}

/** Live recipient rows on published agreements (recipients never see drafts); aliased `r`. */
export function recipientGrantSql(email: string): string {
  return `SELECT 1 FROM dripsign.recipient r
    JOIN dripsign.agreement a ON a.tenant_id = r.tenant_id AND a.id = r.agreement_id
    WHERE r.email = ${email} AND r.revoked_at IS NULL AND a.current_revision_id IS NOT NULL`;
}

/** Live staff anywhere or a live recipient of a published agreement. */
export async function hasStanding(db: Db, email: string): Promise<boolean> {
  const found = await db.query<{ standing: boolean }>(
    `SELECT EXISTS (${liveStaffSql("$1")}) OR EXISTS (${recipientGrantSql("$1")}) AS standing`,
    [email],
  );
  return found.rows[0]?.standing === true;
}
