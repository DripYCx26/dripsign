import type { AgreementView } from "@dripsign/core/types";
import { Check } from "@/ui";
import styles from "./StepTracker.module.css";

const STEPS = [
  "Prepare",
  "Publish",
  "Request signatures",
  "Awaiting signatures",
  "Completed",
] as const;

/** Index of the step staff are on; -1 when the agreement is voided and no step is ahead. */
function currentStep(view: AgreementView): number {
  const { status, publicationNeeded } = view.agreement;
  switch (status) {
    case "void":
      return -1;
    case "signed":
      return 4;
    case "signing":
      return 3;
    case "negotiating":
      return publicationNeeded ? 1 : 2;
    case "draft":
      return view.allowedActions.includes("publish") ? 1 : 0;
  }
}

/** Where the agreement stands on the way to signatures; staff only, the recipient sees no tracker. */
export function StepTracker({ view }: Readonly<{ view: AgreementView }>) {
  const current = currentStep(view);
  if (current === -1) return null;
  return (
    <ol className={styles.steps} aria-label="Progress">
      {STEPS.map((label, index) => {
        const state = index < current ? "done" : index === current ? "current" : "upcoming";
        return (
          <li
            key={label}
            className={styles.step}
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className={styles.mark} aria-hidden="true">
              {state === "done" ? <Check /> : index + 1}
            </span>
            <span>{label}</span>
            {state === "done" && <span className="ds-visually-hidden">, done</span>}
          </li>
        );
      })}
    </ol>
  );
}
