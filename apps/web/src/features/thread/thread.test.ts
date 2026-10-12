import type {
  MessageView,
  ParticipantRef,
  ProposalView,
  TimelineItem,
  ViewerView,
} from "@dripsign/core/types";
import { expect, it } from "vitest";
import { isSendKey } from "./enterToSend.ts";
import { threadItems } from "./model.ts";
import {
  adoptIdentity,
  clearStoredText,
  IDENTITY_STAMP,
  storageKey,
  storeText,
  type TextScope,
} from "./useStoredText.ts";

const avery: TextScope = { email: "avery@northwind.test", capacity: "staff", agreementId: "a-1" };
const jordan: TextScope = {
  email: "jordan@client.test",
  capacity: "recipient",
  agreementId: "a-1",
};

function memoryStorage(entries: Readonly<Record<string, string>>) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

it("sends on a plain Enter only: Shift+Enter, IME confirmations and other keys are not sends", () => {
  const key = { key: "Enter", shiftKey: false, isComposing: false };
  expect(isSendKey(key)).toBe(true);
  expect(isSendKey({ ...key, shiftKey: true })).toBe(false);
  expect(isSendKey({ ...key, isComposing: true })).toBe(false);
  expect(isSendKey({ ...key, key: "a" })).toBe(false);
});

it("drops the previous person's stored text when another identity takes over the tab", () => {
  const theirs = storageKey(avery, "message");
  const mine = storageKey(jordan, "message");
  expect(mine).not.toBe(theirs);
  const storage = memoryStorage({
    [theirs]: "draft for the client",
    [IDENTITY_STAMP]: `dripsign:${avery.email}:${avery.capacity}:`,
    unrelated: "kept",
  });

  expect(adoptIdentity(storage, jordan)).toEqual([theirs]);
  expect([...storage.map.keys()].sort()).toEqual([IDENTITY_STAMP, "unrelated"]);

  storage.setItem(mine, "my draft");
  expect(adoptIdentity(storage, jordan)).toEqual([]);
  expect(storage.getItem(mine)).toBe("my draft");
});

it("keeps text typed while a send was in flight when the send succeeds late", () => {
  const key = storageKey(avery, "message");
  storeText(key, "Can we meet");
  // The send carried "Can we meet"; more was typed before its answer arrived.
  storeText(key, "Can we meet on Tuesday?");
  expect(clearStoredText(key, "Can we meet")).toBe(false);
  expect(clearStoredText(key, "Can we meet on Tuesday?")).toBe(true);
});

it("shows milestones only, says You for the viewer's own signature, groups one minute and carries the void reason", () => {
  const row = (
    at: string,
    kind: TimelineItem["kind"],
    detail: TimelineItem["detail"] = {},
  ): TimelineItem => ({ at, kind, actor: null, subjectId: null, detail });
  const items = threadItems({
    messages: [],
    proposals: [],
    viewer: {
      capacity: "recipient",
      email: "jordan@client.test",
      recipientId: "r-1",
      isRequiredSigner: true,
      hasSigned: true,
    },
    timeline: [
      row("2026-10-11T10:00:00.000Z", "agreement_created"),
      row("2026-10-11T10:00:10.000Z", "revision_published", { number: 2, sha256: "ab" }),
      row("2026-10-11T10:05:00.000Z", "signature_recorded", { recipientId: "r-1", name: "Jordan" }),
      row("2026-10-11T10:05:30.000Z", "signature_recorded", { recipientId: "r-2", name: "Morgan" }),
      row("2026-10-11T10:05:30.000Z", "signing_completed"),
      row("2026-10-11T10:30:00.000Z", "agreement_voided"),
    ],
  });
  expect(items.map((item) => (item.kind === "activity" ? item.lines : []))).toEqual([
    ["Revision 2 published"],
    ["You signed", "Morgan signed", "Everyone signed"],
    ["Voided"],
  ]);
});

it("folds a countered proposal into the live card, keeps a withdrawn one, and times only the first, the last and what follows a pause", () => {
  const author: ParticipantRef = {
    capacity: "staff",
    recipientId: null,
    label: "Avery Chen",
    email: null,
  };
  const viewer: ViewerView = {
    capacity: "staff",
    email: "avery@northwind.test",
    recipientId: null,
    isRequiredSigner: false,
    hasSigned: false,
  };
  const message = (id: string, at: string): MessageView => ({
    id,
    author,
    body: id,
    createdAt: `2026-10-11T${at}:00.000Z`,
  });
  const proposal = (id: string, at: string, status: ProposalView["status"]): ProposalView => ({
    id,
    baseRevisionId: "rev-1",
    baseRevisionNumber: 1,
    author,
    text: id,
    replacementSource: null,
    status,
    supersedesId: id === "p-2" ? "p-1" : null,
    createdAt: `2026-10-11T${at}:00.000Z`,
    decidedAt: null,
    decidedBy: null,
    publishedInRevision: null,
  });
  const items = threadItems({
    viewer,
    timeline: [],
    messages: [message("m-1", "10:00"), message("m-2", "10:01"), message("m-3", "10:02")],
    proposals: [
      proposal("p-0", "09:59", "superseded"),
      proposal("p-1", "10:03", "superseded"),
      proposal("p-2", "10:09", "pending"),
    ],
  });
  expect(items.map((item) => [item.key, item.timed])).toEqual([
    ["proposal-p-0", true],
    ["message-m-1", false],
    ["message-m-2", false],
    ["message-m-3", false],
    ["proposal-p-2", true],
  ]);
  // Countering keeps the row count; only the newest key says a new card arrived.
  const beforeCounter = threadItems({
    viewer,
    timeline: [],
    messages: [message("m-1", "10:00"), message("m-2", "10:01"), message("m-3", "10:02")],
    proposals: [proposal("p-0", "09:59", "superseded"), proposal("p-1", "10:03", "pending")],
  });
  expect(beforeCounter).toHaveLength(items.length);
  expect(beforeCounter.at(-1)?.key).toBe("proposal-p-1");
});
