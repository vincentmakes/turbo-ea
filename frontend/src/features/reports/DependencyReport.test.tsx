import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import DependencyReport from "./DependencyReport";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: vi.fn(),
}));

vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: vi.fn(),
}));

vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: vi.fn(),
}));

vi.mock("@/hooks/useTimeline", () => ({
  useTimeline: vi.fn(),
}));

vi.mock("@/hooks/AuthContext", () => ({
  useAuthContext: () => ({ user: { permissions: { "*": true } } }),
}));

vi.mock("./SaveReportDialog", () => ({
  default: () => null,
}));

type SliderProps = {
  milestones?: { value: number }[];
  onMilestoneClick?: (from: number, to: number) => void;
  milestoneCards?: (
    from: number,
    to: number,
  ) => { id: string; name: string; kind: string; color?: string }[];
  onMilestoneCardClick?: (card: { id: string; kind: string }) => void;
};
const sliderProps: SliderProps[] = [];
vi.mock("@/components/TimelineSlider", () => ({
  default: (props: SliderProps) => {
    sliderProps.push(props);
    return <div data-testid="timeline-slider" />;
  },
}));

// React Flow can't lay out in jsdom; the LDV has its own pure-logic tests.
// Props are captured so the spotlight data path can be asserted at the
// boundary — whether the pulse reaches the canvas is a CSS question, whether
// it is handed over is this report's job.
type LdvProps = { pulseCards?: Record<string, "live" | "retire">; nodes?: { id: string }[] };
const ldvProps: LdvProps[] = [];
vi.mock("./LayeredDependencyView", () => ({
  default: (props: LdvProps) => {
    ldvProps.push(props);
    return <div data-testid="ldv" />;
  },
}));

vi.mock("@/components/CardDetailSidePanel", () => ({
  default: () => null,
}));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { useTimeline } from "@/hooks/useTimeline";
import { createRef } from "react";

// ---------------------------------------------------------------------------
// Test data — a small chain around one card retiring inside the window
// ---------------------------------------------------------------------------

const ms = (iso: string) => new Date(iso).getTime();
const TODAY = ms("2026-08-22");
const FUTURE = ms("2028-06-01");

const GRAPH = {
  nodes: [
    // Retires between today and the travelled date.
    {
      id: "legacy",
      name: "Legacy ERP",
      type: "Application",
      lifecycle: { active: "2012-01-01", endOfLife: "2027-06-01" },
    },
    { id: "portal", name: "Web Portal", type: "Application", lifecycle: { active: "2020-01-01" } },
    { id: "crm", name: "CRM Cloud", type: "Application", lifecycle: { active: "2021-01-01" } },
    // Retired well before today: badged RETIRED at every date (persist on), so
    // its retirement must still be marked on the timeline.
    {
      id: "mainframe",
      name: "Legacy Mainframe",
      type: "Application",
      lifecycle: { active: "2005-01-01", endOfLife: "2015-01-01" },
    },
    // Starts after the travelled date — only visible with the preview toggle.
    {
      id: "next-gen",
      name: "NextGen Suite",
      type: "Application",
      lifecycle: { plan: "2030-01-01" },
    },
  ],
  edges: [
    { source: "legacy", target: "portal", type: "app_to_app", label: "uses" },
    { source: "portal", target: "crm", type: "app_to_app", label: "uses" },
    { source: "next-gen", target: "crm", type: "app_to_app", label: "uses" },
    { source: "mainframe", target: "crm", type: "app_to_app", label: "uses" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  sliderProps.length = 0;
  ldvProps.length = 0;

  vi.mocked(api.get).mockResolvedValue(GRAPH);

  vi.mocked(useMetamodel).mockReturnValue({
    types: [{ key: "Application", label: "Application", icon: "apps", color: "#0f7eb5" }],
    relationTypes: [],
    loading: false,
    getType: () => undefined,
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as unknown as ReturnType<typeof useMetamodel>);

  vi.mocked(useSavedReport).mockReturnValue({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: vi.fn(),
    loadedConfig: null,
    // Open straight onto the table view: every node and edge is a plain DOM
    // row there, so time-travel visibility is directly assertable.
    consumeConfig: vi.fn().mockReturnValue({ view: "table" }),
    resetSavedReport: vi.fn(),
    persistConfig: vi.fn(),
    resetAll: vi.fn(),
    reportType: "dependencies",
  } as unknown as ReturnType<typeof useSavedReport>);

  vi.mocked(useThumbnailCapture).mockReturnValue({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: vi.fn(),
  } as unknown as ReturnType<typeof useThumbnailCapture>);

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
});

function renderReport() {
  return render(
    <MemoryRouter>
      <DependencyReport />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Persist retired cards
// ---------------------------------------------------------------------------

describe("DependencyReport time travel — persist retired cards", () => {
  it("keeps a window-retired card on the table by default, badged RETIRED", async () => {
    renderReport();
    expect(await screen.findByText("Legacy ERP")).toBeInTheDocument();
    // Two retired cards are on the table: the one retiring inside the window
    // and the mainframe that went years ago — both badged, persist being on.
    expect(screen.getAllByText("RETIRED").length).toBeGreaterThanOrEqual(2);
    // The ghost is displayed, so its surviving dependent is NOT badged — the
    // dashed red edge (in chart view) already tells the story.
    expect(screen.queryByText("IMPACTED")).not.toBeInTheDocument();
  });

  it("un-toggling the switch removes retired cards and their relations", async () => {
    renderReport();
    await screen.findByText("Legacy ERP");

    await userEvent.click(screen.getByRole("checkbox", { name: /Keep retired cards/ }));

    await waitFor(() => {
      expect(screen.queryByText("Legacy ERP")).not.toBeInTheDocument();
    });
    // Persist off drops every retired card, whenever it retired.
    expect(screen.queryByText("Legacy Mainframe")).not.toBeInTheDocument();
    expect(screen.queryByText("RETIRED")).not.toBeInTheDocument();
    // The surviving pair stays.
    expect(screen.getAllByText("Web Portal").length).toBeGreaterThan(0);
    expect(screen.getByText("CRM Cloud")).toBeInTheDocument();
  });

  it("badges the surviving dependent IMPACTED once its severed dependency is hidden", async () => {
    renderReport();
    await screen.findByText("Legacy ERP");

    await userEvent.click(screen.getByRole("checkbox", { name: /Keep retired cards/ }));

    await waitFor(() => {
      expect(screen.getByText("IMPACTED")).toBeInTheDocument();
    });
    // Only the direct dependents of a hidden retiring card — Web Portal (lost
    // Legacy ERP) and CRM Cloud (lost the mainframe) — not the whole chain.
    expect(screen.getAllByText("IMPACTED").length).toBeGreaterThanOrEqual(1);
  });

  it("toggling back on restores the retired card and clears the badge", async () => {
    renderReport();
    await screen.findByText("Legacy ERP");

    await userEvent.click(screen.getByRole("checkbox", { name: /Keep retired cards/ }));
    await waitFor(() => expect(screen.queryByText("Legacy ERP")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("checkbox", { name: /Keep retired cards/ }));
    expect(await screen.findByText("Legacy ERP")).toBeInTheDocument();
    expect(screen.queryByText("IMPACTED")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Preview planned cards
// ---------------------------------------------------------------------------

describe("DependencyReport time travel — preview planned cards", () => {
  it("hides a not-yet-started card by default", async () => {
    renderReport();
    await screen.findByText("Legacy ERP");
    expect(screen.queryByText("NextGen Suite")).not.toBeInTheDocument();
  });

  it("shows it badged UPCOMING when the preview toggle is on", async () => {
    renderReport();
    await screen.findByText("Legacy ERP");

    await userEvent.click(screen.getByRole("checkbox", { name: /Show cards that have not started/ }));

    expect(await screen.findByText("NextGen Suite")).toBeInTheDocument();
    expect(screen.getByText("UPCOMING")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: /Show cards that have not started/ }));
    await waitFor(() => expect(screen.queryByText("NextGen Suite")).not.toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Transition marks
// ---------------------------------------------------------------------------

describe("DependencyReport time travel — transition marks", () => {
  it("marks past transitions too, so a stateful badge always has its mark", () => {
    // Regression: marks were once filtered to the future, which left every
    // card retired before today badged RETIRED with nothing on the timeline to
    // explain it — and the same for UPCOMING cards viewed from the past.
    renderReport();

    return waitFor(() => {
      const marks = sliderProps.at(-1)?.milestones ?? [];
      const dates = marks.map((m) => m.value);
      expect(dates).toContain(ms("2015-01-01")); // Legacy Mainframe retires
      expect(dates).toContain(ms("2005-01-01")); // ...and appeared, long ago
      expect(dates.some((d) => d > TODAY)).toBe(true); // future ones still there
    });
  });
});

// ---------------------------------------------------------------------------
// Clicking a transition mark
// ---------------------------------------------------------------------------

describe("DependencyReport time travel — clicking a mark", () => {
  it("reveals a hidden retiring card for the duration of the highlight", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderReport();
      await screen.findByText("Legacy ERP");

      // Hide retired cards: the retirement mark now has nothing to point at.
      await userEvent.click(screen.getByRole("checkbox", { name: /Keep retired cards/ }));
      await waitFor(() => expect(screen.queryByText("Legacy ERP")).not.toBeInTheDocument());

      // Click the mark covering Legacy ERP's retirement.
      const eol = ms("2027-06-01");
      act(() => sliderProps.at(-1)?.onMilestoneClick?.(eol, eol));

      // Revealed while the pulse runs...
      expect(await screen.findByText("Legacy ERP")).toBeInTheDocument();

      // ...and hidden again once it ends, without touching the toggle.
      act(() => void vi.advanceTimersByTime(2000));
      await waitFor(() => expect(screen.queryByText("Legacy ERP")).not.toBeInTheDocument());
      expect(screen.getByRole("checkbox", { name: /Keep retired cards/ })).not.toBeChecked();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// The pill row under the marks
// ---------------------------------------------------------------------------

describe("DependencyReport time travel — cards behind a mark", () => {
  it("names the cards a mark counts, coloured by card type", async () => {
    renderReport();
    await screen.findByText("Legacy ERP");

    const eol = ms("2027-06-01");
    const named = sliderProps.at(-1)!.milestoneCards!(eol, eol);
    expect(named).toEqual([
      { id: "legacy", name: "Legacy ERP", kind: "disappearing", color: "#0f7eb5" },
    ]);

    // A go-live date names the arriving side instead.
    const live = ms("2021-01-01");
    expect(sliderProps.at(-1)!.milestoneCards!(live, live)).toEqual([
      { id: "crm", name: "CRM Cloud", kind: "activating", color: "#0f7eb5" },
    ]);
  });

  it("names nothing on a date where nothing changes", async () => {
    renderReport();
    await screen.findByText("Legacy ERP");
    const quiet = ms("2023-04-04");
    expect(sliderProps.at(-1)!.milestoneCards!(quiet, quiet)).toEqual([]);
  });

  it("spotlights just the clicked card, revealing it if it is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderReport();
      await screen.findByText("Legacy ERP");

      await userEvent.click(screen.getByRole("checkbox", { name: /Keep retired cards/ }));
      await waitFor(() => expect(screen.queryByText("Legacy ERP")).not.toBeInTheDocument());

      act(() =>
        sliderProps.at(-1)?.onMilestoneCardClick?.({ id: "legacy", kind: "disappearing" }),
      );
      expect(await screen.findByText("Legacy ERP")).toBeInTheDocument();

      act(() => void vi.advanceTimersByTime(2000));
      await waitFor(() => expect(screen.queryByText("Legacy ERP")).not.toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// The spotlight reaches the canvas
// ---------------------------------------------------------------------------

describe("DependencyReport time travel — spotlight handover", () => {
  function renderLdv() {
    vi.mocked(useSavedReport).mockReturnValue({
      savedReport: null,
      savedReportName: null,
      saveDialogOpen: false,
      setSaveDialogOpen: vi.fn(),
      loadedConfig: null,
      consumeConfig: vi
        .fn()
        .mockReturnValue({ view: "chart", chartMode: "c4", center: "portal" }),
      resetSavedReport: vi.fn(),
      persistConfig: vi.fn(),
      resetAll: vi.fn(),
      reportType: "dependencies",
    } as unknown as ReturnType<typeof useSavedReport>);
    return renderReport();
  }

  it("hands the clicked mark's cards to the Layered Dependency View", async () => {
    renderLdv();
    await screen.findByTestId("ldv");

    const eol = ms("2027-06-01");
    act(() => sliderProps.at(-1)?.onMilestoneClick?.(eol, eol));

    await waitFor(() => {
      expect(ldvProps.at(-1)?.pulseCards).toEqual({ legacy: "retire" });
    });
    // ...and the card it points at is actually on the canvas to be pulsed.
    expect(ldvProps.at(-1)?.nodes?.some((n) => n.id === "legacy")).toBe(true);
  });

  it("hands over a go-live spotlight the same way", async () => {
    renderLdv();
    await screen.findByTestId("ldv");

    const live = ms("2021-01-01");
    act(() => sliderProps.at(-1)?.onMilestoneClick?.(live, live));

    await waitFor(() => {
      expect(ldvProps.at(-1)?.pulseCards).toEqual({ crm: "live" });
    });
  });

  it("clears the spotlight when the highlight ends", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderLdv();
      await screen.findByTestId("ldv");

      const eol = ms("2027-06-01");
      act(() => sliderProps.at(-1)?.onMilestoneClick?.(eol, eol));
      await waitFor(() => expect(ldvProps.at(-1)?.pulseCards).toEqual({ legacy: "retire" }));

      act(() => void vi.advanceTimersByTime(2000));
      await waitFor(() => expect(ldvProps.at(-1)?.pulseCards).toEqual({}));
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// The spotlight animates in every view
// ---------------------------------------------------------------------------

describe("DependencyReport time travel — spotlight animation", () => {
  it("injects the pulse keyframes only while a spotlight is running", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // Table view (the default here): the LDV injects its own keyframes, so
      // without these the tree and table dimmed and ringed but never pulsed.
      const { container } = renderReport();
      await screen.findByText("Legacy ERP");
      expect(container.innerHTML).not.toContain("dep-pulse-row-retire");

      const eol = ms("2027-06-01");
      act(() => sliderProps.at(-1)?.onMilestoneClick?.(eol, eol));
      await waitFor(() => expect(container.innerHTML).toContain("dep-pulse-row-retire"));

      act(() => void vi.advanceTimersByTime(2000));
      await waitFor(() => expect(container.innerHTML).not.toContain("dep-pulse-row-retire"));
    } finally {
      vi.useRealTimers();
    }
  });
});
