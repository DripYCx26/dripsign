import type { AgreementStatus } from "@dripsign/core/types";
import { Pill } from "@/ui";
import { pillStatus } from "./statusMap.ts";

/** An agreement's status word and icon, from the stored status. */
export function StatusPill({ status }: Readonly<{ status: AgreementStatus }>) {
  return <Pill status={pillStatus(status)} />;
}
