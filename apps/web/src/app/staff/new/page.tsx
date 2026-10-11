import type { Metadata } from "next";
import { NewAgreementForm } from "@/features/create/NewAgreementForm.tsx";
import { PageContainer } from "@/features/shell/PageContainer.tsx";
import { PageHeader } from "@/ui";
import { requireStaff } from "@/server/session.ts";

export const metadata: Metadata = { title: "New agreement" };

/** Staff only: a title, the terms (written here or a PDF) and the people who will review and sign. */
export default async function NewAgreementPage() {
  await requireStaff();
  return (
    <PageContainer>
      <PageHeader title="New agreement" />
      <NewAgreementForm />
    </PageContainer>
  );
}
