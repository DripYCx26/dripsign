import type { DocumentSource } from "@dripsign/core/schema";
import { ArrowUpDown, Pencil, Pill, Plus, Trash2 } from "@/ui";
import { diffSources, type SectionChange, type SectionDiffItem, type WordOp } from "./diff.ts";
import styles from "./SectionDiff.module.css";

const CHANGE: Readonly<
  Record<
    Exclude<SectionChange, "unchanged">,
    Readonly<{ word: string; tone: "confirm" | "stop" | "info"; icon: "plus" | "trash" | "pencil" }>
  >
> = {
  added: { word: "Added", tone: "confirm", icon: "plus" },
  removed: { word: "Removed", tone: "stop", icon: "trash" },
  changed: { word: "Changed", tone: "info", icon: "pencil" },
};

const ICONS = { plus: <Plus />, trash: <Trash2 />, pencil: <Pencil /> } as const;

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

/** Unchanged text in its old place: nothing to show, so it folds into the disclosure. */
const isQuiet = (item: SectionDiffItem) => item.change === "unchanged" && !item.moved;

function ChangedSection({ item }: Readonly<{ item: SectionDiffItem }>) {
  if (isQuiet(item)) return null;
  const kind = item.change === "unchanged" ? null : CHANGE[item.change];
  return (
    <li className={styles.section}>
      <div className={styles.head}>
        {kind !== null && (
          <Pill tone={kind.tone} icon={ICONS[kind.icon]}>
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
 * section. Sections that neither changed nor moved fold into one disclosure. A null `before` is a
 * first revision.
 */
export function SectionDiff({
  before,
  after,
}: Readonly<{ before: DocumentSource | null; after: DocumentSource | null }>) {
  if (after === null) return <p className={styles.empty}>There are no written terms to compare.</p>;
  const diff = diffSources(before, after);
  const unchanged = diff.sections.filter(isQuiet);
  const changed = diff.sections.length - unchanged.length;
  if (changed === 0 && diff.title === null) {
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
      {unchanged.length > 0 && (
        <details className={styles.unchanged}>
          <summary>{`${String(unchanged.length)} unchanged ${unchanged.length === 1 ? "section" : "sections"}`}</summary>
          <ul>
            {unchanged.map((item) => (
              <li key={item.id}>
                <Ops ops={item.heading} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
