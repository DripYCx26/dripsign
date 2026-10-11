import { useEffect, useRef } from "react";

const POLL_MS = 5000;
/** Two minutes of polling, then the view waits for the next focus refresh. */
const MAX_POLLS = 24;

/** Calls `tick` every five seconds while `active`, at most 24 times per activation. */
export function usePoll(active: boolean, tick: () => unknown): void {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  });
  useEffect(() => {
    if (!active) return;
    let polls = 0;
    const id = window.setInterval(() => {
      polls += 1;
      if (polls > MAX_POLLS) window.clearInterval(id);
      else void latest.current();
    }, POLL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [active]);
}
