import type { AgreementView } from "@dripsign/core/types";
import { useState } from "react";
import { railMode } from "@/features/workspace/tabs.ts";
import { candidateOf, type CandidatePreview } from "./candidate.ts";

/**
 * The assistant's candidate draft as the sheet shows it: previewed from the moment it arrives,
 * until the person sets it aside (`close`) or starts editing over it. A newer candidate opens
 * again. Only the drafting rail has one.
 */
export function useCandidate(view: AgreementView, editing: boolean) {
  const candidate = railMode(view) === "draft" ? candidateOf(view.aiSuggestions) : null;
  const [closedId, setClosedId] = useState<string | null>(null);
  const shown = candidate !== null && candidate.id !== closedId && !editing;
  const preview: CandidatePreview = {
    hidden: candidate !== null && !shown && !editing,
    show: () => {
      setClosedId(null);
    },
  };
  return {
    candidate,
    shown,
    preview,
    close: () => {
      setClosedId(candidate?.id ?? null);
    },
  };
}
