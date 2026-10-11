"use client";

import { LIMITS } from "@dripsign/core/schema";
import { Dropzone } from "@/ui";
import { SectionEditor } from "@/features/document/SectionEditor.tsx";
import type { EditableSection } from "@/features/document/sections.ts";
import styles from "./NewAgreementForm.module.css";
import { TemplatePicker } from "./TemplatePicker.tsx";
import type { TemplateId } from "./templates.ts";
import type { Mode } from "./validate.ts";

const BYTES_PER_MB = 1024 * 1024;

function describeFile(file: File): string {
  const megabytes = file.size / BYTES_PER_MB;
  return `${file.name} · ${megabytes < 0.1 ? "under 0.1" : megabytes.toFixed(1)} MB`;
}

type TermsSectionProps = Readonly<{
  mode: Mode;
  template: TemplateId;
  onTemplate: (next: TemplateId) => void;
  sections: readonly EditableSection[];
  onSections: (next: readonly EditableSection[]) => void;
  file: File | null;
  onFile: (file: File) => void;
  disabled: boolean;
}>;

/** The terms: written sections (with starter texts) or the PDF to upload. */
export function TermsSection({
  mode,
  template,
  onTemplate,
  sections,
  onSections,
  file,
  onFile,
  disabled,
}: TermsSectionProps) {
  if (mode === "write") {
    return (
      <section className={styles.section} aria-labelledby="terms-heading">
        <h2 id="terms-heading" className={styles.heading}>
          Terms
        </h2>
        <TemplatePicker value={template} onChange={onTemplate} disabled={disabled} />
        <SectionEditor sections={sections} onChange={onSections} disabled={disabled} />
      </section>
    );
  }
  return (
    <section className={styles.section} aria-labelledby="pdf-heading">
      <h2 id="pdf-heading" className={styles.heading}>
        PDF
      </h2>
      <Dropzone maxMb={LIMITS.pdfBytes / BYTES_PER_MB} disabled={disabled} onFile={onFile} />
      {file !== null && <p className={styles.file}>{describeFile(file)}</p>}
    </section>
  );
}
