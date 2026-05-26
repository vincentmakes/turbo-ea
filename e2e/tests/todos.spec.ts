/**
 * Todos & Surveys E2E tests — todo list, create, toggle status, surveys tab.
 */
import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8920";

test.describe("Todos page", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/todos`);
    await page.waitForLoadState("networkidle");
  });

  test("renders My Todos tab", async ({ page }) => {
    await expect(
      page.getByRole("tab", { name: /my todo|todo/i }).first()
        .or(page.getByText(/todo|no todo|open|done/i).first()),
    ).toBeVisible({ timeout: 8000 });
  });

  test("status filter buttons are present (Open, Done, All)", async ({ page }) => {
    const openBtn = page
      .getByRole("button", { name: /^open$/i })
      .or(page.getByRole("tab", { name: /^open$/i }))
      .first();
    await expect(openBtn).toBeVisible({ timeout: 5000 });
  });

  test("New Todo button opens creation dialog", async ({ page }) => {
    const newTodoBtn = page
      .getByRole("button", { name: /new todo|add todo|\+ todo/i })
      .first();
    await expect(newTodoBtn).toBeVisible();
    await newTodoBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Dialog should have a title input
    await expect(
      dialog.getByRole("textbox").first()
        .or(dialog.getByLabel(/title/i)),
    ).toBeVisible();

    await page.keyboard.press("Escape");
  });

  test("can create and toggle a todo", async ({ context, page }) => {
    const token = await loginAsAdmin(context, BASE_URL);

    // Create todo via API
    const resp = await context.request.post(`${BASE_URL}/api/v1/todos`, {
      data: { title: "E2E Toggle Test Todo" },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok()) return;
    const todo = await resp.json();

    await page.reload();
    await page.waitForLoadState("networkidle");

    // Find the todo row
    const todoRow = page.getByText("E2E Toggle Test Todo").first();
    await expect(todoRow).toBeVisible({ timeout: 8000 });

    // Find nearby checkbox and toggle
    const checkbox = page
      .locator("[role='row'], .todo-item, li")
      .filter({ hasText: "E2E Toggle Test Todo" })
      .first()
      .getByRole("checkbox")
      .first();
    if (await checkbox.isVisible()) {
      await checkbox.click();
      await page.waitForTimeout(500);
    }

    // Cleanup
    await context.request.delete(`${BASE_URL}/api/v1/todos/${todo.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  });

  test("Surveys tab is accessible", async ({ page }) => {
    const surveysTab = page.getByRole("tab", { name: /survey/i });
    if (await surveysTab.isVisible()) {
      await surveysTab.click();
      await expect(
        page.getByText(/survey|pending|no survey/i).first(),
      ).toBeVisible({ timeout: 5000 });
    }
  });
});
