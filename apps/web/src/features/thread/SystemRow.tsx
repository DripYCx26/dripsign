import { Ago } from "./Ago.tsx";
import styles from "./SystemRow.module.css";

type SystemRowProps = Readonly<{ at: string; lines: readonly string[] }>;

/** Milestones of one moment as quiet left-aligned lines, the time after the last. */
export function SystemRow({ at, lines }: SystemRowProps) {
  return (
    <div className={styles.row}>
      {lines.map((line, index) => (
        <p key={line}>
          {line}
          {index === lines.length - 1 && (
            <>
              {" "}
              <span className={styles.time}>
                <Ago value={at} />
              </span>
            </>
          )}
        </p>
      ))}
    </div>
  );
}
