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
              {index === 0
                ? `Revision ${String(revision)} (current)`
                : `Revision ${String(revision)}`}
            </p>
            <p className={styles.detail}>
              <span>{createdBy}</span>
              <Moment value={createdAt} format="absolute" />
            </p>
            <p className={styles.pins}>
              <span>{`key ${config.keyId} v${String(config.keyVersion)}`}</span>
              <span>{`binding ${config.senderBindingId} r${String(config.senderBindingRevision)}`}</span>
              <span>{`grant ${config.senderGrantId}`}</span>
              <span>{`tenant ${config.hostTenantId}`}</span>
              <span>{`${config.issuer} → ${config.audience}`}</span>
              <span>{`${String(config.freshnessSeconds)} s`}</span>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
