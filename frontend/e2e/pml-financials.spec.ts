import { randomUUID } from "node:crypto";
import type { APIRequestContext, APIResponse, Page } from "@playwright/test";

import { expect, gotoApp, test } from "./fixtures";
import { t } from "./i18n";

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), "API " + response.url() + ": " + (await response.text())).toBeTruthy();
  return (await response.json()) as T;
}

async function recordInvoice(page: Page, cost: string, reference: string, amount: string) {
  await page
    .getByRole("button", { name: t("ppm:financeTree.recordInvoice", { name: cost }) })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(t("ppm:financialForm.invoiceDate")).fill("2026-11-23");
  await dialog.getByLabel(t("ppm:financialForm.invoiceId")).fill(reference);
  await dialog.getByLabel(t("ppm:financialForm.amount")).fill(amount);
  await dialog.getByRole("button", { name: t("common:actions.save") }).click();
  await expect(dialog).toBeHidden();
}

async function projection(request: APIRequestContext, initiativeId: string) {
  return json<{
    budget_totals: { total_invoiced: string; remaining_to_invoice: string };
    actual_invoiced: string;
    card_comparison: { actual: { total: string } };
    cost_items: {
      id: string;
      description: string;
      total_invoiced: string;
      remaining_to_invoice: string;
    }[];
  }>(await request.get("/api/v1/ppm/initiatives/" + initiativeId + "/financials"));
}

test("tracks invoices through the budget hierarchy, Initiative, portfolio and print", async ({
  page,
  request,
}) => {
  expect(
    !process.env.E2E_BASE_URL || process.env.E2E_PML_DISPOSABLE === "1",
    "Set E2E_PML_DISPOSABLE=1 only for an isolated demo stack.",
  ).toBe(true);
  const name = "PML E2E " + randomUUID();
  const settings = "/api/v1/settings/pml/financial-fields";
  const configs = await json<
    Record<
      "budget" | "cost_item",
      {
        fields: Record<string, unknown>[];
        visible_columns: string[];
        provider_source: { budget_field_key: string; allow_child_selection: boolean } | null;
      }
    >
  >(await request.get(settings));
  const providerType = await json<{ has_hierarchy: boolean }>(
    await request.get("/api/v1/metamodel/types/Provider"),
  );
  const originKey = "e2eOrigin" + randomUUID().replaceAll("-", "");
  const createdIds: string[] = [];
  let budgetChanged = false;
  let costChanged = false;
  let hierarchyChanged = false;
  try {
    hierarchyChanged = true;
    await json(
      await request.patch("/api/v1/metamodel/types/Provider", { data: { has_hierarchy: true } }),
    );
    const provider = await json<{ id: string }>(
      await request.post("/api/v1/cards", {
        data: { type: "Provider", name: name + " Provider" },
      }),
    );
    createdIds.unshift(provider.id);
    const firstChild = await json<{ id: string }>(
      await request.post("/api/v1/cards", {
        data: { type: "Provider", parent_id: provider.id, name: name + " Child A" },
      }),
    );
    createdIds.unshift(firstChild.id);
    const secondChild = await json<{ id: string }>(
      await request.post("/api/v1/cards", {
        data: { type: "Provider", parent_id: provider.id, name: name + " Child B" },
      }),
    );
    createdIds.unshift(secondChild.id);
    budgetChanged = true;
    await json(
      await request.put(settings + "/budget", {
        data: {
          ...configs.budget,
          fields: [
            ...configs.budget.fields,
            {
              key: originKey,
              label: "PML E2E Provider",
              kind: "card_reference",
              card_type: "Provider",
            },
          ],
        },
      }),
    );
    costChanged = true;
    await json(
      await request.put(settings + "/cost_item", {
        data: {
          ...configs.cost_item,
          provider_source: { budget_field_key: originKey, allow_child_selection: true },
        },
      }),
    );
    await gotoApp(page, "/admin/settings?tab=pml");
    await expect(page.getByRole("tab", { name: t("admin:pml.fields.budget") })).toBeVisible();
    await expect(page.getByText("PML E2E Provider", { exact: true })).toBeVisible();
    const budgetRead = page.waitForResponse(
      (response) =>
        response.url().endsWith("/settings/pml/financial-fields/budget") &&
        response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: t("admin:pml.fields.save") }).click();
    expect((await budgetRead).ok()).toBeTruthy();
    await expect(page.getByText(t("admin:pml.fields.saved"))).toBeVisible();
    const card = await json<{ id: string }>(
      await request.post("/api/v1/cards", {
        data: {
          name,
          type: "Initiative",
          attributes: {
            startDate: "2026-04-01",
            endDate: "2026-09-30",
            actualStart: "2026-05-15",
            actualEnd: "2026-11-10",
          },
        },
      }),
    );
    createdIds.unshift(card.id);
    const base = "/api/v1/ppm/initiatives/" + card.id;
    const budget = await json<{ id: string }>(
      await request.post(base + "/budgets", {
        data: {
          fiscal_year: 2026,
          category: "capex",
          description: "Platform",
          amount: 12000,
          field_values: { [originKey]: provider.id },
        },
      }),
    );
    const renewal = await json<{ id: string }>(
      await request.post(base + "/costs", {
        data: { budget_line_id: budget.id, description: "Renewal", category: "opex", actual: 8000 },
      }),
    );
    const support = await json<{ id: string }>(
      await request.post(base + "/costs", {
        data: {
          budget_line_id: budget.id,
          description: "Support",
          category: "opex",
          actual: 2000,
          provider_child_id: secondChild.id,
        },
      }),
    );
    await gotoApp(page, "/ppm/" + card.id + "?tab=cost");
    await page
      .getByRole("button", { name: t("ppm:financeTree.expand", { name: "Platform" }) })
      .click();
    await page
      .getByRole("button", { name: t("ppm:financeTree.editCost", { name: "Renewal" }) })
      .click();
    const costEditor = page.getByRole("dialog");
    await costEditor.getByRole("combobox", { name: t("ppm:financialForm.providerChild") }).click();
    await page.getByRole("option", { name: name + " Child A" }).click();
    await costEditor.getByRole("button", { name: t("common:actions.save") }).click();
    await expect(costEditor).toBeHidden();
    await expect(page.getByText(name + " Child A", { exact: true })).toBeVisible();
    await recordInvoice(page, "Renewal", "00018", "4000");
    await recordInvoice(page, "Renewal", "00051", "2500");
    await expect(page.getByText("00051", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: t("ppm:financeTree.moveInvoice", { name: "00051" }) })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(t("ppm:financialForm.selectCost")).click();
    await page.getByRole("option", { name: "Support" }).click();
    await dialog.getByRole("button", { name: t("common:actions.save") }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => {
        const data = await projection(request, card.id);
        const first = data.cost_items.find((item) => item.id === renewal.id);
        const second = data.cost_items.find((item) => item.id === support.id);
        return [
          Number(first?.total_invoiced),
          Number(second?.remaining_to_invoice),
          Number(data.budget_totals.total_invoiced),
          Number(data.budget_totals.remaining_to_invoice),
          Number(data.actual_invoiced),
          Number(data.card_comparison.actual.total),
        ];
      })
      .toEqual([4000, -500, 6500, 3500, 6500, 10000]);
    const tree = page.getByRole("region", { name: t("ppm:financeTree.item") });
    const platform = tree.getByRole("row").filter({ hasText: "Platform" });
    await expect(platform).toContainText(/6[,.]500/);
    await expect(platform).toContainText(/3[,.]500/);
    const supportRow = tree.getByRole("row").filter({ hasText: "Support" });
    await expect(supportRow).toContainText(/-.*500/);

    await gotoApp(page, "/ppm/" + card.id + "?tab=details");
    await expect(page.getByText(t("ppm:financials"), { exact: true })).toBeVisible();
    await expect(page.getByText(/6[,.]500/).first()).toBeVisible();
    const actualStart = /15 May 2026|2026-05-15|05\/15\/2026/;
    const actualEnd = /10 Nov 2026|2026-11-10|11\/10\/2026/;
    for (const date of [actualStart, actualEnd]) {
      await expect(page.getByText(date).filter({ visible: true }).first()).toBeVisible();
    }
    await gotoApp(page, "/ppm/" + card.id + "/report");
    await expect(page.getByText(name).first()).toBeVisible();
    await expect(page.getByText("00051", { exact: true })).toBeVisible();
    await expect(page.getByText(/6[,.]500/).first()).toBeVisible();
    for (const date of [actualStart, actualEnd]) {
      await expect(page.getByText(date).filter({ visible: true }).first()).toBeVisible();
    }
    await gotoApp(page, "/ppm");
    const row = page
      .locator("[data-export-row]")
      .filter({ has: page.getByText(name, { exact: true }) });
    await expect(row).toHaveCount(1);
    const actualTrack = row.getByRole("img", { name: /Actual:.*15 May 2026.*10 Nov 2026/ });
    await expect(actualTrack).toBeVisible();
    await expect(actualTrack.locator("[data-actual-track]")).toBeVisible();
  } finally {
    const failures: string[] = [];
    const cleanup = async (label: string, action: () => Promise<APIResponse>) => {
      try {
        const response = await action();
        if (!response.ok()) failures.push(label + ": " + (await response.text()));
      } catch (error) {
        failures.push(label + ": " + String(error));
      }
    };
    for (const id of createdIds) {
      await cleanup("delete " + id, () => request.delete("/api/v1/cards/" + id));
    }
    for (const section of ["cost_item", "budget"] as const) {
      if ((section === "cost_item" && !costChanged) || (section === "budget" && !budgetChanged))
        continue;
      await cleanup("restore " + section, () =>
        request.put(settings + "/" + section, { data: configs[section] }),
      );
    }
    if (hierarchyChanged) {
      await cleanup("restore Provider hierarchy", () =>
        request.patch("/api/v1/metamodel/types/Provider", {
          data: { has_hierarchy: providerType.has_hierarchy },
        }),
      );
    }
    expect(failures, "clean up isolated test data").toEqual([]);
  }
});

const legacyId = process.env.E2E_PML_LEGACY_ID;
if (legacyId) {
  test("keeps legacy invoices separate from linked budget totals", async ({ page, request }) => {
    const data = await projection(request, legacyId);
    expect(Number(data.actual_invoiced)).toBe(6800);
    expect(Number(data.budget_totals.total_invoiced)).toBe(6500);
    await gotoApp(page, "/ppm/" + legacyId + "?tab=cost");
    await page
      .getByRole("button", {
        name: t("ppm:financeTree.expand", { name: t("ppm:financeTree.unassigned") }),
      })
      .click();
    await page
      .getByRole("button", { name: t("ppm:financeTree.expand", { name: "Legacy 300" }) })
      .click();
    await expect(page.getByText("LEGACY-00003", { exact: true })).toBeVisible();
    await gotoApp(page, "/ppm/" + legacyId + "?tab=details");
    await expect(page.getByText(/6[,.]800/).first()).toBeVisible();
    await gotoApp(page, "/ppm/" + legacyId + "/report");
    await expect(page.getByText("LEGACY-00003", { exact: true })).toBeVisible();
    await expect(page.getByText(/6[,.]800/).first()).toBeVisible();
  });
}

test("keeps the module navigation and multi-year timeline labels readable", async ({
  page,
  demo,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoApp(page, "/ppm/" + demo.migrationId);
  const moduleLink = page.getByRole("link", { name: /Project Master List/ });
  await expect(moduleLink).toBeVisible();
  const labelFits = await moduleLink.evaluate((link) => link.scrollWidth <= link.clientWidth);
  expect(labelFits).toBe(true);

  const timeline = page.getByRole("region", { name: t("ppm:summaryTimeline") });
  await expect(timeline.getByTestId("plan-bar")).toBeVisible();
  const labels = timeline.getByText(/^Q[1-4]'[0-9]{2}$/);
  expect(await labels.count()).toBeGreaterThan(8);
  const nonOverlapping = await labels.evaluateAll((nodes) => {
    const boxes = nodes.map((node) => node.getBoundingClientRect());
    return boxes.slice(1).every((box, index) => boxes[index].right <= box.left);
  });
  expect(nonOverlapping).toBe(true);
});
