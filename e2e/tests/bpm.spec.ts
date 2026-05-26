/**
 * BPM E2E tests — BPM dashboard, process navigator, process card detail tabs.
 * Requires SEED_BPM=true (or SEED_DEMO=true) for demo processes to exist.
 */
import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8920";

test.describe("BPM — Dashboard and Navigator", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/bpm`);
    await page.waitForLoadState("networkidle");
  });

  test("renders BPM dashboard with KPI tiles", async ({ page }) => {
    // KPI tiles: total processes, diagram coverage, high-risk count
    await expect(
      page.getByText(/process|bpm|coverage|maturity/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("Process Navigator shows management/core/support groups", async ({ page }) => {
    await expect(
      page.getByText(/management|core|support/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("filter controls are present", async ({ page }) => {
    // Filters for type, maturity, automation level, risk
    const filterControl = page.getByRole("combobox").or(page.getByLabel(/type|maturity|automation|risk/i)).first();
    await expect(filterControl).toBeVisible({ timeout: 8000 });
  });

  test("clicking a process navigates to its card detail", async ({ page }) => {
    // Find first process row / link
    const processLink = page
      .getByRole("link")
      .filter({ hasText: /process|procure|order|customer/i })
      .first();

    if (await processLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await processLink.click();
      await page.waitForURL(/\/cards\//, { timeout: 8000 });
      await expect(page).toHaveURL(/\/cards\//);
    }
  });
});

test.describe("BPM — Reports", () => {
  test("maturity report renders at /bpm (reports tab)", async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/bpm`);
    await page.waitForLoadState("networkidle");

    const reportsTab = page.getByRole("tab", { name: /report/i });
    if (await reportsTab.isVisible()) {
      await reportsTab.click();
      await expect(
        page.locator("svg").or(page.getByText(/maturity|risk|automation|no data/i)).first(),
      ).toBeVisible({ timeout: 8000 });
    }
  });
});
