/**
 * The sign-in form, in a fresh context: the login page renders in place at the
 * requested URL and lands there once signed in. The run's second and last
 * login — `/auth/login` is rate-limited and locks after five failures.
 */
// The shared `test`, not @playwright/test's: its `page` fixture is what records
// coverage. The worker's `demo` fixture is lazy, so nothing is looked up here.
import { ADMIN, expect, gotoApp, test } from "./fixtures";
import { t } from "./i18n";

test.use({ storageState: { cookies: [], origins: [] } });

test("signs in through the form and keeps the deep link", async ({ page }) => {
  await gotoApp(page, "/inventory");
  // By role, not by label: MUI's required asterisk is part of the <label> text.
  const password = page.getByRole("textbox", { name: t("auth:login.password"), exact: true });
  await page.getByRole("textbox", { name: t("auth:login.email"), exact: true }).fill(ADMIN.email);
  await password.fill(ADMIN.password);
  await page.getByRole("button", { name: t("auth:login.submitLogin"), exact: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(password).toBeHidden();
  await expect(page.locator(".ag-root-wrapper")).toBeVisible();
});
