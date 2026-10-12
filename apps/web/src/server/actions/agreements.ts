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
import { starterDraft } from "@/features/list/starterDraft.ts";
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

const startDraft = action(
  z.strictObject({ receiptKey: receiptKeySchema }),
  async ({ receiptKey }) =>
    createAgreement(await staffActor(), receiptKey, starterDraft(receiptKey)),
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
