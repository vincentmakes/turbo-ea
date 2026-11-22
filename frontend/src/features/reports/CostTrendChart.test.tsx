import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import CostTrendChart from "./CostTrendChart";

vi.mock("@/api/client", () => ({ api: { get: vi.fn() }, isAbortError: () => false }));
vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({ fmt: { format: (v: number) => `$${v}` } }),
}));
// jsdom has no canvas: the chart is the shared test double, and a test reads the option the page built.
vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));
import { api } from "@/api/client";
import { echartState } from "@/test/echartMock";

/** What the chart plots: each component's per-year totals, in year order. */
const rowsOf = () =>
  Object.fromEntries(
    echartState.last().option.series.map((s: { name: string; data: number[] }) => [s.name, s.data]),
  );
const yearLabels = () => echartState.last().option.xAxis.data as string[];
const yearOf = (path: string) => new URLSearchParams(path.split("?")[1]).get("fiscal_year")!;
const barKeys = () => (echartState.props.length ? echartState.last().option.series.map((s: { name: string }) => s.name) : []);

const COMPONENTS = ["licenseCost", "serviceCost"];
const props = (over: Partial<React.ComponentProps<typeof CostTrendChart>> = {}) => ({
  typeParam: "Application",
  costField: "costTotalAnnual",
  components: COMPONENTS,
  years: [2025, 2026],
  currentFiscalYear: 2026,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  echartState.reset();
  vi.mocked(api.get).mockImplementation((path: string) => {
    const p = new URLSearchParams(path.split("?")[1]);
    const totals: Record<string, number> = {
      "licenseCost:2025": 100,
      "serviceCost:2025": 50,
      "licenseCost:2026": 120,
      "serviceCost:2026": 60,
    };
    return Promise.resolve({
      items: [],
      total: totals[`${p.get("cost_field")}:${p.get("fiscal_year")}`] ?? 0,
    }) as never;
  });
});

describe("CostTrendChart", () => {
  it("requests each component for each year with the component as cost_field", async () => {
    render(<CostTrendChart {...props()} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(4)); // 2 years x 2 components
    const paths = vi.mocked(api.get).mock.calls.map(([p]) => String(p));
    expect(paths).toContain(
      "/reports/cost-treemap?type=Application&cost_field=licenseCost&fiscal_year=2025",
    );
    expect(paths).toContain(
      "/reports/cost-treemap?type=Application&cost_field=serviceCost&fiscal_year=2026",
    );
    await waitFor(() =>
      expect(rowsOf()).toEqual({ licenseCost: [100, 120], serviceCost: [50, 60] }),
    );
  });

  it("draws one bar per component, keyed by the technical key, with distinct colours", async () => {
    render(<CostTrendChart {...props()} />);
    await waitFor(() => expect(barKeys()).toEqual(COMPONENTS));
    const fills = echartState
      .last()
      .option.series.map((s: { itemStyle: { color: string } }) => s.itemStyle.color);
    expect(new Set(fills).size).toBe(2);
  });

  it("updates the bars and refetches when the component list changes", async () => {
    const { rerender } = render(<CostTrendChart {...props()} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(4));
    rerender(<CostTrendChart {...props({ components: ["licenseCost"] })} />);
    await waitFor(() => expect(barKeys()).toEqual(["licenseCost"]));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(6));
  });

  it("does not refetch for a new array with the same components", async () => {
    const years = [2025, 2026];
    const { rerender } = render(<CostTrendChart {...props({ years })} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(4));
    rerender(<CostTrendChart {...props({ years, components: [...COMPONENTS] })} />);
    await act(async () => {});
    expect(api.get).toHaveBeenCalledTimes(4);
  });

  it("labels the axis with FY names", async () => {
    render(<CostTrendChart {...props({ years: [2025, 2026, 2027] })} />);
    await waitFor(() => expect(yearLabels()).toHaveLength(3));
    expect(yearLabels()).toEqual(["FY25", "FY26 - Current", "FY27 - Forecast"]);
  });

  it("sends no group_by param without a groupBy prop", async () => {
    render(<CostTrendChart {...props({ years: [2025] })} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    for (const [p] of vi.mocked(api.get).mock.calls) expect(String(p)).not.toContain("group_by");
  });

  it("aborts the requests still in flight when the years change", async () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}) as never);
    const { rerender } = render(<CostTrendChart {...props({ years: [2025] })} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    const firstSignals = vi.mocked(api.get).mock.calls.map(([, opts]) => opts?.signal);

    rerender(<CostTrendChart {...props({ years: [2026] })} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(4));

    expect(firstSignals).toHaveLength(2);
    for (const signal of firstSignals) expect(signal?.aborted).toBe(true);
    const latestSignals = vi.mocked(api.get).mock.calls.slice(2).map(([, opts]) => opts?.signal);
    for (const signal of latestSignals) expect(signal?.aborted).toBe(false);
  });

  it("keeps the latest selection's rows when an older request resolves last", async () => {
    const pending: { year: string; resolve: (v: unknown) => void }[] = [];
    vi.mocked(api.get).mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          pending.push({ year: yearOf(path), resolve });
        }) as never,
    );
    const settle = (year: string, total: number) =>
      pending.filter((p) => p.year === year).forEach((p) => p.resolve({ items: [], total }));

    const { rerender } = render(<CostTrendChart {...props({ years: [2025] })} />);
    await waitFor(() => expect(pending).toHaveLength(2));
    rerender(<CostTrendChart {...props({ years: [2026] })} />);
    await waitFor(() => expect(pending).toHaveLength(4));

    settle("2026", 7);
    const latest = { licenseCost: [7], serviceCost: [7] };
    await waitFor(() => expect(rowsOf()).toEqual(latest));

    await act(async () => {
      settle("2025", 99); // the superseded request lands last
    });
    expect(rowsOf()).toEqual(latest);
  });
});

describe("CostTrendChart selection and scope", () => {
  const ITEMS = [
    { id: "a", cost: 10, group: "fin" },
    { id: "b", cost: 5, group: "fin" },
    { id: "c", cost: 7, group: "ops" },
  ];
  const withItems = () =>
    vi.mocked(api.get).mockImplementation(() =>
      Promise.resolve({ items: ITEMS, total: 999 }) as never,
    );

  it("sums only the selected card across years", async () => {
    withItems();
    render(<CostTrendChart {...props({ components: ["licenseCost"], years: [2025], selection: { kind: "card", id: "b" } })} />);
    await waitFor(() => expect(rowsOf()).toEqual({ licenseCost: [5] }));
  });

  it("sums the group's members and sends group_by", async () => {
    withItems();
    render(
      <CostTrendChart
        {...props({ components: ["licenseCost"], years: [2025], groupBy: "field:dept", selection: { kind: "group", keys: ["fin"] } })}
      />,
    );
    await waitFor(() => expect(rowsOf()).toEqual({ licenseCost: [15] }));
    expect(String(vi.mocked(api.get).mock.calls[0][0])).toContain("group_by=field%3Adept");
  });

  it("sums several raw group keys (Others)", async () => {
    withItems();
    render(<CostTrendChart {...props({ components: ["licenseCost"], years: [2025], selection: { kind: "group", keys: ["fin", "ops"] } })} />);
    await waitFor(() => expect(rowsOf()).toEqual({ licenseCost: [22] }));
  });

  it("respects the scope closure", async () => {
    withItems();
    render(<CostTrendChart {...props({ components: ["licenseCost"], years: [2025], scopeIds: new Set(["a", "c"]) })} />);
    await waitFor(() => expect(rowsOf()).toEqual({ licenseCost: [17] }));
  });

  it("uses the response total without selection or scope", async () => {
    withItems();
    render(<CostTrendChart {...props({ components: ["licenseCost"], years: [2025] })} />);
    await waitFor(() => expect(rowsOf()).toEqual({ licenseCost: [999] }));
  });
});

it("refetches all component years when the refresh version changes", async () => {
  const years = [2025, 2026];
  const { rerender } = render(<CostTrendChart {...props({ years, refreshVersion: 0 })} />);
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(4));
  rerender(<CostTrendChart {...props({ years, refreshVersion: 1 })} />);
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(8));
});
