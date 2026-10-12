"use client";

import { LIMITS } from "@dripsign/core/schema";
import { useEffect, useId, useRef, useState } from "react";
import { SectionEditor } from "@/features/document/SectionEditor.tsx";
import { emptySection, type EditableSection } from "@/features/document/sections.ts";
import { useUnloadGuard } from "@/features/document/useUnloadGuard.ts";
import { TextField } from "@/ui";
import styles from "./NewAgreementForm.module.css";
import { emptyRow, type RecipientRow, type RowErrors } from "./recipients.ts";
import { RecipientRows } from "./RecipientRows.tsx";
import { SubmitBar } from "./SubmitBar.tsx";
import { TemplatePicker } from "./TemplatePicker.tsx";
import { templateSections, templateTitle, type TemplateId } from "./templates.ts";
import { useCreateAgreement } from "./useCreateAgreement.ts";
import { hasContent, type FormValues } from "./validate.ts";

// Ids come from useId: random ones differ between the server render and hydration.
const startSections = (id: string): readonly EditableSection[] => [emptySection(`section-${id}`)];
const startRows = (id: string): readonly RecipientRow[] => [emptyRow(`row-${id}`)];

const NO_ROW_ERRORS: ReadonlyMap<string, RowErrors> = new Map();

/**
 * The create form: the terms (title and written sections, from a starter text or blank) beside
 * the recipients and the submit button. Submitting is `useCreateAgreement`'s; the form locks while
 * it runs.
 */
export function NewAgreementForm() {
  const form = useRef<HTMLFormElement>(null);
  const startId = useId();
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<TemplateId>("blank");
  const [sections, setSections] = useState(() => startSections(startId));
  const [rows, setRows] = useState(() => startRows(startId));
  const { busy, problem, errors, submit } = useCreateAgreement();

  const values: FormValues = { title, sections, rows };
  useUnloadGuard(hasContent(values));

  // A refused submit moves focus to the first field with a message.
  useEffect(() => {
    if (errors === null) return;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  return (
    <form
      ref={form}
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit(values);
      }}
    >
      <div className={styles.main}>
        <TextField
          label="Title"
          hideLabel
          placeholder="Title"
          name="title"
          value={title}
          maxLength={LIMITS.title}
          disabled={busy}
          error={errors?.title}
          onChange={setTitle}
        />
        <TemplatePicker
          value={template}
          onChange={(next) => {
            setTemplate(next);
            setSections(templateSections(next));
            if (title.trim() === "") setTitle(templateTitle(next));
          }}
          disabled={busy}
        />
        <SectionEditor sections={sections} onChange={setSections} disabled={busy} />
        {errors?.terms !== undefined && (
          <p className={styles.error} role="alert">
            {errors.terms}
          </p>
        )}
      </div>
      <div className={styles.side}>
        <RecipientRows
          rows={rows}
          onChange={setRows}
          errors={errors?.rows ?? NO_ROW_ERRORS}
          disabled={busy}
        />
        <SubmitBar busy={busy} problem={problem} />
      </div>
    </form>
  );
}
