"use client";

import type { AgreementView } from "@dripsign/core/types";
import { buildSource } from "@/features/document/sections.ts";
import type { RunCommand } from "@/features/workspace/commands.ts";
import { Button } from "@/ui";
import styles from "./Starters.module.css";
import {
  TEMPLATE_NOTE,
  TEMPLATE_OPTIONS,
  templateSections,
  templateTitle,
  type TemplateId,
} from "./templates.ts";

type StartersProps = Readonly<{ view: AgreementView; run: RunCommand; busy: boolean }>;

/** Starter texts as buttons: choosing one writes it as the draft, fenced on the draft seen. */
export function Starters({ view, run, busy }: StartersProps) {
  async function start(id: TemplateId) {
    const check = buildSource(templateTitle(id), templateSections(id));
    const expectedDraftVersion = view.agreement.draftVersion;
    if (!check.ok || expectedDraftVersion === null) return;
    await run({ kind: "save_draft", expectedDraftVersion, source: check.source }, "starter");
  }

  return (
    <div className={styles.starters}>
      <div className={styles.row} role="group" aria-label="Start from a template">
        {TEMPLATE_OPTIONS.map((option) => (
          <Button
            key={option.value}
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void start(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <p className={styles.note}>{TEMPLATE_NOTE}</p>
    </div>
  );
}
