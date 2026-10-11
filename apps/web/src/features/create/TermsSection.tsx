"use client";

import { LIMITS } from "@dripsign/core/schema";
import { Dropzone, Segmented } from "@/ui";
import { SectionEditor } from "@/features/document/SectionEditor.tsx";
import type { EditableSection } from "@/features/document/sections.ts";
import styles from "./NewAgreementForm.module.css";
import { TemplatePicker } from "./TemplatePicker.tsx";
import type { TemplateId } from "./templates.ts";
import type { Mode } from "./validate.ts";

const MODES = [
  { value: "write", label: "Write terms" },
  { value: "upload", label: "Upload PDF" },
] as const;

const BYTES_PER_MB = 1024 * 1024;

function describeFile(file: File): string {
  const megabytes = file.size / BYTES_PER_MB;
  return `${file.name} · ${megabytes < 0.1 ? "under 0.1" : megabytes.toFixed(1)} MB`;
}

type TermsSectionProps = Readonly<{
  mode: Mode;
  onMode: (next: Mode) => void;
  template: TemplateId;
  onTemplate: (next: TemplateId) => void;
  sections: readonly EditableSection[];
  onSections: (next: readonly EditableSection[]) => void;
  file: File | null;
  onFile: (file: File) => void;
  disabled: boolean;
}>;

/** The terms: choose to write sections (with starter texts) or upload a PDF, then give them. */
export function TermsSection({
  mode,
  onMode,
  template,
  onTemplate,
  sections,
  onSections,
  file,
  onFile,
  disabled,
}: TermsSectionProps) {
  return (
    <div className={styles.section}>
      <Segmented
        label="Terms source"
        hideLabel
        name="mode"
        options={MODES}
        value={mode}
        onChange={onMode}
        disabled={disabled}
      />
      {mode === "write" ? (
        <>
          <TemplatePicker value={template} onChange={onTemplate} disabled={disabled} />
          <SectionEditor sections={sections} onChange={onSections} disabled={disabled} />
        </>
      ) : (
        <>
          <Dropzone maxMb={LIMITS.pdfBytes / BYTES_PER_MB} disabled={disabled} onFile={onFile} />
          {file !== null && <p className={styles.file}>{describeFile(file)}</p>}
        </>
      )}
    </div>
  );
}
