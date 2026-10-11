import Link from "next/link";
import { devIdentityLabel, devLoginEnabled } from "@/features/dev/identities.ts";
import { getSession } from "@/server/session.ts";
import { Banner } from "@/ui";
import { standingWord } from "./standing.ts";

/**
 * The strip on every page while development sign-in is on, so no one mistakes a local identity
 * for a verified one. Renders nothing when the flag is off.
 */
export async function DevBanner() {
  if (!devLoginEnabled()) return null;
  const session = await getSession();
  const who =
    session === null
      ? "Not signed in"
      : `Signed in as ${await devIdentityLabel(session.email)} (${standingWord(session)})`;
  return (
    <Banner tone="attention">
      Development sign-in is on · {who} · <Link href="/dev/sign-in">Switch identity</Link>
    </Banner>
  );
}
