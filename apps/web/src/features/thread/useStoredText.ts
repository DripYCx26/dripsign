import type { Capacity } from "@dripsign/core/types";
import { useCallback, useEffect, useSyncExternalStore } from "react";

// Composer text lives in sessionStorage, keyed by who is typing and where, so it survives a
// refresh, a conflict reload and a navigation back, and never reaches another person who signs in
// on the same browser tab. The map is the working copy: it also holds the text when storage is
// blocked (private mode), and it keeps the snapshot of a key stable between reads.
const cache = new Map<string, string | null>();
const listeners = new Set<() => void>();

const ROOT = "dripsign:";
export const IDENTITY_STAMP = `${ROOT}identity`;

/** Whose text it is and which agreement it is about. */
export type TextScope = Readonly<{ email: string; capacity: Capacity; agreementId: string }>;

function identityPrefix(scope: Pick<TextScope, "email" | "capacity">): string {
  return `${ROOT}${scope.email}:${scope.capacity}:`;
}

export function storageKey(scope: TextScope, field: string): string {
  return `${identityPrefix(scope)}${scope.agreementId}:${field}`;
}

/**
 * Removes every stored working copy that belongs to another identity and stamps this one, so a
 * person who signs in after someone else on the same tab inherits nothing. Returns the keys it
 * removed. Nothing happens when the stamp already names this identity.
 */
export function adoptIdentity(
  storage: Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">,
  scope: Pick<TextScope, "email" | "capacity">,
): readonly string[] {
  const prefix = identityPrefix(scope);
  if (storage.getItem(IDENTITY_STAMP) === prefix) return [];
  const foreign: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null && key.startsWith(ROOT) && key !== IDENTITY_STAMP && !key.startsWith(prefix)) {
      foreign.push(key);
    }
  }
  for (const key of foreign) storage.removeItem(key);
  storage.setItem(IDENTITY_STAMP, prefix);
  return foreign;
}

function forgetOtherIdentities(scope: Pick<TextScope, "email" | "capacity">): void {
  const prefix = identityPrefix(scope);
  for (const key of cache.keys()) if (!key.startsWith(prefix)) cache.delete(key);
  try {
    adoptIdentity(window.sessionStorage, scope);
  } catch {
    // Storage is blocked; the in-memory copy above is all there is to clear.
  }
}

function read(key: string): string | null {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(key);
  } catch {
    // Storage is blocked; the in-memory copy still serves this tab.
  }
  cache.set(key, stored);
  return stored;
}

/** Sets a stored field; null forgets it. */
export function storeText(key: string, value: string | null): void {
  cache.set(key, value);
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Storage is blocked or full; the in-memory copy keeps the text for this page.
  }
  for (const listener of listeners) listener();
}

/**
 * Clears a field once the send that carried `sent` succeeded, unless the person typed on while it
 * was in flight. Returns whether it cleared.
 */
export function clearStoredText(key: string, sent: string | null): boolean {
  if (read(key) !== sent) return false;
  storeText(key, null);
  return true;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const serverSnapshot = (): null => null;

/**
 * A text field's value that outlives the page. `null` means untouched (nothing stored), which is
 * different from the empty string a person typed. The server and the first client render see
 * `null`, so hydration agrees; the stored text appears right after. The third item clears the
 * field after a successful send of the given value (`clearStoredText`).
 */
export function useStoredText(
  scope: TextScope,
  field: string,
): readonly [string | null, (value: string | null) => void, (sent: string | null) => void] {
  const { email, capacity } = scope;
  const key = storageKey(scope, field);
  const value = useSyncExternalStore(subscribe, () => read(key), serverSnapshot);
  useEffect(() => {
    forgetOtherIdentities({ email, capacity });
  }, [email, capacity]);
  const set = useCallback(
    (next: string | null) => {
      storeText(key, next);
    },
    [key],
  );
  const clearSent = useCallback(
    (sent: string | null) => {
      clearStoredText(key, sent);
    },
    [key],
  );
  return [value, set, clearSent];
}
