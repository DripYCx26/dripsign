"use client";

import { LIMITS } from "@dripsign/core/schema";
import { Notice, TextField } from "@/ui";
import styles from "./DraftForm.module.css";
import { SectionEditor } from "./SectionEditor.tsx";
import type { EditableSection } from "./sections.ts";

export type Edit = Readonly<{ title: string; sections: readonly EditableSection[] }>;

type DraftFormProps = Readonly<{
  edit: Edit;
  onEdit: (next: Edit) => void;
  pending: boolean;
  /** The refusal to show, if any. */
  message: string | null;
}>;

/** The draft's terms as a form. Save and Discard sit in the document header. */
export function DraftForm({ edit, onEdit, pending, message }: DraftFormProps) {
  return (
    <div className={styles.form}>
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
    </div>
  );
}
