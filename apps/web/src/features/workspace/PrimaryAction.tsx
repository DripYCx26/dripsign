"use client";

import type { Command } from "@dripsign/core/schema";
import { Button, ButtonLink, Pill } from "@/ui";
import type { NextStep } from "./nextStep.ts";

type PrimaryActionProps = Readonly<{
  step: NextStep;
  /** True while any command of this workspace is in flight. */
  busy: boolean;
  onCommand: (command: Command) => void;
  onReveal: (href: string) => void;
}>;

/** The one primary action `nextStep` chose, in whatever form its kind calls for. */
export function PrimaryAction({ step, busy, onCommand, onReveal }: PrimaryActionProps) {
  const { label, kind, command, href, disabled = false, chip } = step;
  return (
    <>
      {chip !== undefined && <Pill tone="info">{chip}</Pill>}
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
    </>
  );
}
