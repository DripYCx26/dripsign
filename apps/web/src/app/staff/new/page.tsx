import type { Metadata } from "next";
import { NewAgreementForm } from "@/features/create/NewAgreementForm.tsx";
import { AppShell } from "@/features/shell/AppShell.tsx";
import { PageContainer } from "@/features/shell/PageContainer.tsx";
import { PageHeader } from "@/ui";
import { requireStaff } from "@/server/session.ts";

export const metadata: Metadata = { title: "New agreement" };

/** Staff only: a title, the written terms and the people who will review and sign. */
export default async function NewAgreementPage() {
  const { session } = await requireStaff();
  return (
    <AppShell session={session} home="staff">
      <PageContainer>
        <PageHeader title="New agreement" />
        <NewAgreementForm />
      </PageContainer>
    </AppShell>
  );
}
