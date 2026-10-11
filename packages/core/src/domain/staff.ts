// The tenant's staff roster. Membership lives only in the `staff` table; admins manage it.
import type { Db } from "../db.ts";
import { readTx, tx } from "../db.ts";
import { DomainError, notFound } from "../errors.ts";
import { emailSchema, personNameSchema } from "../schema.ts";
import type { StaffActor, StaffRole } from "../types.ts";
import { iso, parseOrInvalid } from "./state.ts";

export interface StaffMember {
  readonly email: string;
  readonly name: string | null;
  readonly role: StaffRole;
  readonly addedAt: string;
}

export interface NewStaffMember {
  readonly email: string;
  readonly name?: string | undefined;
  readonly role: StaffRole;
}

/** Bounded well above a real team; the roster is not paged. */
const ROSTER_LIMIT = 500;

export function listStaff(actor: StaffActor): Promise<readonly StaffMember[]> {
  return readTx(async (db) => {
    await requireRole(db, actor, ["admin", "member"]);
    const found = await db.query<{
      email: string;
      name: string | null;
      role: StaffRole;
      addedAt: Date;
    }>(
      `SELECT email, name, role, added_at AS "addedAt" FROM dripsign.staff
       WHERE tenant_id = $1 AND revoked_at IS NULL
       ORDER BY email LIMIT $2`,
      [actor.tenantId, ROSTER_LIMIT],
    );
    return found.rows.map((row) => ({ ...row, addedAt: iso(row.addedAt) }));
  });
}

/** Adds or reinstates a member, or changes their role. */
export async function addStaff(actor: StaffActor, input: NewStaffMember): Promise<void> {
  const email = parseOrInvalid(emailSchema, input.email);
  const name = input.name === undefined ? null : parseOrInvalid(personNameSchema, input.name);
  return tx(async (db) => {
    await requireRole(db, actor, ["admin"]);
    await db.query(
      `INSERT INTO dripsign.staff (tenant_id, email, name, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, email)
       DO UPDATE SET role = EXCLUDED.role, revoked_at = NULL,
                     name = coalesce(EXCLUDED.name, dripsign.staff.name)`,
      [actor.tenantId, email, name, input.role],
    );
  });
}

/** Admins cannot revoke themselves, so a tenant always keeps one admin. */
export async function revokeStaff(actor: StaffActor, email: string): Promise<void> {
  const target = parseOrInvalid(emailSchema, email);
  if (target === actor.email) {
    throw new DomainError("invalid", "You can’t remove yourself. Ask another admin.");
  }
  return tx(async (db) => {
    await requireRole(db, actor, ["admin"]);
    const revoked = await db.query(
      `UPDATE dripsign.staff SET revoked_at = now()
       WHERE tenant_id = $1 AND email = $2 AND revoked_at IS NULL`,
      [actor.tenantId, target],
    );
    if (revoked.rowCount !== 1) throw notFound();
  });
}

async function requireRole(db: Db, actor: StaffActor, roles: readonly StaffRole[]): Promise<void> {
  const found = await db.query<{ role: StaffRole }>(
    `SELECT role FROM dripsign.staff
     WHERE tenant_id = $1 AND email = $2 AND revoked_at IS NULL`,
    [actor.tenantId, actor.email],
  );
  const role = found.rows[0]?.role;
  if (role === undefined || !roles.includes(role)) throw notFound();
}
