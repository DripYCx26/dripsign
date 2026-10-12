import { describe, expect, it } from "vitest";
import { canonicalJson, newAgreementInputSchema } from "@dripsign/core/schema";
import { starterDraft } from "./starterDraft.ts";

describe("starterDraft", () => {
  it("is a valid create input that one receipt key always reproduces", () => {
    const first = starterDraft("create-a");
    expect(newAgreementInputSchema.parse(first)).toEqual(first);
    expect(canonicalJson(starterDraft("create-a"))).toBe(canonicalJson(first));
    expect(starterDraft("create-b").source.sections[0]?.id).not.toBe(first.source.sections[0]?.id);
  });
});
