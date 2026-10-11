import { useCallback, useSyncExternalStore } from "react";

// Composer text lives in sessionStorage, keyed by agreement, so it survives a refresh, a conflict
// reload and a navigation back. The map is the working copy: it also holds the text when storage
// is blocked (private mode), and it keeps the snapshot of a key stable between reads.
const cache = new Map<string, string | null>();
const listeners = new Set<() => void>();

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

function write(key: string, value: string | null): void {
  cache.set(key, value);
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Storage is blocked or full; the in-memory copy keeps the text for this page.
  }
  for (const listener of listeners) listener();
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
 * `null`, so hydration agrees; the stored text appears right after.
 */
export function useStoredText(
  agreementId: string,
  field: string,
): readonly [string | null, (value: string | null) => void] {
  const key = `dripsign:${agreementId}:${field}`;
  const value = useSyncExternalStore(subscribe, () => read(key), serverSnapshot);
  const set = useCallback(
    (next: string | null) => {
      write(key, next);
    },
    [key],
  );
  return [value, set];
}
