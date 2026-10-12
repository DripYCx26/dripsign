import type { NewAgreementInput } from "@dripsign/core/schema";
import { createAgreement } from "@/server/actions/agreements";

const UNCERTAIN =
  "We couldn’t confirm whether that went through. Reload to check before trying again.";

export type SubmitOutcome =
  Readonly<{ ok: true; id: string }> | Readonly<{ ok: false; message: string }>;

/**
 * Creates the draft under the intent's receipt key, so repeating this call with the same key never
 * creates two drafts. A thrown server action means the network failed before we heard the outcome.
 */
export async function submitCreate(
  input: NewAgreementInput,
  receiptKey: string,
): Promise<SubmitOutcome> {
  try {
    const created = await createAgreement({ receiptKey, input });
    return created.ok ? { ok: true, id: created.value.id } : created;
  } catch {
    return { ok: false, message: UNCERTAIN };
  }
}
