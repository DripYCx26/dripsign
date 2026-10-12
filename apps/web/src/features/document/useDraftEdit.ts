"use client";

import type { DocumentSource } from "@dripsign/core/schema";
import type { AgreementView } from "@dripsign/core/types";
import { useState } from "react";
import type { RunCommand } from "@/features/workspace/commands.ts";
import type { Edit } from "./DraftForm.tsx";
import { buildSource, toEditable } from "./sections.ts";
import { useUnloadGuard } from "./useUnloadGuard.ts";

/** What the form starts from: the draft's terms. */
function startingEdit(source: DocumentSource): Edit {
  return { title: source.title, sections: toEditable(source.sections) };
}

/** One editing session. `version` is the agreement version the form started from, frozen. */
type Session = Readonly<{ baseline: Edit; edit: Edit; version: number }>;

/**
 * The draft's edit session. Saving sends `save_draft` fenced on the version the form started from,
 * not the live one, so a draft someone else changed meanwhile is refused instead of overwritten.
 * The command goes through the workspace's one channel (`run`, `busy`); leaving with unsaved text
 * asks first.
 */
export function useDraftEdit(view: AgreementView, run: RunCommand) {
  const [session, setSession] = useState<Session | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const dirty =
    session !== null && JSON.stringify(session.edit) !== JSON.stringify(session.baseline);
  useUnloadGuard(dirty);

  function discard() {
    setSession(null);
    setProblem(null);
  }

  async function save() {
    if (session === null) return;
    const check = buildSource(session.edit.title, session.edit.sections);
    if (!check.ok) {
      setProblem(check.message);
      return;
    }
    setProblem(null);
    const saved = await run(
      {
        kind: "save_draft",
        expectedVersion: session.version,
        title: check.source.title,
        source: check.source,
      },
      "save_draft",
    );
    if (saved) discard();
  }

  return {
    edit: session?.edit ?? null,
    dirty,
    problem,
    begin: () => {
      if (view.draft === null) return;
      const start = startingEdit(view.draft.source);
      setSession({ baseline: start, edit: start, version: view.agreement.version });
    },
    change: (next: Edit) => {
      setSession((current) => (current === null ? null : { ...current, edit: next }));
    },
    save,
    discard,
  };
}

export type DraftEdit = ReturnType<typeof useDraftEdit>;
