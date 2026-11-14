/**
 * BudgetTable and CostTable — the two grouped tables of Budget & Costs, in the
 * tab's mode (year toggles, add / edit / delete) and in the Initiative
 * Report's (`readOnly`, `expandAll`). The tab's own behaviour around them —
 * which year opens first, a saved line's year opening — is pinned in
 * `PpmCostTab.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PpmBudgetLine, PpmCostLine } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import "@/i18n";
import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { resetFiscalYearStart } from "@/hooks/useFiscalYearStart";
import { groupBudgetLines, groupCostLines, type GroupKey } from "./costTableGroups";
import { BudgetTable, CostTable, type DerivedTable } from "./PpmCostTables";

function budget(overrides: Partial<PpmBudgetLine> & { id: string }): PpmBudgetLine {
  return {
    initiative_id: "i1",
    fiscal_year: 2026,
    category: "capex",
    description: null,
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

const LONG =
  "A very long description of the hardware refresh that would never fit in one table cell";

const BUDGETS = groupBudgetLines([
  budget({ id: "b1", fiscal_year: 2025, category: "capex", amount: 1000, description: "Servers" }),
  budget({ id: "b2", fiscal_year: 2026, category: "opex", amount: 400, description: LONG }),
  // A category the API may hold that is neither CapEx nor OpEx.
  budget({ id: "b3", fiscal_year: 2026, category: "other" as PpmBudgetLine["category"], amount: 50, description: null }),
]);

const COSTS = groupCostLines(
  [
    cost({ id: "c1", description: "Licences", category: "opex", actual: 300, date: "2026-03-15" }),
    cost({ id: "c2", description: LONG, category: "capex", actual: 250, date: null }),
  ],
  1,
);

const DERIVED: DerivedTable = {
  rows: [
    { key: 2025, capex: 100, opex: 20, total: 120 },
    { key: 2026, capex: 0, opex: 30, total: 30 },
  ],
  totals: { capex: 100, opex: 50, total: 150 },
};

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  resetFiscalYearStart();
  mockApi.on("get", "/settings/fiscal-year-start", { month: 1 });
});

const budgetTable = () => screen.getByTestId("ppm-budget-table");
const costTable = () => screen.getByTestId("ppm-cost-table");
const headerCells = (table: HTMLElement) => table.querySelectorAll("thead th");
const footerCells = (table: HTMLElement) => [...table.querySelectorAll("tfoot td")];
const bodyRows = (table: HTMLElement) => [...table.querySelectorAll("tbody tr")];
/** The year group row whose title reads `label`. */
const yearRow = (label: string) => screen.getByText(label).closest("tr") as HTMLElement;

describe("BudgetTable — the tab's mode", () => {
  it("shows a toggle per year, the open years' lines and an actions column", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn<(key: GroupKey) => void>();
    render(<BudgetTable groups={BUDGETS} expanded={new Set([2026])} onToggle={onToggle} />);

    expect(headerCells(budgetTable())).toHaveLength(5);
    const fy25 = screen.getByRole("button", { name: "Show or hide the lines: FY 2025" });
    const fy26 = screen.getByRole("button", { name: "Show or hide the lines: FY 2026" });
    expect(fy25).toHaveAttribute("aria-expanded", "false");
    expect(fy26).toHaveAttribute("aria-expanded", "true");
    // Only FY 2026's lines are open.
    expect(screen.queryByText("Servers")).not.toBeInTheDocument();
    expect(screen.getByText(LONG)).toBeInTheDocument();

    await user.click(fy25);
    expect(onToggle).toHaveBeenCalledWith(2025);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("subtotals each year and totals all years in the footer", () => {
    render(<BudgetTable groups={BUDGETS} />);
    const fy26 = within(yearRow("FY 2026")).getAllByRole("cell");
    expect(fy26[0]).toHaveTextContent(/FY 20262 lines$/);
    expect(fy26.slice(1).map((c) => c.textContent)).toEqual(["$0", "$400", "$450", "add"]);
    expect(yearRow("FY 2025")).toHaveTextContent("1 line");
    expect(footerCells(budgetTable()).map((c) => c.textContent)).toEqual([
      "Total, all fiscal years",
      "$1000",
      "$400",
      "$1450",
      "",
    ]);
    expect(footerCells(budgetTable())[1]).not.toHaveStyle({ fontStyle: "italic" });
  });

  it("opens nothing when no expanded set is given", () => {
    render(<BudgetTable groups={BUDGETS} />);
    expect(screen.queryByText("Servers")).not.toBeInTheDocument();
    expect(screen.queryByText(LONG)).not.toBeInTheDocument();
  });

  it("clips a long description to one line with the whole text in its tooltip", () => {
    render(<BudgetTable groups={BUDGETS} expanded={new Set([2026])} />);
    const text = screen.getByText(LONG);
    expect(text).toHaveClass("MuiTypography-noWrap");
    expect(text).toHaveAttribute("title", LONG);
    expect(text.closest("td")).toHaveStyle({ maxWidth: "240px" });
    // A line with no description has an empty tooltip, not "null".
    expect(text.closest("tbody")!.querySelector('[title=""]')).not.toBeNull();
  });

  it("puts each amount under its category, and an other-category one under Total", () => {
    render(<BudgetTable groups={BUDGETS} expanded={new Set([2025, 2026])} />);
    const cells = (desc: string) =>
      [...(screen.getByText(desc).closest("tr") as HTMLElement).querySelectorAll("td")]
        .slice(1, 4)
        .map((c) => c.textContent);
    expect(cells("Servers")).toEqual(["$1000", "", ""]);
    expect(cells(LONG)).toEqual(["", "$400", ""]);
    const other = bodyRows(budgetTable()).find((r) => r.textContent?.includes("$50") && !r.textContent.includes("FY"));
    expect([...other!.querySelectorAll("td")].slice(1, 4).map((c) => c.textContent)).toEqual([
      "",
      "",
      "$50",
    ]);
  });

  it("adds to a year, and edits and deletes a line, through its callbacks", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <BudgetTable
        groups={BUDGETS}
        expanded={new Set([2025])}
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add a budget line for FY 2025" }));
    expect(onAdd).toHaveBeenCalledWith(2025);
    const row = screen.getByText("Servers").closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(BUDGETS[0].lines[0]);
    await user.click(within(row).getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("b1");
  });

  it("says there are no lines, across every column, when there are none", () => {
    render(<BudgetTable groups={[]} />);
    const cell = screen.getByText("No budget lines yet").closest("td");
    expect(cell).toHaveAttribute("colspan", "5");
    expect(budgetTable().querySelector("tfoot")).toBeNull();
  });

  it("shows progress and dashes, never $0, until the lines are known", () => {
    render(<BudgetTable groups={[]} known={false} loading />);
    const progress = screen.getByRole("progressbar");
    expect(progress.closest("td")).toHaveAttribute("colspan", "5");
    expect(screen.queryByText("No budget lines yet")).not.toBeInTheDocument();
    expect(footerCells(budgetTable()).map((c) => c.textContent)).toEqual([
      "Total, all fiscal years",
      "—",
      "—",
      "—",
      "",
    ]);
  });

  it("shows no progress once loading stopped, though the lines are still unknown", () => {
    render(<BudgetTable groups={[]} known={false} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("No budget lines yet")).not.toBeInTheDocument();
  });

  it("shows no progress while reloading lines it already knows", () => {
    render(<BudgetTable groups={BUDGETS} loading />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows the derived years under their caption, in italic, with their total", () => {
    render(<BudgetTable groups={[]} derived={DERIVED} derivedCount={3} />);
    const caption = screen.getByText(
      "No budget lines of its own: the budget of the 3 initiatives beneath it, by fiscal year",
    );
    expect(caption.closest("td")).toHaveAttribute("colspan", "5");
    expect(caption.closest("tr")).toHaveAttribute("data-derived", "budget");
    const rows = [...budgetTable().querySelectorAll("[data-derived-row='budget']")];
    expect(rows.map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent))).toEqual([
      ["FY 2025", "$100", "$20", "$120", ""],
      ["FY 2026", "$0", "$30", "$30", ""],
    ]);
    expect(rows[0].querySelectorAll("td")[1]).toHaveStyle({ fontStyle: "italic" });
    expect(rows[0].querySelector("td")).toHaveAttribute("colspan", "1");
    expect(screen.queryByText("No budget lines yet")).not.toBeInTheDocument();
    const footer = footerCells(budgetTable());
    expect(footer.map((c) => c.textContent)).toEqual([
      "Total, all fiscal years",
      "$100",
      "$50",
      "$150",
      "",
    ]);
    expect(footer[3]).toHaveStyle({ fontStyle: "italic" });
    expect(footer[0]).not.toHaveStyle({ fontStyle: "italic" });
  });
});

describe("BudgetTable — read-only and fully expanded", () => {
  it("has no button at all, no actions column, every year open and every description whole", () => {
    render(<BudgetTable groups={BUDGETS} readOnly expandAll />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(headerCells(budgetTable())).toHaveLength(4);
    expect(screen.getByText("Servers")).toBeInTheDocument();
    const text = screen.getByText(LONG);
    expect(text).not.toHaveClass("MuiTypography-noWrap");
    expect(text).not.toHaveAttribute("title");
    expect(text).toHaveStyle({ whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
    expect(text.closest("td")).not.toHaveStyle({ maxWidth: "240px" });
    // Every row is four cells wide: no trailing actions cell anywhere.
    for (const row of [...bodyRows(budgetTable()), ...budgetTable().querySelectorAll("tfoot tr")]) {
      expect(row.querySelectorAll("td")).toHaveLength(4);
    }
    expect(footerCells(budgetTable()).map((c) => c.textContent)).toEqual([
      "Total, all fiscal years",
      "$1000",
      "$400",
      "$1450",
    ]);
  });

  it("marks each year row, and only those, for print to keep with its first line", () => {
    render(<BudgetTable groups={BUDGETS} readOnly expandAll />);
    const marked = bodyRows(budgetTable()).filter((r) => r.hasAttribute("data-year-row"));
    expect(marked.length).toBe(BUDGETS.length);
    expect(screen.getByText("Servers").closest("tr")).not.toHaveAttribute("data-year-row");
  });

  it("spans the empty and loading rows across four columns", () => {
    const { rerender } = render(<BudgetTable groups={[]} readOnly />);
    expect(screen.getByText("No budget lines yet").closest("td")).toHaveAttribute("colspan", "4");
    rerender(<BudgetTable groups={[]} readOnly known={false} loading />);
    expect(screen.getByRole("progressbar").closest("td")).toHaveAttribute("colspan", "4");
  });

  it("spans the derived caption across four columns, with no trailing cells", () => {
    render(<BudgetTable groups={[]} derived={DERIVED} derivedCount={1} readOnly />);
    const caption = screen.getByText(
      "No budget lines of its own: the budget of the 1 initiative beneath it, by fiscal year",
    );
    expect(caption.closest("td")).toHaveAttribute("colspan", "4");
    for (const row of budgetTable().querySelectorAll("[data-derived-row='budget']")) {
      expect(row.querySelectorAll("td")).toHaveLength(4);
    }
  });

  it("keeps the year toggles when read-only but not expanded", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<BudgetTable groups={BUDGETS} readOnly expanded={new Set()} onToggle={onToggle} />);
    const toggles = screen.getAllByRole("button");
    expect(toggles).toHaveLength(2);
    await user.click(toggles[1]);
    expect(onToggle).toHaveBeenCalledWith(2026);
    expect(screen.queryByText("Servers")).not.toBeInTheDocument();
  });

  it("opens every year without toggles when expanded but editable", () => {
    render(<BudgetTable groups={BUDGETS} expandAll expanded={new Set()} />);
    expect(screen.queryByRole("button", { name: /Show or hide/ })).not.toBeInTheDocument();
    expect(screen.getByText("Servers")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(3);
  });

  it("tolerates a click on a toggle that has no handler", async () => {
    const user = userEvent.setup();
    render(<BudgetTable groups={BUDGETS} expanded={new Set([2025])} />);
    await user.click(screen.getByRole("button", { name: "Show or hide the lines: FY 2025" }));
    await user.click(screen.getByRole("button", { name: "Add a budget line for FY 2025" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Servers")).toBeInTheDocument();
  });
});

describe("CostTable — the tab's mode", () => {
  it("groups by fiscal year with an undated group last, a toggle each and an actions column", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<CostTable groups={COSTS} expanded={new Set(["undated"])} onToggle={onToggle} />);
    expect(headerCells(costTable())).toHaveLength(6);
    const titles = [...costTable().querySelectorAll("tbody tr td[colspan='2'] p")].map(
      (p) => p.textContent,
    );
    expect(titles).toEqual(["FY 2026", "Undated"]);
    expect(screen.queryByText("Licences")).not.toBeInTheDocument();
    // An undated line shows a dash for its date.
    const undatedLine = screen.getByText(LONG).closest("tr") as HTMLElement;
    expect(undatedLine.querySelectorAll("td")[1]).toHaveTextContent("—");
    await user.click(screen.getByRole("button", { name: "Show or hide the lines: Undated" }));
    expect(onToggle).toHaveBeenCalledWith("undated");
  });

  it("shows a dated line's date, its amounts and a trailing actions cell on each row", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <CostTable
        groups={COSTS}
        expanded={new Set([2026])}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
    const row = screen.getByText("Licences").closest("tr") as HTMLElement;
    expect([...row.querySelectorAll("td")].slice(1, 5).map((c) => c.textContent)).toEqual([
      "2026-03-15",
      "",
      "$300",
      "",
    ]);
    // The year rows carry an empty trailing cell under the actions column.
    expect(yearRow("FY 2026").querySelectorAll("td")).toHaveLength(5);
    await user.click(within(row).getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(COSTS[0].lines[0]);
    await user.click(within(row).getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("c1");
    expect(footerCells(costTable()).map((c) => c.textContent)).toEqual([
      "Total, all fiscal years",
      "$250",
      "$300",
      "$550",
      "",
    ]);
    expect(footerCells(costTable())[0]).toHaveAttribute("colspan", "2");
  });

  it("says there are no cost items across every column, with no footer", () => {
    render(<CostTable groups={[]} />);
    expect(screen.getByText("No cost items yet").closest("td")).toHaveAttribute("colspan", "6");
    expect(costTable().querySelector("tfoot")).toBeNull();
  });

  it("shows derived years under a caption six columns wide, and their italic total", () => {
    render(<CostTable groups={[]} derived={DERIVED} derivedCount={2} />);
    const caption = screen.getByText(
      "No cost lines of its own: the actuals of the 2 initiatives beneath it, by fiscal year",
    );
    expect(caption.closest("td")).toHaveAttribute("colspan", "6");
    expect(caption.closest("tr")).toHaveAttribute("data-derived", "cost");
    const row = costTable().querySelector("[data-derived-row='cost']") as HTMLElement;
    expect(row.querySelector("td")).toHaveAttribute("colspan", "2");
    expect(row.querySelectorAll("td")).toHaveLength(5);
    expect(screen.queryByText("No cost items yet")).not.toBeInTheDocument();
    const footer = footerCells(costTable());
    expect(footer.map((c) => c.textContent)).toEqual([
      "Total, all fiscal years",
      "$100",
      "$50",
      "$150",
      "",
    ]);
    expect(footer[1]).toHaveStyle({ fontStyle: "italic" });
  });

  it("names a fiscal year by its span when the year does not start in January", async () => {
    resetFiscalYearStart();
    mockApi.on("get", "/settings/fiscal-year-start", { month: 4 });
    render(<CostTable groups={groupCostLines(COSTS[0].lines, 4)} readOnly expandAll />);
    await waitFor(() => expect(costTable()).toHaveTextContent("FY 2025\u20132026"));
  });
});

describe("CostTable — handlers left out", () => {
  it("tolerates a click on edit or delete when no handler is given", async () => {
    const user = userEvent.setup();
    // React reports a handler that throws on the window; catch it so the test names it.
    const thrown: unknown[] = [];
    const onError = (e: ErrorEvent) => {
      thrown.push(e.error);
      e.preventDefault();
    };
    window.addEventListener("error", onError);
    try {
      render(<CostTable groups={COSTS} expanded={new Set([2026])} />);
      const row = screen.getByText("Licences").closest("tr") as HTMLElement;
      await user.click(within(row).getByRole("button", { name: "Edit" }));
      await user.click(within(row).getByRole("button", { name: "Delete" }));
    } finally {
      window.removeEventListener("error", onError);
    }
    expect(thrown).toEqual([]);
    expect(screen.getByText("Licences")).toBeInTheDocument();
  });
});

describe("CostTable — read-only and fully expanded", () => {
  it("has no button, no actions column, every group open and every description whole", () => {
    render(<CostTable groups={COSTS} readOnly expandAll />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(headerCells(costTable())).toHaveLength(5);
    expect(screen.getByText("Licences")).toBeInTheDocument();
    const text = screen.getByText(LONG);
    expect(text).not.toHaveAttribute("title");
    expect(text).not.toHaveClass("MuiTypography-noWrap");
    expect(yearRow("FY 2026").querySelectorAll("td")).toHaveLength(4);
    for (const row of bodyRows(costTable()).filter((r) => !r.querySelector("[colspan='2']"))) {
      expect(row.querySelectorAll("td")).toHaveLength(5);
    }
    expect(footerCells(costTable())).toHaveLength(4);
  });

  it("marks each year row, and only those, for print to keep with its first line", () => {
    render(<CostTable groups={COSTS} readOnly expandAll />);
    const marked = bodyRows(costTable()).filter((r) => r.hasAttribute("data-year-row"));
    expect(marked.length).toBe(COSTS.length);
    expect(yearRow("FY 2026")).toHaveAttribute("data-year-row");
    expect(screen.getByText("Licences").closest("tr")).not.toHaveAttribute("data-year-row");
  });

  it("spans the empty row and the derived caption across five columns", () => {
    const { rerender } = render(<CostTable groups={[]} readOnly />);
    expect(screen.getByText("No cost items yet").closest("td")).toHaveAttribute("colspan", "5");
    rerender(<CostTable groups={[]} readOnly derived={DERIVED} derivedCount={2} />);
    expect(
      screen.getByText(/the actuals of the 2 initiatives beneath it/).closest("td"),
    ).toHaveAttribute("colspan", "5");
    const row = costTable().querySelector("[data-derived-row='cost']") as HTMLElement;
    expect(row.querySelectorAll("td")).toHaveLength(4);
  });
});
