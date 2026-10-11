import type { TimelineItem, TimelineKind } from "@dripsign/core/types";

/** What one timeline row says: a sentence, and an optional evidence line in the mono face. */
export type ActivityLine = Readonly<{ text: string; evidence?: string }>;

const ENDED: Readonly<Record<string, string>> = {
  cancelled: "The signature request was cancelled.",
  signer_proposal:
    "A proposal cancelled the signature request. Earlier signatures are kept as evidence.",
  signer_removed:
    "The signature request ended because a signer was removed. Earlier signatures are kept as evidence.",
  agreement_voided:
    "The signature request ended because the agreement was voided. Earlier signatures are kept as evidence.",
};

function str(item: TimelineItem, key: string): string | null {
  const value = item.detail[key];
  return typeof value === "string" ? value : null;
}

function names(item: TimelineItem, key: string): string {
  const value = item.detail[key];
  return Array.isArray(value) ? value.join(", ") : "";
}

function line(text: string, evidence?: string | null): ActivityLine {
  return evidence === undefined || evidence === null || evidence === ""
    ? { text }
    : { text, evidence };
}

/** The twelve-character prefix a person can compare against a PDF's hash. */
function hash(label: string, sha: string | null): string | null {
  return sha === null ? null : `${label} ${sha.slice(0, 12)}`;
}

function acted(item: TimelineItem, verb: string, fallback: string): string {
  return item.actor === null ? fallback : `${item.actor.label} ${verb}`;
}

const who = (item: TimelineItem): string => str(item, "name") ?? "A recipient";

const DESCRIBE: Readonly<Record<TimelineKind, (item: TimelineItem) => ActivityLine>> = {
  agreement_created: (item) =>
    line(acted(item, "created the agreement.", "The agreement was created.")),
  recipient_added: (item) =>
    line(
      `${who(item)} was added as ${item.detail.isSigner === true ? "a required signer" : "a recipient"}.`,
    ),
  recipient_removed: (item) => line(`${who(item)} was removed.`),
  revision_published: (item) =>
    line(
      `Revision ${String(item.detail.number)} was published.`,
      hash("SHA-256", str(item, "sha256")),
    ),
  proposal_created: (item) =>
    line(
      item.detail.supersedesId === null
        ? acted(item, "proposed a change.", "A change was proposed.")
        : acted(item, "answered with a counterproposal.", "A counterproposal was sent."),
    ),
  proposal_accepted: (item) =>
    line(acted(item, "accepted the proposal.", "The proposal was accepted.")),
  proposal_rejected: (item) =>
    line(acted(item, "declined the proposal.", "The proposal was declined.")),
  signing_requested: (item) => line(`Signatures were requested from ${names(item, "signers")}.`),
  signature_recorded: (item) =>
    line(
      `${str(item, "name") ?? "A signer"} signed.`,
      `Typed name: ${str(item, "typedName") ?? ""}`,
    ),
  signing_ended: (item) => line(ENDED[str(item, "reason") ?? ""] ?? "The signature request ended."),
  signing_completed: (item) =>
    line(
      "Everyone signed. The signed PDF and audit record were archived.",
      hash("Signed PDF SHA-256", str(item, "signed_document")),
    ),
  agreement_voided: (item) => line("The agreement was voided.", str(item, "reason")),
  ai_requested: () => line("The private assistant was asked for suggestions."),
};

/** The sentence for a timeline row; the kind decides, the row's detail fills it in. */
export function describeActivity(item: TimelineItem): ActivityLine {
  return DESCRIBE[item.kind](item);
}
