// The only validation home. Browser-safe: no Node imports, so web client code may import it.
import { z } from "zod";

export const LIMITS = {
  title: 200,
  name: 200,
  typedName: 200,
  email: 254,
  messageText: 10_000,
  proposalText: 10_000,
  aiInstruction: 4_000,
  voidReason: 1_000,
  heading: 200,
  paragraph: 8_000,
  sections: 100,
  paragraphsPerSection: 100,
  sourceBytes: 500_000,
  draftBytes: 600_000,
  pdfBytes: 10 * 1024 * 1024,
  pdfPages: 200,
  recipients: 50,
  requiredSigners: 10,
  pageSize: 50,
  search: 200,
  receiptKey: 200,
  jobPayloadBytes: 65_536,
} as const;

export const SIGNING_CONSENT = {
  version: "dripsign-electronic-signature-v1",
  text: "I have reviewed this exact document and agree to sign it electronically. I intend my typed name to be my signature and consent to electronic records for this agreement.",
  // The signing_round CHECK recomputes this hash, so a drifted constant fails loudly.
  sha256: "59ebf88c93fc5c629f6cb1010f6c7be828c6ccf0c2d18e32ae7d61d683774f55",
} as const;

/** PostgreSQL jsonb reorders keys; hashes and equality use this one encoding. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value) as string | undefined;
  if (encoded === undefined) throw new TypeError("Value cannot be encoded as JSON");
  return encoded;
}

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length;
const NAME_FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
// Control characters other than tab and newline.
const TEXT_FORBIDDEN = /[^\P{Cc}\t\n]/u;

export const uuidSchema = z.uuid();
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u, "Expected a sha256 hex digest");
export const expectedVersionSchema = z.number().int().positive();
export const receiptKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]+$/u)
  .min(8)
  .max(LIMITS.receiptKey);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(LIMITS.email)
  .pipe(z.email("Enter a valid email address."));

export const personNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(LIMITS.name)
  .refine((value) => !NAME_FORBIDDEN.test(value), "The name contains unsupported characters.");

/** Shape check only; `pdf/font.ts` `assertRenderableName` adds the glyph and fit check. */
export const typedNameSchema = z
  .string()
  .trim()
  .min(1, "Type your full name.")
  .max(LIMITS.typedName)
  .refine((value) => !NAME_FORBIDDEN.test(value), "The name contains unsupported characters.");

export const titleSchema = z
  .string()
  .trim()
  .min(1, "Enter a title.")
  .max(LIMITS.title)
  .refine((value) => !NAME_FORBIDDEN.test(value), "The title contains unsupported characters.");

/** Free text: newlines allowed, CRLF from form posts normalised, other control characters refused. */
function textSchema(max: number) {
  return z
    .string()
    .overwrite((value) => value.replace(/\r\n?/gu, "\n"))
    .max(max)
    .refine((value) => !TEXT_FORBIDDEN.test(value), "The text contains unsupported characters.");
}

export const messageTextSchema = textSchema(LIMITS.messageText).refine(
  (value) => value.trim().length > 0,
  "Write a message.",
);
export const proposalTextSchema = textSchema(LIMITS.proposalText).refine(
  (value) => value.trim().length > 0,
  "Describe the change.",
);
export const aiInstructionSchema = textSchema(LIMITS.aiInstruction).refine(
  (value) => value.trim().length > 0,
  "Describe what you need.",
);

export const documentSectionSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
  heading: textSchema(LIMITS.heading),
  paragraphs: z.array(textSchema(LIMITS.paragraph).min(1)).min(1).max(LIMITS.paragraphsPerSection),
});

export const documentSourceSchema = z
  .strictObject({
    title: titleSchema,
    sections: z.array(documentSectionSchema).min(1).max(LIMITS.sections),
  })
  .refine(
    (source) =>
      new Set(source.sections.map((section) => section.id)).size === source.sections.length,
    "Section ids must be unique.",
  )
  .refine(
    (source) => utf8Bytes(JSON.stringify(source)) <= LIMITS.sourceBytes,
    "The document is too long.",
  );

/** Stored PDF bytes; the storage adapter derives the object key from tenant + sha256. */
export const documentAssetSchema = z.strictObject({
  sha256: sha256Schema,
  byteLength: z.number().int().positive(),
  pageCount: z.number().int().positive(),
});

/** Raw uploaded PDF bytes; the page count is known only after the worker parses them. */
export const uploadAssetSchema = z.strictObject({
  sha256: sha256Schema,
  byteLength: z.number().int().positive(),
});

export const signingFieldSchema = z
  .strictObject({
    recipientId: uuidSchema,
    type: z.enum(["signature", "date"]),
    page: z.number().int().positive(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine((field) => field.x + field.width <= 1 && field.y + field.height <= 1);

export const PREPARATION_STATUSES = ["empty", "preparing", "ready", "failed"] as const;

/**
 * The private working draft stored in `agreement.draft`. `preparation.inputSha256` and
 * `signerSetHash` are the fence a `pdf_prepare` commit must still match.
 */
export const draftSchema = z
  .strictObject({
    source: documentSourceSchema.nullable(),
    upload: uploadAssetSchema.nullable(),
    document: documentAssetSchema.nullable(),
    signingFields: z.array(signingFieldSchema).max(LIMITS.requiredSigners * 2),
    signerIds: z.array(uuidSchema).max(LIMITS.requiredSigners),
    preparation: z.strictObject({
      status: z.enum(PREPARATION_STATUSES),
      error: z.string().max(500).nullable(),
      inputSha256: sha256Schema.nullable(),
      signerSetHash: sha256Schema.nullable(),
    }),
  })
  .refine(
    (draft) => draft.source === null || draft.upload === null,
    "Use terms or a PDF, not both.",
  )
  .refine(
    (draft) => utf8Bytes(JSON.stringify(draft)) <= LIMITS.draftBytes,
    "The draft is too large.",
  );

export const aiSuggestionResultSchema = z.strictObject({
  summary: z.string().min(1).max(2_000),
  source: documentSourceSchema,
  questions: z.array(z.string().min(1).max(500)).max(20),
});

export const newRecipientSchema = z.strictObject({
  name: personNameSchema,
  email: emailSchema,
  isSigner: z.boolean(),
});

export const newAgreementInputSchema = z
  .strictObject({
    title: titleSchema,
    document: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("source"), source: documentSourceSchema }),
      // The PDF bytes follow through the upload route once the draft exists.
      z.strictObject({ kind: z.literal("upload") }),
    ]),
    recipients: z.array(newRecipientSchema).min(1).max(LIMITS.recipients),
  })
  .refine(
    (input) =>
      new Set(input.recipients.map((recipient) => recipient.email)).size ===
      input.recipients.length,
    "Each recipient needs a different email address.",
  )
  .refine(
    (input) =>
      input.recipients.filter((recipient) => recipient.isSigner).length <= LIMITS.requiredSigners,
    `An agreement can have at most ${String(LIMITS.requiredSigners)} required signers.`,
  );

const fenced = { expectedVersion: expectedVersionSchema };
const replacementSource = documentSourceSchema.optional();

export const commandSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("save_draft"),
    ...fenced,
    title: titleSchema.optional(),
    source: documentSourceSchema,
  }),
  z.strictObject({ kind: z.literal("publish"), ...fenced, reviewedSha256: sha256Schema }),
  z.strictObject({ kind: z.literal("retry_preparation"), ...fenced }),
  z.strictObject({
    kind: z.literal("add_recipient"),
    ...fenced,
    name: personNameSchema,
    email: emailSchema,
    isSigner: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("remove_recipient"), ...fenced, recipientId: uuidSchema }),
  z.strictObject({ kind: z.literal("resend_invite"), recipientId: uuidSchema }),
  z.strictObject({
    kind: z.literal("set_signer"),
    ...fenced,
    recipientId: uuidSchema,
    isSigner: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("message"), body: messageTextSchema }),
  z.strictObject({
    kind: z.literal("propose"),
    ...fenced,
    text: proposalTextSchema,
    replacementSource,
  }),
  z.strictObject({
    kind: z.literal("counter"),
    ...fenced,
    proposalId: uuidSchema,
    text: proposalTextSchema,
    replacementSource,
  }),
  z.strictObject({ kind: z.literal("accept"), ...fenced, proposalId: uuidSchema }),
  z.strictObject({ kind: z.literal("reject"), ...fenced, proposalId: uuidSchema }),
  z.strictObject({ kind: z.literal("request_signatures"), ...fenced }),
  z.strictObject({ kind: z.literal("cancel_signatures"), ...fenced, roundId: uuidSchema }),
  z.strictObject({
    kind: z.literal("sign"),
    roundId: uuidSchema,
    revisionId: uuidSchema,
    documentSha256: sha256Schema,
    typedName: typedNameSchema,
    consentVersion: z.string().min(1).max(100),
    consentHash: sha256Schema,
  }),
  z.strictObject({
    kind: z.literal("void"),
    ...fenced,
    reason: textSchema(LIMITS.voidReason).min(1).optional(),
  }),
  z.strictObject({
    kind: z.literal("ask_ai"),
    instruction: aiInstructionSchema,
    proposalId: uuidSchema.optional(),
  }),
  z.strictObject({ kind: z.literal("apply_ai"), ...fenced, suggestionId: uuidSchema }),
]);

export const COMMAND_KINDS = commandSchema.options.map((option) => option.shape.kind.value);

export const STAFF_LIST_FILTERS = [
  "all",
  "needs_you",
  "draft",
  "negotiating",
  "signing",
  "signed",
  "void",
] as const;

export const staffListQuerySchema = z.strictObject({
  q: z.string().trim().max(LIMITS.search).optional(),
  status: z.enum(STAFF_LIST_FILTERS).optional(),
  cursor: z.string().max(200).optional(),
});

export const EMAIL_TEMPLATES = [
  "otp_code",
  "step_up",
  "invite",
  "revision_published",
  "sign_request",
  "signing_cancelled",
  "completed",
  "voided",
] as const;

const hostUuid = (field: string) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.uuid(`Enter the ${field} as a UUID.`));
const hostIdentifier = (field: string) =>
  z
    .string()
    .trim()
    .regex(/^[\x21-\x7e]{1,100}$/u, `Enter the ${field} as 1 to 100 visible ASCII characters.`);
const positiveCount = (field: string, max: number) =>
  z
    .number(`Enter the ${field} as a whole number.`)
    .int(`Enter the ${field} as a whole number.`)
    .min(1, `The ${field} is at least 1.`)
    .max(max, `The ${field} is at most ${String(max)}.`);

/** The public pins Dreach issued for this tenant's executed event; no secret, no URL. */
export const completionExportConfigSchema = z.strictObject({
  hostTenantId: hostUuid("host tenant id"),
  senderBindingId: hostUuid("sender binding id"),
  senderBindingRevision: positiveCount("sender binding revision", Number.MAX_SAFE_INTEGER),
  senderGrantId: hostUuid("sender grant id"),
  issuer: hostIdentifier("issuer"),
  audience: hostIdentifier("audience"),
  keyId: hostIdentifier("key id"),
  keyVersion: positiveCount("key version", 4_294_967_295),
  freshnessSeconds: positiveCount("freshness", 300),
});

/** A save names the revision it replaces (0 for the first), so a stale form cannot win. */
export const completionExportSaveSchema = z.strictObject({
  expectedRevision: z.number().int().min(0),
  config: completionExportConfigSchema,
});

/** Tenant and agreement ids live on the outbox row, not in the payload. */
export const jobPayloadSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("email"),
      to: emailSchema,
      template: z.enum(EMAIL_TEMPLATES),
      // Scrubbed to {} when the job finishes; may hold an OTP code until then.
      params: z.record(z.string().max(100), z.string().max(2_000)),
    }),
    z.strictObject({
      kind: z.literal("pdf_prepare"),
      // canonicalJson sha256 of { title, source, upload sha256 }: what the renderer consumes.
      inputSha256: sha256Schema,
      signerSetHash: sha256Schema,
    }),
    z.strictObject({ kind: z.literal("archive"), roundId: uuidSchema }),
    z.strictObject({ kind: z.literal("ai_suggest"), suggestionId: uuidSchema }),
    z.strictObject({ kind: z.literal("host_event"), roundId: uuidSchema }),
  ])
  .refine((payload) => utf8Bytes(JSON.stringify(payload)) <= LIMITS.jobPayloadBytes);

export type DocumentSection = z.infer<typeof documentSectionSchema>;
export type DocumentSource = z.infer<typeof documentSourceSchema>;
export type DocumentAsset = z.infer<typeof documentAssetSchema>;
export type UploadAsset = z.infer<typeof uploadAssetSchema>;
export type SigningField = z.infer<typeof signingFieldSchema>;
export type PreparationStatus = (typeof PREPARATION_STATUSES)[number];
export type Draft = z.infer<typeof draftSchema>;
export type AiSuggestionResult = z.infer<typeof aiSuggestionResultSchema>;
export type NewRecipient = z.infer<typeof newRecipientSchema>;
export type NewAgreementInput = z.infer<typeof newAgreementInputSchema>;
export type Command = z.infer<typeof commandSchema>;
export type CommandKind = Command["kind"];
export type CommandOf<K extends CommandKind> = Extract<Command, { kind: K }>;
export type StaffListFilter = (typeof STAFF_LIST_FILTERS)[number];
export type StaffListQuery = z.infer<typeof staffListQuerySchema>;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];
export type JobPayload = z.infer<typeof jobPayloadSchema>;
export type CompletionExportConfig = z.infer<typeof completionExportConfigSchema>;
export type CompletionExportSave = z.input<typeof completionExportSaveSchema>;
export type JobKind = JobPayload["kind"];
