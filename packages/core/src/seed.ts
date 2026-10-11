// Demo data for local development: `cli seed [--if-empty]`.
import { schemaState } from "./db.ts";
import { runSeed } from "./seed/run.ts";

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
