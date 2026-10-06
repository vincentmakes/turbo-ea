/**
 * PpmCostCharts — the three cumulative-spend charts on the Budget & Costs tab.
 *
 * Recharts is stubbed: the maths lives in `costChartData.ts` (its own test),
 * so every assertion here is about what this component hands each chart — the
 * series, the lines, the dotted budget references — and about the fiscal-year
 * picker and the collapse toggle that choose which data that is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PpmBudgetLine, PpmCostLine } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

/* eslint-disable @typescript-eslint/no-explicit-any */
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  LineChart: ({ data, children }: any) => (
    <div data-testid="line-chart" data-points={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Line: ({ dataKey, name }: any) => (
    <span data-testid="line" data-key={dataKey}>
      {name}
    </span>
  ),
  ReferenceLine: ({ y, label }: any) => (
    <span data-testid="ref" data-y={y}>
      {label?.value}
    </span>
  ),
  XAxis: () => null,
  YAxis: ({ tickFormatter }: any) => <span data-testid="y-tick">{tickFormatter(2500)}</span>,
  CartesianGrid: () => null,
  Tooltip: ({ formatter }: any) => (
    <span data-testid="tooltip">
      {[formatter(1234), formatter("n/a"), formatter(undefined)].join("|")}
    </span>
  ),
  Legend: ({ formatter }: any) => <span data-testid="legend">{formatter("Legend entry")}</span>,
}));
/* eslint-enable @typescript-eslint/no-explicit-any */

import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { invalidateFiscalYearStart, resetFiscalYearStart } from "@/hooks/useFiscalYearStart";
import PpmCostCharts from "./PpmCostCharts";

const PREFS_KEY = "turboea.ppm.costcharts.prefs";

function cost(overrides: Partial<PpmCostLine> & { id: string }): PpmCostLine {
  return {
    initiative_id: "i1",
    description: overrides.id,
    category: "capex",
    planned: 0,
    actual: 0,
    date: null,
    created_at: "2020-01-01T00:00:00",
    updated_at: "2020-01-01T00:00:00",
    ...overrides,
  };
}

function budget(overrides: Partial<PpmBudgetLine> & { id: string }): PpmBudgetLine {
  return {
    initiative_id: "i1",
    fiscal_year: 2020,
    category: "capex",
    amount: 0,
    created_at: "2020-01-01T00:00:00",
    updated_at: "2020-01-01T00:00:00",
    ...overrides,
  };
}

// A completed past fiscal year, so the series draws all twelve months
// whatever the date the suite runs on.
const COSTS: PpmCostLine[] = [
  cost({ id: "c1", category: "capex", actual: 100, date: "2020-02-10" }),
  cost({ id: "c2", category: "opex", actual: 40, date: "2020-05-01" }),
  cost({ id: "c3", category: "capex", actual: 60, date: "2020-05-20" }),
  cost({ id: "c4", category: "opex", actual: 999, date: null }),
];

const BUDGETS: PpmBudgetLine[] = [
  budget({ id: "b1", fiscal_year: 2020, category: "capex", amount: 500 }),
  budget({ id: "b2", fiscal_year: 2020, category: "opex", amount: 200 }),
  budget({ id: "b3", fiscal_year: 2021, category: "capex", amount: 300 }),
];

type Point = { key: string; label: string; capex: number | null; opex: number | null; total: number | null };

const last = <T,>(xs: T[]): T => xs[xs.length - 1];

/** The chart region named by its heading. */
const chart = (name: string) => screen.getByRole("img", { name });
const pointsOf = (name: string): Point[] =>
  JSON.parse(within(chart(name)).getByTestId("line-chart").getAttribute("data-points") ?? "[]");
const linesOf = (name: string) =>
  within(chart(name))
    .getAllByTestId("line")
    .map((l) => [l.getAttribute("data-key"), l.textContent]);
const refsOf = (name: string) =>
  within(chart(name))
    .queryAllByTestId("ref")
    .map((r) => [r.textContent, Number(r.getAttribute("data-y"))]);

function renderCharts(costLines = COSTS, budgetLines = BUDGETS) {
  const user = userEvent.setup();
  const utils = render(<PpmCostCharts costLines={costLines} budgetLines={budgetLines} />);
  return { user, ...utils };
}

/** Pick an entry in the fiscal-year Select. */
async function pickYear(user: ReturnType<typeof userEvent.setup>, label: string | RegExp) {
  await user.click(screen.getByRole("combobox", { name: "Fiscal Year" }));
  await user.click(await screen.findByRole("option", { name: label }));
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  localStorage.clear();
  resetFiscalYearStart();
  mockApi.on("get", "/settings/fiscal-year-start", { month: 1 });
});

describe("PpmCostCharts — nothing to plot", () => {
  it("renders nothing when there are neither cost nor budget lines", () => {
    const { container } = renderCharts([], []);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the empty label for the project chart when no cost line is dated", () => {
    renderCharts([], [budget({ id: "b1", fiscal_year: 2020, amount: 100 })]);
    // Charts 1 and 2 still draw the current fiscal year (zeros up to today);
    // chart 3 has no timeline at all.
    expect(screen.getByText("Project to date")).toBeInTheDocument();
    expect(screen.getByText("No cost data to chart yet")).toBeInTheDocument();
  });
});

describe("PpmCostCharts — fiscal-year charts", () => {
  it("defaults to the current fiscal year and offers every year with data, newest first", async () => {
    const { user } = renderCharts();
    const currentYear = new Date().getFullYear();
    const combo = screen.getByRole("combobox", { name: "Fiscal Year" });
    expect(combo).toHaveTextContent(`FY ${currentYear}`);

    await user.click(combo);
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options[0]).toBe("All fiscal years");
    expect(options.slice(1)).toEqual(
      [...new Set([currentYear, 2021, 2020])].sort((a, b) => b - a).map((y) => `FY ${y}`),
    );
  });

  it("hands the selected year's cumulative series and per-category budgets to chart 1", async () => {
    const { user } = renderCharts();
    await pickYear(user, "FY 2020");

    const pts = pointsOf("Cumulative spend by category");
    expect(pts).toHaveLength(12);
    expect(pts[0]).toMatchObject({ key: "2020-01", label: "Jan", capex: 0, opex: 0, total: 0 });
    expect(pts[1]).toMatchObject({ key: "2020-02", capex: 100, opex: 0, total: 100 });
    expect(pts[4]).toMatchObject({ key: "2020-05", capex: 160, opex: 40, total: 200 });
    // A finished year draws in full and stays flat to December.
    expect(pts[11]).toMatchObject({ key: "2020-12", capex: 160, opex: 40, total: 200 });

    expect(linesOf("Cumulative spend by category")).toEqual([
      ["capex", "Cumulative CapEx"],
      ["opex", "Cumulative OpEx"],
    ]);
    expect(refsOf("Cumulative spend by category")).toEqual([
      ["CapEx budget", 500],
      ["OpEx budget", 200],
    ]);
  });

  it("draws chart 2 as one total line against the total budget", async () => {
    const { user } = renderCharts();
    await pickYear(user, "FY 2020");

    expect(linesOf("Cumulative total spend")).toEqual([["total", "Cumulative spend"]]);
    expect(refsOf("Cumulative total spend")).toEqual([["Total budget", 700]]);
    expect(last(pointsOf("Cumulative total spend"))).toMatchObject({ total: 200 });
  });

  it("omits a budget reference line for a category with no budget that year", async () => {
    const { user } = renderCharts();
    await pickYear(user, "FY 2021");

    expect(refsOf("Cumulative spend by category")).toEqual([["CapEx budget", 300]]);
    expect(refsOf("Cumulative total spend")).toEqual([["Total budget", 300]]);
  });

  it("spans the whole project with year-qualified labels when 'All fiscal years' is picked", async () => {
    const costs = [
      cost({ id: "x1", category: "capex", actual: 10, date: "2019-11-03" }),
      cost({ id: "x2", category: "opex", actual: 5, date: "2020-02-14" }),
    ];
    const { user } = renderCharts(costs, []);
    await pickYear(user, "All fiscal years");

    const pts = pointsOf("Cumulative spend by category");
    expect(pts.map((p) => p.label)).toEqual(["Nov '19", "Dec '19", "Jan '20", "Feb '20"]);
    expect(last(pts)).toMatchObject({ capex: 10, opex: 5, total: 15 });
    // No budget at all ⇒ no reference lines anywhere.
    expect(refsOf("Cumulative spend by category")).toEqual([]);
    expect(refsOf("Cumulative total spend")).toEqual([]);
    expect(refsOf("Project to date")).toEqual([]);
    expect(linesOf("Project to date")).toEqual([
      ["capex", "Cumulative CapEx"],
      ["opex", "Cumulative OpEx"],
    ]);
  });

  it("saves the picked year and restores it on the next mount", async () => {
    const { user, unmount } = renderCharts();
    await pickYear(user, "FY 2020");
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}")).toEqual({
        fiscalYear: 2020,
        expanded: true,
      }),
    );
    unmount();

    renderCharts();
    expect(screen.getByRole("combobox", { name: "Fiscal Year" })).toHaveTextContent("FY 2020");
    expect(pointsOf("Cumulative spend by category")[0].key).toBe("2020-01");
  });

  it("stores the current year as the 'current' sentinel, not a number", async () => {
    const { user } = renderCharts();
    await pickYear(user, "FY 2020");
    await pickYear(user, `FY ${new Date().getFullYear()}`);
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").fiscalYear).toBe("current"),
    );
  });

  it("falls back to the current year when the stored year has no data here", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ fiscalYear: 2015, expanded: true }));
    renderCharts();
    const currentYear = new Date().getFullYear();
    expect(screen.getByRole("combobox", { name: "Fiscal Year" })).toHaveTextContent(`FY ${currentYear}`);
    expect(pointsOf("Cumulative spend by category")[0].key).toBe(`${currentYear}-01`);
  });

  it("names a fiscal year by its span when the year does not start in January", async () => {
    invalidateFiscalYearStart(4);
    const { user } = renderCharts();
    await user.click(screen.getByRole("combobox", { name: "Fiscal Year" }));
    // A FY2020 budget line and April-start costs in 2020 (FY2020 / FY2021).
    expect(await screen.findByRole("option", { name: "FY 2019–2020" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "FY 2019–2020" }));
    // An April start opens FY2020 in April 2019.
    expect(pointsOf("Cumulative spend by category")[0].key).toBe("2019-04");
  });
});

describe("PpmCostCharts — project chart and chrome", () => {
  it("draws chart 3 over the whole dated range against the all-years budget", () => {
    renderCharts();
    const pts = pointsOf("Project to date");
    expect(pts.map((p) => p.key)).toEqual(["2020-02", "2020-03", "2020-04", "2020-05"]);
    expect(last(pts)).toMatchObject({ capex: 160, opex: 40 });
    expect(refsOf("Project to date")).toEqual([
      ["CapEx budget", 800],
      ["OpEx budget", 200],
    ]);
  });

  it("formats axis ticks, tooltips and legend entries through the currency helpers", () => {
    renderCharts();
    const proj = chart("Project to date");
    expect(within(proj).getByTestId("y-tick")).toHaveTextContent("$2500");
    // Exact text: an undefined value renders as nothing at all.
    expect(within(proj).getByTestId("tooltip").textContent).toBe("$1234|n/a|");
    expect(within(proj).getByTestId("legend")).toHaveTextContent("Legend entry");
  });

  it("counts undated cost lines that the charts cannot place", () => {
    renderCharts();
    expect(screen.getByText("1 undated cost item is not shown on the charts")).toBeInTheDocument();
  });

  it("says nothing about undated lines when every line is dated", () => {
    renderCharts(COSTS.filter((c) => c.date));
    expect(screen.queryByText(/undated cost/)).not.toBeInTheDocument();
  });

  it("collapses and expands, persisting the choice", async () => {
    const { user } = renderCharts();
    const toggle = screen.getByRole("button", { name: "Spend over time" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("combobox", { name: "Fiscal Year" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("img", { name: "Project to date" })).not.toBeInTheDocument());
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").expanded).toBe(false),
    );

    await user.click(toggle);
    expect(await screen.findByRole("img", { name: "Project to date" })).toBeInTheDocument();
  });

  it("starts collapsed when that was the saved preference", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ fiscalYear: "current", expanded: false }));
    renderCharts();
    expect(screen.getByRole("button", { name: "Spend over time" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("still renders every chart right-to-left", () => {
    hookState.isRtl = true;
    renderCharts();
    expect(screen.getAllByTestId("line-chart")).toHaveLength(3);
    expect(within(chart("Project to date")).getByTestId("legend")).toHaveTextContent("Legend entry");
  });
});

describe("PpmCostCharts — which fiscal year is current", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Mid-April 2026 — the first month of an April-start fiscal year. */
  const freezeToday = () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 3, 15, 12));
  };

  it("derives the current fiscal year from today's month and the configured start", () => {
    freezeToday();
    invalidateFiscalYearStart(4);
    renderCharts();
    // April 2026 opens FY2027 (named after the year it ends in).
    expect(screen.getByRole("combobox", { name: "Fiscal Year" })).toHaveTextContent("FY 2026–2027");
    expect(pointsOf("Cumulative spend by category")[0].key).toBe("2026-04");
  });

  it("re-derives the current fiscal year once the configured start arrives", async () => {
    freezeToday();
    // Not primed: the hook starts on the January default and fetches.
    mockApi.on("get", "/settings/fiscal-year-start", { month: 4 });
    renderCharts();
    const combo = screen.getByRole("combobox", { name: "Fiscal Year" });
    expect(combo).toHaveTextContent("FY 2026");
    await waitFor(() => expect(combo).toHaveTextContent("FY 2026–2027"));
    expect(pointsOf("Cumulative spend by category")[0].key).toBe("2026-04");
  });
});

describe("PpmCostCharts — the year picker", () => {
  it("names the heading", () => {
    renderCharts();
    expect(screen.getByText("Spend over time")).toBeInTheDocument();
  });

  it("shows 'All fiscal years' once picked, and again on the next mount", async () => {
    const { user, unmount } = renderCharts();
    await pickYear(user, "All fiscal years");
    expect(screen.getByRole("combobox", { name: "Fiscal Year" })).toHaveTextContent("All fiscal years");
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").fiscalYear).toBe("all"),
    );
    unmount();
    renderCharts();
    expect(screen.getByRole("combobox", { name: "Fiscal Year" })).toHaveTextContent("All fiscal years");
  });

  it("shows the current year when it was stored as a number rather than the sentinel", () => {
    const currentYear = new Date().getFullYear();
    localStorage.setItem(PREFS_KEY, JSON.stringify({ fiscalYear: currentYear, expanded: true }));
    renderCharts();
    expect(screen.getByRole("combobox", { name: "Fiscal Year" })).toHaveTextContent(`FY ${currentYear}`);
  });

  it("follows new cost and budget lines handed to it", async () => {
    const { user, rerender } = renderCharts();
    rerender(
      <PpmCostCharts
        costLines={[
          cost({ id: "n1", category: "capex", actual: 10, date: "2018-06-03" }),
          cost({ id: "n2", category: "opex", actual: 5, date: null }),
          cost({ id: "n3", category: "opex", actual: 5, date: null }),
        ]}
        budgetLines={[budget({ id: "nb", fiscal_year: 2018, category: "opex", amount: 70 })]}
      />,
    );
    expect(pointsOf("Project to date").map((p) => p.key)).toEqual(["2018-06"]);
    expect(last(pointsOf("Project to date"))).toMatchObject({ capex: 10, opex: 0 });
    expect(refsOf("Project to date")).toEqual([["OpEx budget", 70]]);
    expect(screen.getByText("2 undated cost items are not shown on the charts")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Fiscal Year" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toContain("FY 2018");
    expect(options).not.toContain("FY 2020");
  });
});

describe("PpmCostCharts — empty charts", () => {
  it("shows the empty label in all three charts when no cost line is dated across all years", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ fiscalYear: "all", expanded: true }));
    renderCharts([], [budget({ id: "b1", fiscal_year: 2020, amount: 100 })]);
    expect(screen.getAllByText("No cost data to chart yet")).toHaveLength(3);
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
  });

  it("shows the empty label for a fiscal year that has not started yet", async () => {
    const future = new Date().getFullYear() + 3;
    const { user } = renderCharts([], [budget({ id: "bf", fiscal_year: future, amount: 100 })]);
    await pickYear(user, `FY ${future}`);
    // Twelve months, none of them reached: nothing to draw in charts 1 and 2.
    expect(screen.getAllByText("No cost data to chart yet")).toHaveLength(3);
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
  });
});
