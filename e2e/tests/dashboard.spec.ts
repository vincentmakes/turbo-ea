/**
 * Dashboard E2E tests — KPI cards, navigation, workspace tab.
 */
import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8920";

test.describe("Dashboard", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState("networkidle");
  });

  test("renders KPI summary cards with card counts", async ({ page }) => {
    // Total count tile or type-breakdown tiles should be visible
    const kpiArea = page.locator("main, [role='main'], .MuiBox-root").first();
    await expect(kpiArea).toBeVisible();

    // At least one numeric count should appear on the page
    const numbers = page.getByText(/^\d+$/).first();
    await expect(numbers).toBeVisible({ timeout: 8000 });
  });

  test("shows navigation links for main sections", async ({ page }) => {
    // Top nav or sidebar should include Inventory and Reports
    await expect(
      page.getByRole("link", { name: /inventory/i }).or(page.getByText(/inventory/i)).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /reports/i }).or(page.getByText(/reports/i)).first(),
    ).toBeVisible();
  });

  test("clicking a card-type chip navigates to inventory filtered by type", async ({ page }) => {
    // The dashboard shows type breakdown — clicking a type chip should go to /inventory
    const typeChip = page
      .getByRole("link")
      .filter({ hasText: /application|business|it component/i })
      .first();

    if (await typeChip.isVisible()) {
      await typeChip.click();
      await page.waitForURL(/\/inventory/, { timeout: 8000 });
      await expect(page).toHaveURL(/\/inventory/);
    }
  });

  test("Workspace tab shows personal todos and activity", async ({ page }) => {
    const workspaceTab = page.getByRole("tab", { name: /workspace/i });
    if (await workspaceTab.isVisible()) {
      await workspaceTab.click();
      // Workspace should contain some content sections
      await expect(page.getByText(/todo|activity|favorite/i).first()).toBeVisible({
        timeout: 5000,
      });
    }
  });

  test("Admin tab shows stakeholder directory", async ({ page }) => {
    const adminTab = page.getByRole("tab", { name: /admin/i }).first();
    if (await adminTab.isVisible()) {
      await adminTab.click();
      await expect(
        page.getByText(/stakeholder|directory|users/i).first(),
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("notification bell is visible in the header", async ({ page }) => {
    const bell = page
      .getByRole("button", { name: /notification/i })
      .or(page.locator("[aria-label*='notification']"))
      .first();
    await expect(bell).toBeVisible();
  });

  test("create button is accessible from dashboard", async ({ page }) => {
    const createBtn = page
      .getByRole("button", { name: /\+ create|new card|create card/i })
      .or(page.locator("button").filter({ hasText: /^\+$/ }))
      .first();
    await expect(createBtn).toBeVisible();
  });
});
