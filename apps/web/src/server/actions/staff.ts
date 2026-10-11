"use server";

import { z } from "zod";
import { addStaff as add, revokeStaff as revoke } from "@dripsign/core/domain/staff";
import { emailSchema, personNameSchema } from "@dripsign/core/schema";
import type { StaffRole } from "@dripsign/core/types";
import { action } from "../action.ts";
import { staffActor } from "../session.ts";

const roleSchema = z.enum(["admin", "member"]) satisfies z.ZodType<StaffRole>;

export const addStaff = action(
  z.strictObject({ email: emailSchema, name: personNameSchema.optional(), role: roleSchema }),
  async ({ email, name, role }) => {
    await add(await staffActor(), { email, name, role });
    return null;
  },
);

export const revokeStaff = action(z.strictObject({ email: emailSchema }), async ({ email }) => {
  await revoke(await staffActor(), email);
  return null;
});
