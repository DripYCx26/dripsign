import styles from "./Switch.module.css";

type SwitchProps = Readonly<{
  label: string;
  /** Whose setting it is, read after the label so a list of switches has distinct names. */
  subject?: string | undefined;
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
export function Switch(props: SwitchProps) {
  const { label, subject, name, checked, defaultChecked, onChange, disabled } = props;
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
      {subject !== undefined && <span className="ds-visually-hidden">{`: ${subject}`}</span>}
    </label>
  );
}
