import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createRef } from "react";
import DataQualityReport from "./DataQualityReport";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  isAbortError: (e: unknown) => e instanceof Error && e.name === "AbortError",
}));

vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
vi.mock("@/hooks/useSavedReport", () => ({ useSavedReport: vi.fn() }));
vi.mock("@/hooks/useThumbnailCapture", () => ({ useThumbnailCapture: vi.fn() }));
vi.mock("./SaveReportDialog", () => ({ default: () => null }));

vi.mock("@/components/CardDetailSidePanel", () => ({
  default: ({ cardId, open }: { cardId: string | null; open: boolean }) =>
    open ? <div data-testid="card-side-panel">{cardId}</div> : null,
}));

/**
 * Recharts renders nothing measurable in jsdom (ResponsiveContainer has zero
 * width), so the stacked bar is stubbed down to the one thing under test: each
 * <Bar> gets a button per datum that fires its onClick with that datum, which
 * is exactly the contract the real component relies on.
 */
let chartData: Record<string, unknown>[] = [];
vi.mock("recharts", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return {
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    BarChart: ({ data, children }: any) => {
      chartData = data ?? [];
      return <div data-testid="bar-chart">{children}</div>;
    },
    Bar: ({ dataKey, onClick }: any) => (
      <>
        {chartData.map((entry, i) => (
          <button
            key={i}
            data-testid={`seg-${dataKey}-${entry.type}`}
            onClick={() => onClick?.(entry, i)}
          />
        ))}
      </>
    ),
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
});

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_TYPES = [
  {
    key: "Application",
    label: "Application",
    icon: "apps",
    color: "#0f7eb5",
    is_hidden: false,
    fields_schema: [],
  },
];

const MOCK_DQ = {
  overall_data_quality: 62,
  total_items: 10,
  with_lifecycle: 6,
  orphaned: 3,
  stale: 2,
  by_type: [
    {
      type: "Application",
      total: 10,
      complete: 4,
      partial: 3,
      minimal: 3,
      avg_data_quality: 62,
    },
  ],
  worst_items: [],
};

const MOCK_CARDS = {
  total: 3,
  items: [
    { id: "c1", name: "Legacy CRM", type: "Application", subtype: null, data_quality: 55, updated_at: null },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  chartData = [];

  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith("/reports/data-quality/cards")) return Promise.resolve(MOCK_CARDS);
    if (path.startsWith("/reports/data-quality")) return Promise.resolve(MOCK_DQ);
    return Promise.resolve({});
  });

  vi.mocked(useMetamodel).mockReturnValue({
    types: MOCK_TYPES,
    relationTypes: [],
    loading: false,
    getType: (key: string) => MOCK_TYPES.find((t) => t.key === key),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  vi.mocked(useSavedReport).mockReturnValue({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: vi.fn(),
    loadedConfig: null,
    consumeConfig: vi.fn().mockReturnValue(null),
    resetSavedReport: vi.fn(),
    persistConfig: vi.fn(),
    resetAll: vi.fn(),
    reportType: "data-quality",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  vi.mocked(useThumbnailCapture).mockReturnValue({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
});

function renderReport() {
  return render(
    <MemoryRouter>
      <DataQualityReport />
    </MemoryRouter>,
  );
}

/** The path the panel fetched, or undefined if it never fetched. */
function panelFetchPath(): string | undefined {
  return vi
    .mocked(api.get)
    .mock.calls.map((c) => c[0] as string)
    .find((p) => p.startsWith("/reports/data-quality/cards"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DataQualityReport drill-down", () => {
  it("does not fetch panel cards until something is clicked", async () => {
    renderReport();
    await screen.findByTestId("bar-chart");
    expect(panelFetchPath()).toBeUndefined();
  });

  it("opens the cards behind a clicked bar segment, scoped to type AND band", async () => {
    const user = userEvent.setup();
    renderReport();

    await user.click(await screen.findByTestId("seg-Partial-Application"));

    await waitFor(() => {
      expect(panelFetchPath()).toBe("/reports/data-quality/cards?type=Application&band=partial");
    });
    expect(await screen.findByText("Legacy CRM")).toBeInTheDocument();
  });

  it("maps each segment to its own band", async () => {
    const user = userEvent.setup();
    renderReport();

    await user.click(await screen.findByTestId("seg-Minimal-Application"));

    await waitFor(() => {
      expect(panelFetchPath()).toContain("band=minimal");
    });
  });

  it("links a band panel into the inventory, grouped and focused on that band", async () => {
    const user = userEvent.setup();
    renderReport();

    await user.click(await screen.findByTestId("seg-Complete-Application"));

    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "/inventory?type=Application&group_by=data_quality&expand_group=complete",
    );
  });

  it("hands a clicked card off to the single-card side panel", async () => {
    const user = userEvent.setup();
    renderReport();

    await user.click(await screen.findByTestId("seg-Partial-Application"));
    await user.click(await screen.findByText("Legacy CRM"));

    expect(await screen.findByTestId("card-side-panel")).toHaveTextContent("c1");
    // The aggregate panel steps aside rather than stacking two drawers.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("opens orphaned cards from the KPI tile and links them into the inventory", async () => {
    const user = userEvent.setup();
    renderReport();

    await user.click(await screen.findByText("Orphaned"));

    await waitFor(() => {
      expect(panelFetchPath()).toBe("/reports/data-quality/cards?scope=orphaned");
    });
    // No card type and no grouping: the tile counts across every type, so
    // the landing has to as well.
    expect(await screen.findByRole("link")).toHaveAttribute("href", "/inventory?orphaned=true");
  });

  it("links the stale tile to the matching inventory filter", async () => {
    const user = userEvent.setup();
    renderReport();

    await user.click(await screen.findByText("Stale (90+ days)"));

    await waitFor(() => {
      expect(panelFetchPath()).toBe("/reports/data-quality/cards?scope=stale");
    });
    expect(await screen.findByRole("link")).toHaveAttribute("href", "/inventory?stale=true");
  });

  it("opens a whole type from the average-completion row", async () => {
    const user = userEvent.setup();
    renderReport();

    // The avg-completion list repeats the type label under its own heading.
    const rows = await screen.findAllByText("Application");
    await user.click(rows[rows.length - 1]);

    await waitFor(() => {
      expect(panelFetchPath()).toBe("/reports/data-quality/cards?type=Application");
    });
  });
});
