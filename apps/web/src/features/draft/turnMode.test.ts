import { expect, it } from "vitest";
import { composerMode, WRITE_DRAFT } from "./turnMode.ts";

it("asks for a plan until a draft has been written, then refines; a question never drafts", () => {
  expect(composerMode([], false)).toBe("plan");
  expect(composerMode([{ mode: "plan", status: "ready" }], false)).toBe("plan");
  // A draft that is queued or failed has not been written.
  expect(composerMode([{ mode: "draft", status: "queued" }], false)).toBe("plan");
  expect(composerMode([{ mode: "draft", status: "failed" }], false)).toBe("plan");
  expect(composerMode([{ mode: "draft", status: "ready" }], false)).toBe("draft");
  expect(composerMode([{ mode: "draft", status: "applied" }], false)).toBe("draft");
  expect(composerMode([{ mode: "draft", status: "ready" }], true)).toBe("plan");
  expect(WRITE_DRAFT.mode).toBe("draft");
});
