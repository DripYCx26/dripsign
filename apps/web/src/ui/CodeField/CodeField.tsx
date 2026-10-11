"use client";

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import styles from "./CodeField.module.css";

/** Sign-in codes are six digits; a screen gates its submit on `onComplete`. */
export const CODE_LENGTH = 6;

type CodeFieldProps = Readonly<{
  /** The group's accessible name; the screen's heading says what the code is for. */
  label: string;
  /** Submitted with the form as one value of the digits entered so far. */
  name: string;
  /** Every change, with the digits so far; shorter than six means incomplete. */
  onChange?: ((code: string) => void) | undefined;
  /** Once, when the sixth digit lands. */
  onComplete?: ((code: string) => void) | undefined;
  invalid?: boolean | undefined;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
}>;

type Cells = readonly string[];

const EMPTY: Cells = Array.from({ length: CODE_LENGTH }, () => "");

/** Writes `digits` into consecutive cells from `start`, dropping what does not fit. */
function fill(cells: Cells, start: number, digits: string): Cells {
  const next = [...cells];
  Array.from(digits).forEach((digit, offset) => {
    if (start + offset < CODE_LENGTH) next[start + offset] = digit;
  });
  return next;
}

/** The cells and the handlers that edit them; the component only draws and wires them. */
function useCodeCells(
  onChange: CodeFieldProps["onChange"],
  onComplete: CodeFieldProps["onComplete"],
) {
  const [cells, setCells] = useState<Cells>(EMPTY);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  function focusCell(index: number) {
    const target = inputs.current[Math.max(0, Math.min(index, CODE_LENGTH - 1))];
    target?.focus();
    target?.select();
  }

  function commit(next: Cells, focusAt: number) {
    setCells(next);
    const code = next.join("");
    onChange?.(code);
    if (code.length === CODE_LENGTH) onComplete?.(code);
    focusCell(focusAt);
  }

  function clear(index: number, focusAt: number) {
    commit(
      cells.map((cell, at) => (at === index ? "" : cell)),
      focusAt,
    );
  }

  function enter(index: number, raw: string) {
    const digits = raw.replace(/\D/gu, "");
    if (digits === "") {
      clear(index, index);
      return;
    }
    // A whole code (autofill, paste) starts at the first box wherever it landed.
    const start = digits.length >= CODE_LENGTH ? 0 : index;
    commit(fill(cells, start, digits), start + digits.length);
  }

  function paste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    enter(index, event.clipboardData.getData("text"));
  }

  function key(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && cells[index] === "" && index > 0) {
      event.preventDefault();
      clear(index - 1, index - 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusCell(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusCell(index + 1);
    }
  }

  return { cells, inputs, enter, paste, key };
}

/**
 * The emailed code as six one-digit boxes: numeric keypad, one-time-code autofill on the first,
 * a paste (or an autofill) spread across the boxes, backspace and the arrows moving between them.
 * Digits only; a refused code is the screen's notice, not this field's.
 */
export function CodeField({
  label,
  name,
  onChange,
  onComplete,
  invalid = false,
  disabled = false,
  autoFocus,
}: CodeFieldProps) {
  const { cells, inputs, enter, paste, key } = useCodeCells(onChange, onComplete);
  return (
    <div role="group" aria-label={label} className={styles.code}>
      {cells.map((cell, index) => (
        <input
          // The cells are positional and never reorder, so the index is the identity.
          key={index}
          ref={(node) => {
            inputs.current[index] = node;
          }}
          className={styles.cell}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${String(index + 1)} of ${String(CODE_LENGTH)}`}
          aria-invalid={invalid || undefined}
          data-tone={invalid ? "stop" : undefined}
          value={cell}
          onChange={(event) => {
            enter(index, event.target.value);
          }}
          onPaste={(event) => {
            paste(index, event);
          }}
          onKeyDown={(event) => {
            key(index, event);
          }}
          onFocus={(event) => {
            event.target.select();
          }}
          disabled={disabled}
          autoFocus={autoFocus === true && index === 0}
        />
      ))}
      <input type="hidden" name={name} value={cells.join("")} />
    </div>
  );
}
