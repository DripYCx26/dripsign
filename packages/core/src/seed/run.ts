// The demo story, written through the real commands so every invariant, receipt and job applies.
import { randomUUID } from "node:crypto";
import { tx } from "../db.ts";
import type { Command, DocumentSource, NewAgreementInput } from "../schema.ts";
import type { AgreementView, StaffActor } from "../types.ts";
import {
  EQUIPMENT_LEASE,
  LOGO_BRIEF,
  MUTUAL_NDA,
  NDA_OBLIGATIONS_ACCEPTED,
  NDA_TERM_RECIPIENT_ASK,
  NDA_TERM_RECIPIENT_COUNTER,
  NDA_TERM_STAFF_COUNTER,
  OFFICE_SUBLEASE,
  PHOTOGRAPHY_GRANT_WITHOUT_ADS,
  PHOTOGRAPHY_LICENSE,
  Q4_RETAINER,
  SPEAKING_ENGAGEMENT,
  WEBSITE_REDESIGN,
  withSection,
} from "./content.ts";
import { AVERY, HARBOR, JORDAN, MORGAN, NORTHWIND, PRIYA, SAM, STAFF, TAYLOR } from "./people.ts";
import type { Person } from "./people.ts";
import { createScript } from "./script.ts";
import type { Script } from "./script.ts";

/** Inserts the tenants and staff once; false when the database already holds a tenant. */
async function insertTenantsAndStaff(): Promise<Map<string, string> | null> {
  return tx(async (db) => {
    // Two seeds starting together (dev script and a manual run) must not both pass the check.
    await db.query("SELECT pg_advisory_xact_lock(hashtext('dripsign.seed'))");
    const existing = await db.query("SELECT 1 FROM dripsign.tenant LIMIT 1");
    if (existing.rowCount !== 0) return null;
    const tenants = new Map<string, string>();
    for (const { tenant, person, role } of STAFF) {
      let tenantId = tenants.get(tenant);
      if (tenantId === undefined) {
        tenantId = randomUUID();
        tenants.set(tenant, tenantId);
        await db.query("INSERT INTO dripsign.tenant (id, name) VALUES ($1, $2)", [
          tenantId,
          tenant,
        ]);
      }
      await db.query(
        "INSERT INTO dripsign.staff (tenant_id, email, name, role) VALUES ($1, $2, $3, $4)",
        [tenantId, person.email, person.name, role],
      );
    }
    return tenants;
  });
}

const recipient = (person: Person, isSigner: boolean) => ({
  name: person.name,
  email: person.email,
  isSigner,
});

const publish = (view: AgreementView): Command => {
  const reviewedSha256 = view.draft?.document?.sha256;
  if (reviewedSha256 === undefined)
    throw new Error("The draft was not prepared before publishing.");
  return { kind: "publish", expectedVersion: view.agreement.version, reviewedSha256 };
};

const requestSignatures = (view: AgreementView): Command => ({
  kind: "request_signatures",
  expectedVersion: view.agreement.version,
});

const signAs =
  (typedName: string) =>
  (view: AgreementView): Command => {
    const round = view.activeRound;
    if (round === null) throw new Error("There is no round to sign.");
    return {
      kind: "sign",
      roundId: round.id,
      revisionId: round.revisionId,
      documentSha256: round.documentSha256,
      typedName,
      consentVersion: round.consent.version,
      consentHash: round.consent.sha256,
    };
  };

const message = (body: string) => (): Command => ({ kind: "message", body });

const propose =
  (text: string, replacementSource?: DocumentSource) =>
  (view: AgreementView): Command => ({
    kind: "propose",
    expectedVersion: view.agreement.version,
    text,
    replacementSource,
  });

function pendingProposalId(view: AgreementView): string {
  const pending = view.proposals.find((proposal) => proposal.status === "pending");
  if (pending === undefined) throw new Error("There is no pending proposal.");
  return pending.id;
}

const counter =
  (text: string, replacementSource: DocumentSource) =>
  (view: AgreementView): Command => ({
    kind: "counter",
    expectedVersion: view.agreement.version,
    proposalId: pendingProposalId(view),
    text,
    replacementSource,
  });

const accept = (view: AgreementView): Command => ({
  kind: "accept",
  expectedVersion: view.agreement.version,
  proposalId: pendingProposalId(view),
});

/** Creates a draft from written terms and lets the worker prepare its PDF. */
async function startDraft(
  script: Script,
  staff: StaffActor,
  source: DocumentSource,
  recipients: NewAgreementInput["recipients"],
): Promise<string> {
  const id = await script.create(staff, { source, recipients });
  await script.settle();
  return id;
}

/** Publishes the prepared draft as the next revision. */
async function publishDraft(script: Script, staff: StaffActor, id: string): Promise<void> {
  await script.settle();
  await script.step(staff, id, publish);
}

async function startSigning(script: Script, staff: StaffActor, id: string): Promise<void> {
  await publishDraft(script, staff, id);
  await script.step(staff, id, requestSignatures);
}

async function mutualNda(script: Script, avery: StaffActor): Promise<void> {
  const jordan = await script.recipient(JORDAN);
  const id = await startDraft(script, avery, MUTUAL_NDA, [
    recipient(JORDAN, true),
    recipient(TAYLOR, false),
  ]);
  await publishDraft(script, avery, id);
  await script.step(
    avery,
    id,
    message("Thanks for taking a look. Tell us if anything here needs a change."),
  );
  await script.step(
    jordan,
    id,
    message("The structure works for us. I have one change to how we handle information."),
  );
  const revisionTwo = withSection(MUTUAL_NDA, "obligations", NDA_OBLIGATIONS_ACCEPTED);
  await script.step(
    jordan,
    id,
    propose(
      "Allow sharing with advisers, and add a duty to warn before legally required disclosure.",
      revisionTwo,
    ),
  );
  await script.step(avery, id, accept);
  await publishDraft(script, avery, id);
  await script.step(
    jordan,
    id,
    propose(
      "Two years is short for the product roadmap we will share. Can we make it five?",
      withSection(revisionTwo, "term", NDA_TERM_RECIPIENT_ASK),
    ),
  );
  await script.step(
    avery,
    id,
    counter(
      "Five is long for us. Three years, with trade secrets protected for as long as they stay secret.",
      withSection(revisionTwo, "term", NDA_TERM_STAFF_COUNTER),
    ),
  );
  await script.step(
    jordan,
    id,
    counter(
      "Three works if the term also runs until the relationship ends, whichever is later.",
      withSection(revisionTwo, "term", NDA_TERM_RECIPIENT_COUNTER),
    ),
  );
}

async function photographyLicense(
  script: Script,
  avery: StaffActor,
  sam: StaffActor,
): Promise<void> {
  const id = await startDraft(script, avery, PHOTOGRAPHY_LICENSE, [recipient(MORGAN, true)]);
  await publishDraft(script, avery, id);
  await script.step(
    sam,
    id,
    propose(
      "We would like to limit the license to your website and print marketing, and leave out paid social advertising. Does that work for you?",
      withSection(PHOTOGRAPHY_LICENSE, "grant", PHOTOGRAPHY_GRANT_WITHOUT_ADS),
    ),
  );
}

/** In review with nothing proposed, so the thread offers "Propose a change". */
async function logoBrief(script: Script, avery: StaffActor): Promise<void> {
  const id = await startDraft(script, avery, LOGO_BRIEF, [
    recipient(JORDAN, true),
    recipient(TAYLOR, false),
  ]);
  await publishDraft(script, avery, id);
  await script.step(
    avery,
    id,
    message("Here is the brief. Tell us what you would like to change."),
  );
  await script.step(
    await script.recipient(JORDAN),
    id,
    message("Looks close. I will read it through with the team this week."),
  );
}

async function q4Retainer(script: Script, avery: StaffActor): Promise<void> {
  const id = await startDraft(script, avery, Q4_RETAINER, [
    recipient(JORDAN, true),
    recipient(MORGAN, true),
    recipient(TAYLOR, false),
  ]);
  await startSigning(script, avery, id);
  await script.step(await script.recipient(JORDAN), id, signAs(JORDAN.name));
}

async function officeSublease(script: Script, avery: StaffActor): Promise<void> {
  const id = await startDraft(script, avery, OFFICE_SUBLEASE, [
    recipient(JORDAN, true),
    recipient(MORGAN, true),
  ]);
  await startSigning(script, avery, id);
  await script.step(await script.recipient(JORDAN), id, signAs(JORDAN.name));
  await script.step(await script.recipient(MORGAN), id, signAs(MORGAN.name));
  // The last signature queues the archive job; the real worker path produces both artifacts.
  await script.settle();
}

async function equipmentLease(script: Script, avery: StaffActor): Promise<void> {
  const id = await startDraft(script, avery, EQUIPMENT_LEASE, [
    recipient(JORDAN, true),
    recipient(TAYLOR, true),
  ]);
  await startSigning(script, avery, id);
  await script.step(await script.recipient(JORDAN), id, signAs(JORDAN.name));
  await script.step(avery, id, (view) => ({
    kind: "void",
    expectedVersion: view.agreement.version,
    reason: "The equipment is no longer available for this period.",
  }));
}

async function speakingEngagement(script: Script, priya: StaffActor): Promise<void> {
  const id = await startDraft(script, priya, SPEAKING_ENGAGEMENT, [recipient(SAM, true)]);
  await startSigning(script, priya, id);
}

/** Loads the demo into an empty database. Returns false when a tenant already exists. */
export async function runSeed(): Promise<boolean> {
  const tenants = await insertTenantsAndStaff();
  if (tenants === null) return false;
  const script = createScript();
  try {
    const northwind = tenants.get(NORTHWIND);
    const harbor = tenants.get(HARBOR);
    if (northwind === undefined || harbor === undefined)
      throw new Error("Tenants were not created.");
    const avery = await script.staff(northwind, AVERY, "admin");
    const sam = await script.staff(northwind, SAM, "member");
    const priya = await script.staff(harbor, PRIYA, "admin");
    await startDraft(script, avery, WEBSITE_REDESIGN, [recipient(JORDAN, true)]);
    await mutualNda(script, avery);
    await photographyLicense(script, avery, sam);
    await logoBrief(script, avery);
    await q4Retainer(script, avery);
    await officeSublease(script, avery);
    await equipmentLease(script, avery);
    await speakingEngagement(script, priya);
    await script.settle();
  } finally {
    await script.endSessions();
  }
  return true;
}
