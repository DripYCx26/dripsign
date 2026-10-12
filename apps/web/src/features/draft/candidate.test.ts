import type { DocumentSource } from "@dripsign/core/schema";
import type { AiSuggestionView } from "@dripsign/core/types";
import { expect, it } from "vitest";
import { candidateOf } from "./candidate.ts";

const source: DocumentSource = {
  title: "Services",
  sections: [{ id: "s1", heading: "Terms", paragraphs: ["Pay on time."] }],
};

function turn(id: string, minute: number, rest: Partial<AiSuggestionView>): AiSuggestionView {
  return {
    id,
    requestedBy: "avery@northwind.test",
    instruction: "Draft it",
    mode: "draft",
    status: "ready",
    baseSourceSha256: "x",
    result: { kind: "draft", summary: "Done", source, questions: [] },
    error: null,
    createdAt: new Date(Date.UTC(2026, 9, 11, 9, minute)).toISOString(),
    appliedAt: null,
    stale: false,
    ...rest,
  };
}

it("previews the newest finished draft until it is applied, never a plan", () => {
  const plan = turn("plan", 3, {
    mode: "plan",
    result: {
      kind: "plan",
      summary: "Plan",
      outline: [{ heading: "A", intent: "b" }],
      questions: [],
      offerLegalCheck: false,
    },
  });
  const older = turn("older", 1, {});
  const newer = turn("newer", 2, { stale: true });
  expect(candidateOf([])).toBeNull();
  expect(candidateOf([plan])).toBeNull();
  // The view lists newest first; order comes from the time, not the array.
  expect(candidateOf([plan, newer, older])).toEqual({ id: "newer", stale: true, source });
  expect(candidateOf([turn("a", 4, { status: "applied" }), older])).toBeNull();
  expect(candidateOf([turn("q", 4, { status: "queued", result: null }), older])?.id).toBe("older");
});
