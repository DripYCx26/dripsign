import type { DocumentSource } from "@dripsign/core/schema";
import { describe, expect, it } from "vitest";
import { diffSources, type WordOp } from "./diff.ts";

const source = (title: string, ...sections: [string, string, string][]): DocumentSource => ({
  title,
  sections: sections.map(([id, heading, text]) => ({ id, heading, paragraphs: text.split("|") })),
});

const mark = (ops: readonly WordOp[]) =>
  ops.map((op) => (op.kind === "same" ? op.text : `[${op.kind === "ins" ? "+" : "-"}${op.text}]`));

/**
 * One line per change: the title when it moved, then `id:change:text with [+added] [-removed]`;
 * a section in a new place reads `change+moved`.
 */
function show(before: DocumentSource | null, after: DocumentSource): string[] {
  const diff = diffSources(before, after);
  return [
    ...(diff.title === null ? [] : [`title:${mark(diff.title).join(" ")}`]),
    ...diff.sections.map(
      (item) =>
        `${item.id}:${item.change}${item.moved ? "+moved" : ""}:${item.paragraphs.flatMap(mark).join(" ")}`,
    ),
  ];
}

const term: [string, string, string] = ["a", "Term", "One year."];
const fees: [string, string, string] = ["b", "Fees", "Pay within 30 days."];
const law: [string, string, string] = ["c", "Law", "Ohio."];
const base = source("Deal", term, fees);

describe("diffSources", () => {
  it.each([
    ["no change", base, base, ["a:unchanged:One year.", "b:unchanged:Pay within 30 days."]],
    [
      "first revision: everything is added",
      null,
      base,
      ["a:added:[+One year.]", "b:added:[+Pay within 30 days.]"],
    ],
    [
      "section added",
      base,
      source("Deal", term, fees, law),
      ["a:unchanged:One year.", "b:unchanged:Pay within 30 days.", "c:added:[+Ohio.]"],
    ],
    [
      "section removed, kept in place",
      source("Deal", term, fees, law),
      source("Deal", term, law),
      ["a:unchanged:One year.", "b:removed:[-Pay within 30 days.]", "c:unchanged:Ohio."],
    ],
    [
      "one word changed",
      base,
      source("Deal", term, ["b", "Fees", "Pay within 45 days."]),
      ["a:unchanged:One year.", "b:changed:Pay within [-30] [+45] days."],
    ],
    [
      "paragraph added inside a section",
      base,
      source("Deal", ["a", "Term", "One year.|Renews yearly."], fees),
      ["a:changed:One year. [+Renews yearly.]", "b:unchanged:Pay within 30 days."],
    ],
    [
      "sections reordered",
      base,
      source("Deal", fees, term),
      ["b:unchanged:Pay within 30 days.", "a:unchanged+moved:One year."],
    ],
    [
      "title changed",
      base,
      source("Deal 2", term, fees),
      ["title:Deal [+2]", "a:unchanged:One year.", "b:unchanged:Pay within 30 days."],
    ],
  ])("%s", (_name, before, after, expected) => {
    expect(show(before, after)).toEqual(expected);
  });
});
