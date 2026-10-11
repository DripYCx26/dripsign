"use server";

import { z } from "zod";
import { createAgreement as create, executeCommand } from "@dripsign/core/domain/commands";
import { listStaffAgreements, loadAgreementView } from "@dripsign/core/domain/view";
import {
  commandSchema,
  newAgreementInputSchema,
  receiptKeySchema,
  staffListQuerySchema,
  uuidSchema,
} from "@dripsign/core/schema";
import type { Capacity } from "@dripsign/core/types";
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

export const createAgreement = action(
  z.strictObject({ receiptKey: receiptKeySchema, input: newAgreementInputSchema }),
  async ({ receiptKey, input }) => ({ id: await create(await staffActor(), receiptKey, input) }),
);

export const refreshView = action(z.strictObject(workspace), async ({ agreementId, capacity }) =>
  loadAgreementView(await actorFor(capacity, agreementId), agreementId),
);

export const listStaff = action(staffListQuerySchema, async (query) => {
  const page = await listStaffAgreements(await staffActor(), query);
  return { items: [...page.items], nextCursor: page.nextCursor };
});
