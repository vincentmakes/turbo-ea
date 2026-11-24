import {
  invalidateFiscalYearStart,
  resetFiscalYearStart,
} from "@/hooks/useFiscalYearStart";
import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import PpmFinanceTree from "./PpmFinanceTree";

vi.mock("./PpmFinancialRowForm", () => ({
  default: ({
    kind,
    mode,
    parentId,
  }: {
    kind: string;
    mode: string;
    parentId?: string;
  }) => (
    <div data-testid="row-form">
      {kind}:{mode}:{parentId}
    </div>
  ),
}));

const data = {
  initiative_id: "initiative",
  budget_lines: [
    {
      id: "aaaaaaaa-1",
      fiscal_year: 2026,
      category: "opex",
      description: "Software",
      amount: "100.13",
      total_cost_items: "100.13",
      total_invoiced: "30.11",
      remaining_to_invoice: "70.02",
      provider: { name: "Aruba Software", id: "provider", status: "ACTIVE" },
      field_values: {},
      calculated_values: {},
      reference_display: {},
    },
  ],
  budget_subtotals: [
    {
      fiscal_year: 2026,
      category: "opex",
      amount: "100.13",
      total_cost_items: "100.13",
      total_invoiced: "30.11",
      remaining_to_invoice: "70.02",
    },
  ],
  budget_totals: {
    amount: "100.13",
    total_cost_items: "100.13",
    total_invoiced: "30.11",
    remaining_to_invoice: "70.02",
  },
  cost_items: [
    {
      id: "cost-1",
      budget_line_id: "aaaaaaaa-1",
      description: "Renewal",
      category: "opex",
      planned: "0",
      actual: "100.13",
      date: "2026-10-01",
      total_invoiced: "30.11",
      remaining_to_invoice: "70.02",
      provider: {
        name: "Aruba Software / Licensing",
        id: "child",
        status: "ACTIVE",
      },
      field_values: {},
      calculated_values: {},
      reference_display: {},
    },
    {
      id: "cost-legacy",
      budget_line_id: null,
      description: "Legacy",
      category: "opex",
      planned: "0",
      actual: "10",
      date: null,
      total_invoiced: "3",
      remaining_to_invoice: "7",
      field_values: {},
      calculated_values: {},
      reference_display: {},
    },
  ],
  invoice_access: true,
  invoices: [
    {
      id: "inv-1",
      initiative_id: "initiative",
      cost_item_id: "cost-1",
      invoice_date: "2026-11-01",
      invoice_id: "INV-001",
      amount: "30.11",
      field_values: {},
      calculated_values: {},
      reference_display: {},
    },
    {
      id: "inv-legacy",
      initiative_id: "initiative",
      cost_item_id: "cost-legacy",
      invoice_date: "2026-11-02",
      invoice_id: "INV-002",
      amount: "3",
      field_values: {},
      calculated_values: {},
      reference_display: {},
    },
  ],
  actual_invoiced: "33.11",
  field_definitions: {},
};

describe("PpmFinanceTree", () => {
  it("shows aligned budget totals and configured fields in separate nested tables", () => {
    const nested = {
      ...data,
      budget_lines: data.budget_lines.map((row) => ({
        ...row,
        remaining_budget: "-20.25",
      })),
      cost_items: data.cost_items.map((row) => ({
        ...row,
        field_values: { purchase: "PO-42" },
      })),
      field_definitions: {
        cost_item: {
          fields: [{ key: "purchase", label: "OdA", kind: "text" as const }],
          visible_columns: ["purchase"],
        },
      },
    };
    render(<PpmFinanceTree data={nested} rollup={null} onChanged={vi.fn()} />);
    expect(
      screen.getByRole("columnheader", { name: /remaining budget/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/-20[.,]25/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /expand software/i }));
    const costs = screen.getByRole("table", { name: /cost items/i });
    expect(
      within(costs).getByRole("columnheader", { name: "OdA" }),
    ).toBeInTheDocument();
    expect(within(costs).getByText("PO-42")).toBeInTheDocument();
    fireEvent.click(
      within(costs).getByRole("button", { name: /expand renewal/i }),
    );
    const invoices = screen.getByRole("table", { name: /invoices/i });
    expect(
      within(invoices).getByRole("columnheader", { name: /invoice date/i }),
    ).toBeInTheDocument();
    expect(within(invoices).getByText("INV-001")).toBeInTheDocument();
  });

  it("shows exact totals when collapsed, then expands budget, cost and invoices", () => {
    render(<PpmFinanceTree data={data} rollup={null} onChanged={vi.fn()} />);
    expect(screen.getAllByText(/30[.,]11/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/70[.,]02/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /expand software/i }));
    expect(screen.getByText("Aruba Software / Licensing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /expand renewal/i }));
    expect(screen.getByText("INV-001")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /invoice date/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /cost date/i }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /expand costs without a budget/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /expand legacy/i }));
    expect(screen.getByText("INV-002")).toBeInTheDocument();
  });

  it("passes the selected budget and cost as immutable create contexts", () => {
    render(<PpmFinanceTree data={data} rollup={null} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /expand software/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /add cost item to software/i }),
    );
    expect(screen.getByTestId("row-form")).toHaveTextContent(
      "cost:create:aaaaaaaa-1",
    );
  });

  it("omits invoice actions for a user without invoice access", () => {
    render(
      <PpmFinanceTree
        data={{ ...data, invoice_access: false, invoices: undefined }}
        rollup={null}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /expand software/i }));
    expect(
      screen.queryByRole("button", { name: /record invoice/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /expand renewal/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete cost item/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /move cost item renewal/i }),
    ).toBeInTheDocument();
  });

  it("expands all rows in read-only print view", () => {
    render(
      <PpmFinanceTree
        data={data}
        rollup={null}
        readOnly
        expandAll
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText("INV-001")).toBeInTheDocument();
    expect(screen.getByText("INV-002")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add cost item/i }),
    ).not.toBeInTheDocument();
  });
});

describe("PpmFinanceTree totals and transitions", () => {
  it("keeps a budget expanded during a data refresh without showing stale financial values", () => {
    const view = render(
      <PpmFinanceTree data={data} rollup={null} onChanged={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /expand software/i }));
    expect(screen.getByText("Renewal")).toBeInTheDocument();
    view.rerender(
      <PpmFinanceTree data={undefined} rollup={null} onChanged={vi.fn()} />,
    );
    expect(screen.queryByText("Software")).not.toBeInTheDocument();
    view.rerender(
      <PpmFinanceTree data={data} rollup={null} onChanged={vi.fn()} />,
    );
    expect(screen.getByText("Renewal")).toBeInTheDocument();
  });

  it("shows descendant actual as a separate fallback even when this budget has no linked cost", () => {
    const ownBudget = {
      ...data.budget_lines[0],
      total_cost_items: "0",
      total_invoiced: "0",
    };
    const rollup = {
      descendant_count: 1,
      capex_planned: 0,
      opex_planned: 0,
      total_planned: 0,
      capex_actual: 25,
      opex_actual: 0,
      total_actual: 25,
      start_date: null,
      end_date: null,
      has_budget_lines: true,
      has_cost_lines: false,
      by_year: [
        {
          year: 2026,
          capex_budget: 0,
          opex_budget: 0,
          capex_actual: 25,
          opex_actual: 0,
        },
      ],
    };
    render(
      <PpmFinanceTree
        data={{
          ...data,
          budget_lines: [ownBudget],
          cost_items: [],
          invoices: [],
        }}
        rollup={rollup}
        readOnly
        onChanged={vi.fn()}
      />,
    );
    const fallback = screen
      .getByText(/actual costs from initiatives beneath/i)
      .closest("tr");
    expect(fallback).not.toBeNull();
    expect(within(fallback!).getAllByText("—")).toHaveLength(4);
    expect(within(fallback!).getByText(/25/)).toBeInTheDocument();
    const budgetRow = screen.getByText("Software").closest("tr");
    expect(within(budgetRow!).getAllByText(/0/).length).toBeGreaterThan(0);
  });

  it("requires confirmation before deleting a budget", async () => {
    const { api } = await import("@/api/client");
    const del = vi.spyOn(api, "delete").mockResolvedValue(undefined);
    render(<PpmFinanceTree data={data} rollup={null} onChanged={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: /delete budget software/i }),
    );
    expect(del).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("Delete this entry?");
  });
});

describe("budget hierarchy actions", () => {
  it("displays subtotals from the server per fiscal year and category", () => {
    const second = {
      fiscal_year: 2027,
      category: "capex",
      amount: "17.50",
      total_cost_items: "12.05",
      total_invoiced: "3.02",
      remaining_to_invoice: "9.03",
    };
    render(
      <PpmFinanceTree
        data={{ ...data, budget_subtotals: [...data.budget_subtotals, second] }}
        rollup={null}
        readOnly
        expandAll
        onChanged={vi.fn()}
      />,
    );
    const subtotal = screen.getByText(/2027/).closest("tr");
    expect(subtotal).not.toBeNull();
    expect(within(subtotal!).getByText(/17[.,]50/)).toBeInTheDocument();
    expect(within(subtotal!).getByText(/12[.,]05/)).toBeInTheDocument();
    expect(within(subtotal!).getByText(/9[.,]03/)).toBeInTheDocument();
  });

  it("keeps the dialog open and reports a failed delete, then refreshes after success", async () => {
    const { api } = await import("@/api/client");
    const del = vi
      .spyOn(api, "delete")
      .mockRejectedValueOnce(new Error("Deletion failed"))
      .mockResolvedValueOnce(undefined);
    const refresh = vi.fn();
    render(<PpmFinanceTree data={data} rollup={null} onChanged={refresh} />);
    fireEvent.click(
      screen.getByRole("button", { name: /delete budget software/i }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^delete$/i,
      }),
    );
    expect(await screen.findByText("Deletion failed")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^delete$/i,
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(del).toHaveBeenCalledWith("/ppm/budgets/aaaaaaaa-1");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("shows a budget prompt and no cost creation when none exist", () => {
    render(
      <PpmFinanceTree
        data={{ ...data, budget_lines: [], cost_items: [], invoices: [] }}
        rollup={null}
        onChanged={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/add a budget before creating/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add cost item to/i }),
    ).not.toBeInTheDocument();
  });

  it("disambiguates unnamed rows even when their short identifiers collide", () => {
    const first = {
      ...data.budget_lines[0],
      description: null,
      id: "aaaaaaaa-1111",
    };
    const second = { ...first, id: "aaaaaaaa-2222" };
    render(
      <PpmFinanceTree
        data={{ ...data, budget_lines: [first, second], cost_items: [] }}
        rollup={null}
        onChanged={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /expand FY 2026.*aaaaaaaa-1111/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /expand FY 2026.*aaaaaaaa-2222/i }),
    ).toBeInTheDocument();
  });
});

it("keeps expansion controls for a read-only viewer without editing actions", () => {
  render(
    <PpmFinanceTree data={data} rollup={null} readOnly onChanged={vi.fn()} />,
  );
  expect(screen.queryByText("Renewal")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /expand software/i }));
  expect(screen.getByText("Renewal")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /edit cost/i }),
  ).not.toBeInTheDocument();
});

it("expands the legacy group and offers an explicit assignment to a budget", () => {
  render(<PpmFinanceTree data={data} rollup={null} onChanged={vi.fn()} />);
  expect(screen.queryByText("Legacy")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: /expand costs without a budget/i }),
  );
  expect(screen.getByText("Legacy")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: /assign legacy to budget/i }),
  );
  expect(screen.getByTestId("row-form")).toHaveTextContent("cost:move:");
});

it("keeps year and category visible on named budgets and shows the initiative total first", () => {
  render(<PpmFinanceTree data={data} rollup={null} onChanged={vi.fn()} />);
  const budget = screen.getByText("Software").closest("tr");
  expect(within(budget!).getByText(/2026.*OPEX/)).toBeInTheDocument();
  const total = screen.getByText(/initiative total invoiced/i);
  const table = screen.getByRole("table");
  expect(
    total.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("shows the Cost Item's own category when it differs from its budget", () => {
  const capexCost = { ...data.cost_items[0], category: "capex" };
  render(
    <PpmFinanceTree
      data={{ ...data, cost_items: [capexCost] }}
      rollup={null}
      readOnly
      expandAll
      onChanged={vi.fn()}
    />,
  );
  const row = screen.getByText("Renewal").closest("tr");
  expect(within(row!).getByText("CAPEX")).toBeInTheDocument();
  const budget = screen.getByText("Software").closest("tr");
  expect(within(budget!).getByText(/OPEX/)).toBeInTheDocument();
});

it("labels budgets and subtotals with the configured fiscal year span", () => {
  invalidateFiscalYearStart(10);
  try {
    render(<PpmFinanceTree data={data} rollup={null} onChanged={vi.fn()} />);
    expect(screen.getAllByText(/FY 2025–2026.*OPEX/)).toHaveLength(2);
  } finally {
    resetFiscalYearStart();
  }
});
