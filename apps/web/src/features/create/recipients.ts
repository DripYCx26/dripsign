import { emailSchema, personNameSchema } from "@dripsign/core/schema";
import { randomId } from "../document/ids.ts";

export interface RecipientRow {
  readonly key: string;
  readonly name: string;
  readonly email: string;
  readonly isSigner: boolean;
}

export interface RowErrors {
  readonly name?: string | undefined;
  readonly email?: string | undefined;
}

export const DUPLICATE_EMAIL = "Each recipient needs a different email address.";

/** A blank recipient row; `key` lets server-rendered initial state be deterministic. */
export function emptyRow(key: string = randomId()): RecipientRow {
  return { key, name: "", email: "", isSigner: true };
}

const normal = (email: string) => email.trim().toLowerCase();

/** Keys of rows whose email repeats an earlier row's. */
export function duplicateKeys(rows: readonly RecipientRow[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const repeats = new Set<string>();
  for (const row of rows) {
    const email = normal(row.email);
    if (email === "") continue;
    if (seen.has(email)) repeats.add(row.key);
    seen.add(email);
  }
  return repeats;
}

/** Per-row messages from the shared schemas; duplicates are reported by `duplicateKeys`. */
export function rowErrors(rows: readonly RecipientRow[]): ReadonlyMap<string, RowErrors> {
  const errors = new Map<string, RowErrors>();
  for (const row of rows) {
    const name = personNameSchema.safeParse(row.name);
    const email = emailSchema.safeParse(row.email);
    if (!name.success || !email.success) {
      errors.set(row.key, {
        name: name.success ? undefined : name.error.issues[0]?.message,
        email: email.success ? undefined : email.error.issues[0]?.message,
      });
    }
  }
  return errors;
}
