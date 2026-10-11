import styles from "./Skeleton.module.css";

type SkeletonWidth = 30 | 50 | 70 | 90;

/** A placeholder line where content will load; hidden from assistive technology. */
export function Skeleton({ width }: Readonly<{ width: SkeletonWidth }>) {
  return <span className={styles.skeleton} data-width={width} aria-hidden="true" />;
}

const ROW_WIDTHS: readonly (readonly [SkeletonWidth, SkeletonWidth])[] = [
  [90, 50],
  [70, 30],
  [90, 30],
];

/**
 * A list loading as `count` rows at the list row height. The region announces "Loading" once
 * (polite status) and is `aria-busy`; the lines themselves are silent.
 */
export function SkeletonRows({ count = 5 }: Readonly<{ count?: number | undefined }>) {
  return (
    <div role="status" aria-busy="true">
      <span className="ds-visually-hidden">Loading</span>
      {Array.from({ length: count }, (_, index) => {
        const [first, second] = ROW_WIDTHS[index % ROW_WIDTHS.length] ?? [90, 50];
        return (
          // Placeholders are positional and never reorder.
          <div key={index} className={styles.row}>
            <Skeleton width={first} />
            <Skeleton width={second} />
          </div>
        );
      })}
    </div>
  );
}
