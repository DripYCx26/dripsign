import { z } from "zod";
import { readAgreementFile, type FileRequest } from "@dripsign/core/domain/view";
import { uuidSchema } from "@dripsign/core/schema";
import type { AgreementFile, AgreementFileKind, Capacity } from "@dripsign/core/types";
import { failureResponse, HttpError, PRIVATE_NO_STORE } from "@/server/http";
import { actorIn, currentSession } from "@/server/session";

const targetSchema = z
  .strictObject({
    id: uuidSchema,
    kind: z.enum([
      "draft",
      "current",
      "revision",
      "signed",
      "audit",
    ]) satisfies z.ZodType<AgreementFileKind>,
    as: z.enum(["staff", "recipient"]) satisfies z.ZodType<Capacity>,
    rev: z.coerce.number().int().positive().optional(),
  })
  .refine((target) => target.kind !== "revision" || target.rev !== undefined);

interface Context {
  readonly params: Promise<{ id: string; kind: string }>;
}

/** Streams one PDF the caller may read now; every refusal looks like a missing file. */
export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { id, kind } = await context.params;
    const search = new URL(request.url).searchParams;
    const parsed = targetSchema.safeParse({
      id,
      kind,
      as: search.get("as") ?? undefined,
      rev: search.get("rev") ?? undefined,
    });
    if (!parsed.success) throw new HttpError(404, "not_found", "This file isn’t available.");
    const target = parsed.data;
    const file: FileRequest =
      target.kind === "revision" && target.rev !== undefined
        ? { kind: target.kind, revisionNumber: target.rev }
        : { kind: target.kind };
    const actor = await actorIn(await currentSession(), target.as, target.id);
    return pdfResponse(await readAgreementFile(actor, target.id, file));
  } catch (error) {
    return failureResponse(error);
  }
}

function pdfResponse(file: AgreementFile): Response {
  // Copied into an ArrayBuffer-backed view: BodyInit refuses a possibly shared buffer.
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(file.bytes.byteLength),
      "Content-Disposition": contentDisposition(file.filename),
      // Opened directly, the bytes run with no origin: no scripts, forms or same-origin access.
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": PRIVATE_NO_STORE,
    },
  });
}

const UNSAFE_FILENAME = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}"\\/:*?<>|]+/gu;
const MAX_FILENAME = 120;

/** An ASCII fallback plus the RFC 5987 UTF-8 name; neither can break out of the header. */
function contentDisposition(raw: string): string {
  // Truncate by code point: a split surrogate pair would make encodeURIComponent throw.
  const cleaned = raw
    .replace(/\.pdf$/iu, "")
    .replace(UNSAFE_FILENAME, " ")
    .trim();
  const stem = Array.from(cleaned).slice(0, MAX_FILENAME).join("").trim() || "agreement";
  const ascii = stem.replace(/[^A-Za-z0-9._ -]+/gu, "_");
  const encoded = encodeURIComponent(`${stem}.pdf`).replace(
    /['()*]/gu,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${ascii}.pdf"; filename*=UTF-8''${encoded}`;
}
