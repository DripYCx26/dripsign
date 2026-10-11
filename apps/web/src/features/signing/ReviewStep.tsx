"use client";

import { useRef } from "react";
import type { RecipientView, RevisionView } from "@dripsign/core/types";
import { PdfView } from "@/features/document/PdfView.tsx";
import { Button, Checkbox } from "@/ui";
import { StepActions, StepFrame, StepLede } from "./StepFrame.tsx";
import styles from "./ReviewStep.module.css";

type ReviewStepProps = Readonly<{
  /** The exact revision the signer will sign. */
  revision: RevisionView;
  src: string;
  viewerRecipientId: string | null;
  /** Names for the other signers' field labels. */
  recipients: readonly RecipientView[];
  reviewed: boolean;
  autoFocus: boolean;
  onReviewed: (reviewed: boolean) => void;
  onContinue: () => void;
}>;

/** Step 1: the exact PDF with the signer’s own field marked, then the review confirmation. */
export function ReviewStep({
  revision,
  src,
  viewerRecipientId,
  recipients,
  reviewed,
  autoFocus,
  onReviewed,
  onContinue,
}: ReviewStepProps) {
  const frame = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const own = revision.signingFields.find(
    (field) => field.type === "signature" && field.recipientId === viewerRecipientId,
  );

  function goToField() {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The drawn marker is exact; before the pages draw, the page-fraction anchor is close.
    const target = frame.current?.querySelector("[data-own]") ?? anchor.current;
    target?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  }

  return (
    <StepFrame title="Review the document" autoFocus={autoFocus}>
      <StepLede>
        Read the whole document before you sign. Your signature field is highlighted.
      </StepLede>
      {own !== undefined && (
        <div>
          <Button variant="secondary" onClick={goToField}>
            Go to your signature field
          </Button>
        </div>
      )}
      <div ref={frame} className={styles.document}>
        {own !== undefined && (
          // Pages share a size, so a page fraction of the frame lands near the field.
          <span
            ref={anchor}
            className={styles.anchor}
            style={{ top: `${String(((own.page - 1 + own.y) / revision.pageCount) * 100)}%` }}
            aria-hidden="true"
          />
        )}
        <PdfView
          src={src}
          fields={revision.signingFields}
          viewerRecipientId={viewerRecipientId}
          people={recipients}
        />
      </div>
      <Checkbox label="I’ve reviewed this document." checked={reviewed} onChange={onReviewed} />
      <StepActions>
        <Button variant="ink" size="lg" disabled={!reviewed} onClick={onContinue}>
          Continue to sign
        </Button>
      </StepActions>
    </StepFrame>
  );
}
