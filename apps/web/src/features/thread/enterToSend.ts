import type { KeyboardEvent } from "react";

type KeyLike = Readonly<{ key: string; shiftKey: boolean; isComposing: boolean }>;

/** Enter sends, Shift+Enter is a newline, and an Enter that confirms an IME candidate is neither. */
export function isSendKey({ key, shiftKey, isComposing }: KeyLike): boolean {
  return key === "Enter" && !shiftKey && !isComposing;
}

/** Calls `send` for a send key pressed in a textarea; every other key is left alone. */
export function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>, send: () => void): void {
  const { key, shiftKey } = event;
  if (!isSendKey({ key, shiftKey, isComposing: event.nativeEvent.isComposing })) return;
  event.preventDefault();
  send();
}
