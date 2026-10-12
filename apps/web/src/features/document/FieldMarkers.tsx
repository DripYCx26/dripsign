import type { SigningField } from "@dripsign/core/schema";
import styles from "./FieldMarkers.module.css";

export interface FieldMarkerPerson {
  readonly id: string;
  readonly name: string;
}

function labelFor(field: SigningField, own: boolean, name: string): string {
  const what = field.type === "signature" ? "signature" : "date";
  if (own) return `Your ${what}`;
  return `${name} · ${field.type === "signature" ? "Signature" : "Date"}`;
}

/**
 * Where each signer's fields sit on one page. Fields are fractions of the page from its top left,
 * so percentages place them at any width. The viewer's own fields are solid; others are dashed
 * and name their owner. Decoration over the canvas: it takes no pointer.
 */
export function FieldMarkers({
  fields,
  people,
  viewerRecipientId,
}: Readonly<{
  fields: readonly SigningField[];
  people: readonly FieldMarkerPerson[];
  viewerRecipientId: string | null;
}>) {
  return fields.map((field) => {
    const own = field.recipientId === viewerRecipientId;
    const name = people.find((person) => person.id === field.recipientId)?.name ?? "Signer";
    return (
      <div
        key={`${field.recipientId}-${field.type}-${String(field.x)}-${String(field.y)}`}
        className={styles.marker}
        data-own={own || undefined}
        data-recipient={field.recipientId}
        style={{
          left: `${String(field.x * 100)}%`,
          top: `${String(field.y * 100)}%`,
          width: `${String(field.width * 100)}%`,
          height: `${String(field.height * 100)}%`,
        }}
      >
        <span className={styles.label}>{labelFor(field, own, name)}</span>
      </div>
    );
  });
}
