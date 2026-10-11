"use client";

import { Button } from "@/ui";
import styles from "./TemplatePicker.module.css";
import { TEMPLATE_NOTE, TEMPLATE_OPTIONS, type TemplateId } from "./templates.ts";

type TemplatePickerProps = Readonly<{
  value: TemplateId;
  onChange: (next: TemplateId) => void;
  disabled?: boolean | undefined;
}>;

/** Blank, or a starter text, as quiet toggle chips. Choosing one replaces the sections below. */
export function TemplatePicker({ value, onChange, disabled = false }: TemplatePickerProps) {
  return (
    <div className={styles.picker}>
      <div className={styles.chips} role="group" aria-label="Start from">
        <span className={styles.lead} aria-hidden="true">
          Start from
        </span>
        {TEMPLATE_OPTIONS.map((option) => (
          <Button
            key={option.value}
            variant="quiet"
            size="sm"
            pressed={value === option.value}
            disabled={disabled}
            onClick={() => {
              onChange(option.value);
            }}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {value !== "blank" && <p className={styles.note}>{TEMPLATE_NOTE}</p>}
    </div>
  );
}
