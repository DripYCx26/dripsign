import type { AgreementStatus as DomainStatus } from "@dripsign/core/types";
import type { AgreementStatus as PillStatus } from "@/ui";

/** The domain says "negotiating"; the interface says "In review". */
export function pillStatus(status: DomainStatus): PillStatus {
  return status === "negotiating" ? "review" : status;
}
