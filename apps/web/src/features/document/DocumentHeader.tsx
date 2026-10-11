"use client";

import type { ReactNode } from "react";
import { Check, ChevronDown, Menu, Segmented } from "@/ui";
import styles from "./DocumentHeader.module.css";
import { useRevisionParam } from "./useRevisionParam.ts";

export interface RevisionOption {
  readonly value: string;
  readonly label: string;
}

export type DocumentMode = "reading" | "pdf";

const MODES = [
  { value: "reading", label: "Reading" },
  { value: "pdf", label: "PDF" },
] as const;

type RevisionMenuProps = Readonly<{
  options: readonly RevisionOption[];
  value: string;
  /** The option shown when the address has no `rev`; choosing it clears the parameter. */
  defaultValue: string;
  disabled: boolean;
}>;

/** The revision shown, with a menu to choose another when there is another to choose. */
function RevisionMenu({ options, value, defaultValue, disabled }: RevisionMenuProps) {
  const choose = useRevisionParam();
  const label = options.find((option) => option.value === value)?.label ?? "";
  return (
    <div className={styles.revision}>
      <span className={styles.label}>{label}</span>
      {options.length > 1 && (
        <Menu
          label="Choose revision"
          icon={<ChevronDown aria-hidden="true" />}
          disabled={disabled}
          items={options.map((option) => ({
            id: option.value,
            label: option.label,
            icon: option.value === value ? <Check /> : <span className={styles.blank} />,
          }))}
          onAction={(next) => {
            choose(next === defaultValue ? null : next);
          }}
        />
      )}
    </div>
  );
}

type DocumentHeaderProps = Readonly<{
  options: readonly RevisionOption[];
  value: string;
  defaultValue: string;
  /** The form of the document on show; null when the document has one form, so nothing to switch. */
  mode: DocumentMode | null;
  onMode: (mode: DocumentMode) => void;
  /** Hold the revision still, for as long as the draft is being edited. */
  locked: boolean;
  /** Edit draft, or Save and Discard. */
  actions: ReactNode;
}>;

/** The document's 44 px bar: which revision, Reading or PDF, and the draft's actions. */
export function DocumentHeader({
  options,
  value,
  defaultValue,
  mode,
  onMode,
  locked,
  actions,
}: DocumentHeaderProps) {
  return (
    <div className={styles.header}>
      <RevisionMenu options={options} value={value} defaultValue={defaultValue} disabled={locked} />
      <div className={styles.controls}>
        {mode !== null && (
          <Segmented
            label="Document view"
            hideLabel
            name="document-view"
            size="sm"
            options={MODES}
            value={mode}
            onChange={onMode}
          />
        )}
        {actions}
      </div>
    </div>
  );
}
