import "server-only";
import { connection } from "next/server";
import { loadConfig } from "@dripsign/core/config";
import { listDevIdentities } from "@dripsign/core/seed/identities";
import type { DevIdentity } from "./types.ts";

/**
 * The one answer to "is development sign-in on": the config's, which refuses it outside dev. It is
 * read per request, never at build time, because the build has no runtime configuration.
 */
export async function devLoginEnabled(): Promise<boolean> {
  await connection();
  return loadConfig().devLogin;
}

/** The seeded people to sign in as; empty unless development sign-in is on. */
export async function devIdentities(): Promise<readonly DevIdentity[]> {
  if (!(await devLoginEnabled())) return [];
  const identities: readonly DevIdentity[] = await listDevIdentities();
  return identities;
}

/** The seeded name for an email, else the email itself. */
export async function devIdentityLabel(email: string): Promise<string> {
  const found = (await devIdentities()).find((identity) => identity.email === email);
  return found?.name ?? email;
}
