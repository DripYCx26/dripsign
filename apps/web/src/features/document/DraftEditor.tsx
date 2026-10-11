"use client";

import type { AgreementView } from "@dripsign/core/types";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useCommand } from "@/features/command/useCommand";
import { Button, Pencil } from "@/ui";
import { DraftForm, type Edit } from "./DraftForm.tsx";
import styles from "./DraftEditor.module.css";
import { PdfReplacer } from "./PdfReplacer.tsx";
import { buildSource, emptySection, toEditable } from "./sections.ts";
import { useUnloadGuard } from "./useUnloadGuard.ts";

function startingEdit(view: AgreementView): Edit {
  const source = view.draft?.source ?? null;
  return source === null
    ? { title: view.agreement.title, sections: [emptySection()] }
    : { title: source.title, sections: toEditable(source.sections) };
}

/** The document as it is, with the one button that turns it into a form. */
function ReadOnlyDraft({
  onEdit,
  children,
}: Readonly<{ onEdit: () => void; children: ReactNode }>) {
  return (
    <div className={styles.editor}>
      <div>
        <Button variant="secondary" onClick={onEdit}>
          <Pencil aria-hidden="true" />
          Edit draft
        </Button>
      </div>
      {children}
    </div>
  );
}

/** A PDF draft has no text to edit; it offers a replacement file above the document. */
function PdfDraft({
  view,
  refresh,
  children,
}: Readonly<{ view: AgreementView; refresh: () => Promise<void>; children: ReactNode }>) {
  const router = useRouter();
  return (
    <div className={styles.editor}>
      <PdfReplacer
        agreementId={view.agreement.id}
        version={view.agreement.version}
        onUploaded={async () => {
          await refresh();
          router.refresh();
        }}
      />
      {children}
    </div>
  );
}

/**
 * The staff draft: the read-only document until "Edit draft", then the terms as a form. Saving
 * sends `save_draft` fenced on the version the form started from; leaving with unsaved text asks
 * first. A PDF draft has no text to edit, so it offers a replacement file instead.
 */
export function DraftEditor({
  view: initial,
  children,
}: Readonly<{ view: AgreementView; children: ReactNode }>) {
  const router = useRouter();
  const { view, run, pending, error, clearError, refresh } = useCommand(
    initial.agreement.id,
    "staff",
    initial,
  );
  const [baseline, setBaseline] = useState<Edit | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = edit !== null && JSON.stringify(edit) !== JSON.stringify(baseline);
  useUnloadGuard(dirty);

  function close() {
    setEdit(null);
    setBaseline(null);
    setProblem(null);
    clearError();
  }

  async function save(current: Edit) {
    const check = buildSource(current.title, current.sections);
    if (!check.ok) {
      setProblem(check.message);
      return;
    }
    setProblem(null);
    const saved = await run(
      {
        kind: "save_draft",
        expectedVersion: view.agreement.version,
        title: check.source.title,
        source: check.source,
      },
      "save_draft",
    );
    if (saved) {
      close();
      router.refresh();
    }
  }

  if (view.draft !== null && view.draft.upload !== null) {
    return (
      <PdfDraft view={view} refresh={refresh}>
        {children}
      </PdfDraft>
    );
  }
  if (edit !== null) {
    return (
      <DraftForm
        edit={edit}
        onEdit={setEdit}
        dirty={dirty}
        pending={pending}
        message={problem ?? error?.message ?? null}
        onSave={() => {
          void save(edit);
        }}
        onDiscard={close}
      />
    );
  }
  return (
    <ReadOnlyDraft
      onEdit={() => {
        const start = startingEdit(view);
        setBaseline(start);
        setEdit(start);
      }}
    >
      {children}
    </ReadOnlyDraft>
  );
}
