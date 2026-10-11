import type { Metadata } from "next";
import { AppShell } from "@/features/shell/AppShell.tsx";
import { loadWorkspaceView } from "@/features/workspace/loadView.ts";
import { parseRevision, parseTab } from "@/features/workspace/tabs.ts";
import { Unavailable } from "@/features/workspace/Unavailable.tsx";
import { WorkspaceShell } from "@/features/workspace/WorkspaceShell.tsx";
import { requireRecipient } from "@/server/session.ts";

export const metadata: Metadata = { title: "Agreement" };

type Props = Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

/** The recipient workspace: the same shell as staff's, without the editor or recipients. */
export default async function RecipientAgreementPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { actor, session } = await requireRecipient(id);
  const view = await loadWorkspaceView(actor, id);
  return (
    <AppShell session={session} home="recipient">
      {view === null ? (
        <Unavailable email={session.email} />
      ) : (
        <WorkspaceShell
          agreementId={id}
          capacity="recipient"
          initialView={view}
          initialTab={parseTab(query.tab)}
          rev={parseRevision(query.rev)}
        />
      )}
    </AppShell>
  );
}
