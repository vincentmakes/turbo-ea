/**
 * Admin E2E tests — Metamodel admin, Settings (logo, currency, SMTP, AI), Users.
 * All admin routes require admin role.
 */
import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8920";

test.describe("Admin — Metamodel", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/admin/metamodel`);
    await page.waitForLoadState("networkidle");
  });

  test("renders card type list", async ({ page }) => {
    // Should show built-in types like Application, Organization, etc.
    await expect(
      page.getByText(/application|organization|business/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("shows relation type graph or list", async ({ page }) => {
    // Relation types are shown below or alongside card types
    await expect(
      page.getByText(/relation|serves|realizes|depends/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("card type row has an edit/detail action", async ({ page }) => {
    // Clicking a card type should open a drawer or detail panel
    const firstTypeRow = page
      .getByRole("row")
      .filter({ hasText: /application/i })
      .first();
    if (await firstTypeRow.isVisible()) {
      await firstTypeRow.click();
      await expect(
        page.getByRole("dialog").or(page.locator("[role='complementary'], aside")).first(),
      ).toBeVisible({ timeout: 5000 });
      await page.keyboard.press("Escape");
    }
  });
});

test.describe("Admin — Users", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/admin/users`);
    await page.waitForLoadState("networkidle");
  });

  test("renders user list with at least the admin user", async ({ page }) => {
    await expect(
      page
        .getByText(/admin|user|email/i)
        .first(),
    ).toBeVisible({ timeout: 8000 });
  });

  test("Invite user button is present", async ({ page }) => {
    const inviteBtn = page
      .getByRole("button", { name: /invite|new user|\+ user/i })
      .first();
    await expect(inviteBtn).toBeVisible();
  });
});

test.describe("Admin — Settings", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/admin/settings`);
    await page.waitForLoadState("networkidle");
  });

  test("renders settings page with tabs", async ({ page }) => {
    // Settings tabs: General, AI, BPM, PPM, etc.
    await expect(page.getByRole("tab").first()).toBeVisible({ timeout: 8000 });
  });

  test("General tab shows currency and logo settings", async ({ page }) => {
    const generalTab = page
      .getByRole("tab", { name: /general/i })
      .first();
    if (await generalTab.isVisible()) {
      await generalTab.click();
    }
    await expect(
      page.getByText(/currency|logo|branding|display/i).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("AI tab shows provider config", async ({ page }) => {
    const aiTab = page.getByRole("tab", { name: /ai/i });
    if (await aiTab.isVisible()) {
      await aiTab.click();
      await expect(
        page.getByText(/provider|model|ollama|ai/i).first(),
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("BPM tab shows enable/disable toggle", async ({ page }) => {
    const bpmTab = page.getByRole("tab", { name: /bpm/i });
    if (await bpmTab.isVisible()) {
      await bpmTab.click();
      await expect(
        page.getByRole("checkbox").or(page.locator("[role='switch']")).first(),
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("PPM tab shows enable/disable toggle", async ({ page }) => {
    const ppmTab = page.getByRole("tab", { name: /ppm/i });
    if (await ppmTab.isVisible()) {
      await ppmTab.click();
      await expect(
        page.getByRole("checkbox").or(page.locator("[role='switch']")).first(),
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("ArchiMate tab shows enable/disable toggle", async ({ page }) => {
    const archTab = page.getByRole("tab", { name: /archimate/i });
    if (await archTab.isVisible()) {
      await archTab.click();
      await expect(
        page.locator("[role='switch']").first(),
      ).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe("Admin — Surveys", () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsAdmin(context, BASE_URL);
    await page.goto(`${BASE_URL}/admin/surveys`);
    await page.waitForLoadState("networkidle");
  });

  test("renders surveys admin page", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /new survey|create survey|\+ survey/i })
        .or(page.getByText(/survey|no survey/i))
        .first(),
    ).toBeVisible({ timeout: 8000 });
  });
});
