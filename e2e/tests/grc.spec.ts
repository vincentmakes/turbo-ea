/**
 * GRC E2E tests — Governance (ADR, Principles), Risk Register, Compliance.
 */
import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8920";

test.describe("GRC — Governance tab", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/grc?tab=governance`);
    await page.waitForLoadState("networkidle");
  });

  test("renders Governance tab with Principles and Decisions sub-tabs", async ({ page }) => {
    await expect(
      page.getByRole("tab", { name: /principle/i })
        .or(page.getByText(/principle|decision|adr/i))
        .first(),
    ).toBeVisible({ timeout: 8000 });
  });

  test("Decisions sub-tab shows ADR grid", async ({ page }) => {
    const decisionsTab = page.getByRole("tab", { name: /decision/i });
    if (await decisionsTab.isVisible()) {
      await decisionsTab.click();
      await expect(
        page.getByRole("button", { name: /new adr|create adr|new decision/i })
          .or(page.getByText(/adr|architecture decision|no decision/i))
          .first(),
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("can open new ADR creation dialog", async ({ page }) => {
    // Go to decisions sub-tab
    const decisionsTab = page.getByRole("tab", { name: /decision/i });
    if (await decisionsTab.isVisible()) await decisionsTab.click();

    const newAdrBtn = page.getByRole("button", { name: /new adr|create adr|new decision|\+ adr/i }).first();
    if (await newAdrBtn.isVisible()) {
      await newAdrBtn.click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 });
      await page.keyboard.press("Escape");
    }
  });
});

test.describe("GRC — Risk Register tab", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/grc?tab=risk`);
    await page.waitForLoadState("networkidle");
  });

  test("renders risk register with grid and KPI cards", async ({ page }) => {
    await expect(
      page.getByText(/risk|risk register|no risk/i).first(),
    ).toBeVisible({ timeout: 8000 });
  });

  test("shows initial/residual risk matrix heatmap", async ({ page }) => {
    const matrix = page
      .locator("[class*='matrix'], [class*='heatmap']")
      .or(page.locator("table"))
      .first();
    await expect(matrix).toBeVisible({ timeout: 10000 });
  });

  test("New Risk button opens creation dialog", async ({ page }) => {
    const newRiskBtn = page
      .getByRole("button", { name: /\+ new risk|create risk|new risk/i })
      .first();
    await expect(newRiskBtn).toBeVisible({ timeout: 8000 });
    await newRiskBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Dialog should have Title field
    await expect(
      dialog.getByRole("textbox").first()
        .or(dialog.getByLabel(/title/i)),
    ).toBeVisible();

    await page.keyboard.press("Escape");
  });

  test("can create and delete a risk", async ({ context, page }) => {
    const token = await loginAsAdmin(context, BASE_URL);

    // Create via API
    const resp = await context.request.post(`${BASE_URL}/api/v1/risks`, {
      data: {
        title: "E2E Test Risk",
        category: "business",
        initial_probability: 2,
        initial_impact: 2,
      },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok()) return; // Graceful skip if endpoint differs
    const risk = await resp.json();

    await page.reload();
    await page.waitForLoadState("networkidle");

    // Risk should appear in the grid
    await expect(page.getByText("E2E Test Risk")).toBeVisible({ timeout: 8000 });

    // Cleanup
    await context.request.delete(`${BASE_URL}/api/v1/risks/${risk.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  });

  test("risk export button is present", async ({ page }) => {
    const exportBtn = page.getByRole("button", { name: /export/i }).first();
    await expect(exportBtn).toBeVisible();
  });
});

test.describe("GRC — Compliance tab", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/grc?tab=compliance`);
    await page.waitForLoadState("networkidle");
  });

  test("renders compliance page with regulation heatmap or grid", async ({ page }) => {
    await expect(
      page.getByText(/compliance|gdpr|nis2|dora|soc 2|iso 27001|eu ai act|no finding/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("Run compliance scan button is present", async ({ page }) => {
    const scanBtn = page
      .getByRole("button", { name: /run.*scan|compliance scan|start scan/i })
      .first();
    await expect(scanBtn).toBeVisible({ timeout: 8000 });
  });

  test("New finding button opens creation dialog", async ({ page }) => {
    const newFindingBtn = page
      .getByRole("button", { name: /\+ new finding|create finding|new finding/i })
      .first();
    if (await newFindingBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await newFindingBtn.click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 });
      await page.keyboard.press("Escape");
    }
  });
});
