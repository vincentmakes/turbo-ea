/**
 * Tests for the Cost report's card scope (#954). The risk here is not the
 * filter itself but its blast radius: the metric strip, the treemap and the
 * table footer are all derived separately, so a scope applied in the wrong
 * place leaves them disagreeing with each other.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

const COST_ITEMS = [
  { id: "crm", name: "CRM", cost: 100, attributes: {} },
  { id: "crm-web", name: "CRM Web", cost: 20, attributes: {} },
  { id: "erp", name: "ERP", cost: 500, attributes: {} },
];

let consumedConfig: Record<string, unknown> | null = { view: "table" };

beforeEach(() => {
  vi.clearAllMocks();
  consumedConfig = { view: "table" };

  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith("/reports/cost-treemap")) {
      return Promise.resolve({ items: COST_ITEMS }) as never;
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
