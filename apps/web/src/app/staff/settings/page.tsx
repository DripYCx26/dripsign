import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readCompletionExportSettings } from "@dripsign/core/domain/completionExport";
import { CompletionExportForm } from "@/features/settings/CompletionExportForm.tsx";
import { CompletionExportHistory } from "@/features/settings/CompletionExportHistory.tsx";
import styles from "@/features/settings/CompletionExport.module.css";
import { UndeliveredExports } from "@/features/settings/UndeliveredExports.tsx";
import { PageContainer } from "@/features/shell/PageContainer.tsx";
import { requireStaff } from "@/server/session.ts";
import { Notice, PageHeader } from "@/ui";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { actor } = await requireStaff();
  // Admins manage settings; to anyone else the page does not exist.
  if (actor.role !== "admin") notFound();
  const settings = await readCompletionExportSettings(actor);
  return (
    <PageContainer>
      <PageHeader title="Settings" />
      <section className={styles.section} aria-labelledby="completion-export">
        <h2 id="completion-export">Completion export</h2>
        <p className={styles.intro}>
          When an agreement is signed, DripSign sends the host a signed record of it. These values
          come from the host and are public; the signing key stays on this server.
        </p>
        {!settings.deliveryEnabled && (
          <Notice tone="attention">
            Sending is off on this server. Saved values apply once the operator sets the event URL
            and signing keys.
          </Notice>
        )}
        <CompletionExportForm settings={settings} />
      </section>
      <section className={styles.section} aria-labelledby="completion-history">
        <h2 id="completion-history">Revisions</h2>
        <CompletionExportHistory history={settings.history} />
      </section>
      <section className={styles.section} aria-labelledby="completion-undelivered">
        <h2 id="completion-undelivered">Waiting for the host</h2>
        <UndeliveredExports
          items={settings.undelivered}
          deliveryEnabled={settings.deliveryEnabled}
        />
      </section>
    </PageContainer>
  );
}
