import { useLayoutEffect, useRef } from "react";

/**
 * A ref for a textarea that grows with its text. The CSS holds the floor and the ceiling (min and
 * max height); this sets the height between them, so past the ceiling the field scrolls instead.
 */
export function useAutosize(value: string) {
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = field.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${String(element.scrollHeight)}px`;
  }, [value]);
  return field;
}
