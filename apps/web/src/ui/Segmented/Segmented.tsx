import styles from "./Segmented.module.css";

type SegmentedProps<V extends string> = Readonly<{
  /** Names the group; shown above it unless `hideLabel`. */
  label: string;
  hideLabel?: boolean | undefined;
  name: string;
  options: readonly Readonly<{ value: V; label: string }>[];
  value?: V | undefined;
  defaultValue?: V | undefined;
  onChange?: ((value: V) => void) | undefined;
  disabled?: boolean | undefined;
  /** `sm` is the 28 px control of a toolbar (a 44 px target on a coarse pointer). */
  size?: "md" | "sm" | undefined;
}>;

/**
 * One choice of two to seven, all visible ("All, Drafts, In review"): native radios in a
 * radiogroup, so the group is one tab stop, the arrow keys move the choice, and the legend names
 * the group.
 */
export function Segmented<V extends string>({
  label,
  hideLabel = false,
  name,
  options,
  value,
  defaultValue,
  onChange,
  disabled = false,
  size = "md",
}: SegmentedProps<V>) {
  return (
    <fieldset className={styles.group} role="radiogroup" disabled={disabled}>
      <legend className={hideLabel ? "ds-visually-hidden" : styles.legend}>{label}</legend>
      <span className={styles.segmented} data-size={size}>
        {options.map((option) => (
          <label key={option.value} className={styles.option}>
            <input
              type="radio"
              className={styles.input}
              name={name}
              value={option.value}
              checked={value === undefined ? undefined : value === option.value}
              defaultChecked={
                defaultValue === undefined ? undefined : defaultValue === option.value
              }
              onChange={
                onChange &&
                (() => {
                  onChange(option.value);
                })
              }
            />
            <span className={styles.face}>{option.label}</span>
          </label>
        ))}
      </span>
    </fieldset>
  );
}
