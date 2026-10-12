"use server";

import { z } from "zod";
import { notFound, isDomainError } from "@dripsign/core/errors";
import { assertRenderableName, NAME_NOT_RENDERABLE_MESSAGE } from "@dripsign/core/pdf/font";
import type { SignatureFace } from "@dripsign/core/pdf/font";
import { LIMITS } from "@dripsign/core/schema";
import type { ActionResult } from "@/server/action.ts";
import { getSession } from "@/server/session.ts";

// Slack over the stored limit: the name is trimmed before it is measured, and the sign command
// enforces the exact limit.
const nameInput = z.strictObject({ name: z.string().max(LIMITS.typedName * 2) });

/**
 * The same renderable-name check the sign command runs, so the preview can refuse a name before
 * the signer submits it, and draw it in the face the signed PDF will. The font metrics live on the
 * server; the browser never loads the files.
 */
export async function checkName(input: {
  readonly name: string;
}): Promise<ActionResult<SignatureFace>> {
  if ((await getSession()) === null) {
    return { ok: false, code: "not_found", message: notFound().message };
  }
  const parsed = nameInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "invalid", message: NAME_NOT_RENDERABLE_MESSAGE };
  }
  try {
    return { ok: true, value: await assertRenderableName(parsed.data.name) };
  } catch (error) {
    if (isDomainError(error)) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}
