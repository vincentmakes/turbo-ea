/**
 * Regression tests for bugs a mutation pass found in the Dependencies report's
 * tree view: the tooltip's connection count, the change-state outline and its
 * interplay with the type-coloured left edge, the spotlight's opacity on ghost
 * cards, and a hover that outlived a right-click re-centre.
 *
 * The LDV and the timeline slider are mocked (React Flow cannot lay out in
 * jsdom); the slider's props are captured so a mark click can be driven.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({ user: { permissions: { "*": true } } }),
}));

const saved = vi.hoisted(() => ({ config: null as Record<string, unknown> | null }));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: () => ({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: () => {},
    loadedConfig: null,
    consumeConfig: () => saved.config,
    resetSavedReport: () => {},
    persistConfig: () => {},
    resetAll: () => {},
    reportType: "dependencies",
  }),
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({ chartRef: createRef(), thumbnail: undefined, captureAndSave: () => {} }),
}));

const tl = vi.hoisted(() => ({ today: 0, date: 0 }));
vi.mock("@/hooks/useTimeline", () => ({
  useTimeline: () => ({
    timelineDate: tl.date,
    setTimelineDate: () => {},
    todayMs: tl.today,
    isTimeTraveling: tl.date !== tl.today,
    persistValue: undefined,
    printParam: null,
    restore: () => {},
    reset: () => {},
  }),
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
const slider = vi.hoisted(() => ({ props: null as any }));
vi.mock("@/components/TimelineSlider", () => ({
  default: (props: any) => {
    slider.props = props;
    return <div data-testid="timeline-slider" />;
  },
}));
vi.mock("@/features/reports/LayeredDependencyView", () => ({
  default: () => <div data-testid="ldv" />,
  readableTypeColor: (color: string) => color,
}));
/* eslint-enable @typescript-eslint/no-explicit-any */
vi.mock("@/features/reports/SaveReportDialog", () => ({ default: () => null }));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import DependencyReport from "./DependencyReport";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG = "#2889ff";
const APP = "#0f7eb5";
const ITC = "#d29270";
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
/** STATUS_COLORS.error, as the browser reports it. */
const RETIRED_RED = "rgb(244, 67, 54)";

const TYPES = [
  makeCardType({ key: "Organization", label: "Organization", color: ORG, sort_order: 1 }),
  makeCardType({ key: "Application", label: "Application", color: APP, sort_order: 2 }),
  makeCardType({ key: "ITComponent", label: "IT Component", color: ITC, sort_order: 3 }),
];

/** fin ── owns ──▶ alpha ── uses ──▶ db;  alpha ──▶ beta ──▶ os */
const GRAPH = {
  nodes: [
    { id: "db", name: "Oracle DB", type: "ITComponent", lifecycle: {} },
    { id: "os", name: "Linux", type: "ITComponent", lifecycle: {} },
    { id: "fin", name: "Finance", type: "Organization", lifecycle: {} },
    { id: "alpha", name: "Alpha", type: "Application", lifecycle: {} },
    { id: "beta", name: "Beta", type: "Application", lifecycle: {} },
  ],
  edges: [
    { source: "alpha", target: "db", type: "relAppToITC", label: "uses" },
    { source: "alpha", target: "beta", type: "relAppToApp", label: "sends data to" },
    { source: "beta", target: "os", type: "relAppToITC", label: "uses" },
    { source: "fin", target: "alpha", type: "relOrgToApp", label: "owns" },
  ],
};

const ms = (iso: string) => new Date(iso).getTime();
const TODAY = ms("2026-08-22");
const FUTURE = ms("2028-06-01");
const LEGACY_EOL = ms("2027-06-01");

/**
 * At FUTURE, Legacy ERP has retired inside the window and Legacy Mainframe
 * long ago; both are kept on screen as ghosts. Legacy ERP still reaches the
 * Old Archive, so it can be expanded.
 */
const TIMELINE_GRAPH = {
  nodes: [
    {
      id: "legacy",
      name: "Legacy ERP",
      type: "Application",
      lifecycle: { active: "2012-01-01", endOfLife: "2027-06-01" },
    },
    { id: "portal", name: "Web Portal", type: "Application", lifecycle: { active: "2020-01-01" } },
    { id: "crm", name: "CRM Cloud", type: "Application", lifecycle: { active: "2021-01-01" } },
    {
      id: "mainframe",
      name: "Legacy Mainframe",
      type: "Application",
      lifecycle: { active: "2005-01-01", endOfLife: "2015-01-01" },
    },
    { id: "archive", name: "Old Archive", type: "ITComponent", lifecycle: { active: "2010-01-01" } },
  ],
  edges: [
    { source: "portal", target: "legacy", type: "relAppToApp", label: "uses" },
    { source: "portal", target: "crm", type: "relAppToApp", label: "uses" },
    { source: "mainframe", target: "crm", type: "relAppToApp", label: "uses" },
    { source: "legacy", target: "archive", type: "relAppToITC", label: "stores in" },
  ],
};

function renderReport(cfg: Record<string, unknown> | null) {
  saved.config = cfg;
  return render(
    <MemoryRouter initialEntries={["/reports/dependencies"]}>
      <DependencyReport />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(TYPES);
  slider.props = null;
  saved.config = null;
  tl.today = TODAY;
  tl.date = TODAY;
  mockApi.on("get", "/reports/dependencies*", GRAPH);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The tree tiles carrying `name`, found through each tile's own Open-card button. */
function tiles(name: string): HTMLElement[] {
  return screen
    .getAllByRole("button", { name: "Open card" })
    .map((b) => b.closest(".MuiPaper-root") as HTMLElement)
    .filter((p) => within(p).queryByText(name) !== null);
}
const tile = (name: string) => tiles(name)[0];
const style = (el: HTMLElement) => getComputedStyle(el);

async function openTree(center = "alpha") {
  const utils = renderReport({ view: "chart", chartMode: "tree", center });
  await screen.findByRole("button", { name: /collapse all branches/i });
  return utils;
}

/** The tooltip a tile shows on hover, as text. */
async function tooltipOf(name: string): Promise<string> {
  fireEvent.mouseOver(tile(name));
  const tip = await screen.findByRole("tooltip", {}, { timeout: 4000 });
  return tip.textContent ?? "";
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

describe("tree tile tooltip", () => {
  it("names how many connections a card has", async () => {
    await openTree();
    expect(await tooltipOf("Beta")).toBe(
      "Application · 2 connectionsClick to expand · Right-click to re-center",
    );
  });

  it("says one connection in the singular", async () => {
    await openTree();
    expect(await tooltipOf("Finance")).toBe(
      "Organization · 1 connectionClick to expand · Right-click to re-center",
    );
  });
});

// ---------------------------------------------------------------------------
// Change-state outline
// ---------------------------------------------------------------------------

describe("tree tile change-state outline", () => {
  beforeEach(() => {
    mockApi.on("get", "/reports/dependencies*", TIMELINE_GRAPH);
    tl.date = FUTURE;
  });

  it("outlines a collapsed retired card in the retired colour, keeping its type-coloured edge", async () => {
    await openTree("portal");
    const ghost = style(tile("Legacy ERP"));
    expect([ghost.borderTopColor, ghost.borderTopStyle, ghost.borderTopWidth]).toEqual([
      RETIRED_RED,
      "dashed",
      "1.5px",
    ]);
    expect([ghost.borderRightColor, ghost.borderBottomColor]).toEqual([RETIRED_RED, RETIRED_RED]);
    expect([ghost.borderLeftColor, ghost.borderLeftStyle, ghost.borderLeftWidth]).toEqual([
      rgb(APP),
      "solid",
      "3.5px",
    ]);
  });

  it("keeps the root's heavier type-coloured edge under a change-state outline", async () => {
    await openTree("legacy");
    const root = style(tile("Legacy ERP"));
    expect([root.borderTopColor, root.borderTopStyle]).toEqual([RETIRED_RED, "dashed"]);
    expect([root.borderLeftColor, root.borderLeftStyle, root.borderLeftWidth]).toEqual([
      rgb(APP),
      "solid",
      "4px",
    ]);
  });

  it("keeps an expanded card's type-coloured edge under a change-state outline", async () => {
    await openTree("portal");
    fireEvent.click(tile("Legacy ERP"));
    await screen.findByText("Old Archive");
    const open = style(tile("Legacy ERP"));
    expect([open.borderTopColor, open.borderTopStyle]).toEqual([RETIRED_RED, "dashed"]);
    expect([open.borderLeftColor, open.borderLeftStyle, open.borderLeftWidth]).toEqual([
      rgb(APP),
      "solid",
      "3.5px",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Spotlight
// ---------------------------------------------------------------------------

describe("tree spotlight on ghost cards", () => {
  it("lights the spotlit ghost and fades the others like every other card", async () => {
    mockApi.on("get", "/reports/dependencies*", TIMELINE_GRAPH);
    tl.date = FUTURE;
    await openTree("portal");
    fireEvent.click(tile("CRM Cloud"));
    await screen.findByText("Legacy Mainframe");
    // At rest both retired cards are ghosted.
    expect(style(tile("Legacy ERP")).opacity).toBe("0.6");
    expect(style(tile("Legacy Mainframe")).opacity).toBe("0.6");

    act(() => slider.props.onMilestoneClick(LEGACY_EOL, LEGACY_EOL));
    // Legacy ERP retires at the clicked mark: it is the one lit.
    expect(style(tile("Legacy ERP")).opacity).toBe("1");
    // Legacy Mainframe retired long before it: faded with the rest.
    expect(style(tile("Legacy Mainframe")).opacity).toBe("0.3");
    expect(style(tile("CRM Cloud")).opacity).toBe("0.3");
  });
});

// ---------------------------------------------------------------------------
// Hover across a re-centre
// ---------------------------------------------------------------------------

describe("tree hover after a right-click re-centre", () => {
  it("does not leave the new tree dimmed by the card it was centred from", async () => {
    await openTree();
    fireEvent.mouseEnter(tile("Beta"));
    expect(style(tile("Finance")).opacity).toBe("0.4");

    fireEvent.contextMenu(tile("Beta"));
    // Beta is now the root, with Alpha and Linux as its neighbours.
    await waitFor(() => expect(tile("Beta").textContent).toContain("Application"));
    for (const name of ["Beta", "Alpha", "Linux"]) expect(style(tile(name)).opacity).toBe("1");
  });
});
