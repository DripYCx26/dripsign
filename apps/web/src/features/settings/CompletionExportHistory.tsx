import type { CompletionExportRevision } from "@dripsign/core/types";
import { EmptyState, Moment } from "@/ui";
import styles from "./CompletionExport.module.css";

/** Every saved revision, newest first; the first is the one new completions freeze. */
export function CompletionExportHistory({
  history,
}: Readonly<{ history: readonly CompletionExportRevision[] }>) {
  if (history.length === 0) return <EmptyState message="No revision saved yet." />;
  return (
    <ol className={styles.list} aria-label="Revisions">
      {history.map(({ revision, config, createdBy, createdAt }, index) => (
        <li key={revision} className={styles.row}>
          <div className={styles.what}>
            <p className={styles.name}>
              Revision {revision}
              {index === 0 ? " · current" : ""}
            </p>
            <p className={styles.detail}>
              {createdBy} · <Moment value={createdAt} format="absolute" />
            </p>
            <p className={styles.pins}>
              key {config.keyId} v{config.keyVersion} · binding {config.senderBindingId} r
              {config.senderBindingRevision} · grant {config.senderGrantId} · tenant{" "}
              {config.hostTenantId} · {config.issuer} → {config.audience} ·{" "}
              {config.freshnessSeconds} s
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
