import "server-only";
import type { RecipientActor, SessionView } from "@dripsign/core/types";
import { redirect } from "next/navigation";
import { currentSession } from "@/server/session.ts";

/**
 * The signed-in person for the inbox: their email as a recipient actor, which carries no agreement
 * standing. `listInbox` reads the live recipient rows for that email; each agreement page still
 * resolves its own grant. Signed out goes to sign-in.
 */
export async function requireInbox(): Promise<{ session: SessionView; actor: RecipientActor }> {
  const current = await currentSession();
  if (current === null) return redirect("/sign-in");
  const { session, view } = current.resolved;
  return {
    session: view,
    actor: {
      capacity: "recipient",
      email: session.email,
      sessionId: session.id,
      verifiedAt: session.verifiedAt,
    },
  };
}
