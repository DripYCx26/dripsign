import type { DocumentSource } from "@dripsign/core/schema";
import type { ReactNode } from "react";
import { ArrowUpDown, Pill, Plus, Trash2 } from "@/ui";
import { diffSources, type SectionDiffItem, type WordOp } from "./diff.ts";
import styles from "./SectionDiff.module.css";

/** Only whole sections that appear or vanish are marked; edited words mark themselves. */
const WHOLE: Readonly<
  Record<"added" | "removed", Readonly<{ word: string; tone: "confirm" | "stop"; icon: ReactNode }>>
> = {
  added: { word: "Added", tone: "confirm", icon: <Plus /> },
  removed: { word: "Removed", tone: "stop", icon: <Trash2 /> },
};

/** Added and removed runs carry hidden words, so the change is never colour or line style alone. */
function Ops({ ops }: Readonly<{ ops: readonly WordOp[] }>) {
  return ops.map((op, index) => {
    const key = `${String(index)}-${op.kind}`;
    const gap = index === 0 ? "" : " ";
    if (op.kind === "same") return <span key={key}>{`${gap}${op.text}`}</span>;
    const Tag = op.kind === "ins" ? "ins" : "del";
    return (
      <span key={key}>
        {gap}
        <Tag className={styles[op.kind]}>
          <span className="ds-visually-hidden">{op.kind === "ins" ? "added: " : "removed: "}</span>
          {op.text}
        </Tag>
      </span>
    );
  });
}

/** Unchanged text in its old place: nothing to show. */
const isQuiet = (item: SectionDiffItem) => item.change === "unchanged" && !item.moved;

function ChangedSection({ item }: Readonly<{ item: SectionDiffItem }>) {
  if (isQuiet(item)) return null;
  const kind = item.change === "added" || item.change === "removed" ? WHOLE[item.change] : null;
  return (
    <li className={styles.section}>
      <div className={styles.head}>
        {kind !== null && (
          <Pill tone={kind.tone} icon={kind.icon}>
            {kind.word}
          </Pill>
        )}
        {item.moved && (
          <Pill tone="info" icon={<ArrowUpDown />}>
            Moved
          </Pill>
        )}
        <h3 className={styles.heading}>
          <Ops ops={item.heading} />
        </h3>
      </div>
      {item.paragraphs.map((ops, index) => (
        // Paragraph order within one diff is fixed.
        <p key={index} className={styles.paragraph}>
          <Ops ops={ops} />
        </p>
      ))}
    </li>
  );
}

/**
 * What changed between two versions of the terms: sections by id, then the words inside a changed
 * section. Sections that neither changed nor moved are left out. A null `before` is a first
 * revision.
 */
export function SectionDiff({
  before,
  after,
}: Readonly<{ before: DocumentSource | null; after: DocumentSource | null }>) {
  if (after === null) return <p className={styles.empty}>There are no written terms to compare.</p>;
  const diff = diffSources(before, after);
  if (diff.title === null && diff.sections.every(isQuiet)) {
    return <p className={styles.empty}>No changes to the terms.</p>;
  }
  return (
    <div className={styles.diff}>
      {diff.title !== null && (
        <p className={styles.title}>
          <span className={styles.label}>Title</span> <Ops ops={diff.title} />
        </p>
      )}
      <ol className={styles.list}>
        {diff.sections.map((item) => (
          <ChangedSection key={item.id} item={item} />
        ))}
      </ol>
    </div>
  );
}
