"use server";

import { z } from "zod";
import {
  recoverCompletionExport as recover,
  saveCompletionExportConfig as save,
} from "@dripsign/core/domain/completionExport";
import { completionExportSaveSchema, uuidSchema } from "@dripsign/core/schema";
import { action } from "../action.ts";
import { staffActor } from "../session.ts";

/** Saves the next revision of the completion export pins; returns its number. */
export const saveCompletionExport = action(completionExportSaveSchema, async (input) =>
  save(await staffActor(), input),
);

/** Queues a stopped executed event again, with its frozen body. */
export const recoverCompletionExport = action(
  z.strictObject({ roundId: uuidSchema }),
  async ({ roundId }) => {
    await recover(await staffActor(), roundId);
    return null;
  },
);
