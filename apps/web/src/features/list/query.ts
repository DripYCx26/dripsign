import {
  STAFF_LIST_FILTERS,
  staffListQuerySchema,
  type StaffListFilter,
  type StaffListQuery,
} from "@dripsign/core/schema";

const LABELS: Readonly<Record<StaffListFilter, string>> = {
  all: "All",
  needs_you: "Needs you",
  draft: "Drafts",
  negotiating: "In review",
  signing: "Signing",
  signed: "Signed",
  void: "Voided",
};

/** The status filters in the core's order; a filter added there fails to compile without a label. */
export const STATUS_FILTERS = STAFF_LIST_FILTERS.map((value) => ({ value, label: LABELS[value] }));

export interface ListState {
  readonly q: string;
  readonly status: StaffListFilter;
}

type RawParams = Readonly<Record<string, string | readonly string[] | undefined>>;

function first(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

/** The dashboard's `?q=&status=`, validated by the one list schema; anything invalid is dropped. */
export function parseListState(params: RawParams): ListState {
  const parsed = staffListQuerySchema.safeParse({
    q: first(params.q),
    status: first(params.status),
  });
  const query: StaffListQuery = parsed.success ? parsed.data : {};
  return { q: query.q ?? "", status: query.status ?? "all" };
}

/** The dashboard URL for a state; the defaults leave the query string empty. */
export function listHref({ q, status }: ListState): string {
  const params = new URLSearchParams();
  if (q.trim() !== "") params.set("q", q.trim());
  if (status !== "all") params.set("status", status);
  const text = params.toString();
  return text === "" ? "/staff" : `/staff?${text}`;
}

export function isFiltered({ q, status }: ListState): boolean {
  return q !== "" || status !== "all";
}
