import { EntryFrame } from "@/features/shell/EntryFrame.tsx";
import { UseAnotherEmail } from "@/features/shell/UseAnotherEmail.tsx";
import { getSession } from "@/server/session.ts";
import { ButtonLink } from "@/ui";

/**
 * Every page someone may not see, and every URL that does not exist, looks the same: nothing
 * here says which. The words ask whether the right address is signed in.
 */
export default async function NotFound() {
  const session = await getSession();
  if (session === null) {
    return (
      <EntryFrame title="Sign in to continue" lead="You need to sign in to see this page.">
        <div>
          <ButtonLink variant="ink" href="/sign-in">
            Sign in
          </ButtonLink>
        </div>
      </EntryFrame>
    );
  }
  return (
    <EntryFrame
      title="This page isn’t available"
      lead={`This page isn’t available to ${session.email}. Check that you’re signed in with the address it was sent to.`}
    >
      <div>
        <UseAnotherEmail />
      </div>
    </EntryFrame>
  );
}
