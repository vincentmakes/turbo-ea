/**
 * Tests for the Process Map's card scope (#954). Its own risk is the
 * interaction with the pre-existing click-to-zoom drill, which must keep
 * working *inside* a scope rather than escaping it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import ProcessMapReport from "./ProcessMapReport";

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
vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({
    fmt: { format: (v: number) => `$${v}` },
    fmtShort: (v: number) => `$${v}`,
    symbol: "$",
    currency: "USD",
    loading: false,
    invalidate: () => {},
  }),
}));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";

const BP_TYPE = {
  key: "BusinessProcess",
  label: "Business Process",
  color: "#028f00",
  icon: "route",
  is_hidden: false,
  has_hierarchy: true,
  subtypes: [],
  fields_schema: [],
};

const proc = (id: string, name: string, parent_id: string | null) => ({
  id,
  name,
  subtype: "process",
  parent_id,
  attributes: {},
  lifecycle: {},
  app_count: 0,
  total_cost: 0,
  apps: [],
  data_objects: [],
  org_ids: [],
  ctx_ids: [],
});

/**
 *  Order to Cash
 *    └─ Invoicing
 *  Hire to Retire
 */
const ITEMS = [
  proc("otc", "Order to Cash", null),
  proc("inv", "Invoicing", "otc"),
  proc("hire", "Hire to Retire", null),
];

let consumedConfig: Record<string, unknown> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  consumedConfig = null;

  vi.mocked(api.get).mockResolvedValue({
    items: ITEMS,
    organizations: [],
    business_contexts: [],
  } as never);

  vi.mocked(useMetamodel).mockReturnValue({
    types: [BP_TYPE],
    relationTypes: [],
    loading: false,
    getType: (key: string) => (key === "BusinessProcess" ? BP_TYPE : undefined),
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
    reportType: "process-map",
  } as never);
});

function renderMap() {
  return render(
    <MemoryRouter>
      <ProcessMapReport />
    </MemoryRouter>,
  );
}

const chart = () => document.querySelector(".report-chart-area") as HTMLElement;
const toolbar = () => document.querySelector(".report-toolbar") as HTMLElement;

describe("ProcessMapReport scope filter", () => {
  it("renders every process when unscoped", async () => {
    renderMap();
    await waitFor(() =>
      expect(within(chart()).getByText("Order to Cash")).toBeInTheDocument(),
    );
    expect(within(chart()).getByText("Hire to Retire")).toBeInTheDocument();
    expect(within(toolbar()).getByText("All processes")).toBeInTheDocument();
  });

  it("narrows to the scoped subtree", async () => {
    consumedConfig = { scopeIds: ["otc"] };
    renderMap();

    await waitFor(() =>
      expect(within(chart()).getByText("Order to Cash")).toBeInTheDocument(),
    );
    expect(within(chart()).getByText("Invoicing")).toBeInTheDocument();
    expect(within(chart()).queryByText("Hire to Retire")).not.toBeInTheDocument();
  });

  it("shows the scoped count on the chip", async () => {
    consumedConfig = { scopeIds: ["otc"] };
    renderMap();
    await waitFor(() =>
      expect(within(toolbar()).getByText("1 process")).toBeInTheDocument(),
    );
  });

  it("drops a scoped id whose process no longer exists", async () => {
    consumedConfig = { scopeIds: ["deleted-process"] };
    renderMap();

    await waitFor(() =>
      expect(within(chart()).getByText("Hire to Retire")).toBeInTheDocument(),
    );
    expect(within(toolbar()).getByText("All processes")).toBeInTheDocument();
  });

  it("issues no /cards request — the payload already carries the hierarchy", async () => {
    consumedConfig = { scopeIds: ["otc"] };
    renderMap();
    await waitFor(() =>
      expect(within(chart()).getByText("Invoicing")).toBeInTheDocument(),
    );

    const cardCalls = vi
      .mocked(api.get)
      .mock.calls.filter(([path]) => String(path).startsWith("/cards"));
    expect(cardCalls).toHaveLength(0);
  });
});
