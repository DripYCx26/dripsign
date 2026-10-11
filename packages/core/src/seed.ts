// Demo data for local development: `cli seed [--if-empty]` and the dev sign-in's identity list.
import { loadConfig } from "./config.ts";
import { readTx, schemaState } from "./db.ts";
import { DEV_EMAILS } from "./seed/people.ts";
import { runSeed } from "./seed/run.ts";
import type { StaffRole } from "./types.ts";

export interface DevIdentity {
  readonly email: string;
  readonly name: string;
  readonly roleLine: string;
  readonly homes: ("staff" | "recipient")[];
}

export async function seed(options: { readonly ifEmpty: boolean }): Promise<void> {
  if ((await schemaState()) !== "current") {
    throw new Error("The database schema is not applied. Run `pnpm db:reset` first.");
  }
  if (await runSeed()) {
    console.log("Seeded the demo workspace.");
    return;
  }
  if (options.ifEmpty) {
    console.log("Seed skipped: the database already has data.");
    return;
  }
  throw new Error("The database is not empty. Run `pnpm db:reset` first.");
}

interface StaffRow {
  email: string;
  name: string | null;
  role: StaffRole;
  tenant: string;
}

interface RecipientRow {
  email: string;
  name: string;
  agreements: number;
}

/** The seeded people who still have live standing; empty unless development sign-in is on. */
export async function listDevIdentities(): Promise<DevIdentity[]> {
  if (!loadConfig().devLogin) return [];
  const { staff, recipients } = await readTx(async (db) => {
    const staffRows = await db.query<StaffRow>(
      `SELECT s.email, s.name, s.role, t.name AS tenant
       FROM dripsign.staff s JOIN dripsign.tenant t ON t.id = s.tenant_id
       WHERE s.email = ANY($1::text[]) AND s.revoked_at IS NULL
       ORDER BY t.name`,
      [DEV_EMAILS],
    );
    // Recipients only reach published agreements, as in auth/standing.ts.
    const recipientRows = await db.query<RecipientRow>(
      `SELECT r.email, max(r.name) AS name, count(*)::int AS agreements
       FROM dripsign.recipient r
       JOIN dripsign.agreement a ON a.tenant_id = r.tenant_id AND a.id = r.agreement_id
       WHERE r.email = ANY($1::text[]) AND r.revoked_at IS NULL
         AND a.current_revision_id IS NOT NULL
       GROUP BY r.email`,
      [DEV_EMAILS],
    );
    return { staff: staffRows.rows, recipients: recipientRows.rows };
  });
  return DEV_EMAILS.flatMap((email) => {
    const memberships = staff.filter((row) => row.email === email);
    const asRecipient = recipients.find((row) => row.email === email);
    const name = memberships[0]?.name ?? asRecipient?.name;
    if (name === undefined) return [];
    const parts = [
      ...memberships.map((row) => `${row.role === "admin" ? "Admin" : "Member"} at ${row.tenant}`),
      ...(asRecipient
        ? [
            `Recipient on ${String(asRecipient.agreements)} ${asRecipient.agreements === 1 ? "agreement" : "agreements"}`,
          ]
        : []),
    ];
    return [
      {
        email,
        name,
        roleLine: parts.join(" · "),
        homes: [
          ...(memberships.length > 0 ? ["staff" as const] : []),
          ...(asRecipient ? ["recipient" as const] : []),
        ],
      },
    ];
  });
}
