import { defineConfig, devices } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:3000";
const SERVER_START_TIMEOUT_MS = 180_000;

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: BASE_URL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: SERVER_START_TIMEOUT_MS,
  },
});
