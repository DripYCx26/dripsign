import styles from "./Switch.module.css";

type SwitchProps = Readonly<{
  label: string;
  name?: string | undefined;
  checked?: boolean | undefined;
  defaultChecked?: boolean | undefined;
  onChange?: ((checked: boolean) => void) | undefined;
  disabled?: boolean | undefined;
}>;

/**
 * An on/off setting that takes effect as it is set ("Required signer"): a native checkbox with
 * the switch role, so it toggles on Space and reads as on or off, drawn as a track and knob.
 */
export function Switch({ label, name, checked, defaultChecked, onChange, disabled }: SwitchProps) {
  return (
    <label className={styles.switch}>
      <span className={styles.control}>
        <input
          type="checkbox"
          role="switch"
          className={styles.input}
          name={name}
          checked={checked}
          defaultChecked={defaultChecked}
          onChange={
            onChange &&
            ((event) => {
              onChange(event.target.checked);
            })
          }
          disabled={disabled}
        />
        <span className={styles.track} aria-hidden="true" />
      </span>
      {label}
    </label>
  );
}
