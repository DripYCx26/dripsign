import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireInbox } from "@/features/list/inbox.ts";
import { InboxList } from "@/features/list/InboxList.tsx";
import { AppShell } from "@/features/shell/AppShell.tsx";
import { PageContainer } from "@/features/shell/PageContainer.tsx";
import { PageHeader } from "@/ui";

export const metadata: Metadata = { title: "Agreements" };

export default async function InboxPage() {
  const { session, actor } = await requireInbox();
  // A staff member with nothing shared with them has no inbox to show.
  if (session.staffTenants.length > 0 && !session.hasRecipientGrants) redirect("/staff");
  return (
    <AppShell session={session} home="recipient">
      <PageContainer>
        <PageHeader title="Agreements" />
        <InboxList actor={actor} />
      </PageContainer>
    </AppShell>
  );
}
