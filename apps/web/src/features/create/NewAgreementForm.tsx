"use client";

import { LIMITS } from "@dripsign/core/schema";
import { useEffect, useRef, useState } from "react";
import type { EditableSection } from "@/features/document/sections.ts";
import { useUnloadGuard } from "@/features/document/useUnloadGuard.ts";
import { Segmented, TextField } from "@/ui";
import styles from "./NewAgreementForm.module.css";
import { emptyRow, type RecipientRow, type RowErrors } from "./recipients.ts";
import { RecipientRows } from "./RecipientRows.tsx";
import { SubmitBar } from "./SubmitBar.tsx";
import { templateSections, templateTitle, type TemplateId } from "./templates.ts";
import { TermsSection } from "./TermsSection.tsx";
import { useCreateAgreement } from "./useCreateAgreement.ts";
import { hasContent, type FormValues, type Mode } from "./validate.ts";

const MODES = [
  { value: "write", label: "Write terms" },
  { value: "upload", label: "Upload PDF" },
] as const;

const NO_ROW_ERRORS: ReadonlyMap<string, RowErrors> = new Map();

/**
 * The create form: a title, the terms written here or as a PDF, and the recipients. Submitting is
 * `useCreateAgreement`'s; once the draft exists the form locks so a retry cannot send different
 * details under the same receipt key.
 */
export function NewAgreementForm() {
  const form = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<Mode>("write");
  const [template, setTemplate] = useState<TemplateId>("blank");
  const [sections, setSections] = useState<readonly EditableSection[]>(() =>
    templateSections("blank"),
  );
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<readonly RecipientRow[]>(() => [emptyRow()]);
  const { phase, busy, problem, errors, createdId, submit } = useCreateAgreement();

  const locked = busy || createdId !== null;
  const values: FormValues = { title, mode, sections, file, rows };
  useUnloadGuard(hasContent(values) && createdId === null);

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
      <TextField
        label="Title"
        name="title"
        value={title}
        maxLength={LIMITS.title}
        disabled={locked}
        error={errors?.title}
        onChange={setTitle}
      />
      <Segmented
        label="Terms"
        name="mode"
        options={MODES}
        value={mode}
        onChange={setMode}
        disabled={locked}
      />
      <TermsSection
        mode={mode}
        template={template}
        onTemplate={(next) => {
          setTemplate(next);
          setSections(templateSections(next));
          if (title.trim() === "") setTitle(templateTitle(next));
        }}
        sections={sections}
        onSections={setSections}
        file={file}
        onFile={setFile}
        disabled={locked}
      />
      {errors?.terms !== undefined && (
        <p className={styles.error} role="alert">
          {errors.terms}
        </p>
      )}
      <RecipientRows
        rows={rows}
        onChange={setRows}
        errors={errors?.rows ?? NO_ROW_ERRORS}
        disabled={locked}
      />
      <SubmitBar phase={phase} problem={problem} createdId={createdId} />
    </form>
  );
}
