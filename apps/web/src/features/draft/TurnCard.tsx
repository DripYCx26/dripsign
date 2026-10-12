"use client";

import type { AiDraft, AiPlan } from "@dripsign/core/schema";
import type { AgreementView, AiSuggestionView } from "@dripsign/core/types";
import { SectionDiff } from "@/features/document/SectionDiff.tsx";
import type { RunCommand } from "@/features/workspace/commands.ts";
import { Button, ChevronDown, Notice, Pill } from "@/ui";
import type { CandidatePreview } from "./candidate.ts";
import { WRITE_DRAFT } from "./turnMode.ts";
import styles from "./TurnCard.module.css";

type TurnProps = Readonly<{
  view: AgreementView;
  turn: AiSuggestionView;
  /** The id of the draft the sheet previews, if any. */
  candidateId: string | null;
  /** Nothing was asked after this turn. */
  newest: boolean;
  run: RunCommand;
  busy: boolean;
  preview: CandidatePreview | undefined;
}>;

function Questions({ questions }: Readonly<{ questions: readonly string[] }>) {
  if (questions.length === 0) return null;
  return (
    <section className={styles.questions}>
      <h3 className={styles.label}>Questions</h3>
      <ul>
        {questions.map((question) => (
          <li key={question}>{question}</li>
        ))}
      </ul>
    </section>
  );
}

function PlanCard({ plan, view, newest, run, busy }: Readonly<{ plan: AiPlan }> & TurnProps) {
  const canAsk = view.allowedActions.includes("ask_ai");
  return (
    <article className={styles.card}>
      <p className={styles.summary}>{plan.summary}</p>
      <ol className={styles.outline}>
        {plan.outline.map((item) => (
          <li key={item.heading}>
            <span className={styles.heading}>{item.heading}</span>
            <span className={styles.intent}>{item.intent}</span>
          </li>
        ))}
      </ol>
      <Questions questions={plan.questions} />
      {newest && canAsk && (
        <div>
          <Button
            variant="ink"
            size="sm"
            disabled={busy}
            onClick={() => {
              void run(WRITE_DRAFT, "ask_ai:write");
            }}
          >
            Write the draft
          </Button>
        </div>
      )}
    </article>
  );
}

/** What a draft reply can still do: apply, bring its preview back, or say why it cannot. */
function DraftFoot({ view, turn, candidateId, run, busy, preview }: TurnProps) {
  const candidate = turn.id === candidateId;
  const canApply = candidate && !turn.stale && view.allowedActions.includes("apply_ai");
  if (turn.status === "applied") return <Pill tone="info">Used as draft</Pill>;
  return (
    <>
      {!candidate && <span className={styles.quiet}>Superseded</span>}
      {candidate && turn.stale && (
        <Notice tone="attention">
          The draft changed after this was requested, so it can&rsquo;t be used. Ask again.
        </Notice>
      )}
      {canApply && (
        <Button
          variant="ink"
          size="sm"
          disabled={busy}
          onClick={() => {
            void run(
              { kind: "apply_ai", expectedVersion: view.agreement.version, suggestionId: turn.id },
              `apply_ai:${turn.id}`,
            );
          }}
        >
          Apply draft
        </Button>
      )}
      {candidate && preview?.hidden === true && (
        <Button variant="quiet" size="sm" onClick={preview.show}>
          Show on sheet
        </Button>
      )}
    </>
  );
}

function DraftCard({ draft, ...props }: Readonly<{ draft: AiDraft }> & TurnProps) {
  const count = draft.source.sections.length;
  return (
    <article className={styles.card}>
      <p className={styles.summary}>{draft.summary}</p>
      <Questions questions={draft.questions} />
      <p
        className={styles.label}
      >{`Draft ready · ${String(count)} ${count === 1 ? "section" : "sections"}`}</p>
      {props.turn.status !== "applied" && (
        <details>
          <summary className={styles.toggle}>
            Show changes
            <ChevronDown aria-hidden="true" />
          </summary>
          <SectionDiff before={props.view.draft?.source ?? null} after={draft.source} />
        </details>
      )}
      <div className={styles.foot}>
        <DraftFoot {...props} />
      </div>
    </article>
  );
}

function Reply(props: TurnProps) {
  const { view, turn, run, busy } = props;
  const canAsk = view.allowedActions.includes("ask_ai");
  if (turn.status === "queued") {
    return (
      <Notice tone="info" live="polite">
        Thinking…
      </Notice>
    );
  }
  if (turn.status === "failed") {
    return (
      <Notice tone="stop" live="alert">
        <p>The assistant couldn&rsquo;t answer.</p>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !canAsk}
          onClick={() => {
            void run({ kind: "ask_ai", mode: turn.mode, instruction: turn.instruction }, "ask_ai");
          }}
        >
          Try again
        </Button>
      </Notice>
    );
  }
  const { result } = turn;
  if (result === null) return null;
  return result.kind === "plan" ? (
    <PlanCard plan={result} {...props} />
  ) : (
    <DraftCard draft={result} {...props} />
  );
}

/**
 * One exchange: what staff asked, as their own bubble, and the assistant's reply under it: its
 * plan to confirm, a draft to apply, or why there is none. Only the newest draft can be applied.
 */
export function TurnItem(props: TurnProps) {
  return (
    <li className={styles.turn}>
      <p className={styles.ask}>{props.turn.instruction}</p>
      <Reply {...props} />
    </li>
  );
}
