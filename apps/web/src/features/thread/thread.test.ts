import { expect, it } from "vitest";
import { isSendKey } from "./enterToSend.ts";
import { adoptIdentity, IDENTITY_STAMP, storageKey, type TextScope } from "./useStoredText.ts";

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
