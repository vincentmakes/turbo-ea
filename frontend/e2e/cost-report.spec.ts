import { expect, findCard, gotoApp, test } from "./fixtures";
import { t } from "./i18n";

test("cost report keeps its fullscreen surface through drill, detail and table", async ({
  page,
}) => {
  const cardId = await findCard(page.request, "Application", "SAP S/4HANA");
  const logoTimestamp = "2026-01-01T00:00:00Z";
  const items = [
    {
      id: cardId,
      name: "SAP S/4HANA",
      type: "Application",
      cost: 1000000,
      attributes: {},
      logo_updated_at: logoTimestamp,
    },
    ...Array.from({ length: 40 }, (_, i) => ({
      id: `fixture-${i}`,
      name: `Small card ${i}`,
      type: "Application",
      cost: 1000,
      attributes: {},
    })),
  ];
  await page.route(
    (url) =>
      url.origin === new URL(page.url()).origin &&
      url.pathname === `/api/v1/cards/${cardId}/logo` &&
      url.searchParams.get("v") === logoTimestamp,
    async (route) => {
      await route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aX0AAAAASUVORK5CYII=",
          "base64",
        ),
      });
    },
  );
  await page.route("**/api/v1/reports/cost-treemap?*", async (route) => {
    await route.fulfill({
      json: {
        items,
        total: 1040000,
        components: ["licenses"],
        fiscal_year: 2026,
        current_fiscal_year: 2026,
        fiscal_year_start: 1,
      },
    });
  });
  let releaseBreakdown!: () => void;
  const breakdownReady = new Promise<void>((resolve) => {
    releaseBreakdown = resolve;
  });
  let requestedBreakdown!: () => void;
  const breakdownRequested = new Promise<void>((resolve) => {
    requestedBreakdown = resolve;
  });
  await page.route("**/api/v1/reports/cost-sankey?*", async (route) => {
    requestedBreakdown();
    await breakdownReady;
    await route.fulfill({
      json: {
        nodes: [
          {
            id: cardId,
            name: "SAP S/4HANA",
            type: "Application",
            cost: 1000000,
            costs: { licenses: 1000000 },
          },
        ],
        links: [],
        total: 1000000,
      },
    });
  });

  await gotoApp(page, "/reports/cost");
  const host = page.getByTestId("fullscreen-panel");
  await expect(page.getByRole("img", { name: t("reports:cost.title") })).toBeVisible();
  await host.getByRole("button", { name: t("reports:cost.fullscreen") }).click();
  await expect.poll(() => host.evaluate((el) => document.fullscreenElement === el)).toBe(true);
  const chart = host.getByRole("img", { name: t("reports:cost.title") });
  // Forty equally small tiles occupy the narrow strip beside the dominant tile.
  const bounds = await chart.boundingBox();
  if (!bounds) throw new Error("the treemap has no layout");
  const smallTooltip = host
    .locator('div[style*="font-weight"]')
    .filter({ hasText: /Small card \d+/ });
  for (let y = 10; y < bounds.height - 10; y += 12) {
    await page.mouse.move(bounds.x + bounds.width - 20, bounds.y + y);
    try {
      await smallTooltip.waitFor({ state: "visible", timeout: 150 });
      break;
    } catch {
      // Try the next tile in the strip.
    }
  }
  await expect(smallTooltip).toBeVisible();
  await expect(smallTooltip.locator(".material-symbols-outlined")).toBeVisible();
  await chart.click({ button: "right", position: { x: 100, y: 100 } });
  await breakdownRequested;
  await expect(host.getByRole("button", { name: `‹ ${t("reports:cost.back")}` })).toBeVisible();
  await expect(host.getByText("SAP S/4HANA", { exact: true })).toBeVisible();
  expect(await host.evaluate((el) => document.fullscreenElement === el)).toBe(true);
  releaseBreakdown();
  await expect(host.getByRole("img", { name: t("reports:cost.title") })).toBeVisible();
  await host.getByRole("button", { name: `‹ ${t("reports:cost.back")}` }).click();
  await expect(host.getByText(t("reports:cost.breadcrumbRoot"), { exact: true })).toBeVisible();
  expect(await host.evaluate((el) => document.fullscreenElement === el)).toBe(true);

  await chart.click({ position: { x: 100, y: 100 } });
  const closeDetail = host.getByRole("button", { name: t("common:actions.close"), exact: true });
  await expect(closeDetail).toBeVisible();
  await expect(host.getByText("SAP S/4HANA", { exact: true })).toBeVisible();
  await host.getByRole("button", { name: t("cards:tags.edit") }).click();
  const tagDialog = host.getByRole("dialog", { name: t("cards:tags.edit") });
  await expect(tagDialog).toBeVisible();
  await tagDialog.getByRole("button", { name: t("common:actions.cancel") }).click();
  await expect(tagDialog).toBeHidden();
  await closeDetail.click();
  await expect(closeDetail).toBeHidden();
  await host.getByRole("button", { name: t("reports:shell.exitFullscreen") }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);

  await page.getByRole("button", { name: t("reports:shell.tableView") }).click();
  await host.getByRole("button", { name: t("reports:cost.fullscreen") }).click();
  await expect.poll(() => host.evaluate((el) => document.fullscreenElement === el)).toBe(true);
  await expect(host.getByRole("table")).toBeVisible();
  const logo = host
    .getByRole("row", { name: /SAP S\/4HANA/ })
    .locator(`img[src*="/cards/${cardId}/logo"]`);
  await expect(logo).toBeVisible();
  await expect
    .poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  const lastRow = host.getByRole("row", { name: /Small card 39/ });
  await lastRow.scrollIntoViewIfNeeded();
  await expect(lastRow).toBeInViewport();
  await host.getByRole("button", { name: t("reports:shell.exitFullscreen") }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
});
