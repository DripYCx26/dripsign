"use client";

import type { CompletionExportConfig } from "@dripsign/core/schema";
import type { CompletionExportSettings } from "@dripsign/core/types";
import { useRouter } from "next/navigation";
import { useRef, useState, type SubmitEvent } from "react";
import { formText } from "@/features/shell/formText.ts";
import { settle } from "@/features/shell/settle.ts";
import { saveCompletionExport } from "@/server/actions/settings.ts";
import { Button, Notice, TextField } from "@/ui";
import styles from "./CompletionExport.module.css";

const STALE = "These settings changed. Reload to see the latest.";

type FieldName = keyof CompletionExportConfig;

/** The pins in the order the host hands them over; counts are whole numbers. */
const FIELDS: readonly Readonly<{
  name: FieldName;
  label: string;
  count?: true;
  wide?: true;
}>[] = [
  { name: "hostTenantId", label: "Host tenant ID" },
  { name: "senderBindingId", label: "Sender binding ID" },
  { name: "senderBindingRevision", label: "Sender binding revision", count: true },
  { name: "senderGrantId", label: "Sender grant ID" },
  { name: "issuer", label: "Issuer", wide: true },
  { name: "audience", label: "Audience", wide: true },
  { name: "keyId", label: "Key ID" },
  { name: "keyVersion", label: "Key version", count: true },
  { name: "freshnessSeconds", label: "Freshness (seconds)", count: true },
];

type Props = Readonly<{ settings: CompletionExportSettings }>;

/** A blank count stays NaN, so the schema names the field instead of saving zero. */
function fieldValue(data: FormData, name: FieldName, count: boolean): string | number {
  const text = formText(data, name);
  if (!count) return text;
  return text === "" ? Number.NaN : Number(text);
}

/** The typed shape the server action validates; the core schema is the judge of each value. */
function readConfig(data: FormData): CompletionExportConfig {
  const entries = FIELDS.map(({ name, count }) => [name, fieldValue(data, name, count === true)]);
  return Object.fromEntries(entries) as CompletionExportConfig;
}

/** What each field starts with: the current revision, else what this server expects. */
function initialValues(settings: CompletionExportSettings): Partial<Record<FieldName, string>> {
  const current = settings.current?.config;
  if (current !== undefined) {
    return Object.fromEntries(
      Object.entries(current).map(([name, value]) => [name, String(value)]),
    );
  }
  return {
    issuer: settings.expected.issuer,
    ...(settings.expected.audience === null ? {} : { audience: settings.expected.audience }),
    freshnessSeconds: "300",
  };
}

const HINTS: Partial<Record<FieldName, string>> = {
  freshnessSeconds: "How long each delivery attempt's signature stays valid, at most 300.",
};

/** Saves the next revision of the host's public pins; a stale form is refused, never merged. */
export function CompletionExportForm({ settings }: Props) {
  const router = useRouter();
  const outcome = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const initial = initialValues(settings);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setProblem(null);
    setSaved(null);
    const result = await settle(
      saveCompletionExport({
        expectedRevision: settings.current?.revision ?? 0,
        config: readConfig(new FormData(event.currentTarget)),
      }),
    );
    setPending(false);
    if (result.ok) {
      setSaved(result.value);
      router.refresh();
    } else setProblem(result.code === "conflict" ? STALE : result.message);
    outcome.current?.focus();
  }

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <div ref={outcome} className={styles.outcome} tabIndex={-1}>
        {problem !== null && (
          <Notice tone="stop" live="alert">
            {problem}
          </Notice>
        )}
        {saved !== null && (
          <Notice tone="confirm" live="polite">
            Saved as revision {saved}. Agreements signed from now on use it.
          </Notice>
        )}
      </div>
      {FIELDS.map(({ name, label, wide }) => (
        <div key={name} className={wide === true ? styles.wide : undefined}>
          <TextField
            label={label}
            name={name}
            hint={HINTS[name]}
            defaultValue={initial[name]}
            autoComplete="off"
            required
          />
        </div>
      ))}
      <div className={styles.save}>
        <Button type="submit" variant="ink" loading={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}
