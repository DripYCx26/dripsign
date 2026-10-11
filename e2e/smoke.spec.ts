import { expect, test, type Page } from "@playwright/test";

const WORKER_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 3 * WORKER_TIMEOUT_MS;
const POLL_INTERVAL_MS = 1_000;

async function signInAs(page: Page, name: string) {
  await page.goto("/dev/sign-in");
  await page.getByRole("button", { name: `Sign in as ${name}` }).click();
  await expect(page).not.toHaveURL(/\/dev\/sign-in/u);
}

/** Reloads until `ready` shows: the worker prepares and archives the PDFs in the background. */
async function reloadUntilVisible(page: Page, ready: () => Promise<boolean>) {
  await expect(async () => {
    await page.reload();
    expect(await ready()).toBe(true);
  }).toPass({ timeout: WORKER_TIMEOUT_MS, intervals: [POLL_INTERVAL_MS] });
}

test.setTimeout(TEST_TIMEOUT_MS);

test("a staff member publishes, a recipient signs, and the signed PDF downloads", async ({
  page,
}) => {
  await signInAs(page, "Avery Chen");

  await page.goto("/staff");
  await page.getByRole("link", { name: "New agreement" }).first().click();
  await page.getByLabel("Title").fill(`E2E services ${String(Date.now())}`);
  await page.getByRole("button", { name: "Services agreement" }).click();
  await page.getByLabel("Name").fill("Jordan Lee");
  await page.getByLabel("Email").fill("jordan@client.test");
  await expect(page.getByLabel("Required signer")).toBeChecked();
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/staff\/agreements\/[^/]+$/u);
  const agreementId = new URL(page.url()).pathname.split("/").at(-1) ?? "";

  const review = page.getByRole("link", { name: "Review and publish" });
  await reloadUntilVisible(page, () => review.isVisible());
  await review.click();
  await expect(page).toHaveURL(/\/publish$/u);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: WORKER_TIMEOUT_MS });
  await page.getByLabel("I reviewed the full PDF and its signature fields.").check();
  await page.getByRole("button", { name: "Publish and invite recipients" }).click();
  await expect(page).toHaveURL(new RegExp(`/staff/agreements/${agreementId}$`, "u"));

  await page.getByRole("button", { name: "Request signatures" }).click();
  await page
    .getByRole("dialog", { name: "Request signatures?" })
    .getByRole("button", { name: "Request signatures" })
    .click();
  await expect(page.getByText("0 of 1 signed")).toBeVisible();

  await signInAs(page, "Jordan Lee");
  await page.goto(`/agreements/${agreementId}`);
  await page.getByRole("link", { name: "Review and sign" }).click();
  await page.getByLabel(/I.ve reviewed this document\./u).check();
  await page.getByRole("button", { name: "Continue to sign" }).click();
  await page.getByLabel("I agree to sign electronically.").check();
  await page.getByLabel("Full name").fill("Jordan Lee");
  await page.getByRole("button", { name: "Sign agreement" }).click();
  await expect(page.getByText("Your signature is recorded.")).toBeVisible();

  await page.goto(`/agreements/${agreementId}`);
  const signedPdf = page.getByRole("link", { name: /signed PDF/i });
  await reloadUntilVisible(page, () => signedPdf.isVisible());
  const href = await signedPdf.getAttribute("href");
  expect(href).not.toBeNull();
  const response = await page.request.get(href ?? "");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  expect((await response.body()).subarray(0, 4).toString("latin1")).toBe("%PDF");
});
