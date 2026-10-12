"use client";

import { LIMITS, type Command, type DocumentSource } from "@dripsign/core/schema";
import type { AgreementView, ProposalView } from "@dripsign/core/types";
import { useEffect, type ReactNode, type RefObject, type SubmitEvent } from "react";
import { SectionDiff } from "@/features/document/SectionDiff.tsx";
import type { RunCommand } from "@/features/workspace/commands.ts";
import { ArrowUp, IconButton, X } from "@/ui";
import { sendOnEnter } from "./enterToSend.ts";
import { cancelProposal, startProposal, type ProposalIntent } from "./intent.ts";
import {
  baseSourceOf,
  changedSection,
  currentRevision,
  MESSAGE_FIELD_ID,
  paragraphsOf,
  replaceSection,
  sectionLabel,
  wordingOf,
} from "./model.ts";
import styles from "./ProposalComposer.module.css";
import { useAutosize } from "./useAutosize.ts";
import { useStoredText, type TextScope } from "./useStoredText.ts";

type ProposalComposerProps = Readonly<{
  view: AgreementView;
  scope: TextScope;
  intent: ProposalIntent;
  /** The open proposal this one answers; null for a fresh proposal. */
  target: ProposalView | null;
  run: RunCommand;
  busy: boolean;
  onSent: () => void;
}>;

type Section = DocumentSource["sections"][number];

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

/** Leaving proposal mode returns the cursor to the message field, where typing goes on. */
function leave() {
  cancelProposal();
  window.requestAnimationFrame(() => {
    document.getElementById(MESSAGE_FIELD_ID)?.focus();
  });
}

type FrameProps = Readonly<{
  title: ReactNode;
  warning: string | null;
  canSend: boolean;
  onSubmit: () => void;
  children: ReactNode;
}>;

/** The parts every proposal shares: what is being proposed, cancel, and the round send button. */
function ProposalFrame({ title, warning, canSend, onSubmit, children }: FrameProps) {
  return (
    <form
      className={styles.box}
      onSubmit={(event: SubmitEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <header className={styles.head}>
        <p className={styles.title}>{title}</p>
        <IconButton label="Cancel proposal" icon={<X />} onClick={leave} />
      </header>
      <div className={styles.body}>{children}</div>
      <div className={styles.foot}>
        {warning === null ? <span /> : <p className={styles.warning}>{warning}</p>}
        <IconButton
          variant="ink"
          shape="round"
          type="submit"
          label="Send proposal"
          icon={<ArrowUp />}
          disabled={!canSend}
        />
      </div>
    </form>
  );
}

function titleOf(target: ProposalView | null): ReactNode {
  return target === null ? "Proposing a change" : `Countering ${target.author.label}'s proposal`;
}

/** Sending this ends a live signature request, which only a recipient's proposal can do. */
function warningOf(view: AgreementView): string | null {
  const live = view.activeRound?.status === "active";
  return view.viewer.capacity === "recipient" && live
    ? "Sending this cancels the current signature request."
    : null;
}

/** The text of a counter's starting point: the wording of the section the other side changed. */
function theirWording(view: AgreementView, target: ProposalView): Section | null {
  return changedSection(baseSourceOf(view, target), target.replacementSource)?.section ?? null;
}

/** Focuses the first field when proposing begins, so the next keystroke is the proposal. */
function useFocusOnMount(field: RefObject<HTMLTextAreaElement | null>) {
  useEffect(() => {
    field.current?.focus();
  }, [field]);
}

/** A PDF cannot be edited in the browser, so the change is described in words. */
function PdfProposal({ view, scope, target, run, busy, onSent }: ProposalComposerProps) {
  const [stored, setStored, clearSent] = useStoredText(scope, `${target?.id ?? "propose"}:text`);
  const text = stored ?? "";
  const field = useAutosize(text);
  useFocusOnMount(field);
  const ready = text.trim() !== "" && !busy;

  async function send() {
    if (!ready) return;
    const intent = target === null ? "propose" : `counter:${target.id}`;
    if (await run(proposalCommand(view, target, text.trim(), null), intent)) {
      clearSent(stored);
      onSent();
      leave();
    }
  }

  return (
    <ProposalFrame
      title={titleOf(target)}
      warning={warningOf(view)}
      canSend={ready}
      onSubmit={() => void send()}
    >
      <textarea
        ref={field}
        className={styles.field}
        rows={1}
        aria-label="Describe the change you need"
        placeholder="Describe the change you need"
        maxLength={LIMITS.proposalText}
        value={text}
        onChange={(event) => {
          setStored(event.target.value);
        }}
        onKeyDown={(event) => {
          sendOnEnter(event, () => void send());
        }}
      />
    </ProposalFrame>
  );
}

/** The section being rewritten, and the wording the field starts from. */
function resolveSection(
  view: AgreementView,
  source: DocumentSource,
  intent: ProposalIntent,
  target: ProposalView | null,
): Readonly<{ section: Section; initial: string }> | null {
  const theirs = target === null ? null : theirWording(view, target);
  const section =
    source.sections.find((s) => s.id === (intent.sectionId ?? theirs?.id)) ?? source.sections[0];
  if (section === undefined) return null;
  const start = theirs?.id === section.id ? theirs : section;
  return { section, initial: wordingOf(start) };
}

/**
 * A counter answers a particular proposal, so it names that; a fresh proposal lets the person pick
 * which section to rewrite.
 */
function SectionTitle({
  source,
  section,
  target,
}: Readonly<{ source: DocumentSource; section: Section; target: ProposalView | null }>) {
  if (target !== null || source.sections.length < 2) return titleOf(target);
  return (
    <>
      <span>Proposing a change to</span>
      <select
        className={styles.section}
        aria-label="Section"
        value={section.id}
        onChange={(event) => {
          startProposal({ sectionId: event.target.value });
        }}
      >
        {source.sections.map((s, index) => (
          <option key={s.id} value={s.id}>
            {sectionLabel(s.heading, index)}
          </option>
        ))}
      </select>
    </>
  );
}

type SectionFormProps = ProposalComposerProps &
  Readonly<{ source: DocumentSource; section: Section; initial: string }>;

/** The wording, its live diff and the reason for one section; Enter in the reason sends. */
function SectionForm(props: SectionFormProps) {
  const { view, scope, target, source, section, initial, run, busy, onSent } = props;
  const prefix = target === null ? "propose" : `counter:${target.id}`;
  const [storedWording, setWording, clearWording] = useStoredText(
    scope,
    `${prefix}:${section.id}:wording`,
  );
  const [storedReason, setReason, clearReason] = useStoredText(scope, `${prefix}:reason`);
  const wording = storedWording ?? initial;
  const reason = storedReason ?? "";
  const wordingField = useAutosize(wording);
  const reasonField = useAutosize(reason);
  useFocusOnMount(wordingField);

  const paragraphs = paragraphsOf(wording);
  const { source: replacement, error } = replaceSection(source, section.id, paragraphs);
  const changed = JSON.stringify(paragraphs) !== JSON.stringify(section.paragraphs);
  const ready = replacement !== null && changed && reason.trim() !== "" && !busy;

  async function send() {
    if (!ready) return;
    const intentId = target === null ? "propose" : `counter:${target.id}`;
    if (await run(proposalCommand(view, target, reason.trim(), replacement), intentId)) {
      clearWording(storedWording);
      clearReason(storedReason);
      onSent();
      leave();
    }
  }

  return (
    <ProposalFrame
      title={<SectionTitle source={source} section={section} target={target} />}
      warning={warningOf(view)}
      canSend={ready}
      onSubmit={() => void send()}
    >
      <textarea
        ref={wordingField}
        className={styles.wording}
        rows={1}
        aria-label="Proposed wording"
        maxLength={LIMITS.paragraph * LIMITS.paragraphsPerSection}
        value={wording}
        onChange={(event) => {
          setWording(event.target.value);
        }}
      />
      {error !== undefined && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {changed && replacement !== null && (
        <section className={styles.preview} aria-label="Your proposed change">
          <SectionDiff before={source} after={replacement} namedSectionId={section.id} />
        </section>
      )}
      <textarea
        ref={reasonField}
        className={styles.field}
        rows={1}
        aria-label="Reason"
        placeholder="Why this change?"
        maxLength={LIMITS.proposalText}
        value={reason}
        onChange={(event) => {
          setReason(event.target.value);
        }}
        onKeyDown={(event) => {
          sendOnEnter(event, () => void send());
        }}
      />
    </ProposalFrame>
  );
}

function SectionProposal(props: ProposalComposerProps & Readonly<{ source: DocumentSource }>) {
  const resolved = resolveSection(props.view, props.source, props.intent, props.target);
  return resolved === null ? null : <SectionForm {...props} {...resolved} />;
}

/**
 * Proposal mode of the composer: terms are edited by section with a live diff, a PDF is described
 * in words. Starting from "Propose a change", a document section or a Counter lands here.
 */
export function ProposalComposer(props: ProposalComposerProps) {
  const source = currentRevision(props.view)?.source ?? null;
  if (source === null) return <PdfProposal {...props} />;
  return <SectionProposal {...props} source={source} />;
}
