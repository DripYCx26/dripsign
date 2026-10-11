import { useId, type HTMLInputAutoCompleteAttribute, type ReactNode } from "react";
import styles from "./TextField.module.css";

/** The attributes `Field` hands its control: the label's target and the description links. */
export type FieldControl = Readonly<{
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
  "data-tone": "stop" | undefined;
}>;

/**
 * The frame every labelled control shares: a visible label bound to the control, then the
 * control, then the hint and the error, which the control names as its description (the error
 * also marks it invalid). The one owner of field ids; TextField, TextArea and Select render their
 * control through it.
 */
export function Field({
  label,
  hideLabel = false,
  hint,
  error,
  children,
}: Readonly<{
  label: string;
  /** Keeps the label for assistive technology only; the placeholder or context says it by eye. */
  hideLabel?: boolean | undefined;
  hint?: string | undefined;
  error: string | undefined;
  children: (control: FieldControl) => ReactNode;
}>) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const invalid = error !== undefined;
  const described = [hint === undefined ? null : hintId, invalid ? errorId : null]
    .filter((part) => part !== null)
    .join(" ");
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={hideLabel ? "ds-visually-hidden" : styles.label}>
        {label}
      </label>
      {children({
        id,
        "aria-invalid": invalid ? true : undefined,
        "aria-describedby": described === "" ? undefined : described,
        "data-tone": invalid ? "stop" : undefined,
      })}
      {hint !== undefined && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {invalid && (
        <p id={errorId} className={styles.error} data-tone="stop">
          {error}
        </p>
      )}
    </div>
  );
}

type TextFieldProps = Readonly<{
  label: string;
  hideLabel?: boolean | undefined;
  name: string;
  type?: "text" | "email" | "search" | "url" | undefined;
  /** md everywhere; lg on sign-in, where the field is the page's one question. */
  size?: "md" | "lg" | undefined;
  autoComplete?: HTMLInputAutoCompleteAttribute | undefined;
  placeholder?: string | undefined;
  hint?: string | undefined;
  defaultValue?: string | undefined;
  value?: string | undefined;
  maxLength?: number | undefined;
  onChange?: ((value: string) => void) | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
  error?: string | undefined;
}>;

/** A one-line native text input with its label, hint and error. */
export function TextField({
  label,
  hideLabel,
  name,
  type = "text",
  size = "md",
  autoComplete,
  placeholder,
  hint,
  defaultValue,
  value,
  maxLength,
  onChange,
  required = false,
  disabled = false,
  autoFocus,
  error,
}: TextFieldProps) {
  return (
    <Field label={label} hideLabel={hideLabel} hint={hint} error={error}>
      {(control) => (
        <input
          {...control}
          className={styles.input}
          data-size={size}
          type={type}
          name={name}
          autoComplete={autoComplete}
          placeholder={placeholder}
          defaultValue={defaultValue}
          value={value}
          maxLength={maxLength}
          onChange={
            onChange &&
            ((event) => {
              onChange(event.target.value);
            })
          }
          required={required}
          disabled={disabled}
          autoFocus={autoFocus}
        />
      )}
    </Field>
  );
}
