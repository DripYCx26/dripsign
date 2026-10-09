import type { ReactNode } from "react";
import { parseCompletionExportConfig } from "@dripsign/db";
import { Header } from "../../../components/Header";
import { Login } from "../../../components/Login";
import { CompletionExport } from "../../../components/CompletionExport";
import { readActor, requireSession } from "../../../server/sessions";
import { getStore } from "../../../server/store";

export const dynamic = "force-dynamic";

/** The original native staff session reads its own public export configuration. */
export default async function CompletionExportPage(): Promise<ReactNode> {
  const actor = await readActor("staff");
  if (!actor || actor.kind !== "staff")
    return (
      <>
        <Header isStaff />
        <Login kind="staff" />
      </>
    );
  const { session, tokenHash } = await requireSession("staff");
  if (session.actor.kind !== "staff")
    return (
      <>
        <Header isStaff />
        <Login kind="staff" />
      </>
    );
  const saved = await getStore().readCompletionExportConfig(
    session.actor,
    tokenHash,
  );
  const initial = {
    revision: saved.revision,
    config:
      saved.config === null ? null : parseCompletionExportConfig(saved.config),
  };
  return (
    <>
      <Header isStaff isSignedIn />
      <main className="page">
        <h1>Completion export settings</h1>
        <CompletionExport initial={initial} />
      </main>
    </>
  );
}
