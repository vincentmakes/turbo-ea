/**
 * Playwright global setup — runs once before all tests.
 * Logs in as admin via browser and saves auth state to .auth/admin.json
 * so individual tests can restore it via storageState (more reliable than addInitScript).
 */
import { chromium } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8920";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@turboea.demo";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "TurboEA!2025";
const AUTH_DIR = path.join(__dirname, "../.auth");
const AUTH_STATE_FILE = path.join(AUTH_DIR, "admin.json");

export default async function globalSetup() {
  // Create .auth directory if it doesn't exist
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  try {
    // Navigate to login page
    await page.goto(`${BASE_URL}/`, { waitUntil: "load" });

    // Fill in login form
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in|log in|login/i }).click();

    // Wait for navigation away from login
    await page.waitForURL((url) => !url.toString().includes("login"), { timeout: 15000 });
    await page.waitForLoadState("load");

    // Save the auth state (sessionStorage, cookies, etc.)
    const storageState = await context.storageState();
    fs.writeFileSync(AUTH_STATE_FILE, JSON.stringify(storageState, null, 2));
    console.log(`[global-setup] Auth state saved to .auth/admin.json`);
  } finally {
    await context.close();
    await browser.close();
  }
}
