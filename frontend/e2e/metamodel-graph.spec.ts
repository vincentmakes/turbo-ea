/**
 * The metamodel graph (a hand-rolled SVG): the Graph tab draws the relation
 * types as edges, and clicking a type opens its drawer.
 */
import { expect, gotoApp, test } from "./fixtures";
import { t } from "./i18n";

test("the metamodel graph draws the relation types and opens a type on click", async ({ page }) => {
  await gotoApp(page, "/admin/metamodel");
  await page.getByRole("tab", { name: t("admin:metamodel.tabs.graph") }).click();
  await expect.poll(() => page.locator("svg g.mm-edge").count()).toBeGreaterThan(0);
  await page.locator("svg text", { hasText: /^Application$/ }).first().click();
  await expect(page.getByRole("heading", { name: "Application", exact: true })).toBeVisible();
});
