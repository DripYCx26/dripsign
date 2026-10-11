import type { ActionResult } from "@/server/action";
import type { AgreementView } from "@dripsign/core/types";

export const UNCERTAIN =
  "We couldn’t confirm whether that went through. Reload to check before trying again.";

export type UploadOutcome =
  Readonly<{ ok: true; view: AgreementView }> | Readonly<{ ok: false; message: string }>;

function isActionResult(body: unknown): body is ActionResult<AgreementView> {
  return typeof body === "object" && body !== null && "ok" in body && typeof body.ok === "boolean";
}

/**
 * Sends a PDF to the upload route as the raw body. `key` is the user's one intent: a retry of the
 * same file reuses it so the server replays the stored result instead of storing twice.
 */
export async function uploadPdf(
  agreementId: string,
  file: File,
  key: string,
  expectedVersion: number,
): Promise<UploadOutcome> {
  const query = new URLSearchParams({ key, expectedVersion: String(expectedVersion) });
  let response: Response;
  try {
    response = await fetch(`/api/agreements/${agreementId}/upload?${query.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: file,
    });
  } catch {
    return { ok: false, message: UNCERTAIN };
  }
  const body: unknown = await response.json().catch(() => null);
  if (!isActionResult(body)) return { ok: false, message: UNCERTAIN };
  return body.ok ? { ok: true, view: body.value } : { ok: false, message: body.message };
}
