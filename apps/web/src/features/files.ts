import type { AgreementFileKind, Capacity } from "@dripsign/core/types";

export interface FileUrlOptions {
  readonly as: Capacity;
  /** Required for `revision`; the route ignores it for other kinds. */
  readonly rev?: number | undefined;
}

/** The same-origin URL of an agreement PDF, served by `app/api/agreements/[id]/files/[kind]`. */
export function fileUrl(
  agreementId: string,
  kind: AgreementFileKind,
  options: FileUrlOptions,
): string {
  const query = new URLSearchParams({ as: options.as });
  if (options.rev !== undefined) query.set("rev", String(options.rev));
  return `/api/agreements/${encodeURIComponent(agreementId)}/files/${kind}?${query.toString()}`;
}
