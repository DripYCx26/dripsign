"use client";

import { Button, Check, ChevronDown, Menu, Segmented } from "@/ui";
import styles from "./DocumentControls.module.css";
import type { DocumentState } from "./useDocumentState.ts";
import { useRevisionParam } from "./useRevisionParam.ts";

const MODES = [
  { value: "reading", label: "Reading" },
  { value: "pdf", label: "PDF" },
] as const;

/** The revision shown, with a menu to choose another when there is another to choose. */
function RevisionMenu({ doc }: Readonly<{ doc: DocumentState }>) {
  const choose = useRevisionParam();
  const { options, value, defaultValue, draft } = doc;
  const label = options.find((option) => option.value === value)?.label ?? "";
  return (
    <div className={styles.revision}>
      <span className={styles.label}>{label}</span>
      {options.length > 1 && (
        <Menu
          label="Choose revision"
          icon={<ChevronDown aria-hidden="true" />}
          // Hold the revision still for as long as the draft is being edited.
          disabled={draft.edit !== null}
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

/** Edit draft, or Save and Discard while the form is open; for an uploaded PDF, Replace PDF. */
function DraftActions({ doc, busy }: Readonly<{ doc: DocumentState; busy: boolean }>) {
  const { draft, uploaded, replacing, setReplacing } = doc;
  if (uploaded) {
    return (
      <Button
        variant="secondary"
        size="sm"
        pressed={replacing}
        onClick={() => {
          setReplacing(!replacing);
        }}
      >
        Replace PDF
      </Button>
    );
  }
  if (draft.edit === null) {
    return (
      <Button variant="secondary" size="sm" onClick={draft.begin}>
        Edit draft
      </Button>
    );
  }
  return (
    <>
      <Button variant="quiet" size="sm" disabled={busy} onClick={draft.discard}>
        Discard
      </Button>
      <Button
        variant="ink"
        size="sm"
        loading={busy}
        disabled={!draft.dirty}
        onClick={() => void draft.save()}
      >
        Save
      </Button>
    </>
  );
}

/**
 * The document's controls, which sit in the workspace's title row: which revision, Reading or PDF,
 * and the draft's actions. Each part appears only when it has something to choose.
 */
export function DocumentControls({ doc, busy }: Readonly<{ doc: DocumentState; busy: boolean }>) {
  const { switchableMode, setMode, editable } = doc;
  return (
    <div className={styles.controls}>
      <RevisionMenu doc={doc} />
      {switchableMode !== null && (
        <Segmented
          label="Document view"
          hideLabel
          name="document-view"
          size="sm"
          options={MODES}
          value={switchableMode}
          onChange={setMode}
        />
      )}
      {editable && <DraftActions doc={doc} busy={busy} />}
    </div>
  );
}
