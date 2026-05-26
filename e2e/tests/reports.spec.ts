/**
 * Reports E2E tests — Portfolio, Capability Map, Lifecycle, Dependencies,
 * Data Quality, Cost, Matrix, EOL, Saved Reports.
 */
import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8920";

test.describe("Reports — Portfolio", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/reports/portfolio`);
    await page.waitForLoadState("networkidle");
  });

  test("renders portfolio page with a chart area", async ({ page }) => {
    // Recharts SVG or a placeholder
    const chart = page
      .locator("svg")
      .or(page.getByText(/no data|portfolio/i))
      .first();
    await expect(chart).toBeVisible({ timeout: 10000 });
  });

  test("axis selector dropdowns are present", async ({ page }) => {
    const selects = page.getByRole("combobox");
    const count = await selects.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe("Reports — Capability Map", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/reports/capability-map`);
    await page.waitForLoadState("networkidle");
  });

  test("renders heatmap with capability cells", async ({ page }) => {
    // Either capability cards or an SVG heatmap
    const content = page
      .locator("svg, [class*='capability'], [class*='heatmap']")
      .or(page.getByText(/business capability|no capabilities/i))
      .first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Reports — Lifecycle", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/reports/lifecycle`);
    await page.waitForLoadState("networkidle");
  });

  test("renders lifecycle timeline", async ({ page }) => {
    const content = page
      .locator("svg")
      .or(page.getByText(/lifecycle|timeline|no data/i))
      .first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Reports — Dependencies", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/reports/dependencies`);
    await page.waitForLoadState("networkidle");
  });

  test("renders dependency network graph or layered view", async ({ page }) => {
    const content = page
      .locator("svg, [class*='react-flow'], canvas")
      .or(page.getByText(/dependency|relation|no data/i))
      .first();
    await expect(content).toBeVisible({ timeout: 15000 });
  });

  test("depth control or filter is present", async ({ page }) => {
    const depthControl = page
      .getByRole("combobox")
      .or(page.getByRole("slider"))
      .or(page.getByLabel(/depth/i))
      .first();
    await expect(depthControl).toBeVisible({ timeout: 8000 });
  });
});

test.describe("Reports — Cost", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/reports/cost`);
    await page.waitForLoadState("networkidle");
  });

  test("renders cost treemap or bar chart", async ({ page }) => {
    const chart = page
      .locator("svg")
      .or(page.getByText(/cost|no data/i))
      .first();
    await expect(chart).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Reports — Matrix", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/reports/matrix`);
    await page.waitForLoadState("networkidle");
  });

  test("renders matrix page with row/column type selectors", async ({ page }) => {
    const selects = page.getByRole("combobox");
    await expect(selects.first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe("Reports — Data Quality", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/reports/data-quality`);
    await page.waitForLoadState("networkidle");
  });

  test("renders data quality report with overall score", async ({ page }) => {
    // Should show a percentage or score
    const scoreEl = page
      .getByText(/%/)
      .or(page.getByText(/data quality|completeness|score/i))
      .first();
    await expect(scoreEl).toBeVisible({ timeout: 10000 });
  });

  test("shows breakdown by card type", async ({ page }) => {
    // Type names like Application, Business Capability etc. should appear
    const typeEntry = page
      .getByText(/application|business|it component/i)
      .first();
    await expect(typeEntry).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Reports — EOL", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/reports/eol`);
    await page.waitForLoadState("networkidle");
  });

  test("renders EOL report page", async ({ page }) => {
    const content = page
      .locator("svg")
      .or(page.getByText(/end.of.life|eol|support|no data/i))
      .first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Reports — Saved Reports gallery", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/reports/saved`);
    await page.waitForLoadState("networkidle");
  });

  test("renders saved reports page with tabs", async ({ page }) => {
    // Tabs: My Reports, Shared with Me, Public
    await expect(
      page.getByRole("tab", { name: /my reports/i })
        .or(page.getByText(/saved report|no saved report/i))
        .first(),
    ).toBeVisible({ timeout: 8000 });
  });
});
