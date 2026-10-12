import type { AgreementView } from "@dripsign/core/types";
import { expect, it } from "vitest";
import { defaultTab, railMode } from "./tabs.ts";

type Source = Pick<AgreementView, "allowedActions" | "messages" | "proposals">;

const message = { id: "m1" } as AgreementView["messages"][number];

function source(allowed: Source["allowedActions"], messages: Source["messages"]): Source {
  return { allowedActions: allowed, messages, proposals: [] };
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

it("gives a draft's staff the assistant rail with or without the assistant, never a recipient", () => {
  expect(railMode(source(["save_draft", "ask_ai"], []))).toBe("draft");
  expect(railMode(source(["save_draft"], []))).toBe("draft");
  expect(defaultTab(source(["save_draft", "ask_ai"], []))).toBe("document");
  // Once a revision is out the thread takes the rail back, and a recipient never has `save_draft`.
  expect(railMode(source(["save_draft", "message"], [message]))).toBe("full");
  expect(railMode(source([], []))).toBe("none");
});
