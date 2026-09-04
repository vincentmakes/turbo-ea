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
/**
 * The report renders more than one BarChart (completeness by type, then EOL
 * coverage at the foot), and BOTH are now clickable. Each `Bar` therefore has
 * to fire with its OWN chart's datum: a module-level `chartData` shared by
 * every chart would hand the EOL bars the completeness chart's rows, and the
 * `seg-*` testids would collide wherever a card type appears in both charts.
 * A context carries each chart's data down to its own bars, and the testid is
 * namespaced by the chart's index.
 */
let charts: Record<string, unknown>[][] = [];
let nextChartIndex = 0;
vi.mock("recharts", async () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { createContext, useContext, useState } =
    await vi.importActual<typeof import("react")>("react");
  const ChartCtx = createContext<{ data: Record<string, unknown>[]; index: number }>({
    data: [],
    index: 0,
  });
  return {
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    BarChart: ({ data, children }: any) => {
      // Claimed once per mounted chart, not per render: opening the panel
      // re-renders the report, and an index derived from `charts.length`
      // would renumber every chart on each pass and invalidate the testids.
      const [index] = useState(() => nextChartIndex++);
      charts[index] = data ?? [];
      return (
        <ChartCtx.Provider value={{ data: data ?? [], index }}>
          <div data-testid={`bar-chart-${index}`}>{children}</div>
        </ChartCtx.Provider>
      );
    },
    Bar: ({ dataKey, onClick }: any) => {
      const { data, index } = useContext(ChartCtx);
      return (
        <>
          {data.map((entry: any, i: number) => (
            <button
              key={i}
              data-testid={`seg-${index}-${dataKey}-${entry.type}`}
              onClick={() => onClick?.(entry, i)}
            />
          ))}
        </>
      );
    },
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
  eol_coverage: [
    { type: "Application", linked: 3, manual: 1, missing: 6, total: 10 },
  ],
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
  charts = [];
  nextChartIndex = 0;

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
function panelFetchPath(match?: string): string | undefined {
  const paths = vi
    .mocked(api.get)
    .mock.calls.map((c) => c[0] as string)
    .filter((p) => p.startsWith("/reports/data-quality/cards"));
  // The panel refetches as the scope changes, so a test that clicks twice
  // asks for the call it means by a fragment of the query.
  return match ? paths.find((p) => p.includes(match)) : paths[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DataQualityReport drill-down", () => {
  it("does not fetch panel cards until something is clicked", async () => {
    renderReport();
    await screen.findByTestId("bar-chart-0");
    expect(panelFetchPath()).toBeUndefined();
  });

  it("opens the cards behind a clicked bar segment, scoped to type AND band", async () => {
    const user = userEvent.setup();
    renderReport();

    await user.click(await screen.findByTestId("seg-0-Partial-Application"));

    await waitFor(() => {
      expect(panelFetchPath()).toBe("/reports/data-quality/cards?type=Application&band=partial");
    });
    expect(await screen.findByText("Legacy CRM")).toBeInTheDocument();
  });

  it("maps each segment to its own band", async () => {
    const user = userEvent.setup();
    renderReport();

    await user.click(await screen.findByTestId("seg-0-Minimal-Application"));

    await waitFor(() => {
      expect(panelFetchPath()).toContain("band=minimal");
    });
  });

  it("links a band panel into the inventory, grouped and focused on that band", async () => {
    const user = userEvent.setup();
    renderReport();

    await user.click(await screen.findByTestId("seg-0-Complete-Application"));

    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "/inventory?type=Application&group_by=data_quality&expand_group=complete",
    );
  });

  it("hands a clicked card off to the single-card side panel", async () => {
    const user = userEvent.setup();
    renderReport();

    await user.click(await screen.findByTestId("seg-0-Partial-Application"));
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

  it("charts EOL coverage at the foot rather than as another KPI tile", async () => {
    renderReport();

    expect(await screen.findByText("End-of-life coverage")).toBeInTheDocument();
    // The segment labels live in the Recharts legend, which the double
    // renders as null — assert on the data the chart was handed instead.
    const eolChart = charts[charts.length - 1];
    expect(eolChart).toEqual([
      expect.objectContaining({
        type: "Application",
        "Linked to endoflife.date": 3,
        "Date entered by hand": 1,
        "Not recorded": 6,
      }),
    ]);
  });

  it.each([
    ["Linked to endoflife.date", "eol_linked"],
    ["Date entered by hand", "eol_manual"],
    ["Not recorded", "eol_missing"],
  ])("opens the cards behind the %s segment", async (label, scope) => {
    const user = userEvent.setup();
    renderReport();

    // Chart 1 is the EOL coverage chart; chart 0 is completeness by type.
    await user.click(await screen.findByTestId(`seg-1-${label}-Application`));

    await waitFor(() => {
      expect(panelFetchPath()).toBe(
        `/reports/data-quality/cards?type=Application&scope=${scope}`,
      );
    });
  });

  it("titles the EOL panel with the segment's own label", async () => {
    const user = userEvent.setup();
    renderReport();

    await user.click(await screen.findByTestId("seg-1-Not recorded-Application"));

    // Header and legend read from the same label map, so the panel can never
    // name a segment differently from the bar it was opened from.
    expect(await screen.findByText("Application · Not recorded")).toBeInTheDocument();
  });

  it("continues into the inventory from Not recorded, and only from there", async () => {
    const user = userEvent.setup();
    renderReport();

    await user.click(await screen.findByTestId("seg-1-Not recorded-Application"));
    // The inventory's (empty) End of life pill lists exactly this set.
    expect(await screen.findByRole("link")).toHaveAttribute(
      "href",
      "/inventory?type=Application&eol=__empty__",
    );

    // The inventory filters by STATUS, not by where the data came from, so
    // the other two buckets have no landing that lists the same cards.
    await user.click(screen.getByTestId("seg-1-Linked to endoflife.date-Application"));
    await waitFor(() =>
      expect(panelFetchPath("eol_linked")).toBe(
        "/reports/data-quality/cards?type=Application&scope=eol_linked",
      ),
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
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
