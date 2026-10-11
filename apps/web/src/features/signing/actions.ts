"use server";

import { z } from "zod";
import { notFound, isDomainError } from "@dripsign/core/errors";
import { assertRenderableName, NAME_NOT_RENDERABLE_MESSAGE } from "@dripsign/core/pdf/font";
import { LIMITS } from "@dripsign/core/schema";
import type { ActionResult } from "@/server/action.ts";
import { getSession } from "@/server/session.ts";

// Slack over the stored limit: the name is trimmed before it is measured, and the sign command
// enforces the exact limit.
const nameInput = z.strictObject({ name: z.string().max(LIMITS.typedName * 2) });

/**
 * The same renderable-name check the sign command runs, so the preview can refuse a name before
 * the signer submits it. The font metrics live on the server; the browser never loads the file.
 */
export async function checkName(input: { readonly name: string }): Promise<ActionResult<null>> {
  if ((await getSession()) === null) {
    return { ok: false, code: "not_found", message: notFound().message };
  }
  const parsed = nameInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "invalid", message: NAME_NOT_RENDERABLE_MESSAGE };
  }
  try {
    await assertRenderableName(parsed.data.name);
    return { ok: true, value: null };
  } catch (error) {
    if (isDomainError(error)) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}
