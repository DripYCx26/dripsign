import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import axe from "axe-core";

declare global {
  interface Window {
    axe: typeof axe;
  }
}
import { z } from "zod";
import type {
  Agreement,
  DocumentDraft,
  DocumentAsset,
  DocumentSection,
  Revision,
  SigningRound,
  SignatureSummary,
  ArchivedArtifact,
} from "@dripsign/db/types";
type PortalAsset = Pick<DocumentAsset, "sha256" | "byteLength">;
type PortalWitness = {
  agreement: Pick<Agreement, "id" | "status" | "currentRevisionId">;
  draft: {
    preparationStatus: DocumentDraft["preparationStatus"];
    document: PortalAsset | null;
    source: {
      sections: ReadonlyArray<Pick<DocumentSection, "paragraphs">>;
    } | null;
  } | null;
  revisions: ReadonlyArray<{ id: Revision["id"]; document: PortalAsset }>;
  signingRound: Pick<
    SigningRound,
    "id" | "revisionId" | "documentSha256" | "status"
  > | null;
  signatures: ReadonlyArray<
    Pick<SignatureSummary, "roundId" | "typedName" | "signedAt">
  >;
  artifacts: ReadonlyArray<{
    kind: ArchivedArtifact["kind"];
    document: PortalAsset;
  }>;
};
import { mailboxValue } from "./mailbox";

const mail = resolve(
  process.env["DRIPSIGN_BROWSER_MAIL_DIRECTORY"] ??
    "../../infra/container/.local/mail",
);
const staffEmail = "staff@example.com";
const recipientEmail = "recipient@example.com";
const source =
  "The supplier provides weekly staffing reports.\n\nPayment is due within 30 days of each invoice.";
const replacement = source.replace("30 days", "45 days");
const asset = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  byteLength: z.number().int().positive(),
});
const witness: z.ZodType<PortalWitness> = z.object({
  agreement: z.object({
    id: z.uuid(),
    status: z.enum(["draft", "negotiating", "signing", "signed", "void"]),
    currentRevisionId: z.uuid().nullable(),
  }),
  draft: z
    .object({
      preparationStatus: z.enum(["empty", "preparing", "ready", "failed"]),
      document: asset.nullable(),
      source: z
        .object({
          sections: z.array(z.object({ paragraphs: z.array(z.string()) })),
        })
        .nullable(),
    })
    .nullable(),
  revisions: z.array(z.object({ id: z.uuid(), document: asset })),
  signingRound: z
    .object({
      id: z.uuid(),
      revisionId: z.uuid(),
      documentSha256: z.string(),
      status: z.enum(["active", "finalizing", "completed", "void"]),
    })
    .nullable(),
  signatures: z.array(
    z.object({
      roundId: z.uuid(),
      typedName: z.string(),
      signedAt: z.string(),
    }),
  ),
  artifacts: z.array(
    z.object({
      kind: z.enum(["signed_document", "audit_record"]),
      document: asset,
    }),
  ),
});

async function detail(page: Page, id: string) {
  const response = await page.request.get(`/api/agreements/${id}`);
  expect(response.status()).toBe(200);
  return witness.parse(await response.json());
}

async function signIn(page: Page, email: string) {
  await page.getByLabel("Email address", { exact: true }).fill(email);
  const since = Date.now();
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await page
    .getByLabel("Code", { exact: true })
    .fill(
      await mailboxValue(
        mail,
        email,
        since,
        (body) => /Your DripSign code is (\d{6})\./u.exec(body)?.[1],
      ),
    );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

async function create(
  page: Page,
  email: string,
  title: string,
): Promise<string> {
  await page.getByRole("link", { name: "New agreement", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Editable terms", { exact: true }).fill(source);
  await page.getByLabel("Name", { exact: true }).fill("Local Recipient");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByRole("button", { name: "Create private draft", exact: true })
    .click();
  await expect(page).toHaveURL(/\/staff\/agreements\/[a-f0-9-]{36}$/u);
  return z.uuid().parse(new URL(page.url()).pathname.split("/").at(-1));
}

async function preparePublish(page: Page, id: string) {
  await page.getByText("Working draft", { exact: true }).last().click();
  await page
    .getByRole("button", { name: "Save working draft", exact: true })
    .click();
  await expect
    .poll(
      async () => {
        await page
          .getByRole("button", { name: "Refresh status", exact: true })
          .click();
        return (await detail(page, id)).draft?.preparationStatus;
      },
      { timeout: 60_000 },
    )
    .toBe("ready");
  const before = await detail(page, id);
  const prepared = before.draft?.document;
  expect(Boolean(prepared)).toBe(true);
  const pdf = await page.request.get(`/api/agreements/${id}/pdf?kind=draft`);
  expect(pdf.status()).toBe(200);
  expect(
    createHash("sha256")
      .update(await pdf.body())
      .digest("hex"),
  ).toBe(prepared?.sha256);
  await page
    .getByLabel("I reviewed the full PDF and its signature fields.", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Publish revision", exact: true })
    .click();
  await expect
    .poll(async () => {
      const current = await detail(page, id);
      return (
        current.agreement.status === "negotiating" &&
        current.agreement.currentRevisionId !==
          before.agreement.currentRevisionId
      );
    })
    .toBe(true);
  const published = await detail(page, id);
  expect(
    published.revisions.find(
      (row) => row.id === published.agreement.currentRevisionId,
    )?.document.sha256,
  ).toBe(prepared?.sha256);
}

async function desktopProof(page: Page, info: TestInfo, stage: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.evaluate(axe.source);
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
      },
    });
    return result.violations.map((item) => ({
      id: item.id,
      count: item.nodes.length,
    }));
  });
  // IDs and counts only: axe node excerpts may hold email or document text.
  expect(violations).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({
    path: info.outputPath(`${stage}.png`),
    fullPage: true,
  });
}

async function download(
  page: Page,
  info: TestInfo,
  id: string,
  kind: "signed_document" | "audit_record",
) {
  const expected = (await detail(page, id)).artifacts.find(
    (row) => row.kind === kind,
  )?.document.sha256;
  expect(Boolean(expected)).toBe(true);
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name:
        kind === "signed_document"
          ? "Download signed PDF"
          : "Download audit record",
      exact: true,
    })
    .click();
  const actual = await event;
  expect(await actual.failure()).toBeNull();
  const path = info.outputPath(`${kind}-${randomUUID()}.pdf`);
  await actual.saveAs(path);
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected);
}

test("actual standalone staff and recipient signing journey", async ({
  browser,
  page,
}, info) => {
  await page.goto("/");
  await desktopProof(page, info, "public-entry");
  await page.getByRole("link", { name: "Staff sign-in", exact: true }).click();
  await signIn(page, staffEmail);
  await expect(
    page.getByRole("heading", { name: "Agreement inbox", exact: true }),
  ).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/staff$/u);
  const foreign = await create(
    page,
    "uninvited@example.com",
    `Unshared local fixture ${randomUUID()}`,
  );
  await page.goto("/staff");
  const id = await create(
    page,
    recipientEmail,
    `Local browser agreement ${randomUUID()}`,
  );
  const since = Date.now();
  await preparePublish(page, id);
  await desktopProof(page, info, "staff-published");
  const invitation = await mailboxValue(mail, recipientEmail, since, (body) => {
    return [...body.matchAll(/https:\/\/[^\s<>]+/gu)]
      .map((match) => match[0])
      .find((value) => {
        try {
          const url = new URL(value);
          return (
            url.origin === new URL(page.url()).origin &&
            url.pathname === `/agreements/${id}`
          );
        } catch {
          return false;
        }
      });
  });
  const recipientContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    ignoreHTTPSErrors: true,
    viewport: page.viewportSize() ?? { width: 1920, height: 1080 },
    colorScheme: info.project.name.includes("dark") ? "dark" : "light",
  });
  const recipient = await recipientContext.newPage();
  try {
    await recipient.goto(invitation);
    await signIn(recipient, recipientEmail);
    await expect(
      recipient.getByRole("button", { name: "Propose a change", exact: true }),
    ).toBeVisible();
    expect(
      (
        await recipient.request.get(`/api/agreements/${id}/pdf?kind=draft`)
      ).status(),
    ).toBe(404);
    expect(
      (await recipient.request.get(`/api/agreements/${foreign}`)).status(),
    ).toBe(404);
    const denied = await recipient.request.post("/api/agreements", {
      headers: { Origin: new URL(recipient.url()).origin },
      data: {
        idempotencyKey: randomUUID(),
        title: "Forbidden fixture",
        source: null,
        recipients: [
          {
            email: recipientEmail,
            name: "Local Recipient",
            requiredSigner: true,
          },
        ],
      },
    });
    expect(denied.status()).toBe(401);
    await recipient
      .getByRole("button", { name: "Propose a change", exact: true })
      .click();
    await recipient
      .getByLabel("What would you like to change?", { exact: true })
      .fill("Please make payment due within 45 days.");
    await recipient.getByText("Edit proposed wording", { exact: true }).click();
    await recipient.getByLabel("Wording", { exact: true }).fill(replacement);
    await recipient
      .getByRole("button", { name: "Send proposal", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Refresh status", exact: true })
      .click();
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await detail(page, id)).draft?.source?.sections[0]?.paragraphs.join(
            "\n\n",
          ) === replacement,
      )
      .toBe(true);
    await preparePublish(page, id);
    await page
      .getByRole("button", {
        name: "Request signatures on the published version",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => {
        await recipient
          .getByRole("button", { name: "Refresh status", exact: true })
          .click();
        return (await detail(recipient, id)).signingRound?.status;
      })
      .toBe("active");
    const round = (await detail(recipient, id)).signingRound;
    expect(
      Boolean(
        round &&
        round.revisionId ===
          (await detail(recipient, id)).agreement.currentRevisionId,
      ),
    ).toBe(true);
    await recipient
      .getByLabel("Full name", { exact: true })
      .fill("Local Recipient");
    await recipient.locator(".ds-signature-form input[type=checkbox]").check();
    await desktopProof(recipient, info, "recipient-signing");
    const receiptResponse = recipient.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/agreements/${id}/sign`,
    );
    await recipient.getByRole("button", { name: /^Sign version /u }).click();
    const recorded = await receiptResponse;
    expect(recorded.status()).toBe(200);
    const receipt = z
      .object({
        roundId: z.uuid(),
        revisionId: z.uuid(),
        documentSha256: z.string(),
        signedAt: z.string(),
      })
      .parse(await recorded.json());
    expect(receipt.roundId).toBe(round?.id);
    expect(receipt.revisionId).toBe(round?.revisionId);
    expect(receipt.documentSha256).toBe(round?.documentSha256);
    expect(Number.isFinite(Date.parse(receipt.signedAt))).toBe(true);
    await expect
      .poll(
        async () => {
          await recipient
            .getByRole("button", { name: "Refresh status", exact: true })
            .click();
          return (await detail(recipient, id)).agreement.status;
        },
        { timeout: 60_000 },
      )
      .toBe("signed");
    const signed = await detail(recipient, id);
    expect(
      signed.signatures.some(
        (row) =>
          row.roundId === round?.id &&
          row.typedName === "Local Recipient" &&
          Number.isFinite(Date.parse(row.signedAt)),
      ),
    ).toBe(true);
    expect(signed.signingRound?.status).toBe("completed");
    await desktopProof(recipient, info, "recipient-completed");
    await page
      .getByRole("button", { name: "Refresh status", exact: true })
      .click();
    for (const actor of [page, recipient]) {
      await download(actor, info, id, "signed_document");
      await download(actor, info, id, "audit_record");
      await actor
        .getByRole("button", { name: "Sign out", exact: true })
        .click();
      expect((await actor.request.get(`/api/agreements/${id}`)).status()).toBe(
        401,
      );
    }
  } finally {
    await recipientContext.close();
  }
});
