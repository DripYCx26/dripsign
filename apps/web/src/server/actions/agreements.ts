"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createAgreement, executeCommand } from "@dripsign/core/domain/commands";
import { listStaffAgreements, loadAgreementView } from "@dripsign/core/domain/view";
import {
  commandSchema,
  receiptKeySchema,
  staffListQuerySchema,
  uuidSchema,
} from "@dripsign/core/schema";
import type { Capacity } from "@dripsign/core/types";
import { STARTER_SECTION } from "@/features/draft/templates.ts";
import { action } from "../action.ts";
import { actorFor, staffActor } from "../session.ts";

const capacitySchema = z.enum(["staff", "recipient"]) satisfies z.ZodType<Capacity>;
const workspace = { agreementId: uuidSchema, capacity: capacitySchema };

/** One command under its receipt key; the domain rechecks authority after locking. */
export const runCommand = action(
  z.strictObject({ ...workspace, receiptKey: receiptKeySchema, command: commandSchema }),
  async ({ agreementId, capacity, receiptKey, command }) =>
    executeCommand(await actorFor(capacity, agreementId), agreementId, receiptKey, command),
);

/** Constant, so a resubmitted "New agreement" form replays its draft instead of conflicting. */
const STARTER_DRAFT = {
  source: {
    title: "Untitled agreement",
    sections: [{ ...STARTER_SECTION, paragraphs: [...STARTER_SECTION.paragraphs] }],
  },
  recipients: [],
};

const startDraft = action(
  z.strictObject({ receiptKey: receiptKeySchema }),
  async ({ receiptKey }) => createAgreement(await staffActor(), receiptKey, STARTER_DRAFT),
);

/** The "New agreement" form: a signerless one-section draft, then its workspace. */
export async function startAgreement(formData: FormData): Promise<void> {
  const key = formData.get("receiptKey");
  const started = await startDraft({ receiptKey: typeof key === "string" ? key : "" });
  // The error boundary words it; toFailure already logged the cause by id.
  if (!started.ok) throw new Error(started.message);
  redirect(`/staff/agreements/${started.value}`);
}

export const refreshView = action(z.strictObject(workspace), async ({ agreementId, capacity }) =>
  loadAgreementView(await actorFor(capacity, agreementId), agreementId),
);

export const listStaff = action(staffListQuerySchema, async (query) => {
  const page = await listStaffAgreements(await staffActor(), query);
  return { items: [...page.items], nextCursor: page.nextCursor };
});
