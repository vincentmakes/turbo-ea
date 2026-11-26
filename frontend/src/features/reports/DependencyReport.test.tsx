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
  useOptionalAuthUser: () => null,
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
  onActiveSpanChange?: (span: { from: number; to: number } | null) => void;
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
  // Re-exported from @/lib/color by the real module and used by the TREE view,
  // which this mock must not break. Stubbed rather than pulled in with
  // importOriginal — that would evaluate the module and drag React Flow back in,
  // which is the whole reason the view is mocked.
  readableTypeColor: (color: string) => color,
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
const LEGACY_EOL = ms("2027-06-01");

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

/**
 * Render with the slider parked on a given date. The report only trusts a mark's
 * span once its (debounced) date agrees with it, which is what the real slider
 * guarantees by snapping the value onto the mark.
 */
function renderAt(dateMs: number, initialEntry = "/reports/dependencies") {
  vi.mocked(useTimeline).mockReturnValue({
    timelineDate: dateMs,
    setTimelineDate: vi.fn(),
    todayMs: TODAY,
    isTimeTraveling: true,
    persistValue: dateMs,
    printParam: { label: "Time Travel", value: "marker" },
    restore: vi.fn(),
    reset: vi.fn(),
  });
  return renderReport(initialEntry);
}

/** The connection-change icons, counted by their accessible title. */
const gainedMarks = () =>
  document.querySelectorAll('[title="Gains a connection here"]').length;
const lostMarks = () => document.querySelectorAll('[title="Loses a connection here"]').length;

/** Tell the report which mark the slider is standing on, as the slider would. */
function standOn(span: number | null) {
  act(() => {
    sliderProps
      .at(-1)
      ?.onActiveSpanChange?.(span == null ? null : { from: span, to: span });
  });
}

function renderReport(initialEntry = "/reports/dependencies") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
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
    // Nothing is standing on a mark, so no connection-change marks anywhere.
    expect(document.querySelectorAll("[title$='connection here']").length).toBe(0);
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

  it("marks nothing away from a transition mark", async () => {
    // The regression: scoped to today→viewed-date, a mark earned at one
    // retirement was earned at every later date and never expired.
    renderReport();
    await screen.findByText("Legacy ERP");

    await userEvent.click(screen.getByRole("checkbox", { name: /Keep retired cards/ }));
    await waitFor(() => expect(screen.queryByText("Legacy ERP")).not.toBeInTheDocument());

    expect(lostMarks()).toBe(0);
    expect(gainedMarks()).toBe(0);
  });

  it("marks the bystanders that lose a connection while standing on the mark", async () => {
    renderAt(LEGACY_EOL);
    await screen.findAllByText("Web Portal");

    await userEvent.click(screen.getByRole("checkbox", { name: /Keep retired cards/ }));
    standOn(LEGACY_EOL);

    // Web Portal loses Legacy ERP, which retires exactly here.
    await waitFor(() => expect(lostMarks()).toBeGreaterThanOrEqual(1));
    expect(gainedMarks()).toBe(0);
  });

  it("marks the bystanders that gain a connection when a neighbour goes live", async () => {
    // The half that never existed: an arrival hands its neighbours a connection.
    vi.mocked(api.get).mockResolvedValue({
      ...GRAPH,
      nodes: [
        ...GRAPH.nodes,
        {
          id: "arriving",
          name: "Arriving Platform",
          type: "Application",
          lifecycle: { active: "2027-09-01" },
        },
      ],
      edges: [
        ...GRAPH.edges,
        { source: "arriving", target: "crm", type: "app_to_app", label: "uses" },
      ],
    });
    renderAt(ms("2027-09-01"));
    await screen.findByText("Arriving Platform");

    standOn(ms("2027-09-01"));

    // CRM Cloud gains a link to the arriving card; the arriving card gets none.
    await waitFor(() => expect(gainedMarks()).toBeGreaterThanOrEqual(1));
  });

  it("keeps a card retiring at the mark on screen, badged RETIRED, with persist off", async () => {
    // The pill row names the cards changing here, so they have to be somewhere
    // to be named — even though persist off would otherwise drop them.
    renderAt(LEGACY_EOL);
    await screen.findByText("Legacy ERP");

    await userEvent.click(screen.getByRole("checkbox", { name: /Keep retired cards/ }));
    standOn(LEGACY_EOL);

    await waitFor(() => expect(screen.getByText("Legacy ERP")).toBeInTheDocument());
    expect(screen.getAllByText("RETIRED").length).toBeGreaterThanOrEqual(1);
    // The card that went years earlier is NOT dragged back by this mark.
    expect(screen.queryByText("Legacy Mainframe")).not.toBeInTheDocument();
  });

  it("drops both the retiring card and the badges when the slider leaves the mark", async () => {
    renderAt(LEGACY_EOL);
    await screen.findByText("Legacy ERP");

    await userEvent.click(screen.getByRole("checkbox", { name: /Keep retired cards/ }));
    standOn(LEGACY_EOL);
    await waitFor(() => expect(screen.getByText("Legacy ERP")).toBeInTheDocument());

    standOn(null);
    await waitFor(() => expect(screen.queryByText("Legacy ERP")).not.toBeInTheDocument());
    expect(lostMarks()).toBe(0);
  });

  it("toggling back on restores the retired card and clears the badge", async () => {
    renderReport();
    await screen.findByText("Legacy ERP");

    await userEvent.click(screen.getByRole("checkbox", { name: /Keep retired cards/ }));
    await waitFor(() => expect(screen.queryByText("Legacy ERP")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("checkbox", { name: /Keep retired cards/ }));
    expect(await screen.findByText("Legacy ERP")).toBeInTheDocument();
    expect(lostMarks()).toBe(0);
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

  it("leaves a card that has arrived by the viewed date unbadged", async () => {
    // Time travel shows the state as it will be: a card that went live on the
    // way to the viewed date is simply part of the landscape there, and what
    // arrived is the timeline's job to say. Only cards drawn DESPITE not being
    // in that state — retired ghosts, previewed planned ones — are badged.
    vi.mocked(api.get).mockResolvedValue({
      ...GRAPH,
      nodes: [
        ...GRAPH.nodes,
        {
          id: "arriving",
          name: "Arriving Platform",
          type: "Application",
          lifecycle: { active: "2027-06-01" }, // after TODAY, before FUTURE
        },
      ],
      edges: [...GRAPH.edges, { source: "arriving", target: "crm", type: "app_to_app", label: "uses" }],
    });
    renderReport();

    // It is on the canvas...
    expect(await screen.findByText("Arriving Platform")).toBeInTheDocument();
    // ...and carries no badge of its own. RETIRED still belongs to Legacy ERP,
    // which really is gone by the viewed date.
    expect(screen.queryByText("PLANNED")).not.toBeInTheDocument();
    expect(screen.queryByText("UPCOMING")).not.toBeInTheDocument();
    expect(screen.getAllByText("RETIRED").length).toBeGreaterThan(0);
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
      expect(container.innerHTML).not.toContain("tl-pulse-row-retire");

      const eol = ms("2027-06-01");
      act(() => sliderProps.at(-1)?.onMilestoneClick?.(eol, eol));
      await waitFor(() => expect(container.innerHTML).toContain("tl-pulse-row-retire"));

      act(() => void vi.advanceTimersByTime(2000));
      await waitFor(() => expect(container.innerHTML).not.toContain("tl-pulse-row-retire"));
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Arriving from a card's Dependencies section
// ---------------------------------------------------------------------------

describe("DependencyReport deep link", () => {
  /** Stored config pointing somewhere else entirely — the link must win. */
  function seedStoredConfig(cfg: Record<string, unknown>) {
    vi.mocked(useSavedReport).mockReturnValue({
      savedReport: null,
      savedReportName: null,
      saveDialogOpen: false,
      setSaveDialogOpen: vi.fn(),
      loadedConfig: null,
      consumeConfig: vi.fn().mockReturnValue(cfg),
      resetSavedReport: vi.fn(),
      persistConfig: vi.fn(),
      resetAll: vi.fn(),
      reportType: "dependencies",
    } as unknown as ReturnType<typeof useSavedReport>);
  }

  it("centres on the linked card over whatever the tab was last showing", async () => {
    seedStoredConfig({ view: "table", center: "crm", cardTypeKey: "Application" });
    renderReport("/reports/dependencies?center=portal&mode=c4");

    // The LDV is mocked, so its presence is the proof the deep link forced the
    // chart view; the centre reaches it through the captured props.
    await screen.findByTestId("ldv");
    await waitFor(() => {
      expect(ldvProps.at(-1)?.nodes?.some((n) => n.id === "portal")).toBe(true);
    });
  });

  it("opens the tree view when the link asks for it", async () => {
    seedStoredConfig({ view: "table", chartMode: "c4" });
    renderReport("/reports/dependencies?center=portal&mode=tree");

    // "Collapse all branches" renders only when a centre is set AND the mode
    // is tree, so it witnesses both halves of the link at once. The tree
    // canvas itself lays out from measured rects, which jsdom reports as zero,
    // so asserting on its cards would prove nothing.
    expect(
      await screen.findByRole("button", { name: /Collapse all branches/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("ldv")).toBeNull();
  });

  it("clears a stored type filter that would hide the linked card", async () => {
    // The type filter scopes the centre picker and the toolbar autocomplete,
    // not the graph — carried over, a stored "Application" would leave a
    // linked BusinessCapability centred but absent from its own autocomplete.
    seedStoredConfig({ cardTypeKey: "Application" });
    renderReport("/reports/dependencies?center=portal");
    await screen.findByTestId("ldv");
    // MUI renders a zero-width space for an empty select value, so assert the
    // absence of the carried type rather than the "All Types" item's label.
    expect(screen.getByRole("combobox", { name: /Type/i })).not.toHaveTextContent("Application");
  });

  it("leaves the stored config alone when there is no link", async () => {
    seedStoredConfig({ view: "chart", chartMode: "c4", center: "crm", cardTypeKey: "Application" });
    renderReport();
    await screen.findByTestId("ldv");
    // No ?center=, so nothing overrides: the stored type filter survives.
    expect(screen.getByRole("combobox", { name: /Type/i })).toHaveTextContent("Application");
  });
});

// ---------------------------------------------------------------------------
// Choosing a centre
// ---------------------------------------------------------------------------

describe("DependencyReport centre picker", () => {
  /** Open on the picker (no centre), with the slider parked in 2028. */
  function renderPicker() {
    vi.mocked(useSavedReport).mockReturnValue({
      savedReport: null,
      savedReportName: null,
      saveDialogOpen: false,
      setSaveDialogOpen: vi.fn(),
      loadedConfig: null,
      // No centre and no view: the report opens on the picker.
      consumeConfig: vi.fn().mockReturnValue({ view: "chart" }),
      resetSavedReport: vi.fn(),
      persistConfig: vi.fn(),
      resetAll: vi.fn(),
      reportType: "dependencies",
    } as unknown as ReturnType<typeof useSavedReport>);
    return renderReport();
  }

  it("offers the best-connected cards first, not the alphabetically first", async () => {
    const { container } = renderPicker();
    await screen.findByText("CRM Cloud");

    // In the fixture CRM Cloud has three relations and Legacy ERP one, so
    // alphabetical order would put "CRM Cloud" first for the wrong reason.
    // "Web Portal" has two and must beat "Legacy Mainframe" and "NextGen
    // Suite", which have one each.
    const names = Array.from(container.querySelectorAll("p"))
      .map((el) => el.textContent ?? "")
      .filter((t) => ["CRM Cloud", "Web Portal", "Legacy ERP", "NextGen Suite"].includes(t));
    expect(names.indexOf("CRM Cloud")).toBeLessThan(names.indexOf("Web Portal"));
    expect(names.indexOf("Web Portal")).toBeLessThan(names.indexOf("Legacy ERP"));
  });

  // The picker is reached by a button that HIDES the slider and the two
  // visibility switches, so anything it filters by date is filtered by a control
  // the reader cannot see. It lists the inventory; the diagram shows the date.
  it("lists a card that has not gone live yet, though the timeline hides it", async () => {
    // `next-gen` is planned for 2030 and the slider is parked on 2028, with
    // "Preview planned cards" off — it is absent from the diagram by design, and
    // used to be absent from the picker too.
    renderPicker();
    await screen.findByText("CRM Cloud");
    expect(screen.getByText("NextGen Suite")).toBeInTheDocument();
  });

  it("lists a card retired before today, badged RETIRED", async () => {
    renderPicker();
    await screen.findByText("CRM Cloud");
    expect(screen.getByText("Legacy Mainframe")).toBeInTheDocument();
    // `mainframe` retired in 2015, `legacy` not until 2027: exactly one row is
    // at end of life TODAY, whatever date the slider is standing on.
    expect(screen.getAllByText("RETIRED")).toHaveLength(1);
  });

  it("counts every card of a type on its chip, not just the ones alive today", async () => {
    renderPicker();
    await screen.findByText("CRM Cloud");
    // All five fixture cards are Applications.
    expect(screen.getByText("Application (5)")).toBeInTheDocument();
  });

  it("drops the end-of-life cards, and only those, when the toggle is on", async () => {
    renderPicker();
    await screen.findByText("CRM Cloud");

    await userEvent.click(screen.getByRole("checkbox", { name: /Hide end-of-life/ }));

    expect(screen.queryByText("Legacy Mainframe")).toBeNull();
    expect(screen.queryByText("RETIRED")).toBeNull();
    // Not yet at end of life (2027) and not yet live (2030): both stay.
    expect(screen.getByText("Legacy ERP")).toBeInTheDocument();
    expect(screen.getByText("NextGen Suite")).toBeInTheDocument();
    expect(screen.getByText("Application (4)")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Both toggles off, in the chart view
// ---------------------------------------------------------------------------

describe("DependencyReport time travel — both toggles off (chart)", () => {
  function renderChart() {
    vi.mocked(useSavedReport).mockReturnValue({
      savedReport: null,
      savedReportName: null,
      saveDialogOpen: false,
      setSaveDialogOpen: vi.fn(),
      loadedConfig: null,
      consumeConfig: vi
        .fn()
        .mockReturnValue({ view: "chart", chartMode: "c4", center: "crm" }),
      resetSavedReport: vi.fn(),
      persistConfig: vi.fn(),
      resetAll: vi.fn(),
      reportType: "dependencies",
    } as unknown as ReturnType<typeof useSavedReport>);
    return renderReport();
  }

  it("hands the canvas nothing retired or not-yet-started", async () => {
    renderChart();
    await screen.findByTestId("ldv");
    await userEvent.click(screen.getByRole("checkbox", { name: /Keep retired cards/ }));

    await waitFor(() => {
      const last = ldvProps[ldvProps.length - 1];
      const bad = (last.nodes ?? []).filter(
        (n) => (n as { changeState?: string }).changeState === "retired",
      );
      expect(bad.map((n) => n.id)).toEqual([]);
    });
    const last = ldvProps[ldvProps.length - 1] as LdvProps & {
      nodes?: { id: string; changeState?: string }[];
    };
    expect((last.nodes ?? []).filter((n) => n.changeState === "planned").map((n) => n.id)).toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// The toolbar "Center on" drop-down (#1107)
// ---------------------------------------------------------------------------

describe('DependencyReport "Center on" drop-down', () => {
  /**
   * Card names currently rendered in the open listbox. Each option also
   * carries a colour dot and a muted type label, so read the name element
   * rather than the row's whole text.
   */
  function optionNames() {
    return Array.from(document.querySelectorAll('[role="option"]')).map(
      (el) => el.querySelector("p")?.textContent ?? "",
    );
  }

  async function openCenterOn() {
    const user = userEvent.setup();
    renderReport();
    // Wait for the graph, so the options are loaded before the list opens.
    expect(await screen.findByText("Legacy ERP")).toBeInTheDocument();
    const input = screen.getByRole("combobox", { name: /Center on/i });
    await user.click(input);
    return { user, input };
  }

  it("lists the cards alphabetically", async () => {
    // `/reports/dependencies` builds its node list by iterating a set, so the
    // fixture arrives in an order that is neither alphabetical nor stable.
    await openCenterOn();
    const names = optionNames();
    expect(names).toEqual([
      "CRM Cloud",
      "Legacy ERP",
      "Legacy Mainframe",
      "NextGen Suite",
      "Web Portal",
    ]);
  });

  it("ranks what is typed, best match first", async () => {
    const { user, input } = await openCenterOn();
    await user.type(input, "legacy");
    const names = optionNames();
    // "Legacy ERP"/"Legacy Mainframe" start with the term; "NextGen Suite"
    // and the rest do not match at all and are filtered out.
    expect(names).toEqual(["Legacy ERP", "Legacy Mainframe"]);
  });

  it("puts a starts-with match above a mid-name one", async () => {
    const { user, input } = await openCenterOn();
    await user.type(input, "erp");
    // Only "Legacy ERP" contains it — the point is that the ranked filter is
    // wired at all, so MUI's unranked "contains" cannot resurface.
    expect(optionNames()).toEqual(["Legacy ERP"]);
  });
});

// ---------------------------------------------------------------------------
// A relation's own dates
// ---------------------------------------------------------------------------

describe("DependencyReport time travel — a relation's own dates", () => {
  // Seen from CRM Cloud, every card is alive throughout; only the relations
  // carry dates. A card the centre reaches ONLY through relations not in effect
  // at the travelled date is a planned / retired CARD from here, exactly as one
  // planned or retired by its own lifecycle — not a present card with a faded
  // line.
  const DATED_GRAPH = {
    nodes: [
      { id: "crm", name: "CRM Cloud", type: "Application", lifecycle: { active: "2019-01-01" } },
      // Reached only through a relation starting 2029-01-01.
      { id: "portal", name: "Web Portal", type: "Application", lifecycle: { active: "2019-01-01" } },
      // Reached only through a relation ending 2027-01-01.
      { id: "billing", name: "Billing", type: "Application", lifecycle: { active: "2019-01-01" } },
      // Reached only through a relation with Plan / Phase In and no Active date.
      { id: "hr", name: "HR Suite", type: "Application" },
      // Reached through an undated relation.
      { id: "erp", name: "ERP Core", type: "Application" },
      // Reached through an undated relation AND a second one starting 2028-01-01.
      { id: "ops", name: "Ops Desk", type: "Application" },
    ],
    edges: [
      {
        source: "portal",
        target: "crm",
        type: "app_to_app",
        label: "uses",
        lifecycle: { active: "2029-01-01" },
      },
      {
        source: "billing",
        target: "crm",
        type: "app_to_app",
        label: "uses",
        lifecycle: { active: "2020-01-01", endOfLife: "2027-01-01" },
      },
      {
        source: "crm",
        target: "hr",
        type: "app_to_app",
        label: "uses",
        lifecycle: { plan: "2025-01-01", phaseIn: "2026-01-01" },
      },
      { source: "crm", target: "erp", type: "app_to_app", label: "uses" },
      { source: "crm", target: "ops", type: "app_to_app", label: "uses" },
      {
        source: "ops",
        target: "crm",
        type: "app_feeds_app",
        label: "feeds",
        lifecycle: { active: "2028-01-01" },
      },
    ],
  };
  const EOL = ms("2027-01-01");
  type Node = { id: string; changeState?: string; gainedLink?: boolean; lostLink?: boolean };
  type Edge = { source: string; relationState?: string };
  /** The LDV's cards as `{id: state}` — "present" for a card drawn plainly. */
  const ldvCards = () =>
    Object.fromEntries(
      ((ldvProps.at(-1)?.nodes ?? []) as Node[]).map((n) => [n.id, n.changeState ?? "present"]),
    );
  const ldvNode = (id: string) =>
    ((ldvProps.at(-1)?.nodes ?? []) as Node[]).find((n) => n.id === id);
  const drawn = () =>
    ((ldvProps.at(-1) as { edges?: Edge[] }).edges ?? [])
      .map((e) => `${e.source}:${e.relationState ?? "inEffect"}`)
      .sort();

  function renderChart(
    dateMs: number,
    cfg: { persistRetired?: boolean; previewPlanned?: boolean; chartMode?: "c4" | "tree" } = {},
    graph: unknown = DATED_GRAPH,
  ) {
    vi.mocked(api.get).mockResolvedValue(graph);
    vi.mocked(useTimeline).mockReturnValue({
      timelineDate: dateMs,
      setTimelineDate: vi.fn(),
      todayMs: TODAY,
      isTimeTraveling: dateMs !== TODAY,
      persistValue: dateMs,
      printParam: { label: "Time Travel", value: "date" },
      restore: vi.fn(),
      reset: vi.fn(),
    });
    vi.mocked(useSavedReport).mockReturnValue({
      savedReport: null,
      savedReportName: null,
      saveDialogOpen: false,
      setSaveDialogOpen: vi.fn(),
      loadedConfig: null,
      consumeConfig: vi
        .fn()
        .mockReturnValue({ view: "chart", chartMode: "c4", center: "crm", ...cfg }),
      resetSavedReport: vi.fn(),
      persistConfig: vi.fn(),
      resetAll: vi.fn(),
      reportType: "dependencies",
    } as unknown as ReturnType<typeof useSavedReport>);
    return renderReport();
  }
  async function ldvAt(dateMs: number, cfg: Parameters<typeof renderChart>[1] = {}) {
    renderChart(dateMs, cfg);
    await screen.findByTestId("ldv");
    await waitFor(() => expect(ldvCards().erp).toBeDefined());
  }

  describe("Layered Dependency View", () => {
    it("hides a card reached only by a planned relation, and ghosts one reached only by an ended one while retired cards are kept", async () => {
      // Defaults: keep retired ON, preview planned OFF.
      await ldvAt(FUTURE);
      expect(ldvCards()).toEqual({
        crm: "present",
        billing: "retired",
        erp: "present",
        ops: "present",
      });
      // The line to the kept card keeps its own faded state.
      expect(drawn()).toEqual(["billing:ended", "crm:inEffect", "crm:inEffect", "ops:inEffect"]);
    });

    it("hides both with both toggles off", async () => {
      await ldvAt(FUTURE, { persistRetired: false, previewPlanned: false });
      expect(ldvCards()).toEqual({ crm: "present", erp: "present", ops: "present" });
      expect(drawn()).toEqual(["crm:inEffect", "crm:inEffect", "ops:inEffect"]);
    });

    it("shows a card reached only by planned relations as an UPCOMING card when planned cards are previewed", async () => {
      await ldvAt(FUTURE, { persistRetired: false, previewPlanned: true });
      expect(ldvCards()).toEqual({
        crm: "present",
        portal: "planned",
        hr: "planned",
        erp: "present",
        ops: "present",
      });
      expect(drawn()).toContain("portal:planned");
    });

    it("previewing follows the switch itself", async () => {
      await ldvAt(FUTURE, { persistRetired: false });
      expect(ldvCards().portal).toBeUndefined();
      await userEvent.click(screen.getByRole("checkbox", { name: /Show cards that have not started/ }));
      await waitFor(() => expect(ldvCards().portal).toBe("planned"));
    });

    it("draws the card plainly once its relation is in effect, arriving at a date after today", async () => {
      await ldvAt(ms("2029-06-01"), { persistRetired: false });
      expect(ldvCards().portal).toBe("arriving");
      // The ops card was already in the view today: no accent.
      expect(ldvCards().ops).toBe("present");
    });

    it("keeps a card reached by an undated relation present at every date, with every toggle", async () => {
      for (const date of [ms("2000-01-01"), FUTURE, ms("2099-01-01")])
        for (const persistRetired of [true, false])
          for (const previewPlanned of [true, false]) {
            ldvProps.length = 0;
            const r = renderChart(date, { persistRetired, previewPlanned });
            await screen.findByTestId("ldv");
            await waitFor(() => expect(ldvCards().erp).toBe("present"));
            r.unmount();
          }
    });

    it("never shows a card whose only relation has Plan / Phase In and no Active date, however far ahead", async () => {
      for (const date of [TODAY, ms("2099-01-01")]) {
        ldvProps.length = 0;
        const r = renderChart(date, { persistRetired: true, previewPlanned: false });
        await screen.findByTestId("ldv");
        await waitFor(() => expect(ldvCards().erp).toBe("present"));
        expect(ldvCards().hr).toBeUndefined();
        r.unmount();
        ldvProps.length = 0;
        const p = renderChart(date, { persistRetired: false, previewPlanned: true });
        await screen.findByTestId("ldv");
        await waitFor(() => expect(ldvCards().hr).toBe("planned"));
        p.unmount();
      }
    });

    it("treats the relation's End of Life as inclusive: present the day before, gone on it and after", async () => {
      const off = { persistRetired: false, previewPlanned: false };
      let r = renderChart(EOL - 86_400_000, off);
      await screen.findByTestId("ldv");
      await waitFor(() => expect(ldvCards().billing).toBe("present"));
      r.unmount();
      for (const date of [EOL, EOL + 86_400_000]) {
        ldvProps.length = 0;
        r = renderChart(date, off);
        await screen.findByTestId("ldv");
        await waitFor(() => expect(ldvCards().erp).toBe("present"));
        expect(ldvCards().billing).toBeUndefined();
        r.unmount();
      }
    });

    it("(a) keeps it ghosted as a RETIRED card on and after its End of Life with keep retired on", async () => {
      for (const date of [EOL, EOL + 86_400_000]) {
        ldvProps.length = 0;
        const r = renderChart(date, { persistRetired: true });
        await screen.findByTestId("ldv");
        await waitFor(() => expect(ldvCards().billing).toBe("retired"));
        r.unmount();
      }
    });

    it("(b) keeps it ghosted while the slider stands on the mark where its relation ends, then lets it go", async () => {
      renderChart(EOL, { persistRetired: false });
      await screen.findByTestId("ldv");
      await waitFor(() => expect(ldvCards().erp).toBe("present"));
      expect(ldvCards().billing).toBeUndefined();
      standOn(EOL);
      await waitFor(() => expect(ldvCards().billing).toBe("retired"));
      expect(drawn()).toContain("billing:ended");
      // The centre loses the connection; the leaving card carries no mark.
      expect(ldvNode("crm")?.lostLink).toBe(true);
      expect(ldvNode("billing")?.lostLink).toBeUndefined();
      standOn(null);
      await waitFor(() => expect(ldvCards().billing).toBeUndefined());
    });
  });

  describe("timeline marks", () => {
    type Pill = { id: string; kind: string };
    const pills = (d: number) =>
      (sliderProps.at(-1)?.milestoneCards?.(d, d) ?? []).map((c: Pill) => ({ id: c.id, kind: c.kind }));
    const marks = () =>
      sliderProps.at(-1)?.milestones as
        | { value: number; activating: number; disappearing: number; linking?: number; unlinking?: number }[]
        | undefined;

    it("makes a relation that brings a card in or takes it out a card arriving or leaving", async () => {
      await ldvAt(FUTURE);
      expect(marks()).toContainEqual({
        value: ms("2029-01-01"),
        activating: 1,
        disappearing: 0,
        linking: 0,
        unlinking: 0,
      });
      expect(marks()).toContainEqual({
        value: EOL,
        activating: 0,
        disappearing: 1,
        linking: 0,
        unlinking: 0,
      });
      expect(pills(ms("2029-01-01"))).toEqual([{ id: "portal", kind: "activating" }]);
      expect(pills(EOL)).toEqual([{ id: "billing", kind: "disappearing" }]);
    });

    it("counts a link between two cards that both stay as a connection, naming no card", async () => {
      await ldvAt(FUTURE);
      expect(marks()).toContainEqual({
        value: ms("2028-01-01"),
        activating: 0,
        disappearing: 0,
        linking: 1,
        unlinking: 0,
      });
      expect(pills(ms("2028-01-01"))).toEqual([]);
    });

    it("marks nothing for a relation with Plan / Phase In and no Active date", async () => {
      await ldvAt(FUTURE);
      const dates = (marks() ?? []).map((m) => m.value);
      expect(dates).not.toContain(ms("2025-01-01"));
      expect(dates).not.toContain(ms("2026-01-01"));
    });

    it("counts cards a relation brings in or takes out in the transformation chips", async () => {
      await ldvAt(ms("2029-06-01"));
      const delta = () => (sliderProps.at(-1) as { delta?: unknown }).delta;
      // Web Portal arrives with its relation in 2029; Billing leaves with its
      // relation's end in 2027. HR Suite's relation never starts.
      expect(delta()).toEqual({ arriving: 1, retiring: 1 });
    });

    it("counts a card that enters and leaves inside the window once, as leaving", async () => {
      renderChart(FUTURE, {}, {
        nodes: [DATED_GRAPH.nodes[0], { id: "temp", name: "Temp App", type: "Application" }],
        edges: [
          {
            source: "crm",
            target: "temp",
            type: "app_to_app",
            label: "uses",
            lifecycle: { active: "2027-01-01", endOfLife: "2028-01-01" },
          },
        ],
      });
      await screen.findByTestId("ldv");
      await waitFor(() => expect(ldvCards().temp).toBe("retired"));
      expect((sliderProps.at(-1) as { delta?: unknown }).delta).toEqual({ arriving: 0, retiring: 1 });
      expect(pills(ms("2027-01-01"))).toEqual([{ id: "temp", kind: "activating" }]);
      expect(pills(ms("2028-01-01"))).toEqual([{ id: "temp", kind: "disappearing" }]);
    });

    it("gives the connection icon to the card that stays, never to the card arriving", async () => {
      await ldvAt(ms("2029-01-01"), { persistRetired: false });
      standOn(ms("2029-01-01"));
      await waitFor(() => expect(ldvNode("crm")?.gainedLink).toBe(true));
      expect(ldvNode("portal")?.gainedLink).toBeUndefined();
      expect(ldvNode("ops")?.gainedLink).toBeUndefined();
    });

    it("gives both cards the icon when a link starts between two cards that stay", async () => {
      await ldvAt(ms("2028-01-01"));
      standOn(ms("2028-01-01"));
      await waitFor(() => expect(ldvNode("ops")?.gainedLink).toBe(true));
      expect(ldvNode("crm")?.gainedLink).toBe(true);
      expect(ldvNode("erp")?.gainedLink).toBeUndefined();
    });
  });

  describe("tree mode", () => {
    /** The tree card carrying `name`, or null when the tree does not draw it. */
    const treeCard = (name: string) =>
      (screen.queryAllByText(name)[0]?.closest(".MuiPaper-root") as HTMLElement | null) ?? null;
    async function treeAt(dateMs: number, cfg: Parameters<typeof renderChart>[1] = {}) {
      const r = renderChart(dateMs, { chartMode: "tree", ...cfg });
      await screen.findByRole("button", { name: /Collapse all branches/i });
      await waitFor(() => expect(treeCard("ERP Core")).not.toBeNull());
      return r;
    }

    it("hides a card reached only by relations not in effect, with both toggles off", async () => {
      await treeAt(FUTURE, { persistRetired: false, previewPlanned: false });
      expect(treeCard("Web Portal")).toBeNull();
      expect(treeCard("Billing")).toBeNull();
      expect(treeCard("HR Suite")).toBeNull();
      expect(treeCard("Ops Desk")).not.toBeNull();
    });

    it("ghosts them as RETIRED / UPCOMING cards when the toggles keep them", async () => {
      await treeAt(FUTURE, { persistRetired: true, previewPlanned: true });
      expect(treeCard("Billing")?.textContent).toContain("RETIRED");
      expect(treeCard("Web Portal")?.textContent).toContain("UPCOMING");
      expect(treeCard("HR Suite")?.textContent).toContain("UPCOMING");
      expect(treeCard("ERP Core")?.textContent).not.toMatch(/RETIRED|UPCOMING/);
    });

    it("outlines a card whose path comes into effect after today as arriving", async () => {
      // Web Portal's relation starts 2029-01-01: not in effect today, in effect
      // at the viewed date — drawn plainly, in the arriving outline.
      await treeAt(ms("2029-06-01"), { persistRetired: false, previewPlanned: false });
      const portal = getComputedStyle(treeCard("Web Portal")!);
      expect(portal.borderTop).toBe("1.5px solid rgb(124, 77, 255)");
      expect(treeCard("Web Portal")?.textContent).not.toMatch(/RETIRED|UPCOMING/);
      // ERP Core has been reached all along: no outline.
      expect(getComputedStyle(treeCard("ERP Core")!).borderTop).not.toContain("rgb(124, 77, 255)");
    });

    it("keeps only the retired one with keep retired alone", async () => {
      await treeAt(FUTURE, { persistRetired: true, previewPlanned: false });
      expect(treeCard("Billing")?.textContent).toContain("RETIRED");
      expect(treeCard("Web Portal")).toBeNull();
    });

    it("treats the relation's End of Life as inclusive, and keeps the card while standing on its mark", async () => {
      const off = { persistRetired: false, previewPlanned: false };
      let r = await treeAt(EOL - 86_400_000, off);
      expect(treeCard("Billing")?.textContent).not.toContain("RETIRED");
      r.unmount();
      r = await treeAt(EOL + 86_400_000, off);
      expect(treeCard("Billing")).toBeNull();
      r.unmount();
      await treeAt(EOL, off);
      expect(treeCard("Billing")).toBeNull();
      standOn(EOL);
      await waitFor(() => expect(treeCard("Billing")?.textContent).toContain("RETIRED"));
    });
  });
});
