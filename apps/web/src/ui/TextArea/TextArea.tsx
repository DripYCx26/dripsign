"use client";

import { useState } from "react";
import { Field } from "../TextField/TextField.tsx";
import styles from "./TextArea.module.css";

type TextAreaProps = Readonly<{
  label: string;
  name: string;
  /** The bound the server enforces; the count appears once the text reaches 90% of it. */
  maxLength: number;
  placeholder?: string | undefined;
  hint?: string | undefined;
  defaultValue?: string | undefined;
  value?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  error?: string | undefined;
}>;

const COUNT_FORMAT = new Intl.NumberFormat("en-US");

/** The share of `maxLength` at which the count appears. */
const COUNT_FROM = 0.9;

/** A native multi-line field with its label, error and a count against its bound ("9,100 / 10,000"). */
export function TextArea({
  label,
  name,
  maxLength,
  placeholder,
  hint,
  defaultValue,
  value,
  onChange,
  required = false,
  disabled = false,
  error,
}: TextAreaProps) {
  const [typed, setTyped] = useState(defaultValue ?? "");
  const length = (value ?? typed).length;
  const counting = length >= maxLength * COUNT_FROM;
  return (
    <Field label={label} hint={hint} error={error}>
      {(control) => {
        const countId = `${control.id}-count`;
        const described = [control["aria-describedby"], counting ? countId : undefined]
          .filter((id) => id !== undefined)
          .join(" ");
        return (
          <>
            <textarea
              {...control}
              aria-describedby={described === "" ? undefined : described}
              className={styles.area}
              name={name}
              maxLength={maxLength}
              placeholder={placeholder}
              defaultValue={value === undefined ? defaultValue : undefined}
              value={value}
              onChange={(event) => {
                setTyped(event.target.value);
                onChange?.(event.target.value);
              }}
              required={required}
              disabled={disabled}
            />
            {counting && (
              <span
                id={countId}
                className={styles.count}
                data-full={length >= maxLength || undefined}
              >
                {`${COUNT_FORMAT.format(length)} / ${COUNT_FORMAT.format(maxLength)}`}
              </span>
            )}
          </>
        );
      }}
    </Field>
  );
}
