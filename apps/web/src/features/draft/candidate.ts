import type { DocumentSource } from "@dripsign/core/schema";
import type { AiSuggestionView } from "@dripsign/core/types";

/** The assistant's newest unapplied draft: what the sheet previews and `Apply draft` applies. */
export type Candidate = Readonly<{ id: string; stale: boolean; source: DocumentSource }>;

/** Oldest first, the order a conversation reads; the view lists newest first. */
export function inOrder(suggestions: readonly AiSuggestionView[]): AiSuggestionView[] {
  return [...suggestions].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/**
 * The newest finished draft reply, while it is not applied. An applied newest reply leaves no
 * candidate, and plans are never one.
 */
export function candidateOf(suggestions: readonly AiSuggestionView[]): Candidate | null {
  const newest = inOrder(suggestions)
    .filter(
      (turn) => turn.mode === "draft" && (turn.status === "ready" || turn.status === "applied"),
    )
    .at(-1);
  if (newest?.status !== "ready" || newest.result?.kind !== "draft") return null;
  return { id: newest.id, stale: newest.stale, source: newest.result.source };
}

/** The candidate was set aside ("Show current"); `show` puts it back on the sheet. */
export type CandidatePreview = Readonly<{ hidden: boolean; show: () => void }>;
