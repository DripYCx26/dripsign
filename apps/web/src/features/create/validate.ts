import {
  newAgreementInputSchema,
  titleSchema,
  type NewAgreementInput,
} from "@dripsign/core/schema";
import { buildSource, type EditableSection, type SourceCheck } from "../document/sections.ts";
import { duplicateKeys, rowErrors, type RecipientRow, type RowErrors } from "./recipients.ts";

export type Mode = "write" | "upload";

export interface FormValues {
  readonly title: string;
  readonly mode: Mode;
  readonly sections: readonly EditableSection[];
  readonly file: File | null;
  readonly rows: readonly RecipientRow[];
}

export interface FormErrors {
  readonly title?: string | undefined;
  readonly terms?: string | undefined;
  readonly rows: ReadonlyMap<string, RowErrors>;
  /** Anything the field checks did not name, from the whole-input schema. */
  readonly general?: string | undefined;
}

export type Validation =
  Readonly<{ ok: true; input: NewAgreementInput }> | Readonly<{ ok: false; errors: FormErrors }>;

function termsError(values: FormValues, source: SourceCheck | null): string | undefined {
  if (values.mode === "upload") return values.file === null ? "Choose a PDF." : undefined;
  return source !== null && !source.ok ? source.message : undefined;
}

/**
 * The form's checks, in the words of the shared schemas, so a refusal reads the same here and on
 * the server. Field messages show beside their field; the whole-input schema is the last word.
 */
export function validateForm(values: FormValues): Validation {
  const title = titleSchema.safeParse(values.title);
  const source = values.mode === "write" ? buildSource(values.title, values.sections) : null;
  const terms = termsError(values, source);
  const rows = rowErrors(values.rows);
  const fieldsOk =
    title.success &&
    terms === undefined &&
    rows.size === 0 &&
    duplicateKeys(values.rows).size === 0;
  if (!fieldsOk) {
    return {
      ok: false,
      errors: { title: title.success ? undefined : title.error.issues[0]?.message, terms, rows },
    };
  }
  const parsed = newAgreementInputSchema.safeParse({
    title: values.title,
    document: source?.ok === true ? { kind: "source", source: source.source } : { kind: "upload" },
    recipients: values.rows.map(({ name, email, isSigner }) => ({ name, email, isSigner })),
  });
  if (!parsed.success) {
    return {
      ok: false,
      errors: { rows, general: parsed.error.issues[0]?.message ?? "Check the details." },
    };
  }
  return { ok: true, input: parsed.data };
}

/** Whether the form holds anything worth warning about before the page is left. */
export function hasContent(values: FormValues): boolean {
  return (
    values.title.trim() !== "" ||
    values.file !== null ||
    values.sections.some((section) => section.heading !== "" || section.body !== "") ||
    values.rows.some((row) => row.name !== "" || row.email !== "")
  );
}
