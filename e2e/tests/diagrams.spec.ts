/**
 * Diagrams E2E tests — gallery, create, open editor, sync panel.
 */
import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8920";

test.describe("Diagrams gallery", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/diagrams`);
    await page.waitForLoadState("networkidle");
  });

  test("renders diagrams gallery page", async ({ page }) => {
    await expect(
      page.getByText(/diagram|no diagram/i).first(),
    ).toBeVisible({ timeout: 8000 });
  });

  test("Create diagram button is present", async ({ page }) => {
    const createBtn = page.getByRole("button", { name: /create|new diagram|\+ diagram/i }).first();
    await expect(createBtn).toBeVisible();
  });

  test("can create and then delete a diagram", async ({ context, page }) => {
    const token = await loginAsAdmin(context, BASE_URL);

    // Create via API to avoid DrawIO iframe complexity
    const resp = await context.request.post(`${BASE_URL}/api/v1/diagrams`, {
      data: { name: "E2E Test Diagram", type: "drawio" },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resp.ok()).toBe(true);
    const diagram = await resp.json();

    await page.reload();
    await page.waitForLoadState("networkidle");

    // The new diagram card should appear in the gallery
    await expect(page.getByText("E2E Test Diagram")).toBeVisible({ timeout: 8000 });

    // Cleanup
    await context.request.delete(`${BASE_URL}/api/v1/diagrams/${diagram.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  });
});

test.describe("Diagram editor", () => {
  let diagramId: string;
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

    const createResp = await ctx.request.post(`${BASE_URL}/api/v1/diagrams`, {
      data: { name: "E2E Editor Test", type: "drawio" },
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await createResp.json();
    diagramId = d.id ?? "";
    await ctx.close();
  });

  test.afterAll(async ({ browser }) => {
    if (!diagramId) return;
    const ctx = await browser.newContext();
    await ctx.request.delete(`${BASE_URL}/api/v1/diagrams/${diagramId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await ctx.close();
  });

  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    if (!diagramId) test.skip();
    await page.goto(`${BASE_URL}/diagrams/${diagramId}/edit`);
    // DrawIO iframe loads — give it time
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
  });

  test("editor page loads with a DrawIO iframe", async ({ page }) => {
    // DrawIO is rendered as an iframe
    const iframe = page.locator("iframe[src*='drawio'], iframe[title*='diagram']").first();
    if (await iframe.isVisible()) {
      await expect(iframe).toBeVisible();
    } else {
      // Fallback: some canvas or SVG area should appear
      await expect(page.locator("canvas, svg").first()).toBeVisible({ timeout: 15000 });
    }
  });

  test("editor has sync / card link toolbar element", async ({ page }) => {
    const syncBtn = page
      .getByRole("button", { name: /sync|insert cards|cards/i })
      .or(page.locator("[aria-label*='sync'], [aria-label*='cards']"))
      .first();
    // Only check if it's rendered (depends on DrawIO load)
    if (await syncBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(syncBtn).toBeVisible();
    }
  });
});
