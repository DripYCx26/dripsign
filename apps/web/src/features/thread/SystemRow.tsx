import { Ago } from "./Ago.tsx";
import styles from "./SystemRow.module.css";

type SystemRowProps = Readonly<{ at: string; lines: readonly string[] }>;

/** Milestones of one moment, each a centred caps label between hairlines, the time after the last. */
export function SystemRow({ at, lines }: SystemRowProps) {
  return (
    <div className={styles.rows}>
      {lines.map((line, index) => (
        <p key={line} className={styles.row}>
          <span>
            {line}
            {index === lines.length - 1 && (
              <>
                {" "}
                <span className={styles.time}>
                  <Ago value={at} />
                </span>
              </>
            )}
          </span>
        </p>
      ))}
    </div>
  );
}
