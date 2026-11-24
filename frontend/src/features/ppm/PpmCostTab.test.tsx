import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PpmFinancials } from "@/types";

const query = vi.hoisted(() => ({ data: undefined as PpmFinancials | undefined, loading: false, error: null as Error | null, refetch: vi.fn() }));
vi.mock("./usePpmFinancials", () => ({
  usePpmFinancials: () => query,
  usePpmFinancialAmount: () => (value: string | number | null | undefined) => value == null ? "—" : "$" + String(value),
}));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: { format: (value: number) => "$" + value.toFixed(0) } }) }));
vi.mock("@/hooks/AuthContext", () => ({ useOptionalAuthUser: () => ({ permissions: { "ppm.manage": true } }) }));
vi.mock("./PpmCostCharts", () => ({ default: ({ costLines, budgetLines }: { costLines: unknown[]; budgetLines: unknown[] }) => <div data-testid="chart">{costLines.length}/{budgetLines.length}</div> }));
vi.mock("./PpmFinancialRowForm", () => ({ default: () => null }));

import PpmCostTab from "./PpmCostTab";

const financials: PpmFinancials = {
  initiative_id: "i1",
  budget_lines: [{ id: "b1", fiscal_year: 2026, category: "opex", description: "Software", amount: "100.13", total_cost_items: "100.13", total_invoiced: "30.11", remaining_to_invoice: "70.02" }],
  budget_subtotals: [],
  budget_totals: { amount: "100.13", total_cost_items: "100.13", total_invoiced: "30.11", remaining_to_invoice: "70.02" },
  cost_items: [{ id: "c1", budget_line_id: "b1", description: "Renewal", category: "opex", planned: "0", actual: "100.13", date: null, total_invoiced: "30.11", remaining_to_invoice: "70.02" }],
  invoice_access: true,
  invoices: [],
  actual_invoiced: "30.11",
  field_definitions: {},
};

beforeEach(() => { query.data = financials; query.error = null; query.loading = false; query.refetch.mockReset(); });

describe("PpmCostTab financial projection", () => {
  it("uses exact server budget and invoice amounts and supplies the chart with current rows", async () => {
    render(<PpmCostTab initiativeId="i1" costLines={[]} rollup={null} onRefresh={vi.fn()} />);
    expect(screen.getAllByText("$100.13").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$30.11").length).toBeGreaterThan(0);
    expect(await screen.findByTestId("chart")).toHaveTextContent("1/1");
    fireEvent.click(screen.getByRole("button", { name: /expand software/i }));
    expect(screen.getByText("Renewal")).toBeInTheDocument();
  });

  it("does not display the prior initiative while the current query is unavailable", () => {
    query.data = undefined;
    query.loading = true;
    render(<PpmCostTab initiativeId="i2" costLines={[]} rollup={null} onRefresh={vi.fn()} />);
    expect(screen.queryByText("Software")).not.toBeInTheDocument();
    expect(screen.queryByText("$100.13")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("hides financial data when the current request fails", () => {
    query.data = undefined;
    query.error = new Error("Denied");
    render(<PpmCostTab initiativeId="i2" costLines={[]} rollup={null} onRefresh={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Denied");
    expect(screen.queryByText("Software")).not.toBeInTheDocument();
  });
});
