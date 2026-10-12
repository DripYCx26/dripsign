import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { objectKey, readBytes } from "../adapters/storage.ts";
import { getPool, tx } from "../db.ts";
import { DomainError } from "../errors.ts";
import { createHandlers } from "../jobs/handlers.ts";
import type { ClaimedJob, JobLease } from "../jobs/outbox.ts";
import { SIGNING_VERIFICATION_MAX_AGE_MS } from "../auth/sessions.ts";
import { LIMITS, SIGNING_CONSENT } from "../schema.ts";
import type { Command, DocumentSource, JobPayload } from "../schema.ts";
import type { NewAgreementInput, NewRecipient } from "../schema.ts";
import type { Actor, AgreementView, RecipientActor, RevisionView, StaffActor } from "../types.ts";
import { createAgreement, executeCommand } from "./commands.ts";
import { sha256Hex } from "./receipts.ts";
import { addStaff, revokeStaff, upsertStaff } from "./staff.ts";
import { loadArchiveEvidence } from "./archive.ts";
import { renderAuditRecord } from "../pdf/archive.ts";
import { loadAgreementView } from "./view.ts";

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected a value");
  return value;
}

function terms(term: string, fee = "$100 a month."): DocumentSource {
  return {
    title: "Services agreement",
    sections: [
      { id: "term", heading: "Term", paragraphs: [term] },
      { id: "fee", heading: "Fee", paragraphs: [fee] },
    ],
  };
}

interface PdfReader {
  getDocument(input: { data: Uint8Array; verbosity: number }): {
    promise: Promise<{
      getPage(page: number): Promise<{ getTextContent(): Promise<{ items: { str?: string }[] }> }>;
    }>;
    destroy(): Promise<void>;
  };
}

/** The text runs of a published revision's first page, read back from storage. */
async function firstPageText(tenantId: string, revision: RevisionView): Promise<string[]> {
  const { sha256, byteLength } = revision;
  const bytes = await readBytes({ key: objectKey(tenantId, sha256), sha256, byteLength });
  const require = createRequire(new URL("../../../../package.json", import.meta.url));
  const reader = (await import(require.resolve("pdfjs-dist/legacy/build/pdf.mjs"))) as PdfReader;
  const task = reader.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  try {
    const content = await (await (await task.promise).getPage(1)).getTextContent();
    return content.items.map((item) => item.str ?? "");
  } finally {
    await task.destroy();
  }
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

function verifiedAgo(actor: Actor, ms: number) {
  return getPool().query(
    "UPDATE dripsign.auth_session SET verified_at = now() - $2::float8 * interval '1 millisecond' WHERE id = $1",
    [actor.sessionId, ms],
  );
}

async function staffActor(): Promise<StaffActor> {
  const tenantId = randomUUID();
  const email = `staff-${tenantId}@acme.test`;
  await getPool().query("INSERT INTO dripsign.tenant (id, name) VALUES ($1, $2)", [
    tenantId,
    `Acme ${tenantId}`,
  ]);
  await tx((db) => upsertStaff(db, tenantId, { email, role: "admin" }));
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

async function colleague(admin: StaffActor): Promise<StaffActor> {
  const email = `admin-${randomUUID()}@acme.test`;
  await addStaff(admin, { email, role: "admin" });
  return { ...admin, email, ...(await session(email)) };
}

function job(
  payload: JobPayload,
  staff: StaffActor,
  agreementId: string,
  lease: JobLease = { id: randomUUID(), leaseToken: randomUUID() },
): ClaimedJob {
  const now = new Date();
  const scope = { tenantId: staff.tenantId, agreementId };
  return { ...lease, ...scope, attempts: 1, leaseUntil: now, createdAt: now, payload };
}

/** Holds row locks in an open transaction; `queue(n)` returns once n other backends wait on it. */
async function holdLocks(...statements: readonly (readonly [string, readonly unknown[]])[]) {
  const client = await getPool().connect();
  await client.query("BEGIN");
  for (const [sql, params] of statements) await client.query(sql, [...params]);
  const backend = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const { pid } = must(backend.rows[0]);
  return {
    async queue(waiting: number): Promise<void> {
      for (const deadline = Date.now() + 4_000; Date.now() < deadline;) {
        // A second waiter on the same row queues behind the first waiter, not the holder.
        const found = await getPool().query<{ count: number }>(
          `WITH RECURSIVE queued(pid) AS (
             SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))
             UNION
             SELECT a.pid FROM pg_stat_activity a JOIN queued q ON q.pid = ANY(pg_blocking_pids(a.pid))
           )
           SELECT count(*)::int AS count FROM queued`,
          [pid],
        );
        if (must(found.rows[0]).count >= waiting) return;
      }
      throw new Error("Nothing queued behind the held locks");
    },
    async release(): Promise<void> {
      await client.query("COMMIT");
      client.release();
    },
  };
}

/** Runs the worker's own prepare handler against the draft's fence, then publishes the PDF. */
async function publish(staff: StaffActor, agreementId: string): Promise<AgreementView> {
  const { preparation } = must((await loadAgreementView(staff, agreementId)).draft);
  const fence = {
    inputSha256: must(preparation.inputSha256),
    signerSetHash: must(preparation.signerSetHash),
  };
  const prepare = job({ kind: "pdf_prepare", ...fence }, staff, agreementId);
  await createHandlers().pdf_prepare.handler(prepare, new AbortController().signal);
  const prepared = await loadAgreementView(staff, agreementId);
  return run(staff, agreementId, {
    kind: "publish",
    expectedVersion: prepared.agreement.version,
    reviewedSha256: must(prepared.draft?.document).sha256,
  });
}

async function negotiating(recipients: readonly NewRecipient[], recipientIds?: readonly string[]) {
  const staff = await staffActor();
  const id = await createAgreement(staff, `key-${randomUUID()}`, {
    source: terms("Twelve months."),
    recipients: [...recipients],
  });
  if (recipientIds) {
    await getPool().query("DELETE FROM dripsign.recipient WHERE agreement_id = $1", [id]);
    for (const [index, recipient] of recipients.entries()) {
      await getPool().query(
        `INSERT INTO dripsign.recipient
         (tenant_id, agreement_id, id, email, name, is_signer, added_at)
         VALUES ($1, $2, $3, $4, $5, $6, now() + $7 * interval '1 millisecond')`,
        [
          staff.tenantId,
          id,
          recipientIds[index],
          recipient.email,
          recipient.name,
          recipient.isSigner,
          index,
        ],
      );
    }
    await run(staff, id, {
      kind: "save_draft",
      expectedVersion: (await loadAgreementView(staff, id)).agreement.version,
      source: terms("Twelve months."),
    });
  }
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
    source: terms("Twelve months."),
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
  // A proposal rewrites one section of its base: two sections, or a reorder, is refused.
  const reordered = terms("Ten months.");
  reordered.sections.reverse();
  for (const replacementSource of [terms("Six months.", "$90 a month."), reordered]) {
    await expect(
      run(jordanActor, id, {
        kind: "propose",
        expectedVersion: view.agreement.version,
        text: "Shorter term.",
        replacementSource,
      }),
    ).rejects.toMatchObject({ code: "invalid", message: "A proposal changes one section." });
  }
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
  // Staff edit the fee and drop the term while it waits: accepting is refused until the term is
  // back, then lands on the term alone and keeps the fee.
  const acceptPending = (current: AgreementView) =>
    run(jordanActor, id, {
      kind: "accept",
      expectedVersion: current.agreement.version,
      proposalId: must(current.proposals.at(-1)).id,
    });
  const edited = terms("Ten months.", "$120 a month.");
  view = await run(staff, id, {
    kind: "save_draft",
    expectedVersion: view.agreement.version,
    source: { ...edited, sections: edited.sections.slice(1) },
  });
  await expect(acceptPending(view)).rejects.toThrow("The draft no longer has this section.");
  view = await run(staff, id, {
    kind: "save_draft",
    expectedVersion: view.agreement.version,
    source: edited,
  });
  await acceptPending(view);
  expect((await loadAgreementView(staff, id)).draft?.source).toEqual(
    terms("Nine months.", "$120 a month."),
  );
  view = await publish(staff, id);
  // Identical terms saved after a publish prepare again: the PDF prints the number it publishes as.
  view = await run(staff, id, {
    kind: "save_draft",
    expectedVersion: view.agreement.version,
    source: terms("Nine months.", "$120 a month."),
  });
  expect(view.agreement.preparation?.status).not.toBe("ready");
  view = await publish(staff, id);
  const latest = must(view.revisions.at(-1));
  expect(latest.number).toBe(3);
  const printed = (await firstPageText(staff.tenantId, latest)).find((text) =>
    text.startsWith("REVISION "),
  );
  expect(printed).toMatch(/^REVISION 3 · /u);
  const signing = await run(staff, id, {
    kind: "request_signatures",
    expectedVersion: view.agreement.version,
  });
  // A verification older than the signing window is refused and records nothing.
  await verifiedAgo(jordanActor, SIGNING_VERIFICATION_MAX_AGE_MS + 60_000);
  await expect(run(jordanActor, id, signCommand(signing, "Jordan Lee"))).rejects.toMatchObject({
    code: "verification_required",
  });
  const signatures = () =>
    getPool().query("SELECT 1 FROM dripsign.signature WHERE agreement_id = $1", [id]);
  expect((await signatures()).rowCount).toBe(0);
  await verifiedAgo(jordanActor, 0);
  await run(jordanActor, id, signCommand(signing, "Jordan Lee"));
  expect((await signatures()).rowCount).toBe(1);

  // Morgan re-verifies while the last signature waits on a lock; it must still follow, and archive.
  const held = await holdLocks(["SELECT 1 FROM dripsign.agreement WHERE id = $1 FOR UPDATE", [id]]);
  const { userAgent: limit } = LIMITS.requestEvidence;
  const request = { ipAddress: "203.0.113.7", userAgent: "u".repeat(limit + 1) };
  const signed = run({ ...morganActor, request }, id, signCommand(signing, "Morgan Diaz"));
  await held.queue(1);
  await verifiedAgo(morganActor, 0);
  await held.release();
  await signed;
  const evidence = await getPool().query<{ ipAddress: string; userAgent: number }>(
    `SELECT ip_address AS "ipAddress", length(user_agent) AS "userAgent" FROM dripsign.signature
     WHERE agreement_id = $1 AND typed_name = 'Morgan Diaz'`,
    [id],
  );
  expect(evidence.rows).toEqual([{ ipAddress: request.ipAddress, userAgent: limit }]);
  view = await loadAgreementView(staff, id);
  const round = must(view.activeRound);
  expect(round.status).toBe("finalizing");
  expect(round.signers.map((signer) => signer.signature?.face)).toEqual(["script", "script"]);
  expect(await jobCount(id, "archive")).toBe(1);
  expect(await jobCount(id, "email", "sign_request")).toBe(2);

  // The worker's claim, scoped to this agreement's job and hidden from parallel claimers, then
  // its real render and commit.
  const leased = await getPool().query<JobLease>(
    `UPDATE dripsign.outbox SET status = 'running', attempts = attempts + 1,
       lease_token = gen_random_uuid(), available_at = now() + interval '1 minute'
     WHERE agreement_id = $1 AND kind = 'archive'
     RETURNING id, lease_token AS "leaseToken"`,
    [id],
  );
  const archive = job({ kind: "archive", roundId: round.id }, staff, id, must(leased.rows[0]));
  await createHandlers().archive.handler(archive, new AbortController().signal);
  view = await loadAgreementView(jordanActor, id);
  // The completion gate admits "signed" only with both archived artifacts.
  expect(view.agreement.status).toBe("signed");
});

it("cancels signing only by a signer's proposal, voids on removal, keeps one signer order", async () => {
  const taylor = person("Taylor Kim", false);
  const jordan = person("Jordan Lee", true);
  const morgan = person("Morgan Diaz", true);
  const {
    staff,
    id,
    view: published,
    actors,
  } = await negotiating(
    [taylor, jordan, morgan],
    [
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
      "88888888-8888-4888-8888-888888888888",
      "11111111-1111-4111-8111-111111111111",
    ],
  );
  const taylorActor = must(actors[0]);
  const jordanActor = must(actors[1]);
  const morganActor = must(actors[2]);
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

  const idOf = (email: string) => must(view.recipients.find((r) => r.email === email)).id;
  view = await run(staff, id, {
    kind: "remove_recipient",
    expectedVersion: view.agreement.version,
    recipientId: idOf(morgan.email),
  });
  expect(view.activeRound).toBeNull();
  const removed = await getPool().query<{ status: string; endReason: string }>(
    `SELECT status, end_reason AS "endReason" FROM dripsign.signing_round WHERE id = $1`,
    [secondRound],
  );
  expect(removed.rows[0]).toEqual({ status: "void", endReason: "signer_removed" });

  // Taylor, listed before Jordan, signs first once promoted: staging, the worker's signature
  // page and publication all follow the one signer order.
  view = await run(staff, id, {
    kind: "set_signer",
    expectedVersion: view.agreement.version,
    recipientId: idOf(taylor.email),
    isSigner: true,
  });
  view = await publish(staff, id);
  const revision = must(view.revisions.at(-1));
  const order = [idOf(taylor.email), idOf(jordan.email)];
  expect(revision.signerIds).toEqual(order);
  const signatureFields = revision.signingFields.filter((field) => field.type === "signature");
  expect(signatureFields.map((field) => field.recipientId)).toEqual(order);
  view = await run(staff, id, {
    kind: "request_signatures",
    expectedVersion: view.agreement.version,
  });
  await run(jordanActor, id, signCommand(view, "Jordan Lee"));
  await run(taylorActor, id, signCommand(view, "Taylor Kim"));
  const evidence = must(
    await loadArchiveEvidence(getPool(), {
      tenantId: staff.tenantId,
      roundId: must(view.activeRound).id,
    }),
  );
  expect(evidence.signers.map((signer) => signer.recipientId)).toEqual(order);
  // Input signature arrival order must not affect the audit's frozen signer order.
  expect(
    await renderAuditRecord({ ...evidence, signatures: [...evidence.signatures].reverse() }),
  ).toEqual(await renderAuditRecord(evidence));
  expect(
    await renderAuditRecord({ ...evidence, signers: [...evidence.signers].reverse() }),
  ).not.toEqual(await renderAuditRecord(evidence));
});

it("renames from the terms, fences, replays, rechecks authority, keeps the last admin", async () => {
  const jordan = person("Jordan Lee", true);
  const { staff, id, view: published, actors } = await negotiating([jordan]);
  const jordanActor = must(actors[0]);
  // The agreement title follows the saved terms' title; the same save on the old version is fenced.
  const rename = {
    kind: "save_draft",
    source: { ...terms("Twelve months."), title: "Renamed agreement" },
    expectedVersion: published.agreement.version,
  } as const;
  const renamed = await run(staff, id, rename);
  expect(renamed.agreement.title).toBe("Renamed agreement");
  await expect(run(staff, id, rename)).rejects.toMatchObject({ code: "conflict" });
  // Terms the renderer refuses reach staff as its sentence, not its code; a retry prepares again.
  const { inputSha256, signerSetHash } = must(renamed.draft).preparation;
  const fence = { inputSha256: must(inputSha256), signerSetHash: must(signerSetHash) };
  const refused = new DomainError("invalid", "The signer label is too long.");
  await tx((db) =>
    must(createHandlers().pdf_prepare.onFinalFailure)(
      db,
      job({ kind: "pdf_prepare", ...fence }, staff, id),
      "invalid",
      refused,
    ),
  );
  const failed = await loadAgreementView(staff, id);
  expect(failed.agreement.preparation).toEqual({ status: "failed", error: refused.message });
  await run(staff, id, { kind: "retry_preparation", expectedVersion: failed.agreement.version });
  const view = await publish(staff, id);
  const proposal: Command = {
    kind: "propose",
    expectedVersion: view.agreement.version,
    text: "Shorter term.",
  };
  const key = `key-${randomUUID()}`;
  await executeCommand(jordanActor, id, key, proposal);
  const replayed = await executeCommand(jordanActor, id, key, proposal);
  expect(replayed.proposals).toHaveLength(1);
  await expect(
    executeCommand(jordanActor, id, key, { ...proposal, text: "A different change." }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect((await loadAgreementView(jordanActor, id)).proposals).toHaveLength(1);

  // Only the author takes a pending proposal back; then signatures are no longer blocked.
  const pending = must((await loadAgreementView(staff, id)).proposals.at(-1));
  const withdraw = (actor: Actor, expectedVersion: number): Promise<AgreementView> =>
    run(actor, id, { kind: "withdraw", expectedVersion, proposalId: pending.id });
  await expect(withdraw(staff, replayed.agreement.version)).rejects.toMatchObject({
    code: "conflict",
  });
  const withdrawn = await withdraw(jordanActor, replayed.agreement.version);
  expect(must(withdrawn.proposals.at(-1)).status).toBe("superseded");
  // A withdrawal is dated and on the shared timeline as the author's own act.
  expect(withdrawn.timeline.at(-1)).toMatchObject({
    kind: "proposal_superseded",
    actor: { capacity: "recipient", label: "Jordan Lee" },
  });
  expect((await loadAgreementView(staff, id)).allowedActions).toContain("request_signatures");

  // Revoked while a message waits on the agreement, a create replay on its receipt and a roster
  // change on the staff row: all three fail.
  const second = await colleague(staff);
  const draft: NewAgreementInput = { source: terms("Twelve months."), recipients: [] };
  const createKey = `key-${randomUUID()}`;
  // A new draft with no recipients prepares its PDF, and publishing waits for a required signer.
  const created = await createAgreement(staff, createKey, draft);
  expect(await jobCount(created, "pdf_prepare")).toBe(1);
  await expect(publish(staff, created)).rejects.toMatchObject({ code: "conflict" });
  const held = await holdLocks(
    ["SELECT 1 FROM dripsign.agreement WHERE id = $1 FOR UPDATE", [id]],
    ["SELECT 1 FROM dripsign.command_receipt WHERE key = $1 FOR UPDATE", [createKey]],
    [
      "UPDATE dripsign.staff SET revoked_at = now() WHERE tenant_id = $1 AND email = $2",
      [staff.tenantId, staff.email],
    ],
  );
  const queued = Promise.allSettled([
    run(staff, id, { kind: "message", body: "Checking in." }),
    createAgreement(staff, createKey, draft),
    addStaff(staff, { email: `late-${randomUUID()}@acme.test`, role: "member" }),
  ]);
  await held.queue(3);
  await held.release();
  for (const outcome of await queued) {
    expect(outcome).toMatchObject({ status: "rejected", reason: { code: "not_found" } });
  }
  expect((await loadAgreementView(jordanActor, id)).messages).toHaveLength(0);

  // The last admin cannot step down, and two admins revoking each other leave one.
  await expect(addStaff(second, { email: second.email, role: "member" })).rejects.toMatchObject({
    code: "invalid",
  });
  await expect(
    tx((db) => upsertStaff(db, second.tenantId, { email: second.email, role: "member" })),
  ).rejects.toMatchObject({ code: "invalid" });
  const third = await colleague(second);
  const revoked = await Promise.allSettled([
    revokeStaff(second, third.email),
    revokeStaff(third, second.email),
  ]);
  expect(revoked.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
});
