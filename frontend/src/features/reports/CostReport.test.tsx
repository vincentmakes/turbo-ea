/**
 * Tests for the Cost report's card scope (#954) and its fiscal-year indicator.
 *
 * Scope: the risk is not the filter itself but its blast radius — the metric
 * strip, the treemap and the table footer are all derived separately, so a
 * scope applied in the wrong place leaves them disagreeing with each other.
 *
 * Fiscal year: the server shows the current year only and names it; the page
 * must say which year that is and never ask for another.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
// Reset switches to the chart view; jsdom has no canvas for ECharts to draw on.
vi.mock("@/components/charts/EChart", async () => ({
  ...(await vi.importActual<object>("@/components/charts/EChart")),
  default: () => null,
}));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";

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

/** A related type with a cost field, linked to Application — a Cost Source. */
const INIT_TYPE = {
  key: "Initiative",
  label: "Initiative",
  color: "#33cc58",
  is_hidden: false,
  has_hierarchy: false,
  fields_schema: [
    {
      section: "Costs",
      fields: [{ key: "costBudget", label: "Budget", type: "cost" }],
    },
  ],
};

const REL_INIT_APP = {
  key: "relInitiativeToApplication",
  label: "affects",
  source_type_key: "Initiative",
  target_type_key: "Application",
  is_hidden: false,
};

const SOURCE = "Initiative:costBudget";

/** Initiative i1 (50) improves CRM and ERP; i2 (10) only HR. Tiles add up to 110. */
const SHARED_ITEMS = [
  { id: "crm", name: "CRM", cost: 50, attributes: {}, source_ids: ["i1"] },
  { id: "erp", name: "ERP", cost: 50, attributes: {}, source_ids: ["i1"] },
  { id: "hr", name: "HR", cost: 10, attributes: {}, source_ids: ["i2"] },
];

/** The same split equally: i1 gives 25 to each of its two applications. */
const SPLIT_ITEMS = [
  { id: "crm", name: "CRM", cost: 25, attributes: {}, source_ids: ["i1"] },
  { id: "erp", name: "ERP", cost: 25, attributes: {}, source_ids: ["i1"] },
  { id: "hr", name: "HR", cost: 10, attributes: {}, source_ids: ["i2"] },
];

/** Nothing shared: each initiative improves one application. */
const UNSHARED_ITEMS = [
  { id: "crm", name: "CRM", cost: 50, attributes: {}, source_ids: ["i1"] },
  { id: "hr", name: "HR", cost: 10, attributes: {}, source_ids: ["i2"] },
];

/** A drilled level: initiatives linked to CRM, by their direct cost. */
const DRILL_ITEMS = [{ id: "i1", name: "Init One", cost: 25, attributes: {} }];

let aggregateResponse: Record<string, unknown> = {};

const COST_ITEMS = [
  { id: "crm", name: "CRM", cost: 100, attributes: {} },
  { id: "crm-web", name: "CRM Web", cost: 20, attributes: {} },
  { id: "erp", name: "ERP", cost: 500, attributes: {} },
];

let fyStart = 1;

let consumedConfig: Record<string, unknown> | null = { view: "table" };

beforeEach(() => {
  vi.clearAllMocks();
  consumedConfig = { view: "table" };
  fyStart = 1;

  aggregateResponse = {
    items: SHARED_ITEMS,
    total: 110,
    source_costs: { i1: 50, i2: 10 },
    fiscal_year: 2026,
    fiscal_year_start: 1,
  };

  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith("/reports/cost-treemap") && path.includes("parent_card_id=")) {
      return Promise.resolve({
        items: DRILL_ITEMS,
        total: 25,
        fiscal_year: 2026,
        fiscal_year_start: 1,
      }) as never;
    }
    if (path.startsWith("/reports/cost-treemap") && path.includes("aggregate=")) {
      return Promise.resolve(aggregateResponse) as never;
    }
    if (path.startsWith("/reports/cost-treemap")) {
      return Promise.resolve({
        items: COST_ITEMS,
        total: 620,
        fiscal_year: 2026,
        fiscal_year_start: fyStart,
      }) as never;
    }
    // The scope hook's own hierarchy fetch.
    return Promise.resolve({ items: HIERARCHY, total: HIERARCHY.length }) as never;
  });

  vi.mocked(useMetamodel).mockReturnValue({
    types: [APP_TYPE, INIT_TYPE],
    relationTypes: [REL_INIT_APP],
    loading: false,
    getType: (key: string) =>
      key === "Application" ? APP_TYPE : key === "Initiative" ? INIT_TYPE : undefined,
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
  const indicator = () => document.querySelector('[data-testid="cost-fiscal-year"]');

  it("names the current fiscal year the figures are for", async () => {
    renderCost();
    await waitFor(() => expect(indicator()).not.toBeNull());
    expect(indicator()).toHaveTextContent("Current fiscal year: FY 2026");
    expect(within(toolbar()).getByText("Current fiscal year: FY 2026")).toBeInTheDocument();
  });

  it("names a fiscal year that straddles two calendar years by both", async () => {
    fyStart = 10;
    renderCost();
    await waitFor(() => expect(indicator()).toHaveTextContent("Current fiscal year: FY 2025–2026"));
  });

  it("never asks the server for a particular year", async () => {
    renderCost();
    await waitFor(() => expect(indicator()).not.toBeNull());
    const calls = vi
      .mocked(api.get)
      .mock.calls.map(([path]) => String(path))
      .filter((path) => path.startsWith("/reports/cost-treemap"));
    expect(calls.length).toBeGreaterThan(0);
    for (const path of calls) expect(path).not.toContain("fiscal_year");
  });

  it("offers no year picker", async () => {
    renderCost();
    await waitFor(() => expect(indicator()).not.toBeNull());
    expect(document.querySelector(".MuiSlider-root")).toBeNull();
  });
});

describe("CostReport attribution (#1362)", () => {
  const attributionSelect = () => document.querySelector('[data-testid="cost-attribution"]');
  const treemapCalls = () =>
    vi
      .mocked(api.get)
      .mock.calls.map(([path]) => String(path))
      .filter((path) => path.startsWith("/reports/cost-treemap"));
  const lastPersisted = () => {
    const calls = vi.mocked(useSavedReport).mock.results[0].value.persistConfig.mock.calls;
    return calls[calls.length - 1][0] as Record<string, unknown>;
  };
  const DRILL_FRAME = {
    cardId: "crm",
    cardName: "CRM",
    sources: [{ typeKey: "Initiative", fieldKey: "costBudget", label: "Initiative · Budget" }],
  };

  it("shows the attribution select only while a cost source is active", async () => {
    const direct = renderCost();
    await waitFor(() => expect(within(chart()).getAllByText("ERP").length).toBeGreaterThan(0));
    expect(within(toolbar()).getAllByText("Cost Source").length).toBeGreaterThan(0);
    expect(attributionSelect()).toBeNull();
    direct.unmount();

    consumedConfig = { view: "table", costSources: [SOURCE] };
    const aggregate = renderCost();
    await waitFor(() => expect(attributionSelect()).not.toBeNull());
    expect(within(toolbar()).getByText("Full")).toBeInTheDocument();
    aggregate.unmount();

    // Drilled into a card: the drilled shares depend on it too.
    consumedConfig = { view: "table", drillStack: [DRILL_FRAME] };
    renderCost();
    await waitFor(() => expect(within(chart()).getAllByText("Init One").length).toBeGreaterThan(0));
    expect(attributionSelect()).not.toBeNull();
  });

  it("sends attribution=split and nothing for full", async () => {
    consumedConfig = { view: "table", costSources: [SOURCE] };
    const full = renderCost();
    await waitFor(() => expect(within(chart()).getAllByText("HR").length).toBeGreaterThan(0));
    const fullCalls = treemapCalls();
    expect(fullCalls.some((c) => c.includes("aggregate=Initiative%3AcostBudget"))).toBe(true);
    for (const c of fullCalls) expect(c).not.toContain("attribution");
    full.unmount();

    vi.mocked(api.get).mockClear();
    aggregateResponse = { ...aggregateResponse, items: SPLIT_ITEMS };
    consumedConfig = { view: "table", costSources: [SOURCE], attribution: "split" };
    const split = renderCost();
    await waitFor(() =>
      expect(treemapCalls()).toContain(
        "/reports/cost-treemap?type=Application&aggregate=Initiative%3AcostBudget&attribution=split",
      ),
    );
    split.unmount();

    vi.mocked(api.get).mockClear();
    consumedConfig = { view: "table", drillStack: [DRILL_FRAME], attribution: "split" };
    renderCost();
    await waitFor(() =>
      expect(treemapCalls()).toContain(
        "/reports/cost-treemap?type=Initiative&cost_field=costBudget&parent_card_id=crm&attribution=split",
      ),
    );
  });

  it("sends no attribution while drilled in full", async () => {
    consumedConfig = { view: "table", drillStack: [DRILL_FRAME], attribution: "full" };
    renderCost();
    await waitFor(() =>
      expect(treemapCalls()).toContain(
        "/reports/cost-treemap?type=Initiative&cost_field=costBudget&parent_card_id=crm",
      ),
    );
    for (const c of treemapCalls()) expect(c).not.toContain("attribution");
  });

  it("counts a shared source once in Total Cost and says so", async () => {
    consumedConfig = { view: "table", costSources: [SOURCE] };
    renderCost();
    await waitFor(() => expect(within(chart()).getAllByText("HR").length).toBeGreaterThan(0));
    // The tiles add up to 110; the Total counts initiative i1 once: 50 + 10.
    expect(within(chart()).getAllByText("$50")).toHaveLength(2);
    expect(within(chart()).getAllByText("$60").length).toBeGreaterThan(0);
    // The table footer is the column's own sum (the tiles), not the KPI.
    expect(within(chart()).getAllByText("$110")).toHaveLength(1);
    expect(within(chart()).getByText("Shared costs counted once")).toBeInTheDocument();
    // The two applications sharing i1 are marked; HR is not.
    const marks = document.querySelectorAll('[data-testid="cost-shared-source"]');
    expect(marks).toHaveLength(2);
    for (const m of marks) {
      expect(m).toHaveAttribute("aria-label", "Some of its sources are shared with other cards");
    }
    const hrRow = within(chart()).getByText("HR").closest("tr") as HTMLElement;
    expect(hrRow.querySelector('[data-testid="cost-shared-source"]')).toBeNull();
    // The shares read against the tiles as shown (110), so they add up to
    // 100%: 50 of 110 twice, 10 of 110 — never 83.3% + 83.3% + 16.7%.
    expect(within(chart()).getAllByText("45.5%")).toHaveLength(2);
    expect(within(chart()).getByText("9.1%")).toBeInTheDocument();
    expect(within(chart()).queryByText("83.3%")).not.toBeInTheDocument();
    // The average is the mean of the displayed tiles: 110 / 3, not 60 / 3.
    const average = within(chart()).getByText("Average").closest(".MuiPaper-root") as HTMLElement;
    expect(within(average).getByText(`$${110 / 3}`)).toBeInTheDocument();
    // The top driver's share reads against the same tile sum.
    const top = within(chart()).getByText("Top Cost Driver").closest(".MuiPaper-root") as HTMLElement;
    expect(within(top).getByText("$50 (45%)")).toBeInTheDocument();
    expect(document.querySelector(".report-print-params")).toHaveTextContent("Attribution: Full");
  });

  it("drops the caption when nothing is shared", async () => {
    aggregateResponse = { ...aggregateResponse, items: UNSHARED_ITEMS };
    consumedConfig = { view: "table", costSources: [SOURCE] };
    renderCost();
    await waitFor(() => expect(within(chart()).getAllByText("HR").length).toBeGreaterThan(0));
    expect(within(chart()).getAllByText("$60").length).toBeGreaterThan(0);
    expect(within(chart()).queryByText("Shared costs counted once")).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="cost-shared-source"]')).toBeNull();
  });

  it("split mode totals the tiles", async () => {
    // No source_costs: a Total built from them would read $0.
    aggregateResponse = { items: SPLIT_ITEMS, total: 60, fiscal_year: 2026, fiscal_year_start: 1 };
    consumedConfig = { view: "table", costSources: [SOURCE], attribution: "split" };
    renderCost();
    await waitFor(() => expect(within(chart()).getAllByText("$25")).toHaveLength(2));
    expect(within(chart()).getAllByText("$60").length).toBeGreaterThan(0);
    expect(within(chart()).queryByText("$0")).not.toBeInTheDocument();
    expect(within(chart()).queryByText("Shared costs counted once")).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="cost-shared-source"]')).toBeNull();
    expect(document.querySelector(".report-print-params")).toHaveTextContent(
      "Attribution: Split equally",
    );
  });

  it("restores attribution from a saved config and persists it", async () => {
    consumedConfig = { view: "table", costSources: [SOURCE], attribution: "split" };
    const split = renderCost();
    await waitFor(() => expect(within(toolbar()).getByText("Split equally")).toBeInTheDocument());
    await waitFor(() => expect(lastPersisted().attribution).toBe("split"));
    expect(within(toolbar()).queryByText("Full")).not.toBeInTheDocument();
    split.unmount();
  });

  it("reads an unknown saved attribution as full", async () => {
    consumedConfig = { view: "table", costSources: [SOURCE], attribution: "half" };
    renderCost();
    await waitFor(() => expect(within(chart()).getAllByText("HR").length).toBeGreaterThan(0));
    expect(within(toolbar()).getByText("Full")).toBeInTheDocument();
    expect(lastPersisted().attribution).toBe("full");
    for (const c of treemapCalls()) expect(c).not.toContain("attribution");
  });

  it("keeps the drill stack when attribution changes", async () => {
    consumedConfig = { view: "table", costSources: [SOURCE], drillStack: [DRILL_FRAME] };
    renderCost();
    await waitFor(() => expect(within(chart()).getAllByText("Init One").length).toBeGreaterThan(0));

    fireEvent.mouseDown(within(toolbar()).getByRole("combobox", { name: "Attribution" }));
    fireEvent.click(await screen.findByRole("option", { name: "Split equally" }));

    await waitFor(() =>
      expect(treemapCalls()).toContain(
        "/reports/cost-treemap?type=Initiative&cost_field=costBudget&parent_card_id=crm&attribution=split",
      ),
    );
    await waitFor(() => expect(lastPersisted().attribution).toBe("split"));
    expect(lastPersisted().drillStack).toEqual([DRILL_FRAME]);
    // Still drilled: the breadcrumb names the card.
    expect(screen.getByRole("navigation", { name: "Drill-down path" })).toHaveTextContent("CRM");
  });

  it("resets attribution to full", async () => {
    consumedConfig = { view: "table", costSources: [SOURCE], attribution: "split" };
    renderCost();
    await waitFor(() => expect(within(toolbar()).getByText("Split equally")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    await waitFor(() => expect(lastPersisted().attribution).toBe("full"));
  });
});
