import type { PreparationStatus } from "@dripsign/core/schema";
import type {
  AgreementAction,
  AgreementStatus,
  AgreementView,
  Capacity,
  RoundView,
} from "@dripsign/core/types";
import { expect, it } from "vitest";
import { nextStep, type NextStep } from "./nextStep.ts";

const ID = "7c1f6f0e-6f0e-4c1f-9f0e-0a1b2c3d4e5f";

function round(status: "active" | "finalizing", signed: number, total: number): RoundView {
  return {
    id: "round-1",
    revisionId: "revision-1",
    revisionNumber: 1,
    status,
    documentSha256: "a".repeat(64),
    consent: { version: "v1", text: "consent", sha256: "b".repeat(64) },
    createdAt: "2026-10-11T09:00:00.000Z",
    endedAt: null,
    endReason: null,
    finalizingDelayed: false,
    signers: Array.from({ length: total }, (_, index) => ({
      recipientId: `recipient-${String(index)}`,
      name: `Signer ${String(index)}`,
      email: null,
      signature:
        index < signed ? { typedName: "Signer", signedAt: "2026-10-11T10:00:00.000Z" } : null,
    })),
  };
}

type Scenario = Readonly<{
  status?: AgreementStatus;
  preparation?: PreparationStatus;
  revision?: number | null;
  allowed?: readonly AgreementAction[];
  round?: RoundView;
  signed?: boolean;
}>;

function view(capacity: Capacity, scenario: Scenario): AgreementView {
  return {
    agreement: {
      id: ID,
      title: "Mutual NDA",
      status: scenario.status ?? "negotiating",
      version: 4,
      createdAt: "2026-10-10T09:00:00.000Z",
      updatedAt: "2026-10-11T09:00:00.000Z",
      voidedAt: null,
      voidReason: null,
      publicationNeeded: false,
      currentRevisionNumber: scenario.revision === undefined ? 1 : scenario.revision,
      preparation:
        capacity === "staff" ? { status: scenario.preparation ?? "ready", error: null } : null,
    },
    draft: null,
    recipients: [],
    revisions: [],
    proposals: [],
    messages: [],
    activeRound: scenario.round ?? null,
    completedRound: null,
    artifacts: [],
    aiSuggestions: [],
    timeline: [],
    allowedActions: scenario.allowed ?? [],
    viewer: {
      capacity,
      email: "viewer@example.test",
      recipientId: null,
      isRequiredSigner: false,
      hasSigned: scenario.signed ?? false,
    },
    orgName: "Northwind Studio",
  };
}

const NONE: NextStep = { label: "", kind: "none" };
const signed = (as: Capacity): NextStep => ({
  label: "Download signed PDF",
  kind: "navigate",
  href: `/api/agreements/${ID}/files/signed?as=${as}`,
});

// One row per line of the primary-action table (UX proposal A, section 2), both capacities.
const ROWS: readonly (readonly [string, Capacity, Scenario, NextStep])[] = [
  [
    "staff: draft without terms",
    "staff",
    { status: "draft", preparation: "empty", revision: null },
    { label: "Add terms", kind: "scroll", href: "#document-pane" },
  ],
  [
    "staff: preparing",
    "staff",
    { status: "draft", preparation: "preparing", revision: null },
    { label: "Preparing PDF…", kind: "none", disabled: true },
  ],
  [
    "staff: preparation failed",
    "staff",
    { status: "draft", preparation: "failed", revision: null, allowed: ["retry_preparation"] },
    {
      label: "Retry preparation",
      kind: "command",
      command: { kind: "retry_preparation", expectedVersion: 4 },
    },
  ],
  [
    "staff: ready, never published",
    "staff",
    { status: "draft", revision: null, allowed: ["publish"] },
    { label: "Review and publish", kind: "navigate", href: `/staff/agreements/${ID}/publish` },
  ],
  [
    "staff: ready but no required signer",
    "staff",
    { status: "draft", revision: null },
    { label: "Review and publish", kind: "none", disabled: true, chip: "Needs a required signer" },
  ],
  [
    "staff: publication needed",
    "staff",
    { allowed: ["publish"] },
    {
      label: "Review and publish changes",
      kind: "navigate",
      href: `/staff/agreements/${ID}/publish`,
    },
  ],
  ["staff: proposal waiting on staff", "staff", { allowed: ["accept", "counter", "reject"] }, NONE],
  [
    "staff: request signatures",
    "staff",
    { allowed: ["request_signatures"] },
    {
      label: "Request signatures",
      kind: "command",
      command: { kind: "request_signatures", expectedVersion: 4 },
    },
  ],
  [
    "staff: signing",
    "staff",
    { status: "signing", round: round("active", 1, 2), allowed: ["cancel_signatures"] },
    { label: "", kind: "none", chip: "1 of 2 signed" },
  ],
  [
    "staff: finalizing",
    "staff",
    { status: "signing", round: round("finalizing", 2, 2) },
    { label: "Preparing signed files…", kind: "none", disabled: true },
  ],
  ["staff: signed", "staff", { status: "signed", allowed: ["download"] }, signed("staff")],
  ["staff: void", "staff", { status: "void", allowed: ["download"] }, NONE],
  [
    "recipient: proposal waiting on recipient",
    "recipient",
    { allowed: ["accept", "counter", "reject"] },
    NONE,
  ],
  ["recipient: nothing to do", "recipient", { allowed: ["message", "propose"] }, NONE],
  [
    "recipient: review and sign",
    "recipient",
    { status: "signing", round: round("active", 0, 2), allowed: ["sign", "message"] },
    { label: "Review and sign", kind: "navigate", href: `/agreements/${ID}/sign` },
  ],
  [
    "recipient: signed, waiting",
    "recipient",
    { status: "signing", round: round("active", 1, 2), signed: true, allowed: ["message"] },
    { label: "You signed · waiting on 1 other", kind: "none", disabled: true },
  ],
  [
    "recipient: finalizing",
    "recipient",
    { status: "signing", round: round("finalizing", 2, 2), allowed: ["message"] },
    { label: "Preparing signed files…", kind: "none", disabled: true },
  ],
  [
    "recipient: signed",
    "recipient",
    { status: "signed", allowed: ["download"] },
    signed("recipient"),
  ],
  ["recipient: void", "recipient", { status: "void", allowed: ["download"] }, NONE],
];

it("returns the primary action the table names for every state", () => {
  for (const [name, capacity, scenario, expected] of ROWS) {
    expect(nextStep(capacity, view(capacity, scenario)), name).toEqual(expected);
  }
});
