"use client";

import { useRef } from "react";
import type { RecipientView, RevisionView } from "@dripsign/core/types";
import { PdfView } from "@/features/document/PdfView.tsx";
import { scrollToField } from "@/features/document/scrollToField.ts";
import { Button, Checkbox } from "@/ui";
import { StepActions, StepFrame } from "./StepFrame.tsx";
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
    // The drawn marker is exact; before the pages draw, the page-fraction anchor is close.
    scrollToField(frame.current?.querySelector("[data-own]") ?? anchor.current);
  }

  return (
    <StepFrame title="Review the document" hideTitle autoFocus={autoFocus} wide>
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
          sha256={revision.sha256}
          fields={revision.signingFields}
          viewerRecipientId={viewerRecipientId}
          people={recipients}
          actions={
            own !== undefined && (
              <Button variant="quiet" size="sm" onClick={goToField}>
                Go to your signature field
              </Button>
            )
          }
        />
      </div>
      <StepActions
        lead={
          <Checkbox label="I’ve reviewed this document." checked={reviewed} onChange={onReviewed} />
        }
      >
        <Button variant="ink" size="lg" disabled={!reviewed} onClick={onContinue}>
          Continue to sign
        </Button>
      </StepActions>
    </StepFrame>
  );
}
