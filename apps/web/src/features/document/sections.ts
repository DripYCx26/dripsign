import {
  documentSourceSchema,
  type DocumentSection,
  type DocumentSource,
} from "@dripsign/core/schema";
import { randomId } from "./ids.ts";

/** A section as the editor holds it: the paragraphs stay one string so typing is never rewritten. */
export interface EditableSection {
  readonly id: string;
  readonly heading: string;
  readonly body: string;
}

/** A blank section; `id` lets server-rendered initial state be deterministic. */
export function emptySection(id: string = randomId()): EditableSection {
  return { id, heading: "", body: "" };
}

/** The anchor other screens link to for a section of the reading view. */
export function sectionAnchor(id: string): string {
  return `section-${id}`;
}

export function toEditable(sections: readonly DocumentSection[]): EditableSection[] {
  return sections.map((section) => ({
    id: section.id,
    heading: section.heading,
    body: section.paragraphs.join("\n\n"),
  }));
}

function paragraphsOf(body: string): string[] {
  return body
    .replace(/\r\n?/gu, "\n")
    .split(/\n[^\S\n]*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
}

export type SourceCheck =
  Readonly<{ ok: true; source: DocumentSource }> | Readonly<{ ok: false; message: string }>;

/** The one client check before a source is sent; the server runs the same schema again. */
export function buildSource(title: string, sections: readonly EditableSection[]): SourceCheck {
  const emptyAt = sections.findIndex((section) => paragraphsOf(section.body).length === 0);
  if (emptyAt !== -1) {
    return { ok: false, message: `Section ${String(emptyAt + 1)} needs some text.` };
  }
  const parsed = documentSourceSchema.safeParse({
    title,
    sections: sections.map((section) => ({
      id: section.id,
      heading: section.heading.trim(),
      paragraphs: paragraphsOf(section.body),
    })),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the terms." };
  }
  return { ok: true, source: parsed.data };
}
