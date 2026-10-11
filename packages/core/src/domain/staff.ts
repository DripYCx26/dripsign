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

/** Adds or reinstates a member, or changes a role; an admin steps down only if another stays. */
export async function addStaff(actor: StaffActor, input: NewStaffMember): Promise<void> {
  await tx((db) => upsertStaff(db, actor.tenantId, input, actor));
}

/** Operator path: bootstraps an empty roster, with the same lock and last-admin guard. */
export async function upsertStaff(
  db: Db,
  tenantId: string,
  input: NewStaffMember,
  actor?: StaffActor,
): Promise<void> {
  const email = parseOrInvalid(emailSchema, input.email);
  const name = input.name === undefined ? null : parseOrInvalid(personNameSchema, input.name);
  await changeRoster(
    db,
    tenantId,
    async () => {
      await db.query(
        `INSERT INTO dripsign.staff (tenant_id, email, name, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, email)
       DO UPDATE SET role = EXCLUDED.role, revoked_at = NULL,
                     name = coalesce(EXCLUDED.name, dripsign.staff.name)`,
        [tenantId, email, name, input.role],
      );
    },
    actor,
  );
}

/** Another admin removes a member; nobody removes themselves. */
export async function revokeStaff(actor: StaffActor, email: string): Promise<void> {
  const target = parseOrInvalid(emailSchema, email);
  if (target === actor.email) {
    throw new DomainError("invalid", "You can’t remove yourself. Ask another admin.");
  }
  await tx((db) =>
    changeRoster(
      db,
      actor.tenantId,
      async () => {
        const revoked = await db.query(
          `UPDATE dripsign.staff SET revoked_at = now()
       WHERE tenant_id = $1 AND email = $2 AND revoked_at IS NULL`,
          [actor.tenantId, target],
        );
        if (revoked.rowCount !== 1) throw notFound();
      },
      actor,
    ),
  );
}

/**
 * One roster change per tenant at a time, by a live admin, leaving at least one live admin: two
 * admins removing each other at once cannot leave the tenant with none.
 */
async function changeRoster(
  db: Db,
  tenantId: string,
  change: () => Promise<void>,
  actor?: StaffActor,
): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `dripsign.staff-roster:${tenantId}`,
  ]);
  if (actor) await requireRole(db, actor, ["admin"]);
  await change();
  const admin = await db.query(
    `SELECT 1 FROM dripsign.staff
       WHERE tenant_id = $1 AND role = 'admin' AND revoked_at IS NULL LIMIT 1`,
    [tenantId],
  );
  if (admin.rowCount !== 1) throw new DomainError("invalid", "Make someone else an admin first.");
}

/** Rechecks the actor's live role inside the caller's transaction; anything else is not found. */
export async function requireRole(
  db: Db,
  actor: StaffActor,
  roles: readonly StaffRole[],
): Promise<void> {
  const found = await db.query<{ role: StaffRole }>(
    `SELECT role FROM dripsign.staff
     WHERE tenant_id = $1 AND email = $2 AND revoked_at IS NULL`,
    [actor.tenantId, actor.email],
  );
  const role = found.rows[0]?.role;
  if (role === undefined || !roles.includes(role)) throw notFound();
}
