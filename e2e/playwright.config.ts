import { defineConfig, devices } from "@playwright/test";
import * as path from "path";

const authFile = path.join(__dirname, ".auth/admin.json");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 60000, // 60s per test for slow environments
  globalSetup: "./helpers/global-setup.ts", // Login once; cache auth state to .auth/admin.json
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8920",
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    navigationTimeout: 30000,
    storageState: authFile, // Restore auth cookies + storage from globalSetup
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  workers: process.env.CI ? 1 : 2, // 2 workers to prevent auth rate limiting
});
