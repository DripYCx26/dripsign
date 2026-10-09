import { defineConfig, devices } from "@playwright/test";

const origin = new URL(
  process.env["DRIPSIGN_BROWSER_URL"] ?? "https://localhost:8443",
);
if (
  origin.protocol !== "https:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
  origin.pathname !== "/"
) {
  throw new Error(
    "The browser journey accepts only the isolated local DripSign stack.",
  );
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: origin.origin,
    ignoreHTTPSErrors: true,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "desktop-light-1920",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
        colorScheme: "light",
      },
    },
    {
      name: "desktop-dark-1920",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
        colorScheme: "dark",
      },
    },
    {
      name: "desktop-light-1440",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        colorScheme: "light",
      },
    },
  ],
});
