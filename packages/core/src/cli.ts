// Operator commands: pnpm --filter @dripsign/core cli <command>.
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadConfig } from "./config.ts";
import { applySchema, closePool, resetSchema, schemaState, tx } from "./db.ts";
import { emailSchema, personNameSchema, titleSchema } from "./schema.ts";
import { upsertStaff } from "./domain/staff.ts";

const USAGE = `Usage: cli <command>

  migrate                     Apply schema.sql to a database without it (no-op when current)
  reset                       Drop and reapply the schema (refused in production)
  seed [--if-empty]           Load the demo agreements
  add-staff --tenant <name> --email <email> --role admin|member [--name <name>]`;

interface SeedModule {
  seed(options: { readonly ifEmpty: boolean }): Promise<void>;
}

// A variable specifier keeps the seed lane's module out of this file's compile-time graph.
const SEED_MODULE = "./seed.ts";

async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case "migrate":
      return migrate();
    case "reset":
      return reset();
    case "seed":
      return seed(rest);
    case "add-staff":
      return addStaff(rest);
    default:
      throw new Error(USAGE);
  }
}

async function migrate(): Promise<void> {
  const state = await schemaState();
  if (state === "current") {
    console.log("Schema is current.");
    return;
  }
  if (state === "stale") {
    throw new Error(
      "The database schema differs from schema.sql. There are no migrations: in development run " +
        "`pnpm db:reset`; elsewhere rebuild the database.",
    );
  }
  console.log(`Applied schema ${(await applySchema()).slice(0, 12)}.`);
}

async function reset(): Promise<void> {
  if (loadConfig().production) throw new Error("reset is refused in production.");
  console.log(`Reset schema ${(await resetSchema()).slice(0, 12)}.`);
}

async function seed(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: { "if-empty": { type: "boolean", default: false } },
    strict: true,
  });
  const module = (await import(SEED_MODULE)) as SeedModule;
  await module.seed({ ifEmpty: values["if-empty"] });
}

const addStaffSchema = z.strictObject({
  tenant: titleSchema,
  email: emailSchema,
  role: z.enum(["admin", "member"]),
  name: personNameSchema.optional(),
});

async function addStaff(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      tenant: { type: "string" },
      email: { type: "string" },
      role: { type: "string" },
      name: { type: "string" },
    },
    strict: true,
  });
  const parsed = addStaffSchema.safeParse(values);
  if (!parsed.success) throw new Error(USAGE);
  const input = parsed.data;
  const tenantId = await tx(async (db) => {
    await db.query(
      `INSERT INTO dripsign.tenant (id, name) VALUES ($1, $2)
       ON CONFLICT (name) DO NOTHING`,
      [randomUUID(), input.tenant],
    );
    const tenant = await db.query<{ id: string }>(
      "SELECT id FROM dripsign.tenant WHERE name = $1",
      [input.tenant],
    );
    const id = tenant.rows[0]?.id;
    if (id === undefined) throw new Error("Tenant upsert returned no row.");
    await upsertStaff(db, id, input);
    return id;
  });
  console.log(`${input.email} is ${input.role} of ${input.tenant} (${tenantId}).`);
}

main(process.argv.slice(2))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
    // Docker Desktop's port forward can leave a closed pg socket half-open, keeping Node alive.
    process.exit();
  });
