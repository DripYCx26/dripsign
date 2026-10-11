import "server-only";
import { listInbox } from "@dripsign/core/domain/view";
import type { RecipientActor } from "@dripsign/core/types";
import { EmptyState } from "@/ui";
import { AgreementList } from "./AgreementList.tsx";
import { groupInboxRows } from "./rows.ts";

/** The recipient's agreements in the four groups, read for the actor the page resolved. */
export async function InboxList({ actor }: Readonly<{ actor: RecipientActor }>) {
  const items = await listInbox(actor);
  if (items.length === 0) {
    return <EmptyState message={`No agreements are shared with ${actor.email}.`} />;
  }
  return <AgreementList groups={groupInboxRows(items)} />;
}
