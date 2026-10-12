import type { AgreementView } from "@dripsign/core/types";
import { expect, it } from "vitest";
import { defaultTab, railMode } from "./tabs.ts";

type Source = Pick<
  AgreementView,
  "allowedActions" | "messages" | "proposals" | "aiSuggestions" | "draft"
>;

const message = { id: "m1" } as AgreementView["messages"][number];

/** A draft of `sections` sections: one is the blank draft a new agreement starts as. */
function source(
  allowed: Source["allowedActions"],
  messages: Source["messages"],
  sections = 1,
): Source {
  const draft = { source: { sections: Array.from({ length: sections }) } } as Source["draft"];
  return { allowedActions: allowed, messages, proposals: [], aiSuggestions: [], draft };
}

it("counts only messages and proposals as a conversation, never milestones", () => {
  // Milestones are not part of the source at all: an agreement with only history stays bare.
  expect(railMode(source([], []))).toBe("none");
  expect(railMode(source([], [message]))).toBe("narrow");
  expect(railMode(source(["message"], []))).toBe("full");
  expect(defaultTab(source(["message"], []))).toBe("document");
  expect(defaultTab(source(["message"], [message]))).toBe("chat");
  expect(defaultTab(source([], [message]))).toBe("document");
});

it("gives a draft's staff the assistant rail only when it has something to offer, never a recipient", () => {
  expect(railMode(source(["save_draft", "ask_ai"], [], 3))).toBe("draft");
  // Assistant off: the blank draft keeps its starters, a written draft has nothing for a rail.
  expect(railMode(source(["save_draft"], []))).toBe("draft");
  expect(railMode(source(["save_draft"], [], 3))).toBe("none");
  expect(
    railMode({
      ...source(["save_draft"], [], 3),
      aiSuggestions: [{ id: "s1" } as Source["aiSuggestions"][number]],
    }),
  ).toBe("draft");
  expect(defaultTab(source(["save_draft", "ask_ai"], []))).toBe("document");
  // Once a revision is out the thread takes the rail back, and a recipient never has `save_draft`.
  expect(railMode(source(["save_draft", "message"], [message]))).toBe("full");
  expect(railMode(source([], []))).toBe("none");
});
