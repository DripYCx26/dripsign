import { ChevronDown } from "../icons.tsx";
import { Field } from "../TextField/TextField.tsx";
import styles from "./Select.module.css";

type SelectProps<V extends string> = Readonly<{
  label: string;
  name: string;
  options: readonly Readonly<{ value: V; label: string }>[];
  hint?: string | undefined;
  value?: V | undefined;
  defaultValue?: V | undefined;
  onChange?: ((value: V) => void) | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  error?: string | undefined;
}>;

/**
 * A native `<select>` drawn with tokens: the platform's own list, keyboard and screen-reader
 * behaviour, with the field's border, ring and chevron. `onChange` receives one of the option
 * values, never an arbitrary string.
 */
export function Select<V extends string>({
  label,
  name,
  options,
  hint,
  value,
  defaultValue,
  onChange,
  required = false,
  disabled = false,
  error,
}: SelectProps<V>) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(control) => (
        <span className={styles.wrap}>
          <select
            {...control}
            className={styles.select}
            name={name}
            value={value}
            defaultValue={defaultValue}
            onChange={
              onChange &&
              ((event) => {
                const picked = options.find((option) => option.value === event.target.value);
                if (picked !== undefined) onChange(picked.value);
              })
            }
            required={required}
            disabled={disabled}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown className={styles.chevron} aria-hidden="true" />
        </span>
      )}
    </Field>
  );
}
