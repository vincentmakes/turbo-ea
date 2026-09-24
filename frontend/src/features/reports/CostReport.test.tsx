/**
 * Tests for the Cost report's card scope (#954) and its fiscal-year slider.
 *
 * Scope: the risk is not the filter itself but its blast radius — the metric
 * strip, the treemap and the table footer are all derived separately, so a
 * scope applied in the wrong place leaves them disagreeing with each other.
 *
 * Fiscal year: the server applies the year, so these pin what reaches the
 * request and what the slider is handed — one stop per year, nothing between.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { createRef } from "react";
import CostReport from "./CostReport";

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock("@/api/client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
vi.mock("@/hooks/useSavedReport", () => ({ useSavedReport: vi.fn() }));
vi.mock("@/hooks/useThumbnailCapture", () => ({ useThumbnailCapture: vi.fn() }));
vi.mock("@/hooks/useCurrency", () => ({
  // `fmt` is an Intl-style formatter object, not a function.
  useCurrency: () => ({
    fmt: { format: (v: number) => `$${v}` },
    fmtShort: (v: number) => `$${v}`,
    symbol: "$",
    currency: "USD",
    loading: false,
    invalidate: () => {},
  }),
}));
vi.mock("./SaveReportDialog", () => ({ default: () => null }));
// The report hides everything behind `costs.view`.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { permissions: { "costs.view": true } } }),
}));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));

// Captured so the fiscal-year wiring can be asserted at the slider boundary,
// the same pattern as CapabilityMapReport.test.tsx.
type SliderProps = {
  value: number;
  onChange: (v: number) => void;
  yearMarks: { value: number; label: string }[];
  todayMs?: number;
  step?: number | null;
  formatValue?: (v: number) => string;
  resetLabel?: string;
};
const sliderProps: SliderProps[] = [];
vi.mock("@/components/TimelineSlider", () => ({
  default: (props: SliderProps) => {
    sliderProps.push(props);
    return <div data-testid="timeline-slider" />;
  },
}));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { fiscalYearStartMs } from "@/lib/fiscalYear";

const APP_TYPE = {
  key: "Application",
  label: "Application",
  color: "#0f7eb5",
  is_hidden: false,
  has_hierarchy: true,
  fields_schema: [
    {
      section: "Costs",
      fields: [{ key: "costTotalAnnual", label: "Total Annual Cost", type: "cost" }],
    },
  ],
};

/** crm → crm-web (child).  erp is a separate root. */
const HIERARCHY = [
  { id: "crm", name: "CRM", type: "Application", parent_id: null },
  { id: "crm-web", name: "CRM Web", type: "Application", parent_id: "crm" },
  { id: "erp", name: "ERP", type: "Application", parent_id: null },
];

const COST_ITEMS = [
  { id: "crm", name: "CRM", cost: 100, attributes: {} },
  { id: "crm-web", name: "CRM Web", cost: 20, attributes: {} },
  { id: "erp", name: "ERP", cost: 500, attributes: {} },
];

const CURRENT_FY = 2026;
let fyStart = 1;

let consumedConfig: Record<string, unknown> | null = { view: "table" };

beforeEach(() => {
  vi.clearAllMocks();
  consumedConfig = { view: "table" };
  sliderProps.length = 0;
  fyStart = 1;

  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith("/reports/cost-treemap")) {
      const asked = new URLSearchParams(path.split("?")[1]).get("fiscal_year");
      return Promise.resolve({
        items: COST_ITEMS,
        total: 620,
        fiscal_year: asked ? Number(asked) : CURRENT_FY,
        current_fiscal_year: CURRENT_FY,
        fiscal_year_start: fyStart,
        fiscal_year_range: { min: 2024, max: 2029 },
      }) as never;
    }
    // The scope hook's own hierarchy fetch.
    return Promise.resolve({ items: HIERARCHY, total: HIERARCHY.length }) as never;
  });

  vi.mocked(useMetamodel).mockReturnValue({
    types: [APP_TYPE],
    relationTypes: [],
    loading: false,
    getType: (key: string) => (key === "Application" ? APP_TYPE : undefined),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as never);

  vi.mocked(useSavedReport).mockReturnValue({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: vi.fn(),
    loadedConfig: null,
    consumeConfig: vi.fn(() => consumedConfig),
    resetSavedReport: vi.fn(),
    persistConfig: vi.fn(),
    resetAll: vi.fn(),
    reportType: "cost",
  } as never);

  vi.mocked(useThumbnailCapture).mockReturnValue({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: vi.fn(),
  } as never);
});

function renderCost() {
  return render(
    <MemoryRouter>
      <CostReport />
    </MemoryRouter>,
  );
}

const chart = () => document.querySelector(".report-chart-area") as HTMLElement;
const toolbar = () => document.querySelector(".report-toolbar") as HTMLElement;

describe("CostReport scope filter", () => {
  it("includes every card when unscoped", async () => {
    renderCost();
    await waitFor(() => expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0));
    expect(within(chart()).getAllByText("CRM").length).toBeGreaterThan(0);
    expect(within(toolbar()).getByText("All cards")).toBeInTheDocument();
  });

  it("narrows to the scoped subtree, and the total follows it", async () => {
    // Scoping to CRM keeps CRM + CRM Web (120) and drops ERP's 500 — the whole
    // point being that the metric strip must not keep reporting 620.
    consumedConfig = { view: "table", scopeIds: ["crm"] };
    renderCost();

    await waitFor(() => expect(within(chart()).getAllByText("CRM").length).toBeGreaterThan(0));
    expect(within(chart()).getAllByText("CRM Web").length).toBeGreaterThan(0);
    expect(within(chart()).queryByText("ERP")).not.toBeInTheDocument();
    await waitFor(() => expect(within(chart()).getAllByText("$120").length).toBeGreaterThan(0));
    expect(within(chart()).queryByText("$620")).not.toBeInTheDocument();
  });

  it("issues no hierarchy request while unscoped", async () => {
    renderCost();
    await waitFor(() => expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0));

    const cardCalls = vi
      .mocked(api.get)
      .mock.calls.filter(([path]) => String(path).startsWith("/cards"));
    expect(cardCalls).toHaveLength(0);
  });

  it("drops a scoped id whose card no longer exists", async () => {
    consumedConfig = { view: "table", scopeIds: ["deleted-app"] };
    renderCost();

    await waitFor(() => expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0));
    expect(within(toolbar()).getByText("All cards")).toBeInTheDocument();
  });
});

describe("CostReport fiscal year", () => {
  const treemapCalls = () =>
    vi
      .mocked(api.get)
      .mock.calls.map(([path]) => String(path))
      .filter((path) => path.startsWith("/reports/cost-treemap"));
  const askedYear = (path: string) =>
    new URLSearchParams(path.split("?")[1]).get("fiscal_year");
  const lastSlider = () => sliderProps[sliderProps.length - 1];
  const persisted = () => {
    const calls = vi.mocked(useSavedReport).mock.results[0].value.persistConfig.mock.calls;
    return calls[calls.length - 1][0] as Record<string, unknown>;
  };

  it("leaves the year to the server until one is picked", async () => {
    renderCost();
    await waitFor(() => expect(sliderProps.length).toBeGreaterThan(0));
    expect(treemapCalls().length).toBeGreaterThan(0);
    for (const path of treemapCalls()) expect(askedYear(path)).toBeNull();
  });

  it("offers one stop per fiscal year and nothing in between", async () => {
    renderCost();
    await waitFor(() => expect(sliderProps.length).toBeGreaterThan(0));
    const props = lastSlider();
    expect(props.step).toBeNull();
    expect(props.yearMarks.map((m) => m.label)).toEqual([
      "2024",
      "2025",
      "2026",
      "2027",
      "2028",
      "2029",
    ]);
    expect(props.yearMarks.map((m) => m.value)).toEqual(
      [2024, 2025, 2026, 2027, 2028, 2029].map((fy) => fiscalYearStartMs(fy, 1)),
    );
    // Standing on the current year, which is also where "reset" returns to.
    expect(props.value).toBe(fiscalYearStartMs(CURRENT_FY, 1));
    expect(props.todayMs).toBe(fiscalYearStartMs(CURRENT_FY, 1));
    expect(props.resetLabel).toBe("Current fiscal year");
  });

  it("names the year in full, straddling two years on a non-January start", async () => {
    fyStart = 10;
    renderCost();
    await waitFor(() => expect(sliderProps.length).toBeGreaterThan(0));
    const props = lastSlider();
    expect(props.yearMarks[0].value).toBe(fiscalYearStartMs(2024, 10));
    expect(props.formatValue?.(fiscalYearStartMs(2028, 10))).toBe("FY 2027–2028");
  });

  it("refetches for the year picked, and forgets it back on the current year", async () => {
    renderCost();
    await waitFor(() => expect(sliderProps.length).toBeGreaterThan(0));

    act(() => lastSlider().onChange(fiscalYearStartMs(2028, 1)));
    await waitFor(() => expect(askedYear(treemapCalls().at(-1)!)).toBe("2028"));
    await waitFor(() => expect(lastSlider().value).toBe(fiscalYearStartMs(2028, 1)));
    expect(persisted().fiscalYear).toBe(2028);

    act(() => lastSlider().onChange(fiscalYearStartMs(CURRENT_FY, 1)));
    await waitFor(() => expect(askedYear(treemapCalls().at(-1)!)).toBeNull());
    // Not stored as 2026: a saved report opened next year follows next year.
    expect(persisted().fiscalYear).toBeUndefined();
  });

  it("restores a saved fiscal year into the request", async () => {
    consumedConfig = { view: "table", fiscalYear: 2027 };
    renderCost();
    await waitFor(() => expect(treemapCalls().some((p) => askedYear(p) === "2027")).toBe(true));
    await waitFor(() => expect(lastSlider().value).toBe(fiscalYearStartMs(2027, 1)));
  });
});
