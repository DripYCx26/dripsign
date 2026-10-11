import { staffListQuerySchema } from "@dripsign/core/schema";

type RawParams = Readonly<Record<string, string | readonly string[] | undefined>>;

function first(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

/** The dashboard's `?q=`, validated by the one list schema; anything invalid is dropped. */
export function parseSearch(params: RawParams): string {
  const parsed = staffListQuerySchema.shape.q.safeParse(first(params.q));
  return parsed.success ? (parsed.data ?? "") : "";
}

/** The dashboard URL for a search; no search leaves the query string empty. */
export function listHref(q: string): string {
  const text = q.trim();
  return text === "" ? "/staff" : `/staff?${new URLSearchParams({ q: text }).toString()}`;
}
