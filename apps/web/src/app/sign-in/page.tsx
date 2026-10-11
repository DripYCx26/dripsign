import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { destination } from "@/features/auth/destination.ts";
import { SignInFlow } from "@/features/auth/SignInFlow.tsx";
import { devLoginEnabled } from "@/features/dev/identities.ts";
import { ButtonLink } from "@/ui/index.ts";
import { EntryFrame } from "@/features/shell/EntryFrame.tsx";
import { safeNextPath } from "@/server/navigation.ts";
import { getSession } from "@/server/session.ts";

export const metadata: Metadata = { title: "Sign in" };

type Props = Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>;

export default async function SignInPage({ searchParams }: Props) {
  const { next } = await searchParams;
  const target = safeNextPath(typeof next === "string" ? next : null);
  const session = await getSession();
  if (session !== null) redirect(destination(session, target));
  return (
    <EntryFrame title="Sign in to DripSign">
      <SignInFlow />
      {devLoginEnabled() && (
        <ButtonLink href="/dev/sign-in" variant="quiet" size="sm">
          Development: skip the email code
        </ButtonLink>
      )}
    </EntryFrame>
  );
}
