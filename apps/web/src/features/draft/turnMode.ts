import type { AiMode } from "@dripsign/core/schema";
import type { AiSuggestionView } from "@dripsign/core/types";

/** What "Write the draft" on a plan sends: always a draft turn, whatever the composer would. */
export const WRITE_DRAFT = {
  kind: "ask_ai",
  mode: "draft",
  instruction: "Write the draft from the plan above.",
} as const;

/**
 * The mode the composer sends: a plan until the assistant has written a draft in this
 * conversation, then a draft (a refinement). `questionOnly` is the person's "ask without
 * drafting" choice for one turn.
 */
export function composerMode(
  turns: readonly Pick<AiSuggestionView, "mode" | "status">[],
  questionOnly: boolean,
): AiMode {
  if (questionOnly) return "plan";
  const written = turns.some(
    (turn) => turn.mode === "draft" && (turn.status === "ready" || turn.status === "applied"),
  );
  return written ? "draft" : "plan";
}
