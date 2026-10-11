import { Check } from "../icons.tsx";
import styles from "./Checkbox.module.css";

type CheckboxProps = Readonly<{
  label: string;
  name?: string | undefined;
  value?: string | undefined;
  checked?: boolean | undefined;
  defaultChecked?: boolean | undefined;
  onChange?: ((checked: boolean) => void) | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
}>;

/**
 * A native checkbox drawn as the 20 px box, with its label to the right. The real input lies over
 * the box, invisible, so it keeps its click, keyboard, form and screen-reader behaviour.
 */
export function Checkbox({
  label,
  name,
  value,
  checked,
  defaultChecked,
  onChange,
  required,
  disabled,
}: CheckboxProps) {
  return (
    <label className={styles.checkbox}>
      <span className={styles.control}>
        <input
          type="checkbox"
          className={styles.input}
          name={name}
          value={value}
          checked={checked}
          defaultChecked={defaultChecked}
          onChange={
            onChange &&
            ((event) => {
              onChange(event.target.checked);
            })
          }
          required={required}
          disabled={disabled}
        />
        <span className={styles.box} aria-hidden="true">
          <Check />
        </span>
      </span>
      {label}
    </label>
  );
}
