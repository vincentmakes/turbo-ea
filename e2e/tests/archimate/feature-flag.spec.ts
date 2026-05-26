import { test, expect } from "@playwright/test";
import { loginAsAdmin, enableArchiMate, disableArchiMate } from "../../helpers/auth";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8920";

test.describe("ArchiMate feature flag", () => {
  test("ArchiMate nav item is hidden when disabled", async ({ context, page }) => {
    const token = await loginAsAdmin(context, BASE_URL);
    await disableArchiMate(context.request, BASE_URL, token);

    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState("networkidle");

    // Nav item should not be visible when disabled
    const navLink = page.getByRole("link", { name: /archimate/i });
    await expect(navLink).not.toBeVisible();
  });

  test("ArchiMate nav item is visible when enabled", async ({ context, page }) => {
    const token = await loginAsAdmin(context, BASE_URL);
    await enableArchiMate(context.request, BASE_URL, token);

    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState("networkidle");

    const navLink = page.getByRole("link", { name: /archimate/i });
    await expect(navLink).toBeVisible();

    // Cleanup
    await disableArchiMate(context.request, BASE_URL, token);
  });

  test("/archimate route shows ModuleGate message when disabled", async ({ context, page }) => {
    const token = await loginAsAdmin(context, BASE_URL);
    await disableArchiMate(context.request, BASE_URL, token);

    await page.goto(`${BASE_URL}/archimate`);
    await page.waitForLoadState("networkidle");

    // ModuleGate renders a "not enabled" message or redirects
    // The page should not show the ArchiMate diagrams gallery
    const newDiagramButton = page.getByRole("button", { name: /new.*diagram/i });
    await expect(newDiagramButton).not.toBeVisible();
  });

  test("ArchiMate settings tab appears in admin settings", async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);

    await page.goto(`${BASE_URL}/admin/settings?tab=archimate`);
    await page.waitForLoadState("networkidle");

    // Admin tab should always be accessible regardless of feature flag
    await expect(page.getByText(/archimate/i).first()).toBeVisible();
  });
});
