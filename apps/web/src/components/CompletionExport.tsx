"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import type { CompletionExportConfig } from "@dripsign/db";

type Snapshot = {
  readonly revision: number;
  readonly config: CompletionExportConfig | null;
};
const textFields = [
  ["tenantId", "Destination tenant ID"],
  ["senderBindingId", "Enrolled sender binding ID"],
  ["senderGrantId", "Enrolled sender grant ID"],
  ["issuer", "Issuer"],
  ["audience", "Audience"],
  ["keyId", "Public key ID"],
] as const;
const numberFields = [
  ["senderBindingRevision", "Sender binding revision", Number.MAX_SAFE_INTEGER],
  ["keyVersion", "Public key version", 4_294_967_295],
  ["freshnessSeconds", "Delivery freshness in seconds", 300],
] as const;

/** Public enrollment pins only; the native server owns membership and revision checks. */
export function CompletionExport({
  initial,
}: {
  readonly initial: Snapshot;
}): ReactNode {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(initial);
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);

  async function readSaved(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setIsPending(true);
    setMessage(null);
    setSnapshot(null);
    try {
      const response = await fetch("/api/staff/completion-export", {
        cache: "no-store",
      });
      if (!response.ok) {
        setMessage(
          "Saved export settings are unavailable. Sign in again or retry the read.",
        );
        return;
      }
      setSnapshot((await response.json()) as Snapshot);
    } catch {
      setMessage("Saved export settings could not be read. Retry the read.");
    } finally {
      busy.current = false;
      setIsPending(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy.current || !snapshot) return;
    const data = new FormData(event.currentTarget);
    const config: CompletionExportConfig = {
      tenantId: String(data.get("tenantId")),
      senderBindingId: String(data.get("senderBindingId")),
      senderGrantId: String(data.get("senderGrantId")),
      issuer: String(data.get("issuer")),
      audience: String(data.get("audience")),
      keyId: String(data.get("keyId")),
      senderBindingRevision: Number(data.get("senderBindingRevision")),
      keyVersion: Number(data.get("keyVersion")),
      freshnessSeconds: Number(data.get("freshnessSeconds")),
    };
    const body = JSON.stringify({
      config,
      expectedRevision: snapshot.revision,
    });
    busy.current = true;
    setIsPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/staff/completion-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!response.ok) {
        setSnapshot(null);
        setMessage(
          response.status === 409
            ? "Settings changed. Read saved settings before editing again."
            : "Settings were not confirmed. Read saved settings before editing again.",
        );
        return;
      }
      const saved = (await response.json()) as { readonly revision: number };
      setSnapshot({ revision: saved.revision, config });
      setMessage(
        "Export settings saved. Existing frozen completion events retain their original pins.",
      );
    } catch {
      setSnapshot(null);
      setMessage(
        "The save outcome is unknown. Read saved settings before editing again.",
      );
    } finally {
      busy.current = false;
      setIsPending(false);
    }
  }

  return (
    <section className="stack">
      <p>
        Copy the public pins from the enrolled destination sender. The signing
        key remains in the jobs service.
      </p>
      <button
        className="secondary"
        disabled={isPending}
        onClick={() => {
          void readSaved();
        }}
      >
        Read saved settings
      </button>
      {snapshot && (
        <form
          className="stack create-panel"
          key={snapshot.revision}
          onSubmit={(event) => {
            void save(event);
          }}
        >
          <p>
            {snapshot.config
              ? `Saved revision ${snapshot.revision}`
              : "No export destination is configured."}
          </p>
          <fieldset disabled={isPending} className="stack">
            <legend>Completion export destination</legend>
            {textFields.map(([name, label]) => (
              <label key={name}>
                {label}
                <input
                  name={name}
                  required
                  maxLength={100}
                  defaultValue={snapshot.config?.[name] ?? ""}
                  autoComplete="off"
                />
              </label>
            ))}
            {numberFields.map(([name, label, maximum]) => (
              <label key={name}>
                {label}
                <input
                  name={name}
                  type="number"
                  required
                  min={1}
                  max={maximum}
                  step={1}
                  defaultValue={snapshot.config?.[name] ?? ""}
                />
              </label>
            ))}
            <button className="primary" type="submit">
              Save export settings
            </button>
          </fieldset>
        </form>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

/** Recovery names the original completed round; queue acceptance is not delivery evidence. */
export function CompletionRecovery({
  agreementId,
  roundId,
}: {
  readonly agreementId: string;
  readonly roundId: string;
}): ReactNode {
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);
  async function recover(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setIsPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/staff/completion-export/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agreementId, roundId }),
      });
      if (!response.ok) {
        setMessage(
          "The original completion event could not be queued. Check export settings and refresh the agreement.",
        );
        return;
      }
      const result = (await response.json()) as { readonly eventId: string };
      setMessage(
        `Original completion event ${result.eventId} accepted for recovery. Delivery is not confirmed here.`,
      );
    } catch {
      setMessage(
        "Recovery outcome is unknown. Retry requests the same original completed event.",
      );
    } finally {
      busy.current = false;
      setIsPending(false);
    }
  }
  return (
    <section className="workspace-tools stack">
      <button
        className="secondary"
        disabled={isPending}
        onClick={() => {
          void recover();
        }}
      >
        Recover completion export
      </button>
      <a href="/staff/completion-export">Completion export settings</a>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
