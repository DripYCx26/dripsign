// People in the thread and timeline as the viewer may see them: recipients see staff as the
// organisation and other recipients by name, never by email.
import type { Capacity, ParticipantRef, TimelineItem, TimelineKind } from "../types.ts";
import type { RecipientRow, TimelineRow } from "./snapshot.ts";
import { iso } from "./state.ts";

export interface Labeller {
  readonly viewer: { readonly capacity: Capacity; readonly email: string };
  readonly orgName: string;
  /** Staff viewers only; empty for recipients. */
  readonly staffNames: ReadonlyMap<string, string>;
  readonly recipientsByEmail: ReadonlyMap<string, RecipientRow>;
}

type DetailValue = TimelineItem["detail"][string];

// A Record so a kind added to TimelineKind fails to compile until it is listed here.
const TIMELINE_KINDS: Readonly<Record<TimelineKind, true>> = {
  agreement_created: true,
  recipient_added: true,
  recipient_removed: true,
  revision_published: true,
  proposal_created: true,
  proposal_accepted: true,
  proposal_rejected: true,
  proposal_superseded: true,
  signing_requested: true,
  signature_recorded: true,
  signing_ended: true,
  signing_completed: true,
  agreement_voided: true,
  ai_requested: true,
};

/** A live row wins over earlier removed rows for the same address. */
export function recipientsByEmail(rows: readonly RecipientRow[]): Map<string, RecipientRow> {
  const byEmail = new Map<string, RecipientRow>();
  for (const row of rows) {
    if (row.removedAt === null || !byEmail.has(row.email)) byEmail.set(row.email, row);
  }
  return byEmail;
}

export function participant(
  labeller: Labeller,
  capacity: Capacity,
  email: string | null,
): ParticipantRef {
  const staffViewer = labeller.viewer.capacity === "staff";
  if (capacity === "staff") {
    if (!staffViewer || email === null) {
      return { capacity, recipientId: null, label: labeller.orgName, email: null };
    }
    return { capacity, recipientId: null, label: labeller.staffNames.get(email) ?? email, email };
  }
  const recipient = email === null ? undefined : labeller.recipientsByEmail.get(email);
  const visibleEmail = staffViewer || email === labeller.viewer.email ? email : null;
  return {
    capacity,
    recipientId: recipient?.id ?? null,
    label: recipient?.name ?? visibleEmail ?? "Former recipient",
    email: visibleEmail,
  };
}

export function timelineItem(labeller: Labeller, row: TimelineRow): TimelineItem | null {
  const kind = row.kind;
  if (!isTimelineKind(kind)) return null;
  return {
    at: iso(row.at),
    kind,
    actor:
      row.actorCapacity === null ? null : participant(labeller, row.actorCapacity, row.actorEmail),
    subjectId: row.subjectId,
    detail: toDetail(row.detail),
  };
}

/** Keeps the scalar and string-list values the view emits; anything else is dropped. */
function toDetail(value: unknown): Record<string, DetailValue> {
  const detail: Record<string, DetailValue> = {};
  if (value === null || typeof value !== "object") return detail;
  const entries: readonly (readonly [string, unknown])[] = Object.entries(value);
  for (const [key, item] of entries) {
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      detail[key] = item;
    } else if (isStringList(item)) {
      detail[key] = item;
    }
  }
  return detail;
}

function isTimelineKind(kind: string): kind is TimelineKind {
  return Object.hasOwn(TIMELINE_KINDS, kind);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
