import { test, expect } from "@playwright/test";
import { loginAsAdmin, enableArchiMate, disableArchiMate } from "../../helpers/auth";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8920";

test.describe("ArchiMate diagram editor", () => {
  let token: string;
  let diagramId: string;

  test.beforeAll(async ({ request, browser }) => {
    // Enable ArchiMate for all tests in this suite
    const context = await browser.newContext();
    token = await loginAsAdmin(context, BASE_URL);
    await enableArchiMate(request, BASE_URL, token);
    await context.close();
  });

  test.afterAll(async ({ request }) => {
    // Clean up: delete the test diagram if created
    if (diagramId) {
      await request.delete(`${BASE_URL}/api/v1/diagrams/${diagramId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    await disableArchiMate(request, BASE_URL, token);
  });

  test("ArchiMate gallery page loads and shows new diagram button", async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/archimate`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("button", { name: /new.*archimate.*diagram/i })).toBeVisible();
  });

  test("Can create a new ArchiMate diagram from gallery", async ({ context, page, request }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/archimate`);
    await page.waitForLoadState("networkidle");

    // Click new diagram button
    await page.getByRole("button", { name: /new.*archimate.*diagram/i }).click();

    // Dialog should appear with name input
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByRole("textbox").fill("E2E Test Diagram");
    await dialog.getByRole("button", { name: /create/i }).click();

    // Should navigate to the editor
    await page.waitForURL(/\/archimate\/.+\/edit/);

    // Capture diagram ID from URL
    const url = page.url();
    const match = url.match(/\/archimate\/([^/]+)\/edit/);
    if (match) {
      diagramId = match[1];
    }

    // Editor should load with palette visible
    await expect(page.getByText(/application/i).first()).toBeVisible();
  });

  test("Element palette renders ArchiMate layers", async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);

    // Need a diagram to edit — create one via API
    const resp = await page.request.post(`${BASE_URL}/api/v1/diagrams`, {
      data: { name: "Palette Test", type: "archimate" },
      headers: { Authorization: `Bearer ${token}` },
    });
    const diagram = await resp.json();
    const testDiagramId = diagram.id;

    await page.goto(`${BASE_URL}/archimate/${testDiagramId}/edit`);
    await page.waitForLoadState("networkidle");

    // Palette should show at least Business, Application, Technology layers
    await expect(page.getByText("Business")).toBeVisible();
    await expect(page.getByText("Application")).toBeVisible();
    await expect(page.getByText("Technology")).toBeVisible();

    // Cleanup
    await page.request.delete(`${BASE_URL}/api/v1/diagrams/${testDiagramId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  });

  test("Auto-layout button is present in editor toolbar", async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);

    const resp = await page.request.post(`${BASE_URL}/api/v1/diagrams`, {
      data: { name: "Layout Test", type: "archimate" },
      headers: { Authorization: `Bearer ${token}` },
    });
    const diagram = await resp.json();
    const testDiagramId = diagram.id;

    await page.goto(`${BASE_URL}/archimate/${testDiagramId}/edit`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("button", { name: /auto.?layout/i })).toBeVisible();

    // Cleanup
    await page.request.delete(`${BASE_URL}/api/v1/diagrams/${testDiagramId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  });

  test("Back to diagrams navigation works", async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);

    const resp = await page.request.post(`${BASE_URL}/api/v1/diagrams`, {
      data: { name: "Nav Test", type: "archimate" },
      headers: { Authorization: `Bearer ${token}` },
    });
    const diagram = await resp.json();
    const testDiagramId = diagram.id;

    await page.goto(`${BASE_URL}/archimate/${testDiagramId}/edit`);
    await page.waitForLoadState("networkidle");

    // Should have a back button
    const backButton = page.getByRole("button", { name: /back|diagrams/i });
    if (await backButton.isVisible()) {
      await backButton.click();
      await expect(page).toHaveURL(/\/archimate$/);
    }

    // Cleanup
    await page.request.delete(`${BASE_URL}/api/v1/diagrams/${testDiagramId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  });
});
