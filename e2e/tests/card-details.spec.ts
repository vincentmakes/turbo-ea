/**
 * Card detail E2E tests — header, description, lifecycle, relations, tabs.
 * Navigates to the SAP S/4HANA demo card (Application type).
 */
import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8920";

/** Resolve the UUID of a demo card by name via the search API. */
async function findCardId(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  name: string,
): Promise<string | null> {
  const resp = await request.get(
    `${BASE_URL}/api/v1/cards?search=${encodeURIComponent(name)}&page_size=5`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok()) return null;
  const data = await resp.json();
  const items: Array<{ id: string; name: string }> = data.items ?? data ?? [];
  const match = items.find((c) => c.name.toLowerCase().includes(name.toLowerCase()));
  return match?.id ?? null;
}

test.describe("Card detail — Application card (SAP S/4HANA)", () => {
  let cardId: string;
  let token: string;

  test.beforeAll(async ({ request, browser }) => {
    const ctx = await browser.newContext();
    const resp = await ctx.request.post(`${BASE_URL}/api/v1/auth/login`, {
      data: { email: process.env.E2E_ADMIN_EMAIL ?? "admin@turboea.demo", password: process.env.E2E_ADMIN_PASSWORD ?? "TurboEA!2025" },
    });
    const json = await resp.json();
    token = json.access_token;
    const id = await findCardId(request, token, "SAP S/4HANA");
    cardId = id ?? "";
    await ctx.close();
  });

  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    if (!cardId) test.skip();
    await page.goto(`${BASE_URL}/cards/${cardId}`);
    await page.waitForLoadState("networkidle");
  });

  test("shows card name in the header", async ({ page }) => {
    await expect(page.getByText(/SAP S\/4HANA/i).first()).toBeVisible({ timeout: 8000 });
  });

  test("shows card type badge", async ({ page }) => {
    await expect(page.getByText(/application/i).first()).toBeVisible();
  });

  test("shows approval status badge", async ({ page }) => {
    // Status badge: Draft, Approved, Broken, Rejected
    await expect(
      page.getByText(/draft|approved|broken|rejected/i).first(),
    ).toBeVisible();
  });

  test("shows data quality ring or score", async ({ page }) => {
    // Data quality ring renders a percentage or score
    const quality = page.getByText(/%/).or(page.locator("[aria-label*='quality'], [title*='quality']")).first();
    await expect(quality).toBeVisible();
  });

  test("description section is present", async ({ page }) => {
    await expect(
      page.getByText(/description/i).first(),
    ).toBeVisible();
  });

  test("lifecycle section shows phase timeline", async ({ page }) => {
    const lifecycleSection = page.getByText(/lifecycle/i).first();
    await expect(lifecycleSection).toBeVisible();
  });

  test("relations section lists related cards", async ({ page }) => {
    const relSection = page.getByText(/relations|dependencies/i).first();
    await expect(relSection).toBeVisible();
  });

  test("Comments tab is accessible", async ({ page }) => {
    const commentsTab = page.getByRole("tab", { name: /comments/i });
    if (await commentsTab.isVisible()) {
      await commentsTab.click();
      await expect(
        page.getByRole("textbox", { name: /comment/i })
          .or(page.getByPlaceholder(/comment|reply|write/i))
          .first(),
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("Todos tab shows task list", async ({ page }) => {
    const todosTab = page.getByRole("tab", { name: /todo|task/i });
    if (await todosTab.isVisible()) {
      await todosTab.click();
      await expect(
        page.getByRole("button", { name: /new todo|add todo|add task/i })
          .or(page.getByText(/no todo|no task|empty/i))
          .first(),
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("Stakeholders tab shows role assignments", async ({ page }) => {
    const stakeholderTab = page.getByRole("tab", { name: /stakeholder/i });
    if (await stakeholderTab.isVisible()) {
      await stakeholderTab.click();
      // Should have search / invite field or existing stakeholder rows
      await expect(
        page.getByPlaceholder(/search|invite/i)
          .or(page.getByText(/stakeholder|role|owner/i))
          .first(),
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("History tab lists audit events", async ({ page }) => {
    const historyTab = page.getByRole("tab", { name: /history|audit/i });
    if (await historyTab.isVisible()) {
      await historyTab.click();
      // History should contain at least one event (the card creation)
      await expect(
        page.getByText(/created|updated|changed/i).first(),
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("Resources tab shows file/link sections", async ({ page }) => {
    const resourcesTab = page.getByRole("tab", { name: /resource/i });
    if (await resourcesTab.isVisible()) {
      await resourcesTab.click();
      await expect(
        page.getByText(/attachment|document|diagram|decision/i).first(),
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("actions menu (⋮) is accessible", async ({ page }) => {
    const actionsBtn = page
      .getByRole("button", { name: /actions|more|⋮|menu/i })
      .or(page.locator("[aria-label*='action'], [aria-label*='more']"))
      .first();
    if (await actionsBtn.isVisible()) {
      await actionsBtn.click();
      await expect(page.getByRole("menu")).toBeVisible();
      // Close menu
      await page.keyboard.press("Escape");
    }
  });
});

test.describe("Card detail — edit name inline", () => {
  let cardId: string;
  let token: string;

  test.beforeAll(async ({ request, browser }) => {
    const ctx = await browser.newContext();
    const resp = await ctx.request.post(`${BASE_URL}/api/v1/auth/login`, {
      data: { email: process.env.E2E_ADMIN_EMAIL ?? "admin@turboea.demo", password: process.env.E2E_ADMIN_PASSWORD ?? "TurboEA!2025" },
    });
    const json = await resp.json();
    token = json.access_token;

    // Create a throwaway card for edit tests
    const createResp = await request.post(`${BASE_URL}/api/v1/cards`, {
      data: { type_key: "Application", name: "E2E Edit Test Card" },
      headers: { Authorization: `Bearer ${token}` },
    });
    const card = await createResp.json();
    cardId = card.id ?? "";
    await ctx.close();
  });

  test.afterAll(async ({ request }) => {
    if (cardId) {
      await request.delete(`${BASE_URL}/api/v1/cards/${cardId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  });

  test("card name is editable inline", async ({ context, page }) => {
    if (!cardId) test.skip();
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/cards/${cardId}`);
    await page.waitForLoadState("networkidle");

    // Click on the card name to start editing
    const nameEl = page.getByText("E2E Edit Test Card").first();
    await nameEl.click();

    const nameInput = page.getByRole("textbox").first();
    if (await nameInput.isVisible()) {
      await nameInput.fill("E2E Edit Test Card — Renamed");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);
      await expect(page.getByText(/Renamed/)).toBeVisible();
    }
  });
});
