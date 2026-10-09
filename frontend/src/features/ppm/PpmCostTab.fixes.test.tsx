/**
 * PpmCostTab regressions: a budget or cost dialog left open survived a switch
 * to another initiative, so its Save wrote the line to the initiative the user
 * had switched to; and a failed delete's error stayed over the next
 * initiative's tables.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PpmBudgetLine, PpmCostLine } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/features/ppm/PpmCostCharts", () => ({ default: () => null }));

import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import PpmCostTab from "./PpmCostTab";

function budget(overrides: Partial<PpmBudgetLine> & { id: string }): PpmBudgetLine {
  return {
    initiative_id: "i1",
    fiscal_year: 2026,
    category: "capex",
    amount: 0,
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    ...overrides,
  };
}

function cost(overrides: Partial<PpmCostLine> & { id: string }): PpmCostLine {
  return {
    initiative_id: "i1",
    description: overrides.id,
    category: "capex",
    planned: 0,
    actual: 0,
    date: null,
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    ...overrides,
  };
}

const COSTS = [cost({ id: "c1", description: "Servers", actual: 250 })];

function renderTab() {
  const user = userEvent.setup();
  const onRefresh = vi.fn();
  const ui = (initiativeId: string) => (
    <PpmCostTab initiativeId={initiativeId} costLines={COSTS} onRefresh={onRefresh} />
  );
  const { rerender } = render(ui("i1"));
  return { user, switchTo: (id: string) => rerender(ui(id)) };
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  mockApi.on("get", "/ppm/initiatives/i1/budgets", [budget({ id: "b1", fiscal_year: 2025, amount: 1000 })]);
  mockApi.on("get", "/ppm/initiatives/i2/budgets", [
    budget({ id: "b9", initiative_id: "i2", fiscal_year: 2030, amount: 50 }),
  ]);
  mockApi.on("post", /^\/ppm\/initiatives\//, {});
  mockApi.on("delete", /^\/ppm\//, null);
});

describe("PpmCostTab — switching initiatives", () => {
  it("closes an open budget dialog, so its save cannot land on the next initiative", async () => {
    const { user, switchTo } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(screen.getByRole("button", { name: /Add Budget Line/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    switchTo("i2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText("FY 2030")).toBeInTheDocument();
    expect(mockApi.callsOf("post")).toEqual([]);
  });

  it("closes an open cost dialog, so its save cannot land on the next initiative", async () => {
    const { user, switchTo } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(screen.getByRole("button", { name: /Add Cost Item/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    switchTo("i2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText("FY 2030")).toBeInTheDocument();
    expect(mockApi.callsOf("post")).toEqual([]);
  });

  it("opens a fresh dialog for the next initiative and saves it there", async () => {
    const { user, switchTo } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(screen.getByRole("button", { name: /Add Budget Line/ }));
    switchTo("i2");
    await screen.findByText("FY 2030");

    await user.click(screen.getByRole("button", { name: /Add Budget Line/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    expect(mockApi.callsOf("post")[0].path).toBe("/ppm/initiatives/i2/budgets");
  });

  it("drops a failed budget delete's error when it moves to another initiative", async () => {
    mockApi.fail("delete", "/ppm/budgets/b1", 409);
    const { user, switchTo } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(
      within(screen.getByText("FY 2025").closest("tr") as HTMLElement).getByRole("button", {
        name: "Delete",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("DELETE /ppm/budgets/b1 failed");

    switchTo("i2");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(await screen.findByText("FY 2030")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("drops a failed cost delete's error when it moves to another initiative", async () => {
    mockApi.fail("delete", "/ppm/costs/c1", 409);
    const { user, switchTo } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(
      within(screen.getByText("Servers").closest("tr") as HTMLElement).getByRole("button", {
        name: "Delete",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("DELETE /ppm/costs/c1 failed");

    switchTo("i2");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(await screen.findByText("FY 2030")).toBeInTheDocument();
  });
});
