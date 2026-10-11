import type { DocumentSection, DocumentSource } from "@dripsign/core/schema";

export type WordOpKind = "same" | "ins" | "del";

/** A run of consecutive words that were kept, added or removed. */
export interface WordOp {
  readonly kind: WordOpKind;
  readonly text: string;
}

export type SectionChange = "added" | "removed" | "changed" | "unchanged";

export interface SectionDiffItem {
  readonly id: string;
  readonly change: SectionChange;
  /** The section is in a different place than in the older text; a section can be both. */
  readonly moved: boolean;
  readonly heading: readonly WordOp[];
  /** One entry per paragraph of the newer text; removed sections keep their old paragraphs. */
  readonly paragraphs: readonly (readonly WordOp[])[];
}

export interface SourceDiff {
  /** Null when the title did not change. */
  readonly title: readonly WordOp[] | null;
  readonly sections: readonly SectionDiffItem[];
}

const PARAGRAPH = "\n\n";
// Beyond this many table cells the exact diff costs too much for a page render; the whole
// differing middle is shown as removed then added instead.
const MAX_CELLS = 4_000_000;

type TokenOp = Readonly<{ kind: WordOpKind; token: string }>;

function wordsOf(text: string): string[] {
  return text.split(/\s+/u).filter((word) => word !== "");
}

function bodyTokens(paragraphs: readonly string[]): string[] {
  return paragraphs.flatMap((paragraph, index) => [
    ...(index === 0 ? [] : [PARAGRAPH]),
    ...wordsOf(paragraph),
  ]);
}

function sameOps(tokens: readonly string[]): TokenOp[] {
  return tokens.map((token) => ({ kind: "same", token }));
}

function coarseOps(before: readonly string[], after: readonly string[]): TokenOp[] {
  return [
    ...before.map((token): TokenOp => ({ kind: "del", token })),
    ...after.map((token): TokenOp => ({ kind: "ins", token })),
  ];
}

/** suffix[i][j]: the length of the longest common subsequence of before[i..] and after[j..]. */
function lcsTable(before: readonly string[], after: readonly string[]): Uint32Array {
  const cols = after.length + 1;
  const table = new Uint32Array((before.length + 1) * cols);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        before[i] === after[j]
          ? (table[(i + 1) * cols + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + j + 1] ?? 0);
    }
  }
  return table;
}

/** Longest-common-subsequence diff of the middle, after the shared head and tail are peeled off. */
function diffMiddle(before: readonly string[], after: readonly string[]): TokenOp[] {
  const cols = after.length + 1;
  if ((before.length + 1) * cols > MAX_CELLS) return coarseOps(before, after);
  const table = lcsTable(before, after);
  const ops: TokenOp[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    const left = before[i] ?? "";
    const right = after[j] ?? "";
    if (left === right) {
      ops.push({ kind: "same", token: left });
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + j + 1] ?? 0)) {
      ops.push({ kind: "del", token: left });
      i += 1;
    } else {
      ops.push({ kind: "ins", token: right });
      j += 1;
    }
  }
  return [...ops, ...coarseOps(before.slice(i), after.slice(j))];
}

function diffTokens(before: readonly string[], after: readonly string[]): TokenOp[] {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }
  return [
    ...sameOps(before.slice(0, head)),
    ...diffMiddle(before.slice(head, before.length - tail), after.slice(head, after.length - tail)),
    ...sameOps(before.slice(before.length - tail)),
  ];
}

function toRuns(ops: readonly TokenOp[]): WordOp[] {
  const runs: { kind: WordOpKind; words: string[] }[] = [];
  for (const op of ops) {
    const last = runs.at(-1);
    if (last?.kind === op.kind) last.words.push(op.token);
    else runs.push({ kind: op.kind, words: [op.token] });
  }
  return runs.map((run) => ({ kind: run.kind, text: run.words.join(" ") }));
}

/** Splits an op stream at kept or added paragraph breaks; a removed break shows nothing. */
function toParagraphs(ops: readonly TokenOp[]): WordOp[][] {
  const paragraphs: TokenOp[][] = [[]];
  for (const op of ops) {
    if (op.token !== PARAGRAPH) paragraphs.at(-1)?.push(op);
    else if (op.kind !== "del") paragraphs.push([]);
  }
  return paragraphs.filter((paragraph) => paragraph.length > 0).map(toRuns);
}

function wholeOps(kind: "ins" | "del", tokens: readonly string[]): TokenOp[] {
  return tokens.map((token) => ({ kind, token }));
}

function sectionItem(
  before: DocumentSection | undefined,
  after: DocumentSection | undefined,
  moved: boolean,
): SectionDiffItem {
  const current = after ?? before;
  if (current === undefined) throw new TypeError("A section diff needs a section");
  const id = current.id;
  if (before === undefined || after === undefined) {
    const kind = after === undefined ? "del" : "ins";
    return {
      id,
      change: after === undefined ? "removed" : "added",
      moved: false,
      heading: toRuns(wholeOps(kind, wordsOf(current.heading))),
      paragraphs: current.paragraphs.map((paragraph) => toRuns(wholeOps(kind, wordsOf(paragraph)))),
    };
  }
  const headingOps = diffTokens(wordsOf(before.heading), wordsOf(after.heading));
  const bodyOps = diffTokens(bodyTokens(before.paragraphs), bodyTokens(after.paragraphs));
  const changed = [...headingOps, ...bodyOps].some((op) => op.kind !== "same");
  return {
    id,
    change: changed ? "changed" : "unchanged",
    moved,
    heading: toRuns(headingOps),
    paragraphs: toParagraphs(bodyOps),
  };
}

/** Removed sections stay beside the section that preceded them in the older text. */
function orderedIds(before: readonly DocumentSection[], after: readonly DocumentSection[]) {
  const kept = new Set(after.map((section) => section.id));
  const removedAfter = new Map<string | null, string[]>();
  let previous: string | null = null;
  for (const section of before) {
    if (kept.has(section.id)) {
      previous = section.id;
    } else {
      const list = removedAfter.get(previous) ?? [];
      list.push(section.id);
      removedAfter.set(previous, list);
    }
  }
  const ids = [...(removedAfter.get(null) ?? [])];
  for (const section of after) {
    ids.push(section.id, ...(removedAfter.get(section.id) ?? []));
  }
  return ids;
}

/**
 * The kept sections that sit elsewhere than before: what the shortest edit of the older order into
 * the newer one inserts. One section jumping over three reports one move, not three.
 */
function movedIds(before: readonly DocumentSection[], after: readonly DocumentSection[]) {
  const inBoth = (own: readonly DocumentSection[], other: readonly DocumentSection[]) => {
    const ids = new Set(other.map((section) => section.id));
    return own.filter((section) => ids.has(section.id)).map((section) => section.id);
  };
  const ops = diffTokens(inBoth(before, after), inBoth(after, before));
  return new Set(ops.filter((op) => op.kind === "ins").map((op) => op.token));
}

/**
 * Section-level changes by id (added, removed, changed, moved), then word-level changes inside a
 * changed section. `before` null is a first revision: every section is added.
 */
export function diffSources(before: DocumentSource | null, after: DocumentSource): SourceDiff {
  const oldSections = before?.sections ?? [];
  const oldById = new Map(oldSections.map((section) => [section.id, section]));
  const newById = new Map(after.sections.map((section) => [section.id, section]));
  const titleOps =
    before === null || before.title === after.title
      ? null
      : toRuns(diffTokens(wordsOf(before.title), wordsOf(after.title)));
  const moved = movedIds(oldSections, after.sections);
  return {
    title: titleOps,
    sections: orderedIds(oldSections, after.sections).map((id) =>
      sectionItem(oldById.get(id), newById.get(id), moved.has(id)),
    ),
  };
}
