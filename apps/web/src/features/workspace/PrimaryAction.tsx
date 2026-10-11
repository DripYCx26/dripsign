"use client";

import type { Command } from "@dripsign/core/schema";
import { Button, ButtonLink } from "@/ui";
import type { NextStep } from "./nextStep.ts";
import styles from "./PrimaryAction.module.css";

type PrimaryActionProps = Readonly<{
  step: NextStep;
  /** True while any command of this workspace is in flight. */
  busy: boolean;
  onCommand: (command: Command) => void;
  onReveal: (href: string) => void;
}>;

/**
 * The one primary action `nextStep` chose, in whatever form its kind calls for. The step's chip is
 * a status and sits beside the agreement's pill, not here.
 */
export function PrimaryAction({ step, busy, onCommand, onReveal }: PrimaryActionProps) {
  const { label, kind, command, href, disabled = false, narrowOnly = false } = step;
  return (
    <span className={styles.action} data-narrow-only={narrowOnly ? "" : undefined}>
      {label !== "" && kind === "navigate" && href !== undefined && (
        <ButtonLink variant="ink" href={href}>
          {label}
        </ButtonLink>
      )}
      {label !== "" && kind === "scroll" && href !== undefined && (
        <Button
          variant="ink"
          onClick={() => {
            onReveal(href);
          }}
        >
          {label}
        </Button>
      )}
      {label !== "" && kind === "command" && command !== undefined && (
        <Button
          variant="ink"
          loading={busy}
          disabled={disabled}
          onClick={() => {
            onCommand(command);
          }}
        >
          {label}
        </Button>
      )}
      {label !== "" && kind === "none" && (
        <Button variant="secondary" disabled>
          {label}
        </Button>
      )}
    </span>
  );
}
