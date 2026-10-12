/** Brings a field marker (or the stand-in for it) to the middle of the screen, calmly if asked. */
export function scrollToField(target: Element | null | undefined): void {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
}
