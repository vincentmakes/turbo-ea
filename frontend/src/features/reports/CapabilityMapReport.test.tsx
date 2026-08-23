import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createRef } from "react";
import CapabilityMapReport from "./CapabilityMapReport";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
vi.mock("@/hooks/useSavedReport", () => ({ useSavedReport: vi.fn() }));
vi.mock("@/hooks/useThumbnailCapture", () => ({ useThumbnailCapture: vi.fn() }));
vi.mock("@/hooks/useTimeline", () => ({ useTimeline: vi.fn() }));
vi.mock("./SaveReportDialog", () => ({ default: () => null }));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));

// Captured so the milestone/delta/spotlight wiring can be asserted at the
// slider boundary, same pattern as DependencyReport.test.tsx.
type SliderProps = {
  milestones?: { value: number; activating: number; disappearing: number }[];
  delta?: { arriving: number; retiring: number };
  onMilestoneClick?: (from: number, to: number) => void;
  milestoneCards?: (
    from: number,
    to: number,
  ) => { id: string; name: string; kind: string; color?: string }[];
  onMilestoneCardClick?: (card: { id: string; name: string; kind: string }) => void;
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
import { useTimeline } from "@/hooks/useTimeline";

// ---------------------------------------------------------------------------
// Test data
//
//   Sales (L1)                     Finance (L1)
//     └─ Lead Management (L2)        └─ Billing (L2)
//          └─ Lead Scoring (L3)
//               · app: Scoring Engine
//                                          · app: Invoicer
// ---------------------------------------------------------------------------

const MOCK_TYPES = [
  {
    key: "BusinessCapability",
    label: "Business Capability",
    icon: "account_tree",
    color: "#003399",
    is_hidden: false,
    fields_schema: [],
  },
];

const app = (id: string, name: string) => ({
  id,
  name,
  subtype: null,
  attributes: {},
  lifecycle: {},
  org_ids: [],
  related_by_type: {},
  tag_ids: [],
});

const cap = (
  id: string,
  name: string,
  parent_id: string | null,
  apps: ReturnType<typeof app>[] = [],
) => ({
  id,
  name,
  parent_id,
  app_count: apps.length,
  total_cost: 0,
  risk_count: 0,
  attributes: {},
  apps,
});

const SCORING_ENGINE = app("a1", "Scoring Engine");
const INVOICER = app("a2", "Invoicer");

const HEATMAP = {
  items: [
    cap("sales", "Sales", null),
    cap("leads", "Lead Management", "sales"),
    cap("scoring", "Lead Scoring", "leads", [SCORING_ENGINE]),
    cap("finance", "Finance", null),
    cap("billing", "Billing", "finance", [INVOICER]),
  ],
  metric: "app_count",
  filterable_types: {},
  fields_schema: [],
  tag_groups: [],
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let consumedConfig: Record<string, unknown> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  consumedConfig = null;
  sliderProps.length = 0;

  vi.mocked(useTimeline).mockReturnValue({
    timelineDate: Date.now(),
    setTimelineDate: vi.fn(),
    todayMs: Date.now(),
    isTimeTraveling: false,
    persistValue: undefined,
    printParam: null,
    restore: vi.fn(),
    reset: vi.fn(),
  });

  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith("/reports/capability-heatmap")) {
      return Promise.resolve(HEATMAP) as never;
    }
    // The scope dialog's own card fetch.
    return Promise.resolve({
      items: HEATMAP.items.map((c) => ({
        id: c.id,
        name: c.name,
        type: "BusinessCapability",
        parent_id: c.parent_id,
      })),
      total: HEATMAP.items.length,
    }) as never;
  });

  vi.mocked(useMetamodel).mockReturnValue({
    types: MOCK_TYPES,
    relationTypes: [],
    loading: false,
    getType: (key: string) => MOCK_TYPES.find((t) => t.key === key),
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
    reportType: "capability-map",
  } as never);

  vi.mocked(useThumbnailCapture).mockReturnValue({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: vi.fn(),
  } as never);
});

function renderMap() {
  return render(
    <MemoryRouter>
      <CapabilityMapReport />
    </MemoryRouter>,
  );
}

/** The report's chart area, excluding the toolbar chip and the scope dialog. */
function chart() {
  return document.querySelector(".report-chart-area") as HTMLElement;
}

/**
 * The controls row. Scoped because the scope count also renders in the
 * print-parameter strip, which is exactly what it should do.
 */
function toolbar() {
  return document.querySelector(".report-toolbar") as HTMLElement;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CapabilityMapReport scope filter", () => {
  it("renders the whole capability tree when no scope is set", async () => {
    renderMap();
    await waitFor(() => expect(within(chart()).getByText("Sales")).toBeInTheDocument());

    expect(within(chart()).getByText("Finance")).toBeInTheDocument();
    expect(within(chart()).getByText("Lead Management")).toBeInTheDocument();
    // Display depth defaults to 2, so the L3 capability is rolled up.
    expect(within(chart()).queryByText("Lead Scoring")).not.toBeInTheDocument();
    expect(within(toolbar()).getByText("All capabilities")).toBeInTheDocument();
  });

  it("narrows the map to the scoped subtree and drops everything else", async () => {
    consumedConfig = { scopeIds: ["leads"] };
    renderMap();
    await waitFor(() =>
      expect(within(chart()).getByText("Lead Management")).toBeInTheDocument(),
    );

    expect(within(chart()).queryByText("Sales")).not.toBeInTheDocument();
    expect(within(chart()).queryByText("Finance")).not.toBeInTheDocument();
    expect(within(chart()).queryByText("Billing")).not.toBeInTheDocument();
  });

  it("re-levels from the scope, so Display Depth counts from the scoped root", async () => {
    // Unscoped at depth 2, "Lead Scoring" (L3) is rolled up and invisible —
    // asserted above. Scoping to its L2 parent makes that parent the new
    // level 1, so the same depth setting now reaches one tier further down.
    consumedConfig = { scopeIds: ["leads"] };
    renderMap();
    await waitFor(() =>
      expect(within(chart()).getByText("Lead Management")).toBeInTheDocument(),
    );

    expect(within(chart()).getByText("Lead Scoring")).toBeInTheDocument();
  });

  it("recomputes deep metrics against the subtree only", async () => {
    consumedConfig = { scopeIds: ["finance"] };
    renderMap();
    await waitFor(() => expect(within(chart()).getByText("Finance")).toBeInTheDocument());

    // Finance rolls up exactly one application (Invoicer, via Billing) — the
    // Sales branch's app must not leak into the count.
    expect(within(chart()).getAllByText("1").length).toBeGreaterThan(0);
    expect(within(chart()).queryByText("2")).not.toBeInTheDocument();
  });

  it("shows the scoped count on the toolbar chip and clears back to all", async () => {
    const user = userEvent.setup();
    consumedConfig = { scopeIds: ["leads", "billing"] };
    renderMap();
    await waitFor(() =>
      expect(within(toolbar()).getByText("2 capabilities")).toBeInTheDocument(),
    );
    // The same count reaches print / XLSX / PPTX exports.
    expect(
      within(document.querySelector(".report-print-params") as HTMLElement)
        .getByText("2 capabilities"),
    ).toBeInTheDocument();

    // The chip's delete affordance drops the scope.
    await user.click(within(toolbar()).getByTestId("CancelIcon"));
    await waitFor(() =>
      expect(within(toolbar()).getByText("All capabilities")).toBeInTheDocument(),
    );
    expect(within(chart()).getByText("Sales")).toBeInTheDocument();
  });

  it("drops a scoped id whose capability no longer exists", async () => {
    // A saved report pointing at a deleted capability must degrade to the
    // wider map, not to an empty one with no way to tell why.
    consumedConfig = { scopeIds: ["deleted-capability"] };
    renderMap();
    await waitFor(() => expect(within(chart()).getByText("Sales")).toBeInTheDocument());

    expect(within(chart()).getByText("Finance")).toBeInTheDocument();
    expect(within(toolbar()).getByText("All capabilities")).toBeInTheDocument();
  });

  it("keeps only the ancestor when the scope names a capability and its child", async () => {
    consumedConfig = { scopeIds: ["sales", "leads"] };
    renderMap();
    await waitFor(() => expect(within(chart()).getByText("Sales")).toBeInTheDocument());

    // "Lead Management" renders once, as Sales' child — not a second time as
    // a root of its own.
    expect(within(chart()).getAllByText("Lead Management")).toHaveLength(1);
    expect(within(chart()).queryByText("Finance")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Time travel — transition marks, delta, spotlight
//
//   Operations (L1) ── Dual App (retires 2027-06-01, supports BOTH caps)
//   HR (L1)         ── Dual App
// ---------------------------------------------------------------------------

const ms = (iso: string) => new Date(iso).getTime();
const TODAY = ms("2026-08-22");
const FUTURE = ms("2028-06-01");
const DUAL_EOL = ms("2027-06-01");

const DUAL_APP = {
  ...app("dual", "Dual App"),
  lifecycle: { active: "2015-01-01", endOfLife: "2027-06-01" },
};

const TT_HEATMAP = {
  items: [cap("ops", "Operations", null, [DUAL_APP]), cap("hr", "HR", null, [DUAL_APP])],
  metric: "app_count",
  filterable_types: {},
  fields_schema: [],
  tag_groups: [],
};

function mockTimeTravel() {
  vi.mocked(api.get).mockResolvedValue(TT_HEATMAP as never);
  vi.mocked(useTimeline).mockReturnValue({
    timelineDate: FUTURE,
    setTimelineDate: vi.fn(),
    todayMs: TODAY,
    isTimeTraveling: true,
    persistValue: FUTURE,
    printParam: { label: "Time Travel", value: "Jun 1, 2028" },
    restore: vi.fn(),
    reset: vi.fn(),
  });
}

describe("CapabilityMapReport time travel — transition marks", () => {
  it("dedupes an app supporting several capabilities: one mark, one pill, delta of one", async () => {
    mockTimeTravel();
    renderMap();
    await waitFor(() => expect(within(chart()).getByText("Operations")).toBeInTheDocument());

    const props = sliderProps.at(-1)!;
    // The app appears under two capabilities in the payload; counted once.
    expect(props.milestones).toContainEqual({ value: DUAL_EOL, activating: 0, disappearing: 1 });
    expect(props.delta).toEqual({ arriving: 0, retiring: 1 });
    expect(props.milestoneCards!(DUAL_EOL, DUAL_EOL)).toHaveLength(1);
  });

  it("with Show Applications off, a mark click pulses the containing capability boxes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockTimeTravel();
      const { container } = renderMap();
      await waitFor(() => expect(within(chart()).getByText("Operations")).toBeInTheDocument());
      expect(container.innerHTML).not.toContain("tl-pulse-retire");

      act(() => sliderProps.at(-1)!.onMilestoneClick!(DUAL_EOL, DUAL_EOL));
      // Chips are hidden, so the spotlight falls on the capability boxes; the
      // keyframes are injected for the duration of the pulse.
      await waitFor(() => expect(container.innerHTML).toContain("tl-pulse-retire"));
      expect(within(chart()).queryByText("Dual App")).not.toBeInTheDocument();

      act(() => void vi.advanceTimersByTime(2000));
      await waitFor(() => expect(container.innerHTML).not.toContain("tl-pulse-retire"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("with Show Applications on, a retirement mark click reveals the hidden chip for the pulse", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockTimeTravel();
      consumedConfig = { showApps: true };
      renderMap();
      await waitFor(() => expect(within(chart()).getByText("Operations")).toBeInTheDocument());
      // Retired at the travelled 2028 date, so the chip is hidden …
      expect(within(chart()).queryByText("Dual App")).not.toBeInTheDocument();

      act(() => sliderProps.at(-1)!.onMilestoneClick!(DUAL_EOL, DUAL_EOL));
      // … and transiently revealed as the spotlight's ghost.
      await waitFor(() =>
        expect(within(chart()).getAllByText("Dual App").length).toBeGreaterThan(0),
      );

      act(() => void vi.advanceTimersByTime(2000));
      await waitFor(() =>
        expect(within(chart()).queryByText("Dual App")).not.toBeInTheDocument(),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
