/**
 * PpmCostTab — the Budget & Costs tab of an initiative.
 *
 * The charts are stubbed (they have their own test); what is pinned here is
 * the summary bar's arithmetic, the two tables, and exactly what the budget
 * and cost dialogs send to `/ppm/initiatives/{id}/budgets|costs`,
 * `/ppm/budgets/{id}` and `/ppm/costs/{id}`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PpmBudgetLine, PpmCostLine } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/features/ppm/PpmCostCharts", () => ({
  default: ({ costLines, budgetLines }: { costLines: unknown[]; budgetLines: unknown[] }) => (
    <div data-testid="cost-charts">
      {costLines.length} costs / {budgetLines.length} budgets
    </div>
  ),
}));

import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { todayIsoDate } from "@/lib/dates";
import { resetFiscalYearStart } from "@/hooks/useFiscalYearStart";
import i18n from "@/i18n";
import PpmCostTab from "./PpmCostTab";

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

const BUDGETS: PpmBudgetLine[] = [
  budget({ id: "b1", fiscal_year: 2025, category: "capex", amount: 1000 }),
  budget({ id: "b2", fiscal_year: 2026, category: "opex", amount: 400 }),
];

const COSTS: PpmCostLine[] = [
  cost({ id: "c1", description: "Licences — see https://vendor.example.com", category: "opex", actual: 300, date: "2026-03-15" }),
  cost({ id: "c2", description: "Servers", category: "capex", actual: 250, date: null }),
];

const budgetPath = "/ppm/initiatives/i1/budgets";
const costPath = "/ppm/initiatives/i1/costs";

function renderTab(costLines: PpmCostLine[] = COSTS) {
  const onRefresh = vi.fn();
  const user = userEvent.setup();
  const tab = (lines: PpmCostLine[]) => (
    <PpmCostTab initiativeId="i1" costLines={lines} onRefresh={onRefresh} />
  );
  const { rerender } = render(tab(costLines));
  /** What the parent does after `onRefresh`: hand the tab its reloaded cost lines. */
  const setCostLines = (lines: PpmCostLine[]) => rerender(tab(lines));
  return { user, onRefresh, setCostLines };
}

/** The value printed under a summary-bar caption. */
const kpi = (caption: string) =>
  (screen.getByText(caption, { selector: ".MuiTypography-caption" }).nextElementSibling as HTMLElement)
    .textContent;

/** The table row holding `text`. */
const rowOf = (text: string) => screen.getByText(text).closest("tr") as HTMLElement;

/** The budget and cost tables. */
const budgetTable = () => screen.getByTestId("ppm-budget-table");
const costTable = () => screen.getByTestId("ppm-cost-table");

/** A year group's show/hide toggle in `table`. */
const toggleOf = (table: HTMLElement, label: string) =>
  within(table).getByRole("button", { name: `Show or hide the lines: ${label}` });

/** Open a closed year group in `table`, or close an open one. */
async function toggleGroup(user: ReturnType<typeof userEvent.setup>, table: HTMLElement, label: string) {
  await user.click(toggleOf(table, label));
}

/** The header row of a year group in `table`. */
const groupRow = (table: HTMLElement, label: string) =>
  toggleOf(table, label).closest("tr") as HTMLElement;

/** The line row in `table` showing `amount` (a year header or the totals row never matches). */
const lineRow = (table: HTMLElement, amount: string) => {
  const row = within(table)
    .queryAllByRole("button", { name: "Edit" })
    .map((button) => button.closest("tr") as HTMLElement)
    .find((tr) => within(tr).queryByText(amount));
  if (!row) throw new Error(`no line row showing ${amount}`);
  return row;
};

/** The line rows currently rendered in `table`. */
const lineRows = (table: HTMLElement) => within(table).queryAllByRole("button", { name: "Edit" });

/** Each cell's text, in order. */
const cellTexts = (row: HTMLElement) =>
  Array.from(row.querySelectorAll("td")).map((td) => td.textContent);

/** The all-years totals row of `table`. */
const footerRow = (table: HTMLElement) =>
  within(table).getByText("Total, all fiscal years").closest("tr") as HTMLElement;

/** Wait for `text` to render, then hand it back (for `rowOf`). */
const textOf = async (text: string) => (await screen.findByText(text)).textContent ?? "";

/** Pick an option in the dialog's Category select. */
async function pickCategory(user: ReturnType<typeof userEvent.setup>, label: "CapEx" | "OpEx") {
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("combobox", { name: "Category" }));
  await user.click(await screen.findByRole("option", { name: label }));
}

beforeEach(() => {
  // Only `Date` is faked: timers stay real so user-event and findBy* still run.
  // Mid-June 2026 makes FY 2026 the current fiscal year, the one a table opens on.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 5, 15));
  mockApi.reset();
  hookState.reset();
  resetFiscalYearStart();
  mockApi.on("get", "/settings/fiscal-year-start", { month: 1 });
  mockApi.on("get", budgetPath, BUDGETS);
  mockApi.on("post", budgetPath, {});
  mockApi.on("patch", /^\/ppm\/budgets\//, {});
  mockApi.on("delete", /^\/ppm\/budgets\//, null);
  mockApi.on("post", costPath, {});
  mockApi.on("patch", /^\/ppm\/costs\//, {});
  mockApi.on("delete", /^\/ppm\/costs\//, null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PpmCostTab — summary and tables", () => {
  it("totals the budget lines it loads against the cost lines it is given", async () => {
    renderTab();
    await screen.findByText("FY 2025");
    expect(kpi("Total Budget")).toBe("$1400");
    expect(kpi("Total Actual")).toBe("$550");
    expect(kpi("Variance")).toBe("$850");
    expect(kpi("CapEx")).toBe("$250 / $1000");
    expect(kpi("OpEx")).toBe("$300 / $400");
  });

  it("flags an overspend as a negative variance", async () => {
    renderTab([cost({ id: "c9", actual: 5000, category: "capex" })]);
    await screen.findByText("FY 2025");
    expect(kpi("Variance")).toBe("$-3600");
  });

  it("colours the variance red only when actuals exceed the budget", async () => {
    /** The variance figure; the budget lines total $1400. */
    const varianceFor = async (actual: number) => {
      const { unmount } = render(
        <PpmCostTab initiativeId="i1" costLines={[cost({ id: "v", actual })]} onRefresh={vi.fn()} />,
      );
      await screen.findByText("FY 2025");
      const el = screen.getByText("Variance", { selector: ".MuiTypography-caption" })
        .nextElementSibling as HTMLElement;
      const color = getComputedStyle(el).color;
      unmount();
      return color;
    };
    const red = "rgb(211, 47, 47)"; // palette.error.main
    const green = "rgb(46, 125, 50)"; // palette.success.main
    expect(await varianceFor(5000)).toBe(red);
    expect(await varianceFor(1400)).toBe(green);
    expect(await varianceFor(100)).toBe(green);
  });

  it("lists each budget line's amount under its category's column", async () => {
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await toggleGroup(user, budgetTable(), "FY 2025");
    expect(cellTexts(lineRow(budgetTable(), "$1000")).slice(1, 4)).toEqual(["$1000", "", ""]);
    expect(cellTexts(lineRow(budgetTable(), "$400")).slice(1, 4)).toEqual(["", "$400", ""]);
  });

  it("lists cost items with a linkified description, a formatted date and a dash when undated", async () => {
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    const licences = screen.getByRole("link", { name: "https://vendor.example.com" }).closest("tr") as HTMLElement;
    expect(within(licences).getByText("2026-03-15")).toBeInTheDocument();
    expect(within(licences).getByText("$300")).toBeInTheDocument();
    await toggleGroup(user, costTable(), "Undated");
    expect(within(rowOf("Servers")).getByText("—")).toBeInTheDocument();
  });

  it("hands both line sets to the charts", async () => {
    renderTab();
    // The charts wait for the budget lines: their first render already has both.
    expect(await screen.findByTestId("cost-charts")).toHaveTextContent("2 costs / 2 budgets");
  });

  it("shows both empty states", async () => {
    mockApi.on("get", budgetPath, []);
    renderTab([]);
    expect(await screen.findByText("No budget lines yet")).toBeInTheDocument();
    expect(screen.getByText("No budget lines yet").closest("td")).toHaveAttribute("colspan", "5");
    expect(screen.getByText("No cost items yet").closest("td")).toHaveAttribute("colspan", "6");
    expect(kpi("Total Budget")).toBe("$0");
    // No lines, no totals row.
    expect(screen.queryByText("Total, all fiscal years")).not.toBeInTheDocument();
  });
});

describe("PpmCostTab — budget lines", () => {
  it("adds a budget line with the year, category and amount entered", async () => {
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(screen.getByRole("button", { name: /Add Budget Line/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Add Budget Line")).toBeInTheDocument();
    const year = within(dialog).getByRole("spinbutton", { name: "Fiscal Year" });
    expect(year).toHaveValue(2026);
    fireEvent.change(year, { target: { value: "2027" } });
    await pickCategory(user, "OpEx");
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "Amount" }), {
      target: { value: "750" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("post", budgetPath)).toHaveLength(1));
    expect(mockApi.callsOf("post", budgetPath)[0].body).toEqual({
      fiscal_year: 2027,
      category: "opex",
      description: null,
      amount: 750,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The list is reloaded after the write.
    expect(mockApi.callsOf("get", budgetPath)).toHaveLength(2);
  });

  it("edits a budget line with its own values pre-filled", async () => {
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await toggleGroup(user, budgetTable(), "FY 2025");
    await user.click(within(lineRow(budgetTable(), "$1000")).getByRole("button", { name: "Edit" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Edit Budget Line")).toBeInTheDocument();
    expect(within(dialog).getByRole("spinbutton", { name: "Fiscal Year" })).toHaveValue(2025);
    const amount = within(dialog).getByRole("spinbutton", { name: "Amount" });
    expect(amount).toHaveValue(1000);
    // A non-numeric amount falls back to zero rather than NaN.
    fireEvent.change(amount, { target: { value: "" } });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("patch", "/ppm/budgets/b1")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/ppm/budgets/b1")[0].body).toEqual({
      fiscal_year: 2025,
      category: "capex",
      description: null,
      amount: 0,
    });
  });

  it("sends the description typed into the budget dialog, trimmed", async () => {
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(screen.getByRole("button", { name: /Add Budget Line/ }));

    const dialog = screen.getByRole("dialog");
    const description = within(dialog).getByRole("textbox", { name: "Description" });
    expect(description).toHaveValue("");
    await user.type(description, "  SAP licences ");
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "Amount" }), {
      target: { value: "450" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("post", budgetPath)).toHaveLength(1));
    expect(mockApi.callsOf("post", budgetPath)[0].body).toEqual({
      fiscal_year: 2026,
      category: "capex",
      description: "SAP licences",
      amount: 450,
    });
  });

  it("pre-fills a budget line's description on edit, and sends a cleared one as null", async () => {
    mockApi.on("get", budgetPath, [
      budget({ id: "b7", fiscal_year: 2025, amount: 300, description: "Partner" }),
    ]);
    const { user } = renderTab();
    await user.click(within(rowOf(await textOf("Partner"))).getByRole("button", { name: "Edit" }));

    const dialog = screen.getByRole("dialog");
    const description = within(dialog).getByRole("textbox", { name: "Description" });
    expect(description).toHaveValue("Partner");
    await user.clear(description);
    await user.type(description, "   ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("patch", "/ppm/budgets/b7")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/ppm/budgets/b7")[0].body).toEqual({
      fiscal_year: 2025,
      category: "capex",
      description: null,
      amount: 300,
    });
  });

  it("shows a budget line's description in its row, with links linkified", async () => {
    mockApi.on("get", budgetPath, [
      budget({ id: "b8", fiscal_year: 2025, amount: 100, description: "Quote https://partner.example.com" }),
      budget({ id: "b9", fiscal_year: 2026, amount: 50 }),
    ]);
    const { user } = renderTab([]);
    await screen.findByText("FY 2025");
    await toggleGroup(user, budgetTable(), "FY 2025");
    const link = await screen.findByRole("link", { name: "https://partner.example.com" });
    const row = link.closest("tr") as HTMLElement;
    expect(cellTexts(row)[1]).toBe("$100");
    expect(within(row).getByText(/^Quote/).closest("[title]")).toHaveAttribute(
      "title",
      "Quote https://partner.example.com",
    );
    // A line without a description renders an empty cell, with nothing in its tooltip either.
    const bareCell = lineRow(budgetTable(), "$50").querySelectorAll("td")[0] as HTMLElement;
    expect(bareCell.textContent).toBe("");
    expect(bareCell.querySelector("[title]")).toHaveAttribute("title", "");
  });

  it("lists several lines on the same fiscal year and category as separate rows, and sums them", async () => {
    mockApi.on("get", budgetPath, [
      budget({ id: "b1", fiscal_year: 2026, category: "capex", amount: 450, description: "Licences" }),
      budget({ id: "b2", fiscal_year: 2026, category: "capex", amount: 250, description: "Partner" }),
    ]);
    renderTab([]);
    await screen.findByText("Licences");
    // One year, one header over both lines.
    expect(within(budgetTable()).getAllByText("FY 2026")).toHaveLength(1);
    expect(within(groupRow(budgetTable(), "FY 2026")).getByText("2 lines")).toBeInTheDocument();
    expect(within(rowOf("Licences")).getByText("$450")).toBeInTheDocument();
    expect(within(rowOf("Partner")).getByText("$250")).toBeInTheDocument();
    expect(kpi("Total Budget")).toBe("$700");
    expect(kpi("CapEx")).toBe("$0 / $700");
  });

  it("deletes a budget line and reloads the list", async () => {
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(within(lineRow(budgetTable(), "$400")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mockApi.callsOf("delete", "/ppm/budgets/b2")).toHaveLength(1));
    await waitFor(() => expect(mockApi.callsOf("get", budgetPath)).toHaveLength(2));
  });

  it("cancels the budget dialog without writing", async () => {
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(screen.getByRole("button", { name: /Add Budget Line/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });
});

describe("PpmCostTab — cost items", () => {
  it("adds a cost item dated today by default and refreshes the parent", async () => {
    const { user, onRefresh } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(screen.getByRole("button", { name: /Add Cost Item/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Date")).toHaveValue(todayIsoDate());
    await user.type(within(dialog).getByRole("textbox", { name: "Description" }), "Consulting");
    await pickCategory(user, "OpEx");
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "Amount" }), {
      target: { value: "120" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("post", costPath)).toHaveLength(1));
    expect(mockApi.callsOf("post", costPath)[0].body).toEqual({
      description: "Consulting",
      category: "opex",
      actual: 120,
      date: todayIsoDate(),
    });
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("edits a cost item, sending a cleared date as null", async () => {
    const { user, onRefresh } = renderTab();
    await screen.findByText("FY 2025");
    await toggleGroup(user, costTable(), "Undated");
    await user.click(within(rowOf("Servers")).getByRole("button", { name: "Edit" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Edit Cost Item")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Description" })).toHaveValue("Servers");
    expect(within(dialog).getByLabelText("Date")).toHaveValue("");
    const amount = within(dialog).getByRole("spinbutton", { name: "Amount" });
    expect(amount).toHaveValue(250);
    fireEvent.change(amount, { target: { value: "275" } });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("patch", "/ppm/costs/c2")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/ppm/costs/c2")[0].body).toEqual({
      description: "Servers",
      category: "capex",
      actual: 275,
      date: null,
    });
    expect(onRefresh).toHaveBeenCalled();
  });

  it("commits a date picked in the dialog", async () => {
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await toggleGroup(user, costTable(), "Undated");
    await user.click(within(rowOf("Servers")).getByRole("button", { name: "Edit" }));
    const date = within(screen.getByRole("dialog")).getByLabelText("Date");
    fireEvent.focus(date);
    fireEvent.change(date, { target: { value: "2026-06-30" } });
    fireEvent.blur(date);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/ppm/costs/c2")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/ppm/costs/c2")[0].body).toMatchObject({ date: "2026-06-30" });
  });

  it("deletes a cost item and refreshes the parent", async () => {
    const { user, onRefresh } = renderTab();
    await screen.findByText("FY 2025");
    await toggleGroup(user, costTable(), "Undated");
    await user.click(within(rowOf("Servers")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mockApi.callsOf("delete", "/ppm/costs/c2")).toHaveLength(1));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it("cancels the cost dialog without writing", async () => {
    const { user, onRefresh } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(screen.getByRole("button", { name: /Add Cost Item/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe("PpmCostTab — labels and empty states", () => {
  it("names both sections and every column", async () => {
    renderTab();
    await screen.findByText("FY 2025");
    expect(screen.getByText("Planned Budget")).toBeInTheDocument();
    expect(screen.getByText("Cost Items")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Description",
      "CapEx",
      "OpEx",
      "Total",
      "",
      "Description",
      "Date",
      "CapEx",
      "OpEx",
      "Total",
      "",
    ]);
  });

  it("drops both empty states once there are lines to show", async () => {
    renderTab();
    await screen.findByText("FY 2025");
    expect(screen.queryByText("No budget lines yet")).not.toBeInTheDocument();
    expect(screen.queryByText("No cost items yet")).not.toBeInTheDocument();
  });

  it("shows the budget lines loading, not an empty budget or a $0 total", () => {
    // The GET never settles: what shows is the state before any data lands.
    mockApi.on("get", budgetPath, () => new Promise(() => {}));
    renderTab();
    expect(screen.queryByText("No budget lines yet")).not.toBeInTheDocument();
    expect(within(budgetTable()).getByRole("progressbar")).toBeInTheDocument();
    // The all-years row waits for the budget lines too.
    expect(cellTexts(footerRow(budgetTable()))).toEqual(["Total, all fiscal years", "—", "—", "—", ""]);
    // Every figure that needs the budget waits for it; the actuals are known.
    expect(kpi("Total Budget")).toBe("—");
    expect(kpi("Variance")).toBe("—");
    expect(kpi("Total Actual")).toBe("$550");
    expect(kpi("CapEx")).toBe("$250 / —");
    expect(kpi("OpEx")).toBe("$300 / —");
    // An unknown variance is neither an overspend nor within budget.
    const variance = screen.getByText("Variance", { selector: ".MuiTypography-caption" })
      .nextElementSibling as HTMLElement;
    expect(getComputedStyle(variance).color).not.toBe("rgb(211, 47, 47)"); // palette.error.main
    expect(getComputedStyle(variance).color).not.toBe("rgb(46, 125, 50)"); // palette.success.main
  });

  it("pads the budget loading row like the empty-state row it stands in for", () => {
    mockApi.on("get", budgetPath, () => new Promise(() => {}));
    renderTab();
    const cell = within(budgetTable()).getByRole("progressbar").closest("td") as HTMLElement;
    expect(cell).toHaveAttribute("colspan", "5");
  });

  it("drops the loading row once the budget lines have arrived", async () => {
    renderTab();
    await screen.findByText("FY 2025");
    expect(within(budgetTable()).queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("keeps the lines and totals on screen while it reloads them after a save", async () => {
    const reload = deferred<PpmBudgetLine[]>();
    let gets = 0;
    mockApi.on("get", budgetPath, () => (++gets === 1 ? BUDGETS : reload.promise));
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(screen.getByRole("button", { name: /Add Budget Line/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(gets).toBe(2));
    expect(screen.getByText("FY 2025")).toBeInTheDocument();
    expect(kpi("Total Budget")).toBe("$1400");
    expect(within(budgetTable()).queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("puts each cost item's amount under its category's column", async () => {
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await toggleGroup(user, costTable(), "Undated");
    expect(cellTexts(rowOf("Servers")).slice(1, 5)).toEqual(["—", "$250", "", ""]);
    const licences = screen.getByRole("link", { name: "https://vendor.example.com" }).closest("tr") as HTMLElement;
    expect(cellTexts(licences).slice(1, 5)).toEqual(["2026-03-15", "", "$300", ""]);
  });
});

describe("PpmCostTab — dialogs", () => {
  it("opens a fresh budget form after an edit was cancelled", async () => {
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(within(lineRow(budgetTable(), "$400")).getByRole("button", { name: "Edit" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Add Budget Line/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("spinbutton", { name: "Fiscal Year" })).toHaveValue(
      2026,
    );
    expect(within(dialog).getByRole("combobox", { name: "Category" })).toHaveTextContent("CapEx");
    expect(within(dialog).getByRole("spinbutton", { name: "Amount" })).toHaveValue(null);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("post", budgetPath)).toHaveLength(1));
    expect(mockApi.callsOf("post", budgetPath)[0].body).toEqual({
      fiscal_year: 2026,
      category: "capex",
      description: null,
      amount: 0,
    });
  });

  it("pre-fills a dated cost item, then opens a fresh form for the next one", async () => {
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    const licences = screen.getByRole("link", { name: "https://vendor.example.com" }).closest("tr") as HTMLElement;
    await user.click(within(licences).getByRole("button", { name: "Edit" }));
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Date")).toHaveValue("2026-03-15");
    expect(within(dialog).getByRole("combobox", { name: "Category" })).toHaveTextContent("OpEx");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Add Cost Item/ }));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Add Cost Item")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Description" })).toHaveValue("");
    expect(within(dialog).getByRole("combobox", { name: "Category" })).toHaveTextContent("CapEx");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("post", costPath)).toHaveLength(1));
    expect(mockApi.callsOf("post", costPath)[0].body).toEqual({
      description: "",
      category: "capex",
      actual: 0,
      date: todayIsoDate(),
    });
  });

  it("labels the category picker in both dialogs and offers both categories", async () => {
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    for (const add of [/Add Budget Line/, /Add Cost Item/]) {
      await user.click(screen.getByRole("button", { name: add }));
      const dialog = screen.getByRole("dialog");
      // The floating label, and the same text sizing the outline's notch.
      expect(within(dialog).getByText("Category", { selector: "label" })).toBeInTheDocument();
      expect(within(dialog).getByText("Category", { selector: "legend span" })).toBeInTheDocument();
      await user.click(within(dialog).getByRole("combobox", { name: "Category" }));
      const options = await screen.findAllByRole("option");
      expect(options.map((o) => o.textContent)).toEqual(["CapEx", "OpEx"]);
      await user.click(options[0]);
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }
  });

  it("closes either dialog on Escape without writing", async () => {
    const { user, onRefresh } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(screen.getByRole("button", { name: /Add Budget Line/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Add Cost Item/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("translates the dialog buttons through the shared common keys", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    try {
      const { user } = renderTab();
      // The year headers are named in the user's language too.
      await screen.findByText("GJ 2025");
      await user.click(screen.getByRole("button", { name: /Budgetzeile hinzufügen/ }));
      let dialog = screen.getByRole("dialog");
      expect(within(dialog).getByRole("button", { name: "Abbrechen" })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Speichern" })).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      await user.click(screen.getByRole("button", { name: /Kostenposition hinzufügen/ }));
      dialog = screen.getByRole("dialog");
      expect(within(dialog).getByRole("button", { name: "Abbrechen" })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Speichern" })).toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });
});

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Let every pending promise callback run (a macrotask runs after all microtasks). */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

describe("PpmCostTab — loading the budget lines", () => {
  it("shows a failed budget load as an error, not as an empty budget table", async () => {
    mockApi.fail("get", budgetPath, 500);
    renderTab();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`GET ${budgetPath} failed`);
    // Above the totals it explains, set apart from them.
    expect(alert.compareDocumentPosition(screen.getByText("Total Budget"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.queryByText("No budget lines yet")).not.toBeInTheDocument();
    // Nor as a $0 budget, nor as still loading.
    expect(kpi("Total Budget")).toBe("—");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  /** Resolve the lazy charts chunk, so a missing chart means "not drawn", not "chunk still loading". */
  async function warmCharts() {
    const { unmount } = render(<PpmCostTab initiativeId="i1" costLines={COSTS} onRefresh={vi.fn()} />);
    await screen.findByTestId("cost-charts");
    unmount();
  }

  it("draws no spend charts until the budget lines have arrived", async () => {
    await warmCharts();
    const pending = deferred<PpmBudgetLine[]>();
    mockApi.on("get", budgetPath, () => pending.promise);
    renderTab();
    await settle();
    expect(kpi("Total Budget")).toBe("—");
    // A chart without its budget lines would read as an initiative with no budget.
    expect(screen.queryByTestId("cost-charts")).not.toBeInTheDocument();

    pending.resolve(BUDGETS);
    expect(await screen.findByTestId("cost-charts")).toHaveTextContent("2 costs / 2 budgets");
  });

  it("draws no spend charts over a budget that failed to load", async () => {
    await warmCharts();
    mockApi.fail("get", budgetPath, 500);
    renderTab();
    expect(await screen.findByRole("alert")).toHaveTextContent(`GET ${budgetPath} failed`);
    expect(screen.queryByTestId("cost-charts")).not.toBeInTheDocument();
  });

  it("ignores a budget response for an initiative it has since left", async () => {
    const slow = deferred<PpmBudgetLine[]>();
    mockApi.on("get", budgetPath, () => slow.promise);
    mockApi.on("get", "/ppm/initiatives/i2/budgets", [
      budget({ id: "b9", initiative_id: "i2", fiscal_year: 2030, amount: 50 }),
    ]);
    const { rerender } = render(<PpmCostTab initiativeId="i1" costLines={[]} onRefresh={vi.fn()} />);
    rerender(<PpmCostTab initiativeId="i2" costLines={[]} onRefresh={vi.fn()} />);
    expect(await screen.findByText("FY 2030")).toBeInTheDocument();

    // The first initiative's lines land last; they must not replace the second's.
    slow.resolve(BUDGETS);
    await settle();
    expect(screen.queryByText("FY 2025")).not.toBeInTheDocument();
    expect(screen.getByText("FY 2030")).toBeInTheDocument();
    expect(kpi("Total Budget")).toBe("$50");
  });
});

describe("PpmCostTab — saving once", () => {
  it("adds a budget line once however often Save is clicked, and locks Save meanwhile", async () => {
    const write = deferred<object>();
    mockApi.on("post", budgetPath, () => write.promise);
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(screen.getByRole("button", { name: /Add Budget Line/ }));
    const save = within(screen.getByRole("dialog")).getByRole("button", { name: "Save" });
    // Both clicks land before the dialog re-renders.
    act(() => {
      save.click();
      save.click();
    });
    expect(mockApi.callsOf("post", budgetPath)).toHaveLength(1);
    expect(save).toBeDisabled();

    write.resolve({});
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post", budgetPath)).toHaveLength(1);
  });

  it("adds a cost item once however often Save is clicked, and locks Save meanwhile", async () => {
    const write = deferred<object>();
    mockApi.on("post", costPath, () => write.promise);
    const { user, onRefresh } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(screen.getByRole("button", { name: /Add Cost Item/ }));
    const save = within(screen.getByRole("dialog")).getByRole("button", { name: "Save" });
    act(() => {
      save.click();
      save.click();
    });
    expect(mockApi.callsOf("post", costPath)).toHaveLength(1);
    expect(save).toBeDisabled();

    write.resolve({});
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post", costPath)).toHaveLength(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("unlocks Save after a failed save so the user can retry", async () => {
    let posts = 0;
    mockApi.on("post", budgetPath, () => (++posts === 1 ? Promise.reject(new Error("offline")) : {}));
    mockApi.on("post", costPath, () => Promise.reject(new Error("offline")));
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(screen.getByRole("button", { name: /Add Budget Line/ }));
    const save = within(screen.getByRole("dialog")).getByRole("button", { name: "Save" });
    await user.click(save);
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("offline");
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(posts).toBe(2);

    await user.click(screen.getByRole("button", { name: /Add Cost Item/ }));
    const saveCost = within(screen.getByRole("dialog")).getByRole("button", { name: "Save" });
    await user.click(saveCost);
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("offline");
    await waitFor(() => expect(saveCost).toBeEnabled());
  });
});

describe("PpmCostTab — failed writes", () => {
  it("keeps the budget dialog open and says why when the save fails", async () => {
    mockApi.fail("post", budgetPath, 500);
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(screen.getByRole("button", { name: /Add Budget Line/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));

    const dialog = screen.getByRole("dialog");
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(`POST ${budgetPath} failed`);
    // Nothing was written, so nothing is reloaded.
    expect(mockApi.callsOf("get", budgetPath)).toHaveLength(1);
  });

  it("keeps the cost dialog open and says why when the save fails", async () => {
    mockApi.fail("patch", "/ppm/costs/c2", 422);
    const { user, onRefresh } = renderTab();
    await screen.findByText("FY 2025");
    await toggleGroup(user, costTable(), "Undated");
    await user.click(within(rowOf("Servers")).getByRole("button", { name: "Edit" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));

    const dialog = screen.getByRole("dialog");
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("PATCH /ppm/costs/c2 failed");
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when a save fails without one", async () => {
    mockApi.on("post", costPath, () => Promise.reject("network down"));
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(screen.getByRole("button", { name: /Add Cost Item/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      "Something went wrong",
    );
  });

  it("opens either dialog again without the previous attempt's error", async () => {
    mockApi.fail("post", budgetPath, 500);
    mockApi.fail("post", costPath, 500);
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    for (const add of [/Add Budget Line/, /Add Cost Item/]) {
      await user.click(screen.getByRole("button", { name: add }));
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
      await within(screen.getByRole("dialog")).findByRole("alert");
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      await user.click(screen.getByRole("button", { name: add }));
      expect(within(screen.getByRole("dialog")).queryByRole("alert")).not.toBeInTheDocument();
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }
  });

  it("shows a failed budget delete above the budget table, until the next delete succeeds", async () => {
    mockApi.fail("delete", "/ppm/budgets/b2", 409);
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(within(lineRow(budgetTable(), "$400")).getByRole("button", { name: "Delete" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("DELETE /ppm/budgets/b2 failed");
    expect(alert.compareDocumentPosition(budgetTable())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(mockApi.callsOf("get", budgetPath)).toHaveLength(1);

    await toggleGroup(user, budgetTable(), "FY 2025");
    await user.click(within(lineRow(budgetTable(), "$1000")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(mockApi.callsOf("delete", "/ppm/budgets/b1")).toHaveLength(1);
  });

  it("shows a failed cost delete above the cost table and lets it be dismissed", async () => {
    mockApi.fail("delete", "/ppm/costs/c2", 409);
    const { user, onRefresh } = renderTab();
    await screen.findByText("FY 2025");
    await toggleGroup(user, costTable(), "Undated");
    await user.click(within(rowOf("Servers")).getByRole("button", { name: "Delete" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("DELETE /ppm/costs/c2 failed");
    // Under the Cost Items heading, above its table.
    expect(screen.getByText("Cost Items").compareDocumentPosition(alert)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(alert.compareDocumentPosition(rowOf("Servers"))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(onRefresh).not.toHaveBeenCalled();

    await user.click(within(alert).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("clears a failed cost delete once the next one succeeds", async () => {
    mockApi.fail("delete", "/ppm/costs/c2", 409);
    const { user, onRefresh } = renderTab();
    await screen.findByText("FY 2025");
    await toggleGroup(user, costTable(), "Undated");
    await user.click(within(rowOf("Servers")).getByRole("button", { name: "Delete" }));
    await screen.findByRole("alert");

    const licences = screen.getByRole("link", { name: "https://vendor.example.com" }).closest("tr") as HTMLElement;
    await user.click(within(licences).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("dismisses a failed budget delete", async () => {
    mockApi.fail("delete", "/ppm/budgets/b1", 409);
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await toggleGroup(user, budgetTable(), "FY 2025");
    await user.click(within(lineRow(budgetTable(), "$1000")).getByRole("button", { name: "Delete" }));
    const alert = await screen.findByRole("alert");
    await user.click(within(alert).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

describe("PpmCostTab — accessible names", () => {
  it("names every row's edit and delete buttons", async () => {
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await toggleGroup(user, costTable(), "Undated");
    for (const row of [lineRow(budgetTable(), "$400"), rowOf("Servers")]) {
      expect(within(row).getByRole("button", { name: "Edit" })).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    }
  });

  it("links each dialog's Category picker to its label", async () => {
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    for (const add of [/Add Budget Line/, /Add Cost Item/]) {
      await user.click(screen.getByRole("button", { name: add }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByRole("combobox", { name: "Category" })).toHaveTextContent("CapEx");
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }
  });

  it("names the description column, the description field and the row buttons in the user's language", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    try {
      const { user } = renderTab();
      await screen.findByText("GJ 2025");
      // Both tables carry a description column.
      expect(screen.getAllByRole("columnheader", { name: "Beschreibung" })).toHaveLength(2);
      await user.click(
        within(costTable()).getByRole("button", { name: "Zeilen ein- oder ausblenden: Ohne Datum" }),
      );
      expect(within(rowOf("Servers")).getByRole("button", { name: "Bearbeiten" })).toBeInTheDocument();
      expect(within(rowOf("Servers")).getByRole("button", { name: "Löschen" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /Kostenposition hinzufügen/ }));
      expect(
        within(screen.getByRole("dialog")).getByRole("textbox", { name: "Beschreibung" }),
      ).toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });
});

describe("PpmCostTab — fiscal-year groups", () => {
  it("heads each budget year with its CapEx, OpEx and Total subtotals and its line count", async () => {
    mockApi.on("get", budgetPath, [
      budget({ id: "b1", fiscal_year: 2025, category: "capex", amount: 1000 }),
      budget({ id: "b3", fiscal_year: 2025, category: "opex", amount: 200 }),
      budget({ id: "b2", fiscal_year: 2026, category: "opex", amount: 400 }),
    ]);
    renderTab([]);
    await screen.findByText("FY 2025");
    const y2025 = groupRow(budgetTable(), "FY 2025");
    expect(cellTexts(y2025)).toEqual(["chevron_rightFY 20252 lines", "$1000", "$200", "$1200", "add"]);
    const y2026 = groupRow(budgetTable(), "FY 2026");
    expect(cellTexts(y2026)).toEqual(["expand_moreFY 20261 line", "$0", "$400", "$400", "add"]);
    // The icon says which way the toggle goes: closed years point right, open ones down.
    // Years run oldest first.
    expect(y2025.compareDocumentPosition(y2026)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("opens only the current fiscal year on load, and shows or hides a year on its toggle", async () => {
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    const table = budgetTable();
    expect(toggleOf(table, "FY 2026")).toHaveAttribute("aria-expanded", "true");
    expect(toggleOf(table, "FY 2025")).toHaveAttribute("aria-expanded", "false");
    // Only FY 2026's line is on screen.
    expect(lineRows(table)).toHaveLength(1);
    expect(() => lineRow(table, "$1000")).toThrow();

    await toggleGroup(user, table, "FY 2025");
    expect(toggleOf(table, "FY 2025")).toHaveAttribute("aria-expanded", "true");
    expect(cellTexts(lineRow(table, "$1000"))[1]).toBe("$1000");
    expect(lineRows(table)).toHaveLength(2);

    await toggleGroup(user, table, "FY 2025");
    expect(toggleOf(table, "FY 2025")).toHaveAttribute("aria-expanded", "false");
    expect(lineRows(table)).toHaveLength(1);

    // The year that opened by default closes like any other.
    await toggleGroup(user, table, "FY 2026");
    expect(toggleOf(table, "FY 2026")).toHaveAttribute("aria-expanded", "false");
    expect(lineRows(table)).toHaveLength(0);
  });

  it("opens the latest year when the current fiscal year has no lines", async () => {
    mockApi.on("get", budgetPath, [
      budget({ id: "b1", fiscal_year: 2023, amount: 10 }),
      budget({ id: "b2", fiscal_year: 2024, amount: 20 }),
    ]);
    renderTab([]);
    await screen.findByText("FY 2024");
    expect(toggleOf(budgetTable(), "FY 2024")).toHaveAttribute("aria-expanded", "true");
    expect(toggleOf(budgetTable(), "FY 2023")).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps a year the user collapsed collapsed when the lines reload after a save", async () => {
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await toggleGroup(user, budgetTable(), "FY 2026");
    await toggleGroup(user, budgetTable(), "FY 2025");
    // Saved into the year already open, so the save itself opens nothing new.
    await user.click(screen.getByRole("button", { name: "Add a budget line for FY 2025" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("get", budgetPath)).toHaveLength(2));
    await settle();
    expect(toggleOf(budgetTable(), "FY 2026")).toHaveAttribute("aria-expanded", "false");
    expect(toggleOf(budgetTable(), "FY 2025")).toHaveAttribute("aria-expanded", "true");
    expect(lineRows(budgetTable())).toHaveLength(1);
  });

  it("totals every fiscal year in a row under each table", async () => {
    renderTab();
    await screen.findByText("FY 2025");
    expect(cellTexts(footerRow(budgetTable()))).toEqual([
      "Total, all fiscal years",
      "$1000",
      "$400",
      "$1400",
      "",
    ]);
    // Undated cost items count towards the cost totals.
    const costFooter = footerRow(costTable());
    expect(cellTexts(costFooter)).toEqual(["Total, all fiscal years", "$250", "$300", "$550", ""]);
    // Its label spans the Description and Date columns.
    expect(costFooter.querySelector("td")).toHaveAttribute("colspan", "2");
    // The totals row sits below every line, in the table's footer.
    expect(costFooter.closest("tfoot")).not.toBeNull();
    expect(footerRow(budgetTable()).closest("tfoot")).not.toBeNull();
  });

  it("adds a budget line for the year whose + was clicked", async () => {
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(
      within(groupRow(budgetTable(), "FY 2025")).getByRole("button", {
        name: "Add a budget line for FY 2025",
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Add Budget Line")).toBeInTheDocument();
    expect(within(dialog).getByRole("spinbutton", { name: "Fiscal Year" })).toHaveValue(2025);
    expect(within(dialog).getByRole("spinbutton", { name: "Amount" })).toHaveValue(null);
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "Amount" }), {
      target: { value: "90" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("post", budgetPath)).toHaveLength(1));
    expect(mockApi.callsOf("post", budgetPath)[0].body).toEqual({
      fiscal_year: 2025,
      category: "capex",
      description: null,
      amount: 90,
    });
  });

  it("offers no + on a cost year: a whole year is no date", async () => {
    renderTab();
    await screen.findByText("FY 2025");
    expect(within(costTable()).queryByRole("button", { name: /Add a budget line/ })).not.toBeInTheDocument();
    expect(within(budgetTable()).getAllByRole("button", { name: /Add a budget line/ })).toHaveLength(2);
  });

  it("groups cost items by the fiscal year of their date, with the undated ones last", async () => {
    renderTab([
      ...COSTS,
      cost({ id: "c3", description: "Old audit", category: "capex", actual: 80, date: "2025-11-02" }),
    ]);
    // Both tables now carry an FY 2025 header: wait for the budget table's.
    await within(budgetTable()).findByText("FY 2025");
    const table = costTable();
    const y2025 = groupRow(table, "FY 2025");
    const y2026 = groupRow(table, "FY 2026");
    const undated = groupRow(table, "Undated");
    expect(y2025.compareDocumentPosition(y2026)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(y2026.compareDocumentPosition(undated)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // A cost header spans Description and Date, then carries the three subtotals.
    expect(cellTexts(y2026)).toEqual(["expand_moreFY 20261 line", "$0", "$300", "$300", ""]);
    expect(y2026.querySelector("td")).toHaveAttribute("colspan", "2");
    expect(cellTexts(undated)).toEqual(["chevron_rightUndated1 line", "$250", "$0", "$250", ""]);
    // The current year is open; the undated group waits for its toggle.
    expect(toggleOf(table, "Undated")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Servers")).not.toBeInTheDocument();
    expect(screen.queryByText("Old audit")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://vendor.example.com" })).toBeInTheDocument();
  });

  it("opens the undated group when it is the only one", async () => {
    renderTab([cost({ id: "c2", description: "Servers", actual: 250 })]);
    await screen.findByText("FY 2025");
    expect(toggleOf(costTable(), "Undated")).toHaveAttribute("aria-expanded", "true");
    expect(within(rowOf("Servers")).getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("shows a line of any other category under Total only", async () => {
    mockApi.on("get", budgetPath, [
      budget({ id: "b5", fiscal_year: 2026, category: "other" as PpmBudgetLine["category"], amount: 70 }),
    ]);
    renderTab([
      cost({ id: "c5", description: "Misc", category: "misc" as PpmCostLine["category"], actual: 15, date: "2026-02-01" }),
    ]);
    // The cost lines are props and render at once; wait for the budget GET too.
    await waitFor(() => expect(lineRows(budgetTable())).toHaveLength(1));
    expect(cellTexts(lineRow(budgetTable(), "$70")).slice(1, 4)).toEqual(["", "", "$70"]);
    expect(cellTexts(rowOf("Misc")).slice(2, 5)).toEqual(["", "", "$15"]);
    // It counts towards its year's total and the all-years total, never CapEx or OpEx.
    expect(cellTexts(groupRow(budgetTable(), "FY 2026")).slice(1, 4)).toEqual(["$0", "$0", "$70"]);
    expect(cellTexts(footerRow(costTable())).slice(1, 4)).toEqual(["$0", "$0", "$15"]);
  });

  it("names a fiscal year that straddles two calendar years by both, and defaults new lines to it", async () => {
    mockApi.on("get", "/settings/fiscal-year-start", { month: 4 });
    mockApi.on("get", budgetPath, [budget({ id: "b1", fiscal_year: 2026, category: "capex", amount: 500 })]);
    const { user } = renderTab([
      cost({ id: "c1", description: "Licences", category: "opex", actual: 300, date: "2026-03-15" }),
      cost({ id: "c6", description: "Hosting", category: "opex", actual: 40, date: "2026-05-10" }),
    ]);
    // With an April start, March 2026 closes FY 2025–2026 and May 2026 opens FY 2026–2027.
    expect(await within(costTable()).findByText("FY 2025–2026")).toBeInTheDocument();
    expect(within(costTable()).getByText("FY 2026–2027")).toBeInTheDocument();
    expect(await within(budgetTable()).findByText("FY 2025–2026")).toBeInTheDocument();

    // Mid-June 2026 sits in FY 2026–2027: a new line defaults to it.
    await user.click(screen.getByRole("button", { name: /Add Budget Line/ }));
    expect(within(screen.getByRole("dialog")).getByRole("spinbutton", { name: "Fiscal Year" })).toHaveValue(2027);
  });

  it("opens a collapsed year once a line is saved into it from its +", async () => {
    let gets = 0;
    mockApi.on("get", budgetPath, () =>
      ++gets === 1
        ? BUDGETS
        : [...BUDGETS, budget({ id: "b4", fiscal_year: 2025, category: "opex", amount: 90 })],
    );
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    expect(toggleOf(budgetTable(), "FY 2025")).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "Add a budget line for FY 2025" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "Amount" }), {
      target: { value: "90" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(gets).toBe(2));
    await waitFor(() => expect(lineRow(budgetTable(), "$90")).toBeInTheDocument());
    expect(toggleOf(budgetTable(), "FY 2025")).toHaveAttribute("aria-expanded", "true");
    // Opening the saved line's year closes nothing else.
    expect(toggleOf(budgetTable(), "FY 2026")).toHaveAttribute("aria-expanded", "true");
    expect(lineRows(budgetTable())).toHaveLength(3);
  });

  it("shows a new year's group open once a line is saved into it", async () => {
    let gets = 0;
    mockApi.on("get", budgetPath, () =>
      ++gets === 1
        ? BUDGETS
        : [...BUDGETS, budget({ id: "b4", fiscal_year: 2028, category: "capex", amount: 75 })],
    );
    const { user } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(screen.getByRole("button", { name: /Add Budget Line/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "Fiscal Year" }), {
      target: { value: "2028" },
    });
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "Amount" }), {
      target: { value: "75" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(budgetTable()).findByText("FY 2028")).toBeInTheDocument();
    expect(toggleOf(budgetTable(), "FY 2028")).toHaveAttribute("aria-expanded", "true");
    expect(cellTexts(lineRow(budgetTable(), "$75"))[1]).toBe("$75");
    expect(toggleOf(budgetTable(), "FY 2025")).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the fiscal year a saved cost item is dated in", async () => {
    const { user, onRefresh, setCostLines } = renderTab();
    await screen.findByText("FY 2025");
    await user.click(screen.getByRole("button", { name: /Add Cost Item/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Description" }), "Audit");
    const date = within(dialog).getByLabelText("Date");
    fireEvent.focus(date);
    fireEvent.change(date, { target: { value: "2025-08-01" } });
    fireEvent.blur(date);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));

    setCostLines([...COSTS, cost({ id: "c4", description: "Audit", actual: 60, date: "2025-08-01" })]);
    expect(await within(costTable()).findByText("FY 2025")).toBeInTheDocument();
    expect(toggleOf(costTable(), "FY 2025")).toHaveAttribute("aria-expanded", "true");
    expect(within(rowOf("Audit")).getByText("$60")).toBeInTheDocument();
    // The year that was open stays open; Undated stays shut.
    expect(toggleOf(costTable(), "FY 2026")).toHaveAttribute("aria-expanded", "true");
    expect(toggleOf(costTable(), "Undated")).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the undated group once an undated cost item is saved", async () => {
    const { user, onRefresh, setCostLines } = renderTab();
    await screen.findByText("FY 2025");
    expect(toggleOf(costTable(), "Undated")).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: /Add Cost Item/ }));
    const dialog = screen.getByRole("dialog");
    const date = within(dialog).getByLabelText("Date");
    fireEvent.focus(date);
    fireEvent.change(date, { target: { value: "" } });
    fireEvent.blur(date);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("post", costPath)).toHaveLength(1));
    expect(mockApi.callsOf("post", costPath)[0].body).toMatchObject({ date: null });
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));

    setCostLines([...COSTS, cost({ id: "c4", description: "Cables", actual: 12 })]);
    expect(await screen.findByText("Cables")).toBeInTheDocument();
    expect(toggleOf(costTable(), "Undated")).toHaveAttribute("aria-expanded", "true");
    expect(rowOf("Servers")).toBeInTheDocument();
  });

  it("regroups and re-totals the cost items when the parent hands it new ones", async () => {
    const { setCostLines } = renderTab();
    await screen.findByText("FY 2025");
    expect(cellTexts(footerRow(costTable())).slice(1, 4)).toEqual(["$250", "$300", "$550"]);
    expect(within(costTable()).queryByText("FY 2027")).not.toBeInTheDocument();

    setCostLines([...COSTS, cost({ id: "c7", description: "Rollout", category: "capex", actual: 100, date: "2027-02-01" })]);
    const y2027 = groupRow(costTable(), "FY 2027");
    expect(cellTexts(y2027).slice(1, 4)).toEqual(["$100", "$0", "$100"]);
    expect(cellTexts(footerRow(costTable())).slice(1, 4)).toEqual(["$350", "$300", "$650"]);
  });
});
