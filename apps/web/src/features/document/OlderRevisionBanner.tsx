"use client";

import type { DocumentSource } from "@dripsign/core/schema";
import { useState } from "react";
import { Banner, Button } from "@/ui";
import { SectionDiff } from "./SectionDiff.tsx";
import styles from "./OlderRevisionBanner.module.css";

type OlderRevisionBannerProps = Readonly<{
  viewing: number;
  current: number;
  /** Both sources, or null where the revision is a PDF with no written terms to compare. */
  viewingSource: DocumentSource | null;
  currentSource: DocumentSource | null;
}>;

/** The note above an older revision, with the option to see what the current one changed. */
export function OlderRevisionBanner({
  viewing,
  current,
  viewingSource,
  currentSource,
}: OlderRevisionBannerProps) {
  const [comparing, setComparing] = useState(false);
  const canCompare = viewingSource !== null && currentSource !== null;
  return (
    <div className={styles.wrap}>
      <Banner
        tone="info"
        action={
          canCompare ? (
            <Button
              variant="secondary"
              size="sm"
              pressed={comparing}
              onClick={() => {
                setComparing((open) => !open);
              }}
            >
              Compare with current
            </Button>
          ) : undefined
        }
      >
        {`You’re viewing revision ${String(viewing)}. Revision ${String(current)} is current.`}
      </Banner>
      {comparing && canCompare && (
        <section
          className={styles.diff}
          aria-label={`Changes from revision ${String(viewing)} to revision ${String(current)}`}
        >
          <SectionDiff before={viewingSource} after={currentSource} />
        </section>
      )}
    </div>
  );
}
