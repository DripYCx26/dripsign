"use client";

import { LIMITS } from "@dripsign/core/schema";
import { Button, Notice, TextField } from "@/ui";
import styles from "./DraftEditor.module.css";
import { SectionEditor } from "./SectionEditor.tsx";
import type { EditableSection } from "./sections.ts";

export type Edit = Readonly<{ title: string; sections: readonly EditableSection[] }>;

type DraftFormProps = Readonly<{
  edit: Edit;
  onEdit: (next: Edit) => void;
  dirty: boolean;
  pending: boolean;
  /** The refusal or failure to show, if any. */
  message: string | null;
  onSave: () => void;
  onDiscard: () => void;
}>;

/** The draft's terms as a form with its Save draft and Discard changes actions. */
export function DraftForm({
  edit,
  onEdit,
  dirty,
  pending,
  message,
  onSave,
  onDiscard,
}: DraftFormProps) {
  return (
    <form
      className={styles.editor}
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <p className={styles.note}>Only your team sees this draft until you publish it.</p>
      <TextField
        label="Title"
        name="title"
        value={edit.title}
        maxLength={LIMITS.title}
        disabled={pending}
        onChange={(title) => {
          onEdit({ ...edit, title });
        }}
      />
      <SectionEditor
        sections={edit.sections}
        disabled={pending}
        onChange={(sections) => {
          onEdit({ ...edit, sections });
        }}
      />
      {message !== null && (
        <Notice tone="stop" live="alert">
          {message}
        </Notice>
      )}
      <div className={styles.actions}>
        <Button variant="ink" type="submit" loading={pending} disabled={!dirty && !pending}>
          Save draft
        </Button>
        <Button variant="quiet" disabled={pending} onClick={onDiscard}>
          Discard changes
        </Button>
      </div>
    </form>
  );
}
