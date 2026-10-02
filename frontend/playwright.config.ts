/**
 * The browser smoke suite (`e2e/`): the widgets jsdom cannot host — the DrawIO
 * diagram editor, the BPMN modeler, the PPM Gantt, the Layered Dependency View
 * and the metamodel graph — driven in a real Chromium against a backend seeded
 * with the demo data.
 *
 * Targets `vite preview` on :4173 (started here unless `E2E_BASE_URL` points
 * at a running stack, e.g. a Docker one on :8920); the preview proxies `/api`
 * to a backend on :8000 that the job or the Makefile starts — never Playwright.
 * `E2E_CHROMIUM_PATH` runs a Chromium already on the machine instead of the
 * one `playwright install` would fetch.
 *
 * One worker, serial, no retries: the specs share one demo instance and a
 * flaky spec is fixed, not retried into green.
 */
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:4173";
const executablePath = process.env.E2E_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
      use: { storageState: "e2e/.auth/admin.json" },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npx vite preview --port 4173 --strictPort",
        url: "http://localhost:4173",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
