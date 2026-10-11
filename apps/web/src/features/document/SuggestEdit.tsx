"use client";

import { startProposal } from "@/features/thread/intent.ts";
import { Button } from "@/ui";

/** Opens the composer's proposal on this section; the composer owns what is typed from there. */
export function SuggestEdit({
  sectionId,
  heading,
}: Readonly<{ sectionId: string; heading: string }>) {
  return (
    <Button
      variant="quiet"
      size="sm"
      onClick={() => {
        startProposal({ sectionId });
      }}
    >
      Suggest edit
      <span className="ds-visually-hidden">{` to ${heading === "" ? "this section" : heading}`}</span>
    </Button>
  );
}
