/**
 * Authentication E2E tests — login, logout, redirect behaviour.
 * These run against a live app (E2E_BASE_URL) seeded with SEED_DEMO=true.
 */
import { test, expect } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../helpers/auth";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8920";

test.describe("Login page", () => {
  test("shows login form when unauthenticated", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: /sign in|log in|turbo/i }).first()).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in|log in|login/i })).toBeVisible();
  });

  test("redirects protected routes to login when unauthenticated", async ({ page }) => {
    await page.goto(`${BASE_URL}/inventory`);
    await page.waitForLoadState("networkidle");

    // Should end up on login page (either by redirect or by rendering login form)
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test("shows validation error for empty submission", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /sign in|log in|login/i }).click();

    // Browser native validation or custom error message
    const emailInput = page.getByLabel(/email/i);
    const isInvalid =
      (await emailInput.getAttribute("aria-invalid")) === "true" ||
      (await emailInput.evaluate((el) => !(el as HTMLInputElement).validity.valid));
    expect(isInvalid).toBe(true);
  });

  test("shows error for wrong credentials", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState("networkidle");

    await page.getByLabel(/email/i).fill("wrong@example.com");
    await page.getByLabel(/password/i).fill("wrongpassword");
    await page.getByRole("button", { name: /sign in|log in|login/i }).click();

    await expect(page.getByText(/invalid|incorrect|wrong|not found|failed/i)).toBeVisible({
      timeout: 5000,
    });
  });

  test("logs in successfully with valid credentials", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState("networkidle");

    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in|log in|login/i }).click();

    // Should navigate away from login and show the dashboard
    await page.waitForURL((url) => !url.toString().includes("login"), { timeout: 10000 });
    await page.waitForLoadState("networkidle");

    // Dashboard should be visible — logo, nav or main content
    await expect(page).not.toHaveURL(/login/);
  });
});

test.describe("Authenticated session", () => {
  test.beforeEach(async ({ context, page }) => {
    // Inject token directly without going through login UI
    const resp = await context.request.post(`${BASE_URL}/api/v1/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const { access_token } = await resp.json();
    await context.addInitScript(({ token }) => {
      sessionStorage.setItem("token", token);
    }, { token: access_token });
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState("networkidle");
  });

  test("shows user menu / profile after login", async ({ page }) => {
    // There should be an avatar or profile button in the nav
    const profileTrigger = page
      .getByRole("button", { name: /account|profile|user|admin/i })
      .or(page.locator("[aria-label*='account'], [aria-label*='profile'], [aria-label*='user']"))
      .first();
    await expect(profileTrigger).toBeVisible();
  });

  test("logs out and returns to login page", async ({ page }) => {
    // Find and click the profile/account button
    const profileTrigger = page
      .getByRole("button", { name: /account|profile|user|admin/i })
      .or(page.locator("[aria-label*='account'], [aria-label*='profile']"))
      .first();
    await profileTrigger.click();

    // Click logout/sign out
    await page.getByRole("menuitem", { name: /log out|sign out|logout/i }).click();

    // Should be back on login
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 8000 });
  });

  test("session is cleared on logout (sessionStorage token removed)", async ({ page }) => {
    const profileTrigger = page
      .getByRole("button", { name: /account|profile|user|admin/i })
      .or(page.locator("[aria-label*='account'], [aria-label*='profile']"))
      .first();
    await profileTrigger.click();
    await page.getByRole("menuitem", { name: /log out|sign out|logout/i }).click();
    await page.waitForLoadState("networkidle");

    const token = await page.evaluate(() => sessionStorage.getItem("token"));
    expect(token).toBeNull();
  });
});
