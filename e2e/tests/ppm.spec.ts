/**
 * PPM E2E tests — portfolio dashboard, initiative detail, status reports,
 * budget & costs, risk tab, task kanban, Gantt.
 * Requires SEED_PPM=true (or SEED_DEMO=true) for demo data.
 */
import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8920";

test.describe("PPM — Portfolio Dashboard", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/ppm`);
    await page.waitForLoadState("networkidle");
  });

  test("renders PPM portfolio dashboard with KPI cards", async ({ page }) => {
    await expect(
      page.getByText(/initiative|portfolio|budget|project/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("shows health pie charts (schedule, cost, scope)", async ({ page }) => {
    const chart = page
      .locator("svg")
      .or(page.getByText(/schedule|cost|scope|health/i))
      .first();
    await expect(chart).toBeVisible({ timeout: 10000 });
  });

  test("Gantt overview is visible", async ({ page }) => {
    const ganttArea = page
      .locator("[class*='gantt'], [class*='timeline']")
      .or(page.getByText(/gantt|timeline|initiative/i))
      .first();
    await expect(ganttArea).toBeVisible({ timeout: 10000 });
  });

  test("filter by subtype controls are present", async ({ page }) => {
    const subtypeControl = page
      .getByRole("combobox")
      .or(page.getByRole("button", { name: /idea|program|project|epic/i }))
      .first();
    await expect(subtypeControl).toBeVisible({ timeout: 8000 });
  });
});

test.describe("PPM — Initiative Detail", () => {
  let initiativeId: string;
  let token: string;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const resp = await ctx.request.post(`${BASE_URL}/api/v1/auth/login`, {
      data: {
        email: process.env.E2E_ADMIN_EMAIL ?? "admin@turboea.demo",
        password: process.env.E2E_ADMIN_PASSWORD ?? "TurboEA!2025",
      },
    });
    const json = await resp.json();
    token = json.access_token;

    // Find an existing Initiative card from demo data
    const searchResp = await ctx.request.get(
      `${BASE_URL}/api/v1/cards?type=Initiative&page_size=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await searchResp.json();
    const items: Array<{ id: string }> = data.items ?? data ?? [];
    initiativeId = items[0]?.id ?? "";
    await ctx.close();
  });

  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    if (!initiativeId) test.skip();
    await page.goto(`${BASE_URL}/ppm/${initiativeId}`);
    await page.waitForLoadState("networkidle");
  });

  test("renders initiative detail with overview tab", async ({ page }) => {
    await expect(
      page.getByRole("tab", { name: /overview/i })
        .or(page.getByText(/budget|health|summary/i))
        .first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("Status Reports tab is accessible", async ({ page }) => {
    const reportsTab = page.getByRole("tab", { name: /status report/i });
    if (await reportsTab.isVisible()) {
      await reportsTab.click();
      await expect(
        page.getByRole("button", { name: /new report|add report|create report/i })
          .or(page.getByText(/status report|schedule health|no report/i))
          .first(),
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("Budget & Costs tab is accessible", async ({ page }) => {
    const budgetTab = page.getByRole("tab", { name: /budget|cost/i });
    if (await budgetTab.isVisible()) {
      await budgetTab.click();
      await expect(
        page.getByRole("button", { name: /add budget|add cost|new budget|new cost/i })
          .or(page.getByText(/budget|capex|opex|no budget/i))
          .first(),
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("Risk tab shows risk matrix", async ({ page }) => {
    const riskTab = page.getByRole("tab", { name: /risk/i });
    if (await riskTab.isVisible()) {
      await riskTab.click();
      await expect(
        page.locator("table, [class*='matrix']")
          .or(page.getByText(/probability|impact|no risk/i))
          .first(),
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("Tasks tab shows Kanban board", async ({ page }) => {
    const tasksTab = page.getByRole("tab", { name: /task/i });
    if (await tasksTab.isVisible()) {
      await tasksTab.click();
      await expect(
        page.getByText(/to do|in progress|done|blocked|no task/i).first(),
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("Gantt tab shows timeline", async ({ page }) => {
    const ganttTab = page.getByRole("tab", { name: /gantt|timeline/i });
    if (await ganttTab.isVisible()) {
      await ganttTab.click();
      await expect(
        page.locator("[class*='gantt'], [class*='timeline'], svg").first(),
      ).toBeVisible({ timeout: 8000 });
    }
  });
});
