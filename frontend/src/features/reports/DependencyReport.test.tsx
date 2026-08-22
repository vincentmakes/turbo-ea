import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@/components/TimelineSlider", () => ({
  default: () => <div data-testid="timeline-slider" />,
}));

// React Flow can't lay out in jsdom; the LDV has its own pure-logic tests.
vi.mock("./LayeredDependencyView", () => ({
  default: () => <div data-testid="ldv" />,
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
  ],
};

beforeEach(() => {
  vi.clearAllMocks();

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
    expect(screen.getByText("RETIRED")).toBeInTheDocument();
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
    // Only the direct dependent, not the whole chain.
    expect(screen.getAllByText("IMPACTED")).toHaveLength(1);
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
