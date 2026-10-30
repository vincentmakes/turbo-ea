import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createRef } from "react";
import DataQualityReport from "./DataQualityReport";
import { DATA_QUALITY_BANDS } from "@/lib/dataQualityBands";
import { EOL_COVERAGE_COLORS } from "@/theme";
import { EOL_COVERAGE_BUCKETS } from "@/lib/eol";
import { setViewportWidth } from "@/test/matchMedia";

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
 * jsdom has no canvas, so both charts are the shared EChart double: a test
 * reads the option the page built and delivers a click the way ECharts would,
 * with the clicked datum — which carries its card type and segment key.
 */
vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { echartState } from "@/test/echartMock";
import { hookState } from "@/test/hooks";

/* eslint-disable @typescript-eslint/no-explicit-any -- option trees are plain JSON here */

const COMPLETENESS = "Completeness by Type";
const EOL = "End-of-life coverage";

const QUALITY_COLORS = Object.fromEntries(DATA_QUALITY_BANDS.map((b) => [b.key, b.color]));

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
  echartState.reset();
  hookState.isRtl = false;

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
  } as any);

  vi.mocked(useThumbnailCapture).mockReturnValue({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: vi.fn(),
  } as any);
});

afterEach(() => setViewportWidth(1280));

function renderReport() {
  return render(
    <MemoryRouter>
      <DataQualityReport />
    </MemoryRouter>,
  );
}

/** Deliver a click on one segment of a chart, as ECharts would. */
function clickSegment(chart: string, type: string | undefined, segment: string) {
  act(() => echartState.click(chart, { data: { type, segment } }));
}

/** Both charts have rendered once the report data has landed. */
async function chartsReady() {
  await screen.findByRole("img", { name: EOL });
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
    await chartsReady();
    expect(panelFetchPath()).toBeUndefined();
  });

  it("opens the cards behind a clicked bar segment, scoped to type AND band", async () => {
    renderReport();
    await chartsReady();

    clickSegment(COMPLETENESS, "Application", "partial");

    await waitFor(() => {
      expect(panelFetchPath()).toBe("/reports/data-quality/cards?type=Application&band=partial");
    });
    expect(await screen.findByText("Legacy CRM")).toBeInTheDocument();
  });

  it("maps each segment to its own band", async () => {
    renderReport();
    await chartsReady();

    clickSegment(COMPLETENESS, "Application", "minimal");

    await waitFor(() => {
      expect(panelFetchPath()).toContain("band=minimal");
    });
  });

  it("links a band panel into the inventory, grouped and focused on that band", async () => {
    renderReport();
    await chartsReady();

    clickSegment(COMPLETENESS, "Application", "complete");

    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "/inventory?type=Application&group_by=data_quality&expand_group=complete",
    );
  });

  it("hands a clicked card off to the single-card side panel", async () => {
    const user = userEvent.setup();
    renderReport();
    await chartsReady();

    clickSegment(COMPLETENESS, "Application", "partial");
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
    const option = echartState.byName(EOL).option;
    expect(option.yAxis.data).toEqual(["Application"]);
    expect(option.legend.data).toEqual(["Linked to endoflife.date", "Date entered by hand", "Not recorded"]);
    expect(option.series.map((x: any) => x.itemStyle.color)).toEqual([
      EOL_COVERAGE_COLORS.linked,
      EOL_COVERAGE_COLORS.manual,
      EOL_COVERAGE_COLORS.missing,
    ]);
    expect(option.series.map((x: any) => x.data[0])).toEqual([
      { value: 3, type: "Application", segment: "linked" },
      { value: 1, type: "Application", segment: "manual" },
      { value: 6, type: "Application", segment: "missing" },
    ]);
  });

  it.each([
    ["linked", "eol_linked"],
    ["manual", "eol_manual"],
    ["missing", "eol_missing"],
  ])("opens the cards behind the %s segment", async (segment, scope) => {
    renderReport();
    await chartsReady();

    clickSegment(EOL, "Application", segment);

    await waitFor(() => {
      expect(panelFetchPath()).toBe(
        `/reports/data-quality/cards?type=Application&scope=${scope}`,
      );
    });
  });

  it("titles the EOL panel with the segment's own label", async () => {
    renderReport();
    await chartsReady();

    clickSegment(EOL, "Application", "missing");

    // Header and legend read from the same label map, so the panel can never
    // name a segment differently from the bar it was opened from.
    expect(await screen.findByText("Application · Not recorded")).toBeInTheDocument();
  });

  it("continues into the inventory from Not recorded, and only from there", async () => {
    renderReport();
    await chartsReady();

    clickSegment(EOL, "Application", "missing");
    // The inventory's (empty) End of life pill lists exactly this set.
    expect(await screen.findByRole("link")).toHaveAttribute(
      "href",
      "/inventory?type=Application&eol=__empty__",
    );

    // The inventory filters by STATUS, not by where the data came from, so
    // the other two buckets have no landing that lists the same cards.
    clickSegment(EOL, "Application", "linked");
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

  it.each(EOL_COVERAGE_BUCKETS.map((bucket) => [bucket]))(
    "opens the %s EOL segment on the cards behind it",
    async (bucket) => {
      renderReport();
      await chartsReady();

      clickSegment(EOL, "Application", bucket);

      await waitFor(() =>
        expect(panelFetchPath()).toBe(`/reports/data-quality/cards?type=Application&scope=eol_${bucket}`),
      );
    },
  );

  it.each([
    ["no datum", COMPLETENESS, {}],
    ["no type", COMPLETENESS, { data: { segment: "partial" } }],
    ["an unknown band", COMPLETENESS, { data: { type: "Application", segment: "missing" } }],
    ["no EOL type", EOL, { data: { segment: "missing" } }],
    ["a band on the EOL chart", EOL, { data: { type: "Application", segment: "partial" } }],
    ["a non-string EOL segment", EOL, { data: { type: "Application", segment: 1 } }],
  ])("opens nothing for a click with %s", async (_why, chart, params) => {
    renderReport();
    await chartsReady();

    act(() => echartState.click(chart, params));

    expect(panelFetchPath()).toBeUndefined();
    expect(screen.queryByText("Legacy CRM")).not.toBeInTheDocument();
  });
});

describe("DataQualityReport charts", () => {
  it("stacks the three bands in order, in the band colours, rounding only the last", async () => {
    renderReport();
    await chartsReady();

    const option = echartState.byName(COMPLETENESS).option;
    expect(option.legend.data).toEqual(["Complete", "Partial", "Minimal"]);
    expect(option.legend.selectedMode).toBe(false);
    expect(option.series.map((x: any) => x.itemStyle.color)).toEqual([
      QUALITY_COLORS.complete,
      QUALITY_COLORS.partial,
      QUALITY_COLORS.minimal,
    ]);
    expect(option.series.map((x: any) => x.itemStyle.borderRadius)).toEqual([0, 0, [0, 4, 4, 0]]);
    expect(option.series[1].data[0]).toEqual({ value: 3, type: "Application", segment: "partial" });
    expect(option.yAxis.position).toBe("left");
  });

  it("mirrors the bars in RTL", async () => {
    hookState.isRtl = true;
    renderReport();
    await chartsReady();

    for (const name of [COMPLETENESS, EOL]) {
      const option = echartState.byName(name).option;
      expect(option.series.map((x: any) => x.itemStyle.borderRadius)).toEqual([0, 0, [4, 0, 0, 4]]);
      expect(option.yAxis.position).toBe("right");
      expect(option.xAxis.inverse).toBe(true);
    }
  });

  it("draws both charts at the export pixel ratio", async () => {
    renderReport();
    await chartsReady();

    expect(echartState.byName(COMPLETENESS).devicePixelRatio).toBe(2);
    expect(echartState.byName(EOL).devicePixelRatio).toBe(2);
  });

  it("gives the type labels a 150px gutter on a wide screen", async () => {
    renderReport();
    await chartsReady();

    const axis = echartState.byName(COMPLETENESS).option.yAxis.axisLabel;
    expect(axis.width).toBe(150);
    expect(axis.fontSize).toBe(12);
    expect(echartState.byName(EOL).option.yAxis.axisLabel.width).toBe(150);
  });

  it("narrows the label gutter and the ticks on a phone", async () => {
    setViewportWidth(500);
    renderReport();
    await chartsReady();

    for (const name of [COMPLETENESS, EOL]) {
      const option = echartState.byName(name).option;
      expect(option.yAxis.axisLabel.width).toBe(96);
      expect(option.yAxis.axisLabel.fontSize).toBe(11);
      expect(option.xAxis.axisLabel.fontSize).toBe(11);
    }
  });

  it("sizes each chart to its minimum height for a few rows", async () => {
    renderReport();
    await chartsReady();

    // The height is on the chart itself, so print.css's cap on the chart
    // container shrinks the whole block, not just the canvas inside a box.
    expect(echartState.byName(COMPLETENESS).style?.height).toBe(250);
    expect(echartState.byName(EOL).style?.height).toBe(160);
    expect(screen.getByRole("img", { name: COMPLETENESS })).toHaveStyle({ height: "250px" });
    expect(screen.getByRole("img", { name: EOL })).toHaveStyle({ height: "160px" });
    // No sized wrapper is left around either chart.
    for (const name of [COMPLETENESS, EOL]) {
      expect(screen.getByRole("img", { name }).parentElement?.style.height).toBe("");
    }
  });

  it("grows each chart by a fixed height per row", async () => {
    const types = ["A", "B", "C", "D", "E", "F"];
    vi.mocked(api.get).mockImplementation(() =>
      Promise.resolve({
        ...MOCK_DQ,
        by_type: types.map((type) => ({ ...MOCK_DQ.by_type[0], type })),
        eol_coverage: types.slice(0, 3).map((type) => ({ ...MOCK_DQ.eol_coverage[0], type })),
      }),
    );
    renderReport();
    await chartsReady();

    // 6 rows x 50 px, and 3 rows x 70 px.
    expect(echartState.byName(COMPLETENESS).style?.height).toBe(300);
    expect(echartState.byName(EOL).style?.height).toBe(210);
    // A type the metamodel does not know is labelled by its key.
    expect(echartState.byName(COMPLETENESS).option.yAxis.data).toEqual(types);
  });

  it("formats the tooltip with the type, its pluralised total and each band's share", async () => {
    renderReport();
    await chartsReady();

    const formatter = echartState.byName(COMPLETENESS).option.tooltip.formatter;
    const html = formatter([
      { name: "A<B", seriesName: "Complete", value: 3, marker: "<i></i>", color: "" },
      { name: "A<B", seriesName: "Partial", value: 1, marker: "<i></i>", color: "" },
    ]);
    expect(html).toContain('<div style="font-weight:700">A&lt;B</div>');
    expect(html).toContain('<div style="opacity:.7">4 total items</div>');
    expect(html).toContain("<div><i></i> Complete: 3 (75%)</div>");
    expect(html).toContain("<div><i></i> Partial: 1 (25%)</div>");
    expect(formatter({ name: "X", seriesName: "Minimal", value: 1, marker: "", color: "" })).toContain(
      '<div style="opacity:.7">1 total item</div>',
    );
  });

  it("leaves the EOL chart out when no card can have an end of life", async () => {
    vi.mocked(api.get).mockImplementation(() => Promise.resolve({ ...MOCK_DQ, eol_coverage: [] }));
    renderReport();

    await screen.findByRole("img", { name: COMPLETENESS });
    expect(screen.queryByText("End-of-life coverage")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("echart")).toHaveLength(1);
  });
});
