import { listStaffAgreements } from "@dripsign/core/domain/view";
import type { Metadata } from "next";
import { ListControls } from "@/features/list/ListControls.tsx";
import { parseListState } from "@/features/list/query.ts";
import { StaffAgreementList } from "@/features/list/StaffAgreementList.tsx";
import { PageContainer } from "@/features/shell/PageContainer.tsx";
import { requireStaff } from "@/server/session.ts";
import { ButtonLink, PageHeader } from "@/ui";

export const metadata: Metadata = { title: "Agreements" };

type Props = Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>;

export default async function StaffDashboardPage({ searchParams }: Props) {
  const state = parseListState(await searchParams);
  const { actor } = await requireStaff();
  const page = await listStaffAgreements(actor, {
    ...(state.q === "" ? {} : { q: state.q }),
    ...(state.status === "all" ? {} : { status: state.status }),
  });
  return (
    <PageContainer>
      <PageHeader
        title="Agreements"
        actions={
          <ButtonLink variant="ink" href="/staff/new">
            New agreement
          </ButtonLink>
        }
      />
      <ListControls {...state} />
      <StaffAgreementList initial={page} {...state} />
    </PageContainer>
  );
}
