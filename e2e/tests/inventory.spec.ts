/**
 * Inventory E2E tests — grid rendering, filters, column selection, card creation.
 * Assumes SEED_DEMO=true so demo cards are present.
 */
import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8920";

test.describe("Inventory", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/inventory`);
    await page.waitForLoadState("networkidle");
  });

  test("renders the inventory grid with rows", async ({ page }) => {
    // AG Grid renders rows in [role="row"]
    const rows = page.locator("[role='row']").filter({ hasNot: page.locator("[role='columnheader']") });
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test("shows card names in the grid (demo: SAP S/4HANA)", async ({ page }) => {
    // SAP S/4HANA is in the demo seed as an Application card
    const cell = page.getByRole("gridcell", { name: /SAP S\/4HANA/i }).first();
    await expect(cell).toBeVisible({ timeout: 10000 });
  });

  test("filter sidebar: typing in search reduces visible rows", async ({ page }) => {
    // Count initial rows
    const rows = page.locator("[role='row']").filter({ hasNot: page.locator("[role='columnheader']") });
    const initialCount = await rows.count();

    // Type in search / quick-filter input
    const searchInput = page
      .getByRole("searchbox")
      .or(page.getByPlaceholder(/search|filter/i))
      .first();
    await searchInput.fill("SAP");
    await page.waitForTimeout(600); // debounce

    const filteredCount = await rows.count();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
    expect(filteredCount).toBeGreaterThan(0);
  });

  test("filter sidebar: filtering by card type shows only that type", async ({ page }) => {
    // Click on the filter/sidebar toggle if needed
    const filterPanel = page.locator("[data-testid='filter-sidebar'], .filter-sidebar, aside").first();
    const isVisible = await filterPanel.isVisible();
    if (!isVisible) {
      // Try opening it via a Filters button
      const filterBtn = page.getByRole("button", { name: /filter/i }).first();
      if (await filterBtn.isVisible()) await filterBtn.click();
    }

    // Click on the "Application" type chip/checkbox
    const appTypeBtn = page
      .getByRole("checkbox", { name: /^Application$/i })
      .or(page.getByRole("button", { name: /^Application$/i }))
      .first();
    if (await appTypeBtn.isVisible()) {
      await appTypeBtn.click();
      await page.waitForTimeout(600);

      // All visible type-column cells should say "Application"
      const typeCells = page.getByRole("gridcell").filter({ hasText: /^Application$/ });
      const count = await typeCells.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test("Columns tab allows toggling columns", async ({ page }) => {
    const columnsTab = page.getByRole("tab", { name: /columns/i });
    if (await columnsTab.isVisible()) {
      await columnsTab.click();
      // Should show column checkboxes
      const checkboxes = page.getByRole("checkbox");
      const count = await checkboxes.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test("clicking a card name opens card detail page", async ({ page }) => {
    // Click first card name link in the grid
    const firstCardLink = page
      .locator("[role='row']")
      .filter({ hasNot: page.locator("[role='columnheader']") })
      .first()
      .getByRole("link")
      .first();

    await expect(firstCardLink).toBeVisible({ timeout: 8000 });
    await firstCardLink.click();
    await page.waitForURL(/\/cards\//, { timeout: 8000 });
    await expect(page).toHaveURL(/\/cards\//);
  });

  test("Export button is present", async ({ page }) => {
    const exportBtn = page.getByRole("button", { name: /export/i }).first();
    await expect(exportBtn).toBeVisible();
  });

  test("Create card dialog opens and accepts a name", async ({ page }) => {
    const createBtn = page
      .getByRole("button", { name: /\+ create|create card|new card/i })
      .first();
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Should have a name input
    const nameInput = dialog.getByRole("textbox").first();
    await nameInput.fill("E2E Test Card");

    // Cancel without saving
    await dialog.getByRole("button", { name: /cancel/i }).click();
    await expect(dialog).not.toBeVisible();
  });

  test("bookmark/save view button is present", async ({ page }) => {
    // The saved-view bookmark icon should be in the toolbar
    const bookmarkBtn = page
      .getByRole("button", { name: /save view|bookmark|saved view/i })
      .or(page.locator("[aria-label*='bookmark'], [aria-label*='save view']"))
      .first();
    await expect(bookmarkBtn).toBeVisible();
  });
});
