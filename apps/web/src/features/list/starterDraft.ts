import { createHash } from "node:crypto";

/**
 * The signerless one-section draft "New agreement" creates. Derived from the receipt key alone, so
 * a resubmitted form sends the same payload and replays the first draft instead of conflicting.
 */
export function starterDraft(receiptKey: string) {
  const hex = createHash("sha256").update(receiptKey).digest("hex");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return {
    source: {
      title: "Untitled agreement",
      sections: [
        { id, heading: "Terms", paragraphs: ["Write the terms here, or start from a template."] },
      ],
    },
    recipients: [],
  };
}
