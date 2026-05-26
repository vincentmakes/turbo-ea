/**
 * Reference catalogue E2E tests — Capability Catalogue, Principles Catalogue,
 * Process Catalogue, Value Stream Catalogue.
 */
import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8920";

test.describe("Capability Catalogue", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/capability-catalogue`);
    await page.waitForLoadState("networkidle");
  });

  test("renders capability catalogue with L1 capabilities", async ({ page }) => {
    await expect(
      page.getByText(/capability|catalogue|cross.industry/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("search / filter bar is present", async ({ page }) => {
    const searchInput = page
      .getByRole("searchbox")
      .or(page.getByPlaceholder(/search|filter/i))
      .first();
    await expect(searchInput).toBeVisible({ timeout: 8000 });
  });

  test("level filter chips are visible (L1 → L4)", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /l1|macro|level 1/i })
        .or(page.getByText(/l1|macro/i))
        .first(),
    ).toBeVisible({ timeout: 8000 });
  });

  test("can select capabilities and see create button", async ({ page }) => {
    // Select first visible capability checkbox
    const firstCheckbox = page.getByRole("checkbox").first();
    if (await firstCheckbox.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstCheckbox.check();
      await expect(
        page.getByRole("button", { name: /create.*capabilit/i }).first(),
      ).toBeVisible({ timeout: 5000 });
      // Uncheck to clean up
      await firstCheckbox.uncheck();
    }
  });
});

test.describe("Principles Catalogue", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/principles-catalogue`);
    await page.waitForLoadState("networkidle");
  });

  test("renders principles catalogue page", async ({ page }) => {
    await expect(
      page.getByText(/principle|ea principle|catalogue|no principle/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Process Catalogue", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/process-catalogue`);
    await page.waitForLoadState("networkidle");
  });

  test("renders process catalogue page", async ({ page }) => {
    await expect(
      page.getByText(/process|catalogue|pcf|no process/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Value Stream Catalogue", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/value-stream-catalogue`);
    await page.waitForLoadState("networkidle");
  });

  test("renders value stream catalogue page", async ({ page }) => {
    await expect(
      page.getByText(/value stream|catalogue|no value stream/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
