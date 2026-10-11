"use client";

import { LIMITS } from "@dripsign/core/schema";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Button, ChevronDown, IconButton, Plus, TextArea, TextField, X } from "@/ui";
import { emptySection, type EditableSection } from "./sections.ts";
import styles from "./SectionEditor.module.css";

type SectionEditorProps = Readonly<{
  sections: readonly EditableSection[];
  onChange: (next: readonly EditableSection[]) => void;
  disabled?: boolean | undefined;
}>;

function swap(
  sections: readonly EditableSection[],
  index: number,
  other: number,
): EditableSection[] {
  const next = [...sections];
  const a = next[index];
  const b = next[other];
  if (a === undefined || b === undefined) return next;
  next[index] = b;
  next[other] = a;
  return next;
}

type SectionFieldsProps = Readonly<{
  section: EditableSection;
  index: number;
  last: boolean;
  only: boolean;
  disabled: boolean;
  onEdit: (patch: Partial<Omit<EditableSection, "id">>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}>;

/** One section: its heading and text, and the icon buttons that move or remove it. */
function SectionFields({
  section,
  index,
  last,
  only,
  disabled,
  onEdit,
  onMove,
  onRemove,
}: SectionFieldsProps) {
  return (
    <fieldset
      className={styles.section}
      aria-label={`Section ${String(index + 1)}`}
      data-section={section.id}
      disabled={disabled}
    >
      <div className={styles.top}>
        <div className={styles.heading}>
          <TextField
            label="Heading"
            name={`heading-${section.id}`}
            placeholder="Heading"
            value={section.heading}
            maxLength={LIMITS.heading}
            onChange={(heading) => {
              onEdit({ heading });
            }}
          />
        </div>
        <div className={styles.actions}>
          <IconButton
            label="Move section up"
            icon={<ArrowUp aria-hidden="true" />}
            disabled={index === 0}
            onClick={() => {
              onMove(-1);
            }}
          />
          <IconButton
            label="Move section down"
            icon={<ChevronDown aria-hidden="true" />}
            disabled={last}
            onClick={() => {
              onMove(1);
            }}
          />
          <IconButton
            label="Remove section"
            icon={<X aria-hidden="true" />}
            disabled={only}
            onClick={onRemove}
          />
        </div>
      </div>
      <TextArea
        label="Text"
        name={`body-${section.id}`}
        placeholder="Text. Blank line between paragraphs."
        maxLength={LIMITS.sourceBytes}
        value={section.body}
        onChange={(body) => {
          onEdit({ body });
        }}
      />
    </fieldset>
  );
}

/**
 * The terms as sections: a heading and paragraphs each, reordered and removed with buttons (no
 * drag). Section ids stay put through every edit, so a diff can follow a section. Focus follows
 * the section that moved or was added, and a polite line says what happened.
 */
export function SectionEditor({ sections, onChange, disabled = false }: SectionEditorProps) {
  const root = useRef<HTMLDivElement>(null);
  const focusId = useRef<string | null>(null);
  const [said, setSaid] = useState("");

  useEffect(() => {
    const id = focusId.current;
    if (id === null) return;
    focusId.current = null;
    root.current?.querySelector<HTMLElement>(`[data-section="${id}"] input`)?.focus();
  }, [sections]);

  function edit(id: string, patch: Partial<Omit<EditableSection, "id">>) {
    onChange(sections.map((section) => (section.id === id ? { ...section, ...patch } : section)));
  }

  function move(index: number, by: -1 | 1) {
    const moved = sections[index];
    if (moved === undefined) return;
    focusId.current = moved.id;
    setSaid(`Section moved ${by === -1 ? "up" : "down"} to position ${String(index + by + 1)}.`);
    onChange(swap(sections, index, index + by));
  }

  function remove(index: number) {
    const neighbour = sections[index === 0 ? 1 : index - 1];
    focusId.current = neighbour?.id ?? null;
    setSaid(`Section ${String(index + 1)} removed.`);
    onChange(sections.filter((_, at) => at !== index));
  }

  function add() {
    const section = emptySection();
    focusId.current = section.id;
    setSaid(`Section ${String(sections.length + 1)} added.`);
    onChange([...sections, section]);
  }

  return (
    <div ref={root} className={styles.editor}>
      {sections.map((section, index) => (
        <SectionFields
          key={section.id}
          section={section}
          index={index}
          last={index === sections.length - 1}
          only={sections.length === 1}
          disabled={disabled}
          onEdit={(patch) => {
            edit(section.id, patch);
          }}
          onMove={(by) => {
            move(index, by);
          }}
          onRemove={() => {
            remove(index);
          }}
        />
      ))}
      <div>
        <Button
          variant="secondary"
          disabled={disabled || sections.length >= LIMITS.sections}
          onClick={add}
        >
          <Plus aria-hidden="true" />
          Add section
        </Button>
      </div>
      <p className="ds-visually-hidden" role="status">
        {said}
      </p>
    </div>
  );
}
