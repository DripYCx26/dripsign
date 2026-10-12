import { randomUUID } from "node:crypto";
import { startAgreement } from "@/server/actions/agreements.ts";
import { Button } from "@/ui";

/**
 * Creates the signerless starter draft and opens it. A server form, so it works before the page
 * hydrates; the receipt key is made per render, so a double submit lands on the same draft.
 */
export function NewAgreementButton() {
  return (
    <form action={startAgreement}>
      <input type="hidden" name="receiptKey" value={`create-${randomUUID()}`} />
      <Button variant="ink" type="submit">
        New agreement
      </Button>
    </form>
  );
}
