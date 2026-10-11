import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DevIdentityPicker } from "@/features/dev/DevIdentityPicker.tsx";
import { devIdentities, devLoginEnabled } from "@/features/dev/identities.ts";
import { EntryFrame } from "@/features/shell/EntryFrame.tsx";

export const metadata: Metadata = { title: "Development identities" };

export default async function DevSignInPage() {
  // Off means the page does not exist, not that it refuses.
  if (!devLoginEnabled()) notFound();
  return (
    <EntryFrame title="Development identities" width="wide">
      <DevIdentityPicker identities={await devIdentities()} />
    </EntryFrame>
  );
}
