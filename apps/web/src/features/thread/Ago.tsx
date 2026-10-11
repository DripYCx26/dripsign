import { useSyncExternalStore } from "react";
import { Moment } from "@/ui";
import { formatAbsolute } from "@/ui/Moment/format.ts";

const noopSubscribe = () => () => undefined;

/**
 * "5 minutes ago" with the exact time in the viewer's zone as the hover title. The zone is only
 * known in the browser, so the first paint carries no title and hydration adds it.
 */
export function Ago({ value }: Readonly<{ value: string }>) {
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const at = new Date(value);
  const title = hydrated && !Number.isNaN(at.getTime()) ? formatAbsolute(at, "local") : undefined;
  return (
    <span title={title}>
      <Moment value={value} format="relative" />
    </span>
  );
}
