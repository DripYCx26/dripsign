import { expect, test, type Locator, type Page } from "@playwright/test";

const WORKER_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 3 * WORKER_TIMEOUT_MS;
const POLL_INTERVAL_MS = 1_000;
const RENDER_TIMEOUT_MS = 5_000;

async function signInAs(page: Page, name: string) {
  await page.goto("/dev/sign-in");
  await page.getByRole("button", { name: `Sign in as ${name}` }).click();
  await expect(page).not.toHaveURL(/\/dev\/sign-in/u);
}

/** Reloads until `ready` shows: the worker prepares and archives the PDFs in the background. */
async function reloadUntilVisible(page: Page, target: Locator) {
  await expect(async () => {
    await page.reload();
    // Wait for the streamed page, not just the loading fallback, before judging.
    await expect(target).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
  }).toPass({ timeout: WORKER_TIMEOUT_MS, intervals: [POLL_INTERVAL_MS] });
}

test.setTimeout(TEST_TIMEOUT_MS);

test("a staff member publishes, a recipient signs, and the signed PDF downloads", async ({
  page,
}) => {
  await signInAs(page, "Avery Chen");

  await page.goto("/staff");
  await page.getByRole("button", { name: "New agreement" }).first().click();
  await expect(page).toHaveURL(/\/staff\/agreements\/[^/]+$/u);
  // The starter is the AI-off path: choosing it sends no prompt, so the smoke never spends.
  await page.getByRole("button", { name: "Services agreement" }).click();
  // Unsaved edits survive a declined client-side exit.
  await page.getByRole("button", { name: "Edit draft" }).click();
  await page.getByLabel("Title").fill("Unsaved title");
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("link", { name: "Back to agreements" }).click();
  await expect(page.getByLabel("Title")).toHaveValue("Unsaved title");
  let askedOnBack = false;
  page.once("dialog", (dialog) => {
    askedOnBack = true;
    void dialog.dismiss();
  });
  await page.goBack();
  await expect.poll(() => askedOnBack).toBe(true);
  await expect(page.getByLabel("Title")).toHaveValue("Unsaved title");
  await page.getByRole("button", { name: "Discard" }).click();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Recipients" }).click();
  const recipients = page.getByRole("dialog", { name: "Recipients" });
  await recipients.getByLabel("Name", { exact: true }).fill("Jordan Lee");
  await recipients.getByLabel("Email", { exact: true }).fill("jordan@client.test");
  await expect(recipients.getByLabel("Required signer")).toBeChecked();
  await recipients.getByRole("button", { name: "Add recipient" }).click();
  await expect(recipients.getByText("jordan@client.test")).toBeVisible();
  await page.keyboard.press("Escape");
  const agreementId = new URL(page.url()).pathname.split("/").at(-1) ?? "";

  const review = page.getByRole("link", { name: "Review and publish" });
  await reloadUntilVisible(page, review);
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
  await reloadUntilVisible(page, signedPdf);
  const href = await signedPdf.getAttribute("href");
  expect(href).not.toBeNull();
  const response = await page.request.get(href ?? "");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  expect((await response.body()).subarray(0, 4).toString("latin1")).toBe("%PDF");
});
