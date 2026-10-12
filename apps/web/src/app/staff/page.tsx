import { listStaffAgreements } from "@dripsign/core/domain/view";
import type { Metadata } from "next";
import { ListControls } from "@/features/list/ListControls.tsx";
import { parseSearch } from "@/features/list/query.ts";
import { NewAgreementButton } from "@/features/list/NewAgreementButton.tsx";
import { StaffAgreementList } from "@/features/list/StaffAgreementList.tsx";
import { AppShell } from "@/features/shell/AppShell.tsx";
import { PageContainer } from "@/features/shell/PageContainer.tsx";
import { requireStaff } from "@/server/session.ts";
import { PageHeader } from "@/ui";

export const metadata: Metadata = { title: "Agreements" };

type Props = Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>;

export default async function StaffDashboardPage({ searchParams }: Props) {
  const q = parseSearch(await searchParams);
  const { actor, session } = await requireStaff();
  const page = await listStaffAgreements(actor, q === "" ? {} : { q });
  return (
    <AppShell session={session} home="staff">
      <PageContainer>
        <PageHeader title="Agreements" actions={<NewAgreementButton />} />
        <ListControls q={q} />
        <StaffAgreementList initial={page} q={q} empty={<NewAgreementButton />} />
      </PageContainer>
    </AppShell>
  );
}
