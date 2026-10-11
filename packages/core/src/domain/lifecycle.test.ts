import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { storeBytes } from "../adapters/storage.ts";
import { getPool } from "../db.ts";
import { SIGNING_CONSENT } from "../schema.ts";
import type { Command, DocumentSource, NewRecipient, SigningField } from "../schema.ts";
import type { Actor, AgreementView, RecipientActor, StaffActor } from "../types.ts";
import { createAgreement, executeCommand } from "./commands.ts";
import { sha256Hex } from "./receipts.ts";
import { applyPreparedDraft } from "./revisions.ts";
import { completeArchive } from "./signing.ts";
import { loadAgreementView } from "./view.ts";

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected a value");
  return value;
}

function terms(term: string): DocumentSource {
  return {
    title: "Services agreement",
    sections: [{ id: "term", heading: "Term", paragraphs: [term] }],
  };
}

async function session(email: string): Promise<{ sessionId: string; verifiedAt: string }> {
  const sessionId = randomUUID();
  const created = await getPool().query<{ verifiedAt: Date }>(
    `INSERT INTO dripsign.auth_session (id, token_hash, email, verified_at, expires_at)
     VALUES ($1, $2, $3, now(), now() + interval '1 hour')
     RETURNING verified_at AS "verifiedAt"`,
    [sessionId, sha256Hex(sessionId), email],
  );
  return { sessionId, verifiedAt: must(created.rows[0]).verifiedAt.toISOString() };
}

async function staffActor(): Promise<StaffActor> {
  const tenantId = randomUUID();
  const email = `staff-${tenantId}@acme.test`;
  await getPool().query("INSERT INTO dripsign.tenant (id, name) VALUES ($1, $2)", [
    tenantId,
    `Acme ${tenantId}`,
  ]);
  await getPool().query(
    "INSERT INTO dripsign.staff (tenant_id, email, role) VALUES ($1, $2, 'admin')",
    [tenantId, email],
  );
  return { capacity: "staff", tenantId, email, role: "admin", ...(await session(email)) };
}

async function recipientActor(email: string): Promise<RecipientActor> {
  return { capacity: "recipient", email, ...(await session(email)) };
}

function person(name: string, isSigner: boolean): NewRecipient {
  return {
    name,
    email: `${name.split(" ")[0]?.toLowerCase() ?? "x"}-${randomUUID()}@example.test`,
    isSigner,
  };
}

function run(actor: Actor, agreementId: string, command: Command): Promise<AgreementView> {
  return executeCommand(actor, agreementId, `key-${randomUUID()}`, command);
}

/** Stands in for the worker: stores a PDF and commits it against the draft's current fence. */
async function prepare(staff: StaffActor, agreementId: string): Promise<AgreementView> {
  const draft = must((await loadAgreementView(staff, agreementId)).draft);
  const document = await storeBytes(
    staff.tenantId,
    new TextEncoder().encode(`%PDF-1.7 prepared ${randomUUID()}`),
  );
  const fields: SigningField[] = draft.signerIds.flatMap((recipientId, index) => {
    const box = { recipientId, page: 2, x: 0.1, width: 0.4, height: 0.05 };
    return [
      { ...box, type: "signature", y: 0.1 + index * 0.2 },
      { ...box, type: "date", y: 0.17 + index * 0.2 },
    ];
  });
  const fence = {
    inputSha256: must(draft.preparation.inputSha256),
    signerSetHash: must(draft.preparation.signerSetHash),
  };
  const applied = await applyPreparedDraft(getPool(), {
    tenantId: staff.tenantId,
    agreementId,
    fence,
    document,
    pageCount: 2,
    fields,
  });
  expect(applied).toBe(true);
  return loadAgreementView(staff, agreementId);
}

async function publish(staff: StaffActor, agreementId: string): Promise<AgreementView> {
  const prepared = await prepare(staff, agreementId);
  return run(staff, agreementId, {
    kind: "publish",
    expectedVersion: prepared.agreement.version,
    reviewedSha256: must(prepared.draft?.document).sha256,
  });
}

async function negotiating(recipients: readonly NewRecipient[]) {
  const staff = await staffActor();
  const id = await createAgreement(staff, `key-${randomUUID()}`, {
    title: "Services agreement",
    document: { kind: "source", source: terms("Twelve months.") },
    recipients: [...recipients],
  });
  const view = await publish(staff, id);
  const actors = await Promise.all(recipients.map((recipient) => recipientActor(recipient.email)));
  return { staff, id, view, actors };
}

function signCommand(view: AgreementView, typedName: string): Command {
  const round = must(view.activeRound);
  return {
    kind: "sign",
    roundId: round.id,
    revisionId: round.revisionId,
    documentSha256: round.documentSha256,
    typedName,
    consentVersion: SIGNING_CONSENT.version,
    consentHash: SIGNING_CONSENT.sha256,
  };
}

async function jobCount(agreementId: string, kind: string, template?: string): Promise<number> {
  const counted = await getPool().query<{ count: number }>(
    `SELECT count(*)::int AS count FROM dripsign.outbox
     WHERE agreement_id = $1 AND kind = $2 AND ($3::text IS NULL OR payload->>'template' = $3)`,
    [agreementId, kind, template ?? null],
  );
  return must(counted.rows[0]).count;
}

it("negotiates, publishes, collects every signature and archives the signed agreement", async () => {
  const staff = await staffActor();
  const jordan = person("Jordan Lee", true);
  const morgan = person("Morgan Diaz", true);
  const id = await createAgreement(staff, `key-${randomUUID()}`, {
    title: "Services agreement",
    document: { kind: "source", source: terms("Twelve months.") },
    recipients: [jordan, morgan],
  });
  const created = await loadAgreementView(staff, id);
  await run(staff, id, {
    kind: "save_draft",
    expectedVersion: created.agreement.version,
    source: terms("Ten months."),
  });
  let view = await publish(staff, id);
  expect(view.agreement.status).toBe("negotiating");

  const [jordanActor, morganActor] = await Promise.all([
    recipientActor(jordan.email),
    recipientActor(morgan.email),
  ]);
  view = await run(jordanActor, id, {
    kind: "propose",
    expectedVersion: view.agreement.version,
    text: "Shorter term.",
    replacementSource: terms("Six months."),
  });
  view = await run(staff, id, {
    kind: "counter",
    expectedVersion: view.agreement.version,
    proposalId: must(view.proposals.at(-1)).id,
    text: "Meet in the middle.",
    replacementSource: terms("Nine months."),
  });
  await run(jordanActor, id, {
    kind: "accept",
    expectedVersion: view.agreement.version,
    proposalId: must(view.proposals.at(-1)).id,
  });
  expect(must((await loadAgreementView(staff, id)).draft?.source).sections[0]?.paragraphs).toEqual([
    "Nine months.",
  ]);
  view = await publish(staff, id);
  const signing = await run(staff, id, {
    kind: "request_signatures",
    expectedVersion: view.agreement.version,
  });

  await run(jordanActor, id, signCommand(signing, "Jordan Lee"));
  await run(morganActor, id, signCommand(signing, "Morgan Diaz"));
  view = await loadAgreementView(staff, id);
  const round = must(view.activeRound);
  expect(round.status).toBe("finalizing");
  expect(await jobCount(id, "archive")).toBe(1);
  expect(await jobCount(id, "email", "sign_request")).toBe(2);

  // The worker's claim, scoped to this agreement's job.
  const leased = await getPool().query<{ id: string; leaseToken: string }>(
    `UPDATE dripsign.outbox SET status = 'running', attempts = attempts + 1,
       lease_token = gen_random_uuid(), lease_until = now() + interval '1 minute'
     WHERE agreement_id = $1 AND kind = 'archive'
     RETURNING id, lease_token AS "leaseToken"`,
    [id],
  );
  const signedDocument = await storeBytes(staff.tenantId, new TextEncoder().encode("%PDF signed"));
  const auditRecord = await storeBytes(staff.tenantId, new TextEncoder().encode("%PDF audit"));
  const outcome = await completeArchive(getPool(), {
    tenantId: staff.tenantId,
    roundId: round.id,
    leaseFence: must(leased.rows[0]),
    signedDocument,
    auditRecord,
  });
  expect(outcome).toBe("completed");
  view = await loadAgreementView(jordanActor, id);
  expect(view.agreement.status).toBe("signed");
  expect(view.artifacts.map((artifact) => artifact.sha256).sort()).toEqual(
    [signedDocument.sha256, auditRecord.sha256].sort(),
  );
});

it("lets only a required signer cancel signing by proposing, and voids on signer removal", async () => {
  const jordan = person("Jordan Lee", true);
  const morgan = person("Morgan Diaz", true);
  const taylor = person("Taylor Kim", false);
  const { staff, id, view: published, actors } = await negotiating([jordan, morgan, taylor]);
  const jordanActor = must(actors[0]);
  const morganActor = must(actors[1]);
  const taylorActor = must(actors[2]);
  let view = await run(staff, id, {
    kind: "request_signatures",
    expectedVersion: published.agreement.version,
  });
  const firstRound = must(view.activeRound).id;
  await run(jordanActor, id, signCommand(view, "Jordan Lee"));

  view = await run(morganActor, id, {
    kind: "propose",
    expectedVersion: (await loadAgreementView(morganActor, id)).agreement.version,
    text: "One more change before I sign.",
  });
  expect(view.agreement.status).toBe("negotiating");
  const ended = await getPool().query<{ endReason: string; signatures: number }>(
    `SELECT end_reason AS "endReason",
       (SELECT count(*)::int FROM dripsign.signature WHERE round_id = $1) AS signatures
     FROM dripsign.signing_round WHERE id = $1`,
    [firstRound],
  );
  expect(ended.rows[0]).toEqual({ endReason: "signer_proposal", signatures: 1 });

  view = await run(staff, id, {
    kind: "reject",
    expectedVersion: view.agreement.version,
    proposalId: must(view.proposals.at(-1)).id,
  });
  view = await run(staff, id, {
    kind: "request_signatures",
    expectedVersion: view.agreement.version,
  });
  const secondRound = must(view.activeRound).id;
  await expect(
    run(taylorActor, id, {
      kind: "propose",
      expectedVersion: view.agreement.version,
      text: "An observer cannot stop signing.",
    }),
  ).rejects.toMatchObject({ code: "conflict" });

  const morganId = must(view.recipients.find((recipient) => recipient.email === morgan.email)).id;
  view = await run(staff, id, {
    kind: "remove_recipient",
    expectedVersion: view.agreement.version,
    recipientId: morganId,
  });
  expect(view.activeRound).toBeNull();
  const removed = await getPool().query<{ status: string; endReason: string }>(
    `SELECT status, end_reason AS "endReason" FROM dripsign.signing_round WHERE id = $1`,
    [secondRound],
  );
  expect(removed.rows[0]).toEqual({ status: "void", endReason: "signer_removed" });
});

it("fences stale versions and replays a receipt without a second effect", async () => {
  const jordan = person("Jordan Lee", true);
  const { staff, id, view, actors } = await negotiating([jordan]);
  const jordanActor = must(actors[0]);
  await expect(
    run(staff, id, {
      kind: "save_draft",
      expectedVersion: view.agreement.version - 1,
      source: terms("Stale edit."),
    }),
  ).rejects.toMatchObject({ code: "conflict" });

  const key = `key-${randomUUID()}`;
  const proposal: Command = {
    kind: "propose",
    expectedVersion: view.agreement.version,
    text: "Shorter term.",
  };
  await executeCommand(jordanActor, id, key, proposal);
  const replayed = await executeCommand(jordanActor, id, key, proposal);
  expect(replayed.proposals).toHaveLength(1);
  await expect(
    executeCommand(jordanActor, id, key, { ...proposal, text: "A different change." }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect((await loadAgreementView(jordanActor, id)).proposals).toHaveLength(1);
});
