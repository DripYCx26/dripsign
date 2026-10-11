import { z } from "zod";
import { storeUpload } from "@dripsign/core/domain/commands";
import { expectedVersionSchema, LIMITS, receiptKeySchema, uuidSchema } from "@dripsign/core/schema";
import {
  failureResponse,
  HttpError,
  jsonResult,
  mediaType,
  readBoundedBody,
  requirePublicOrigin,
} from "@/server/http";
import { currentSession, staffActorIn } from "@/server/session";

const UPLOAD_TIMEOUT_MS = 30_000;

const querySchema = z.strictObject({
  key: receiptKeySchema,
  expectedVersion: z.coerce.number().pipe(expectedVersionSchema),
});

interface Context {
  readonly params: Promise<{ id: string }>;
}

/**
 * Raw PDF bytes for a staff draft. Checks run cheapest first, and authority before the body is
 * read, so a stranger cannot make the server buffer 10 MB. The worker parses the PDF, not this.
 */
export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    requirePublicOrigin(request.headers);
    if (mediaType(request.headers) !== "application/pdf") {
      throw new HttpError(415, "invalid", "Choose a PDF file.");
    }
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) {
      throw new HttpError(404, "not_found", "This agreement isn’t available.");
    }
    const search = new URL(request.url).searchParams;
    const query = querySchema.safeParse({
      key: search.get("key") ?? undefined,
      expectedVersion: search.get("expectedVersion") ?? undefined,
    });
    if (!query.success) throw new HttpError(400, "invalid", "This upload request is incomplete.");
    const actor = await staffActorIn(await currentSession());
    const bytes = await readBoundedBody(request, {
      bytes: LIMITS.pdfBytes,
      ms: UPLOAD_TIMEOUT_MS,
      tooLarge: `The PDF is larger than ${String(LIMITS.pdfBytes / 1024 / 1024)} MB.`,
    });
    const view = await storeUpload(actor, id, query.data.key, {
      expectedVersion: query.data.expectedVersion,
      bytes,
    });
    return jsonResult({ ok: true, value: view });
  } catch (error) {
    return failureResponse(error);
  }
}
