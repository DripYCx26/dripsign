"use client";

import { LIMITS } from "@dripsign/core/schema";
import { Button, Checkbox, IconButton, Plus, TextField, Trash2 } from "@/ui";
import {
  duplicateKeys,
  DUPLICATE_EMAIL,
  emptyRow,
  type RecipientRow,
  type RowErrors,
} from "./recipients.ts";
import styles from "./RecipientRows.module.css";

type RecipientRowsProps = Readonly<{
  rows: readonly RecipientRow[];
  onChange: (next: readonly RecipientRow[]) => void;
  /** Messages shown after a submit attempt; duplicates show as soon as they appear. */
  errors: ReadonlyMap<string, RowErrors>;
  disabled?: boolean | undefined;
}>;

type RecipientFieldsProps = Readonly<{
  row: RecipientRow;
  index: number;
  errors: RowErrors | undefined;
  duplicate: boolean;
  signerLimitReached: boolean;
  onlyRow: boolean;
  disabled: boolean;
  onEdit: (patch: Partial<Omit<RecipientRow, "key">>) => void;
  onRemove: () => void;
}>;

/** One recipient: name, email, whether they must sign, and removal. */
function RecipientFields({
  row,
  index,
  errors,
  duplicate,
  signerLimitReached,
  onlyRow,
  disabled,
  onEdit,
  onRemove,
}: RecipientFieldsProps) {
  return (
    <fieldset className={styles.row} disabled={disabled}>
      <legend className={styles.legend}>{`Recipient ${String(index + 1)}`}</legend>
      <TextField
        label="Name"
        name={`recipient-name-${row.key}`}
        autoComplete="off"
        value={row.name}
        maxLength={LIMITS.name}
        error={errors?.name}
        onChange={(name) => {
          onEdit({ name });
        }}
      />
      <TextField
        label="Email"
        name={`recipient-email-${row.key}`}
        type="email"
        autoComplete="off"
        value={row.email}
        maxLength={LIMITS.email}
        error={duplicate ? DUPLICATE_EMAIL : errors?.email}
        onChange={(email) => {
          onEdit({ email });
        }}
      />
      <div className={styles.foot}>
        <Checkbox
          label="Required signer"
          checked={row.isSigner}
          disabled={!row.isSigner && signerLimitReached}
          onChange={(isSigner) => {
            onEdit({ isSigner });
          }}
        />
        <IconButton
          label={`Remove recipient ${String(index + 1)}`}
          icon={<Trash2 />}
          disabled={onlyRow}
          onClick={onRemove}
        />
      </div>
    </fieldset>
  );
}

/** The people on the agreement: a name, an email and whether they must sign. */
export function RecipientRows({ rows, onChange, errors, disabled = false }: RecipientRowsProps) {
  const repeats = duplicateKeys(rows);
  const signers = rows.filter((row) => row.isSigner).length;

  function edit(key: string, patch: Partial<Omit<RecipientRow, "key">>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <section className={styles.rows} aria-labelledby="recipients-heading">
      <h2 id="recipients-heading" className={styles.heading}>
        Recipients
      </h2>
      <p className={styles.help}>
        Required signers must sign before the agreement is complete. Others can read and join the
        thread.
      </p>
      {rows.map((row, index) => (
        <RecipientFields
          key={row.key}
          row={row}
          index={index}
          errors={errors.get(row.key)}
          duplicate={repeats.has(row.key)}
          signerLimitReached={signers >= LIMITS.requiredSigners}
          onlyRow={rows.length === 1}
          disabled={disabled}
          onEdit={(patch) => {
            edit(row.key, patch);
          }}
          onRemove={() => {
            onChange(rows.filter((item) => item.key !== row.key));
          }}
        />
      ))}
      <div>
        <Button
          variant="secondary"
          disabled={disabled || rows.length >= LIMITS.recipients}
          onClick={() => {
            onChange([...rows, emptyRow()]);
          }}
        >
          <Plus aria-hidden="true" />
          Add recipient
        </Button>
      </div>
      {signers >= LIMITS.requiredSigners && (
        <p
          className={styles.help}
        >{`An agreement can have up to ${String(LIMITS.requiredSigners)} required signers.`}</p>
      )}
    </section>
  );
}
