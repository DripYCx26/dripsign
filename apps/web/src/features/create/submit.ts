import type { NewAgreementInput } from "@dripsign/core/schema";
import { createAgreement, refreshView } from "@/server/actions/agreements";
import { UNCERTAIN, uploadPdf } from "../document/upload.ts";

export type CreatePhase = "idle" | "creating" | "uploading" | "preparing";

export interface CreateKeys {
  readonly create: string;
  readonly upload: string;
}

export type SubmitOutcome =
  Readonly<{ ok: true; id: string }> | Readonly<{ ok: false; message: string }>;

type SubmitArgs = Readonly<{
  input: NewAgreementInput;
  /** The PDF on the upload path, else null. */
  file: File | null;
  keys: CreateKeys;
  /** Set once the draft exists, so a retry after a failed upload does not create it again. */
  createdId: string | null;
  onPhase: (phase: CreatePhase) => void;
  onCreated: (id: string) => void;
}>;

/** A thrown server action means the network failed before we heard the outcome. */
async function attempt<T>(call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch {
    return null;
  }
}

/**
 * Creates the draft, and on the PDF path sends the file to the draft just created. Both steps
 * carry their own receipt key, so repeating this call with the same keys never creates two drafts
 * or stores the file twice.
 */
export async function submitCreate(args: SubmitArgs): Promise<SubmitOutcome> {
  let id = args.createdId;
  if (id === null) {
    args.onPhase("creating");
    const created = await attempt(() =>
      createAgreement({ receiptKey: args.keys.create, input: args.input }),
    );
    if (created === null) return { ok: false, message: UNCERTAIN };
    if (!created.ok) return { ok: false, message: created.message };
    id = created.value.id;
    args.onCreated(id);
  }
  const { file } = args;
  if (file === null) return { ok: true, id };

  args.onPhase("uploading");
  const draftId = id;
  const fresh = await attempt(() => refreshView({ agreementId: draftId, capacity: "staff" }));
  if (fresh === null) return { ok: false, message: UNCERTAIN };
  if (!fresh.ok) return { ok: false, message: fresh.message };
  const uploaded = await uploadPdf(draftId, file, args.keys.upload, fresh.value.agreement.version);
  if (!uploaded.ok) return { ok: false, message: uploaded.message };
  args.onPhase("preparing");
  return { ok: true, id };
}
