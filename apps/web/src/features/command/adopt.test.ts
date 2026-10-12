import { expect, it } from "vitest";
import type { AgreementView } from "@dripsign/core/types";
import { adoptRead, type Scope } from "./adopt.ts";

const view = (version: number) => ({ version }) as unknown as AgreementView;

it("a response lands only if it is the newest request and its source is still adopted", () => {
  const v1 = view(1);
  const v2 = view(2);
  const read = view(3);
  const scope: Scope = { agreementId: "a", source: v2, view: v2, error: null };
  const ok = { ok: true, value: read } as const;
  const from = (source: AgreementView) => ({
    ticket: 1,
    agreementId: "a",
    source,
    keepError: false,
  });

  expect(adoptRead(scope, from(v2), 1, ok).view).toBe(read);
  // Started before the server's version 2 was adopted: it must not bring version 1 back.
  expect(adoptRead(scope, from(v1), 1, ok)).toBe(scope);
  expect(adoptRead(scope, from(v2), 2, ok)).toBe(scope);
});
