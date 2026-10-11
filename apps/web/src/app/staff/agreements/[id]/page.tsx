import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/features/workspace/WorkspaceShell.tsx";
import { loadWorkspaceView } from "@/features/workspace/loadView.ts";
import { parseRevision, parseTab } from "@/features/workspace/tabs.ts";
import { requireStaff } from "@/server/session.ts";

export const metadata: Metadata = { title: "Agreement" };

type Props = Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

/** The staff workspace. Authority is resolved from the database on this request. */
export default async function StaffAgreementPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { actor } = await requireStaff();
  const view = await loadWorkspaceView(actor, id);
  if (view === null) notFound();
  return (
    <WorkspaceShell
      agreementId={id}
      capacity="staff"
      initialView={view}
      initialTab={parseTab(query.tab)}
      rev={parseRevision(query.rev)}
    />
  );
}
