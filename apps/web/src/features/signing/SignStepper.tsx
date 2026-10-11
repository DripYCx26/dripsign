import { Check } from "@/ui";
import styles from "./SignStepper.module.css";

export type StepKey = "verify" | "review" | "sign" | "done";

const LABELS: Readonly<Record<StepKey, string>> = {
  verify: "Confirm",
  review: "Review",
  sign: "Sign",
  done: "Done",
};

type SignStepperProps = Readonly<{
  /** The steps in order; Confirm is present only when the flow starts there or returns there. */
  steps: readonly StepKey[];
  current: StepKey;
}>;

/** Where the signer is: an ordered list whose current step carries `aria-current`. */
export function SignStepper({ steps, current }: SignStepperProps) {
  const at = steps.indexOf(current);
  return (
    <nav aria-label="Progress">
      <ol className={styles.steps}>
        {steps.map((step, index) => {
          const state = index < at ? "complete" : index === at ? "current" : "upcoming";
          return (
            <li
              key={step}
              className={styles.step}
              data-state={state}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span className={styles.marker} aria-hidden="true">
                {state === "complete" ? <Check /> : index + 1}
              </span>
              {LABELS[step]}
              {state === "complete" && <span className="ds-visually-hidden"> (completed)</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
