"use client";

import { LIMITS, type Command, type DocumentSource } from "@dripsign/core/schema";
import type { AgreementView, ProposalView } from "@dripsign/core/types";
import type { SubmitEvent } from "react";
import { SectionDiff } from "@/features/document/SectionDiff.tsx";
import type { RunCommand } from "@/features/workspace/commands.ts";
import { Button, Select, TextArea } from "@/ui";
import { currentRevision, paragraphsOf, replaceSection, sectionLabel, wordingOf } from "./model.ts";
import styles from "./Composer.module.css";
import { useStoredText } from "./useStoredText.ts";

type ProposeFormProps = Readonly<{
  view: AgreementView;
  run: RunCommand;
  busy: boolean;
  /** The open proposal this one answers; null for a fresh proposal. */
  target: ProposalView | null;
  onSent: () => void;
}>;

function proposalCommand(
  view: AgreementView,
  target: ProposalView | null,
  text: string,
  replacementSource: DocumentSource | null,
): Command {
  const expectedVersion = view.agreement.version;
  const replacement = replacementSource === null ? {} : { replacementSource };
  if (target === null) return { kind: "propose", expectedVersion, text, ...replacement };
  return { kind: "counter", expectedVersion, proposalId: target.id, text, ...replacement };
}

function submitLabel(target: ProposalView | null): string {
  return target === null ? "Send proposal" : "Send counterproposal";
}

/** A PDF cannot be edited in the browser, so the change is described in words. */
function PdfProposal({ view, run, busy, target, onSent }: ProposeFormProps) {
  const id = view.agreement.id;
  const [stored, setStored] = useStoredText(id, "propose:text");
  const text = stored ?? "";
  const ready = text.trim() !== "" && !busy;

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const intent = target === null ? "propose" : `counter:${target.id}`;
    if (await run(proposalCommand(view, target, text.trim(), null), intent)) {
      setStored(null);
      onSent();
    }
  }

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <TextArea
        label="Describe the change you need"
        name="proposal-text"
        maxLength={LIMITS.proposalText}
        value={text}
        onChange={setStored}
      />
      <Button variant="ink" type="submit" disabled={!ready} loading={busy}>
        {submitLabel(target)}
      </Button>
    </form>
  );
}

/** Replace one section's wording; the rest of the revision travels unchanged. */
function SectionProposal({
  view,
  source,
  run,
  busy,
  target,
  onSent,
}: ProposeFormProps & Readonly<{ source: DocumentSource }>) {
  const id = view.agreement.id;
  const [storedSection, setSection] = useStoredText(id, "propose:section");
  const [storedWording, setWording] = useStoredText(id, "propose:wording");
  const [storedReason, setReason] = useStoredText(id, "propose:reason");
  const section = source.sections.find((s) => s.id === storedSection) ?? source.sections[0];
  if (section === undefined) return null;

  const wording = storedWording ?? wordingOf(section);
  const reason = storedReason ?? "";
  const paragraphs = paragraphsOf(wording);
  const { source: replacement, error } = replaceSection(source, section.id, paragraphs);
  const changed = JSON.stringify(paragraphs) !== JSON.stringify(section.paragraphs);
  const ready = replacement !== null && changed && reason.trim() !== "" && !busy;

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (replacement === null) return;
    const intent = target === null ? "propose" : `counter:${target.id}`;
    if (await run(proposalCommand(view, target, reason.trim(), replacement), intent)) {
      setSection(null);
      setWording(null);
      setReason(null);
      onSent();
    }
  }

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <Select
        label="Which section?"
        name="proposal-section"
        value={section.id}
        options={source.sections.map((s, index) => ({
          value: s.id,
          label: sectionLabel(s.heading, index),
        }))}
        onChange={(next) => {
          setSection(next);
          setWording(null);
        }}
      />
      <TextArea
        label="Proposed wording"
        name="proposal-wording"
        maxLength={LIMITS.paragraph * LIMITS.paragraphsPerSection}
        value={wording}
        onChange={setWording}
        error={error}
      />
      <TextArea
        label="Reason"
        name="proposal-reason"
        maxLength={LIMITS.proposalText}
        value={reason}
        onChange={setReason}
      />
      {changed && replacement !== null && (
        <div className={styles.preview} aria-label="Your proposed change">
          <SectionDiff before={source} after={replacement} />
        </div>
      )}
      <Button variant="ink" type="submit" disabled={!ready} loading={busy}>
        {submitLabel(target)}
      </Button>
    </form>
  );
}

/** The "Propose change" half of the composer: terms are edited by section, a PDF is described. */
export function ProposeForm(props: ProposeFormProps) {
  const source = currentRevision(props.view)?.source ?? null;
  if (source === null) return <PdfProposal {...props} />;
  return <SectionProposal {...props} source={source} />;
}
