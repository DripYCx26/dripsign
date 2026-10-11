"use client";

import { Segmented } from "@/ui";
import styles from "./TemplatePicker.module.css";
import { TEMPLATE_NOTE, TEMPLATE_OPTIONS, type TemplateId } from "./templates.ts";

type TemplatePickerProps = Readonly<{
  value: TemplateId;
  onChange: (next: TemplateId) => void;
  disabled?: boolean | undefined;
}>;

/** Blank, or a starter text. Choosing one replaces the sections below it. */
export function TemplatePicker({ value, onChange, disabled = false }: TemplatePickerProps) {
  return (
    <div className={styles.picker}>
      <Segmented
        label="Start from"
        name="template"
        options={TEMPLATE_OPTIONS}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
      <p className={styles.note}>
        {value === "blank" ? "Choosing a starter text replaces the sections below." : TEMPLATE_NOTE}
      </p>
    </div>
  );
}
