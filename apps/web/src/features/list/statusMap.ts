import type { AgreementStatus as PillStatus } from "@/ui";
import type { AgreementStatus } from "@dripsign/core/types";

const PILL: Readonly<Record<AgreementStatus, PillStatus>> = {
  draft: "draft",
  negotiating: "review",
  signing: "signing",
  signed: "signed",
  void: "void",
};

/** The stored lifecycle status as the pill's status: `negotiating` reads "In review". */
export function pillStatus(status: AgreementStatus): PillStatus {
  return PILL[status];
}
