/**
 * Behaviour pinned for the first half of DependencyReport.tsx: the tree
 * layout engine (grouping, ordering, geometry, connections, hover chain), the
 * colour / icon / badge helpers it draws with, the saved-config restore and
 * deep link, navigation history, the graph fetch, the timeline's mark scope
 * and transformation delta, and the Layered Dependency View's neighbourhood.
 *
 * The LDV and the timeline slider are mocked and their props captured: what
 * the report hands them is this file's job, how they draw it is theirs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigationType } from "react-router";
import { createRef, StrictMode, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider, createTheme } from "@mui/material/styles";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({
  user: null as { permissions: Record<string, boolean> } | null,
  config: null as Record<string, unknown> | null,
  loadedConfig: null as unknown,
  reportType: "",
  persistConfig: (() => {}) as (cfg: unknown) => void,
  resetAll: (() => {}) as () => void,
  setSaveDialogOpen: (() => {}) as (open: boolean) => void,
  onThumbnailSave: null as null | (() => void),
  today: 0,
  date: 0,
  restore: (() => {}) as (v?: number) => void,
  tlReset: (() => {}) as () => void,
  slider: null as any,
  ldv: null as any,
  readable: [] as [string, boolean][],
}));

vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => h.user,
  useAuthContext: () => ({ user: h.user }),
}));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: (reportType: string) => {
    h.reportType = reportType;
    return {
      savedReport: null,
      savedReportName: null,
      saveDialogOpen: false,
      setSaveDialogOpen: h.setSaveDialogOpen,
      loadedConfig: h.loadedConfig,
      consumeConfig: () => h.config,
      resetSavedReport: () => {},
      persistConfig: h.persistConfig,
      resetAll: h.resetAll,
      reportType,
    };
  },
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: (onSave: () => void) => {
    h.onThumbnailSave = onSave;
    return { chartRef: createRef(), thumbnail: undefined, captureAndSave: () => {} };
  },
}));
vi.mock("@/hooks/useTimeline", () => ({
  useTimeline: () => ({
    timelineDate: h.date,
    setTimelineDate: () => {},
    todayMs: h.today,
    isTimeTraveling: h.date !== h.today,
    persistValue: undefined,
    printParam: null,
    restore: h.restore,
    reset: h.tlReset,
  }),
}));
vi.mock("@/components/TimelineSlider", () => ({
  default: (props: any) => {
    h.slider = props;
    return <div data-testid="timeline-slider" />;
  },
}));
vi.mock("@/features/reports/LayeredDependencyView", () => ({
  default: (props: any) => {
    h.ldv = props;
    return <div data-testid="ldv" />;
  },
  readableTypeColor: (color: string, dark: boolean) => {
    h.readable.push([color, dark]);
    return color;
  },
}));
vi.mock("@/features/reports/SaveReportDialog", () => ({ default: () => null }));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import DependencyReport from "./DependencyReport";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const ms = (iso: string) => new Date(iso).getTime();
const DAY = 86_400_000;
const TODAY = ms("2026-08-22");

const TYPES = [
  makeCardType({
    key: "Organization",
    label: "Organization",
    icon: "corporate_fare",
    color: "#aa0000",
    sort_order: 1,
  }),
  makeCardType({ key: "Application", label: "Application", icon: "apps", color: "#00aa00", sort_order: 2 }),
  makeCardType({
    key: "ITComponent",
    label: "IT Component",
    icon: "memory",
    color: "#0000aa",
    sort_order: 3,
  }),
];

type Lc = Record<string, string>;
function card(id: string, name: string, type = "Application", extra: Record<string, unknown> = {}) {
  return { id, name, type, lifecycle: {} as Lc, ...extra };
}
function rel(source: string, target: string, label = "uses", extra: Record<string, unknown> = {}) {
  return { source, target, type: "relTest", label, ...extra };
}

function serve(graph: { nodes: unknown[]; edges: unknown[] }) {
  mockApi.on("get", "/reports/dependencies*", graph);
}

/** Where the router is and how it got there. */
function Probe() {
  const location = useLocation();
  const navigationType = useNavigationType();
  return <output data-testid="probe">{`${location.search}|${navigationType}`}</output>;
}

function ui(opts: { route?: string; theme?: "light" | "dark" } = {}): ReactElement {
  const tree = (
    <MemoryRouter initialEntries={[opts.route ?? "/reports/dependencies"]}>
      <DependencyReport />
      <Probe />
    </MemoryRouter>
  );
  return opts.theme ? (
    <ThemeProvider theme={createTheme({ palette: { mode: opts.theme } })}>{tree}</ThemeProvider>
  ) : (
    tree
  );
}

function renderReport(opts: { route?: string; theme?: "light" | "dark"; strict?: boolean } = {}) {
  return render(opts.strict ? <StrictMode>{ui(opts)}</StrictMode> : ui(opts));
}

const lastPersisted = () => vi.mocked(h.persistConfig).mock.lastCall?.[0] as Record<string, unknown>;
const pickerShown = () => screen.findByText("Select a card to explore");

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(TYPES);
  h.user = { permissions: { "*": true } };
  h.config = null;
  h.loadedConfig = null;
  h.reportType = "";
  h.persistConfig = vi.fn();
  h.resetAll = vi.fn();
  h.setSaveDialogOpen = vi.fn();
  h.onThumbnailSave = null;
  h.today = TODAY;
  h.date = TODAY;
  h.restore = vi.fn();
  h.tlReset = vi.fn();
  h.slider = null;
  h.ldv = null;
  h.readable = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tree view
// ---------------------------------------------------------------------------

/**
 * A centre with seven neighbours across five card types, two of which the
 * metamodel does not know (one with a built-in fallback colour, one without).
 * Edges are listed so that neither the types nor the names arrive in the order
 * the tree must show them in.
 */
const TREE = {
  nodes: [
    card("c", "Core App"),
    card("sales", "Sales", "Organization"),
    card("alpha", "Alpha", "Application", { path: ["Suite"] }),
    card("mu", "Mu"),
    card("zeta", "Zeta"),
    card("server", "Server", "ITComponent"),
    card("leaf", "Leaf", "ITComponent"),
    card("thing", "Thing", "Mystery"),
    card("api", "Gateway", "Interface"),
  ],
  edges: [
    rel("c", "zeta", "feeds", { type: "relAppToApp" }),
    rel("c", "server", "runs on", { type: "relAppToITC" }),
    rel("c", "thing", "relates to", { type: "relAppToThing" }),
    rel("c", "alpha", "feeds", { type: "relAppToApp" }),
    rel("c", "mu", "feeds", { type: "relAppToApp" }),
    rel("c", "api", "exposes", { type: "relAppToInterface" }),
    rel("sales", "c", "owns", {
      type: "relOrgToApp",
      reverse_label: "is owned by",
      description: "Budget holder",
    }),
    rel("mu", "server", "runs on", { type: "relAppToITC" }),
    rel("mu", "leaf", "runs on", { type: "relAppToITC" }),
  ],
};

/** The drawn line of every connection, in layout order. */
function lines(container: HTMLElement) {
  return Array.from(container.querySelectorAll("svg > g > path:first-child")).map((p) => ({
    d: p.getAttribute("d"),
    stroke: p.getAttribute("stroke"),
    width: p.getAttribute("stroke-width"),
    opacity: p.getAttribute("stroke-opacity"),
  }));
}
/** The invisible hover target laid over each connection. */
function hitAreas(container: HTMLElement) {
  return Array.from(container.querySelectorAll("svg > g > path:last-child"));
}
/** Each type group header as "<icon><label>(<count>)", in DOM order. */
function headers() {
  return screen.getAllByText(/^\(\d+\)$/).map((el) => el.parentElement!.textContent);
}
/** A tree card by name; `index` picks among duplicates in layout order. */
function treeCard(name: string, index = 0): HTMLElement {
  const cards = screen
    .getAllByText(name)
    .map((el) => el.closest(".MuiPaper-elevation"))
    .filter((el): el is HTMLElement => !!el);
  return cards[index];
}
const badgeOf = (el: HTMLElement) => el.querySelector(".MuiBadge-badge")?.textContent ?? null;
const chevronOf = (el: HTMLElement) =>
  within(el).queryByText(/^(chevron_right|expand_more)$/)?.textContent ?? null;
const canvasOf = (container: HTMLElement) =>
  container.querySelector("svg > g")!.parentElement!.parentElement as HTMLElement;

async function renderTree(opts: { theme?: "light" | "dark" } = {}) {
  serve(TREE);
  h.config = { view: "chart", chartMode: "tree", center: "c" };
  const r = renderReport(opts);
  await screen.findByRole("button", { name: /collapse all branches/i });
  return r;
}

const COLLAPSED_LINES = [
  // Organization first (sort order 1), whatever order the edges came in.
  ["M 276 280 C 321 280, 321 74, 366 74", "#aa0000"], // Sales
  // Application next, alphabetical; Alpha carries a breadcrumb, so it is taller.
  ["M 276 280 C 321 280, 321 164, 366 164", "#00aa00"], // Alpha
  ["M 276 280 C 321 280, 321 215, 366 215", "#00aa00"], // Mu
  ["M 276 280 C 321 280, 321 260, 366 260", "#00aa00"], // Zeta
  ["M 276 280 C 321 280, 321 344, 366 344", "#0000aa"], // Server
  // Types the metamodel does not know sort last, in the order they arrived.
  ["M 276 280 C 321 280, 321 428, 366 428", "#999"], // Thing (no colour anywhere)
  ["M 276 280 C 321 280, 321 512, 366 512", "#02afa4"], // Gateway (built-in fallback)
];

describe("DependencyReport tree layout", () => {
  it("groups the centre's neighbours by type in metamodel order, names alphabetical within", async () => {
    const { container } = await renderTree();

    expect(headers()).toEqual([
      "corporate_fareOrganization(1)",
      "appsApplication(3)",
      "memoryIT Component(1)",
      "descriptionMystery(1)",
      "descriptionInterface(1)",
    ]);
    expect(lines(container).map((l) => [l.d, l.stroke])).toEqual(COLLAPSED_LINES);
    // Headers sit one column to the right of the centre, at the top of their group.
    const appHeader = screen.getByText("(3)").parentElement!;
    expect(getComputedStyle(appHeader).left).toBe("366px");
    expect(getComputedStyle(appHeader).top).toBe("112px");
    // The canvas is sized to the laid-out tree.
    expect(getComputedStyle(canvasOf(container)).width).toBe("670px");
    expect(getComputedStyle(canvasOf(container)).height).toBe("560px");
    expect(screen.getByText("8 nodes · 7 relations")).toBeInTheDocument();
  });

  it("nests an expanded card's neighbours a column further, never repeating an ancestor", async () => {
    const { container } = await renderTree();
    fireEvent.click(treeCard("Mu"));
    await screen.findByText("Leaf");

    expect(lines(container).map((l) => l.d)).toEqual([
      "M 276 315.5 C 321 315.5, 321 74, 366 74", // Sales
      "M 276 315.5 C 321 315.5, 321 164, 366 164", // Alpha
      "M 614 250.5 C 659 250.5, 659 241, 704 241", // Mu → Leaf
      "M 614 250.5 C 659 250.5, 659 286, 704 286", // Mu → Server
      "M 276 315.5 C 321 315.5, 321 250.5, 366 250.5", // Mu, centred on its branch
      "M 276 315.5 C 321 315.5, 321 331, 366 331", // Zeta, pushed down by the branch
      "M 276 315.5 C 321 315.5, 321 415, 366 415", // Server
      "M 276 315.5 C 321 315.5, 321 499, 366 499", // Thing
      "M 276 315.5 C 321 315.5, 321 583, 366 583", // Gateway
    ]);
    expect(headers()).toEqual([
      "corporate_fareOrganization(1)",
      "appsApplication(3)",
      "memoryIT Component(2)",
      "memoryIT Component(1)",
      "descriptionMystery(1)",
      "descriptionInterface(1)",
    ]);
    expect(getComputedStyle(screen.getByText("(2)").parentElement!).left).toBe("704px");
    expect(getComputedStyle(canvasOf(container)).width).toBe("1008px");
    expect(getComputedStyle(canvasOf(container)).height).toBe("631px");
    // The centre is Mu's ancestor, so it is not offered again under Mu.
    const coreCards = screen.getAllByText("Core App").filter((el) => el.closest(".MuiPaper-elevation"));
    expect(coreCards).toHaveLength(1);
    expect(screen.getByText("10 nodes · 9 relations")).toBeInTheDocument();
  });

  it("marks the second appearance of a card as a duplicate", async () => {
    await renderTree();
    expect(within(treeCard("Server")).queryByText("link")).toBeNull();

    fireEvent.click(treeCard("Mu"));
    await screen.findByText("Leaf");
    // First placed under Mu (laid out before the IT Component group), so the
    // one in the centre's own group is the repeat.
    expect(within(treeCard("Server", 0)).queryByText("link")).toBeNull();
    expect(within(treeCard("Server", 1)).getByText("link")).toBeInTheDocument();
  });

  it("labels only the centre with its type and shows breadcrumbs where a card has a path", async () => {
    await renderTree();
    expect(within(treeCard("Core App", 0)).getByText("Application")).toBeInTheDocument();
    expect(within(treeCard("Mu")).queryByText("Application")).toBeNull();
    expect(within(treeCard("Alpha")).getByText("Suite")).toBeInTheDocument();
    expect(treeCard("Zeta").textContent).toBe("Zetaopen_in_new");
  });

  it("badges an expandable card with its connection count, and nothing else", async () => {
    await renderTree();
    const root = treeCard("Core App", 0);
    expect([badgeOf(root), chevronOf(root)]).toEqual(["7", "expand_more"]);
    expect([badgeOf(treeCard("Mu")), chevronOf(treeCard("Mu"))]).toEqual(["3", "chevron_right"]);
    expect([badgeOf(treeCard("Server")), chevronOf(treeCard("Server"))]).toEqual([
      "2",
      "chevron_right",
    ]);
    // Their only neighbour is the centre, already on the path: nothing to expand.
    for (const name of ["Zeta", "Alpha", "Sales"]) {
      expect([badgeOf(treeCard(name)), chevronOf(treeCard(name))]).toEqual([null, null]);
    }

    // Clicking such a card changes nothing.
    fireEvent.click(treeCard("Zeta"));
    await waitFor(() => expect(chevronOf(treeCard("Zeta"))).toBeNull());
    expect(badgeOf(treeCard("Zeta"))).toBeNull();
  });

  it("expands a card on click and collapses it on a second click", async () => {
    await renderTree();
    fireEvent.click(treeCard("Mu"));
    await screen.findByText("Leaf");
    expect(chevronOf(treeCard("Mu"))).toBe("expand_more");

    fireEvent.click(treeCard("Mu"));
    await waitFor(() => expect(screen.queryByText("Leaf")).toBeNull());
    expect(chevronOf(treeCard("Mu"))).toBe("chevron_right");
    expect(headers()).toEqual([
      "corporate_fareOrganization(1)",
      "appsApplication(3)",
      "memoryIT Component(1)",
      "descriptionMystery(1)",
      "descriptionInterface(1)",
    ]);
  });

  it("highlights the hovered card's path back to the centre", async () => {
    const { container } = await renderTree();
    expect(new Set(lines(container).map((l) => `${l.width}/${l.opacity}`))).toEqual(
      new Set(["1.4/0.35"]),
    );
    fireEvent.click(treeCard("Mu"));
    await screen.findByText("Leaf");

    fireEvent.mouseEnter(treeCard("Leaf"));
    // Order: Sales, Alpha, Mu→Leaf, Mu→Server, Mu, Zeta, Server, Thing, Gateway.
    await waitFor(() =>
      expect(lines(container).map((l) => l.width)).toEqual([
        "1.4", "1.4", "2.4", "1.4", "2.4", "1.4", "1.4", "1.4", "1.4",
      ]),
    );
    expect(lines(container).map((l) => l.opacity)).toEqual([
      "0.1", "0.1", "0.9", "0.1", "0.9", "0.1", "0.1", "0.1", "0.1",
    ]);

    fireEvent.mouseLeave(treeCard("Leaf"));
    await waitFor(() =>
      expect(new Set(lines(container).map((l) => l.width))).toEqual(new Set(["1.4"])),
    );
  });

  it("names the relation a hovered connection stands for", async () => {
    const { container } = await renderTree();
    // The first connection is the centre's link to Sales, an incoming relation
    // read from the centre's side.
    fireEvent.mouseEnter(hitAreas(container)[0], { clientX: 5, clientY: 5 });
    expect(await screen.findByText("is owned by")).toBeInTheDocument();
    expect(screen.getByText("Budget holder")).toBeInTheDocument();
    fireEvent.mouseLeave(hitAreas(container)[0]);
    await waitFor(() => expect(screen.queryByText("is owned by")).toBeNull());

    // Mu's connection reads with Mu's relation, not the centre's first one.
    fireEvent.mouseEnter(hitAreas(container)[2], { clientX: 5, clientY: 5 });
    expect(await screen.findByText("feeds")).toBeInTheDocument();
    expect(screen.queryByText("runs on")).toBeNull();
  });

  it("asks for the dark-readable type colour only under a dark theme", async () => {
    await renderTree({ theme: "dark" });
    expect(h.readable.length).toBeGreaterThan(0);
    expect(h.readable.every(([, dark]) => dark)).toBe(true);
  });

  it("asks for the light type colour under a light theme", async () => {
    await renderTree({ theme: "light" });
    expect(h.readable.length).toBeGreaterThan(0);
    expect(h.readable.every(([, dark]) => !dark)).toBe(true);
    expect(h.readable).toContainEqual(["#00aa00", false]);
  });
});

// ---------------------------------------------------------------------------
// Time travel: the change badges
// ---------------------------------------------------------------------------

const LEGACY_EOL = ms("2027-06-01");
const FUTURE = ms("2028-06-01");

/** Who is where around 2026–2028: one retiring in the window, two retired long
 *  ago, two arriving, one planned well after the travelled date. */
const TT = {
  nodes: [
    card("legacy", "Legacy ERP", "Application", { lifecycle: { active: "2012-01-01", endOfLife: "2027-06-01" } }),
    card("portal", "Web Portal", "Application", { lifecycle: { active: "2020-01-01" } }),
    card("crm", "CRM Cloud", "Application", { lifecycle: { active: "2021-01-01" } }),
    card("mainframe", "Legacy Mainframe", "Application", {
      lifecycle: { active: "2005-01-01", endOfLife: "2015-01-01" },
    }),
    card("oldie", "Old Billing", "Application", {
      lifecycle: { active: "2004-01-01", endOfLife: "2016-01-01" },
    }),
    card("arr1", "Arrival One", "Application", { lifecycle: { active: "2027-01-01" } }),
    card("arr2", "Arrival Two", "Application", { lifecycle: { active: "2027-05-01" } }),
    card("nextgen", "NextGen Suite", "Application", { lifecycle: { plan: "2030-01-01" } }),
  ],
  edges: [
    rel("legacy", "portal"),
    rel("portal", "crm"),
    rel("nextgen", "crm"),
    rel("mainframe", "crm"),
    rel("oldie", "crm"),
    rel("arr1", "crm"),
    rel("arr2", "portal"),
  ],
};

const lostMarks = () => document.querySelectorAll('[title="Loses a connection here"]').length;

describe("DependencyReport change badges", () => {
  beforeEach(() => serve(TT));

  it("badges only cards drawn despite not being there — never one that has arrived", async () => {
    h.date = FUTURE;
    h.config = { view: "table" };
    renderReport();
    await screen.findByText("Arrival One");
    // Legacy ERP, Legacy Mainframe and Old Billing are retired by 2028 and kept
    // by "persist retired"; the two arrivals are simply part of the landscape.
    expect(screen.getAllByText("RETIRED")).toHaveLength(3);
    expect(screen.queryByText("UPCOMING")).toBeNull();
  });

  it("draws UPCOMING in the future colour and RETIRED in the error colour", async () => {
    h.date = FUTURE;
    h.config = { view: "table", previewPlanned: true };
    renderReport();
    const upcoming = await screen.findByText("UPCOMING");
    expect(getComputedStyle(upcoming.closest(".MuiChip-root")!).color).toBe("rgb(124, 77, 255)");
    const retired = screen.getAllByText("RETIRED")[0];
    expect(getComputedStyle(retired.closest(".MuiChip-root")!).color).toBe("rgb(244, 67, 54)");
  });

  it("outlines an arriving centre in the future colour in the tree", async () => {
    h.date = FUTURE;
    h.config = { view: "chart", chartMode: "tree", center: "arr1" };
    renderReport();
    await screen.findByRole("button", { name: /collapse all branches/i });
    const root = treeCard("Arrival One");
    expect(getComputedStyle(root).borderTopColor).toBe("rgb(124, 77, 255)");
  });
});

// ---------------------------------------------------------------------------
// Time travel: the transformation delta
// ---------------------------------------------------------------------------

describe("DependencyReport transformation delta", () => {
  beforeEach(() => serve(TT));

  it("counts what arrives and what retires between today and the travelled date", async () => {
    h.date = FUTURE;
    h.config = { view: "table" };
    const { container } = renderReport();
    await screen.findByText("Arrival One");
    await waitFor(() => expect(h.slider?.delta).toEqual({ arriving: 2, retiring: 1 }));
    expect(container.querySelector(".report-print-params")?.textContent).toContain(
      "Transformation: +2 / −1",
    );
  });

  it("reports no change while standing on today", async () => {
    h.config = { view: "table" };
    const { container } = renderReport();
    await screen.findAllByText("Web Portal");
    expect(h.slider.delta).toEqual({ arriving: 0, retiring: 0 });
    expect(container.querySelector(".report-print-params")?.textContent ?? "").not.toContain(
      "Transformation",
    );
  });
});

// ---------------------------------------------------------------------------
// Time travel: when the slider's mark is trusted
// ---------------------------------------------------------------------------

describe("DependencyReport mark tolerance", () => {
  beforeEach(() => serve(TT));

  async function standingOnTheMarkAt(dateMs: number, mark = LEGACY_EOL) {
    h.date = dateMs;
    h.config = { view: "table" };
    renderReport();
    await screen.findAllByText("Web Portal");
    act(() => h.slider.onActiveSpanChange({ from: mark, to: mark }));
  }

  it("trusts the mark from one day before it", async () => {
    await standingOnTheMarkAt(LEGACY_EOL - DAY);
    await waitFor(() => expect(lostMarks()).toBeGreaterThan(0));
  });

  it("does not trust it two days before", async () => {
    await standingOnTheMarkAt(LEGACY_EOL - 2 * DAY);
    await waitFor(() => expect(screen.getAllByText("Web Portal").length).toBeGreaterThan(0));
    expect(lostMarks()).toBe(0);
  });

  it("trusts the mark until one day after it", async () => {
    await standingOnTheMarkAt(LEGACY_EOL + DAY);
    await waitFor(() => expect(lostMarks()).toBeGreaterThan(0));
  });

  it("does not trust it two days after", async () => {
    await standingOnTheMarkAt(LEGACY_EOL + 2 * DAY);
    await waitFor(() => expect(screen.getAllByText("Web Portal").length).toBeGreaterThan(0));
    expect(lostMarks()).toBe(0);
  });

  it("does not drag a card going live at the mark onto the canvas ahead of its date", async () => {
    const goLive = ms("2027-01-01"); // Arrival One
    await standingOnTheMarkAt(goLive - DAY / 2, goLive);
    // The mark is trusted: CRM Cloud gains its connection to the arrival...
    await waitFor(() =>
      expect(document.querySelectorAll('[title="Gains a connection here"]').length).toBeGreaterThan(0),
    );
    // ...but only a RETIRING card is held on screen by it. Half a day short of
    // its go-live, with "preview planned" off, the arrival is not there yet.
    expect(screen.queryByText("Arrival One")).toBeNull();
  });

  it("ignores a mark the travelled date is nowhere near", async () => {
    h.date = FUTURE;
    h.config = { view: "table", persistRetired: false };
    renderReport();
    await screen.findAllByText("Web Portal");
    act(() => h.slider.onActiveSpanChange({ from: LEGACY_EOL, to: LEGACY_EOL }));
    // Legacy ERP retired a year earlier; with persist off it stays hidden.
    await waitFor(() => expect(screen.getAllByText("Web Portal").length).toBeGreaterThan(0));
    expect(screen.queryByText("Legacy ERP")).toBeNull();
    expect(lostMarks()).toBe(0);
  });

  it("keeps the centred card on the canvas after it retires, persist off", async () => {
    h.config = { view: "chart", chartMode: "c4", center: "mainframe", persistRetired: false };
    renderReport();
    await screen.findByTestId("ldv");
    expect(h.ldv.centerId).toBe("mainframe");
    expect(h.ldv.nodes.map((n: { id: string }) => n.id)).toContain("mainframe");
  });
});

// ---------------------------------------------------------------------------
// The mark scope and the Layered Dependency View's neighbourhood
// ---------------------------------------------------------------------------

/** One distinct date per card, so each mark names exactly one card. */
const SCOPE_DATES: Record<string, string> = {
  c: "2001-01-01",
  x: "2002-01-01",
  n2: "2003-01-01",
  n1: "2004-01-01",
  deep: "2005-01-01",
  deeper: "2006-01-01",
  far: "2007-01-01",
  far2: "2008-01-01",
  p: "2020-01-01",
  kid: "2010-01-01",
};
const active = (id: string) => ({ lifecycle: { active: SCOPE_DATES[id] } });

const SCOPE = {
  nodes: [
    // A hierarchy child of Kid, which is related to nothing.
    card("c", "Center", "Application", { ...active("c"), parent_id: "kid" }),
    // Hierarchy child of the centre AND related to it: both on screen at once.
    card("x", "Xenon", "Application", { ...active("x"), parent_id: "c" }),
    card("n2", "Neon", "Application", active("n2")),
    card("n1", "Argon", "Application", { ...active("n1"), parent_id: "p" }),
    card("deep", "Krypton", "Application", active("deep")),
    card("deeper", "Radon", "Application", active("deeper")),
    card("far", "Helium", "Application", active("far")),
    card("far2", "Boron", "Application", active("far2")),
    // Retired before today (kept by "persist retired"), related to nothing.
    card("p", "Parent Co", "Organization", { lifecycle: { endOfLife: SCOPE_DATES.p } }),
    // Retired before today too; a hierarchy child of Neon.
    card("kid", "Kid", "Application", { lifecycle: { endOfLife: SCOPE_DATES.kid }, parent_id: "n2" }),
  ],
  edges: [
    // The centre is the TARGET of two edges before it is ever a source.
    rel("x", "c"),
    rel("n2", "c"),
    rel("c", "n1"),
    rel("n1", "deep"),
    rel("deep", "deeper"),
    rel("far", "far2"),
  ],
};

const cardByMark = new Map(Object.entries(SCOPE_DATES).map(([id, d]) => [ms(d), id]));
/** The cards the timeline's marks are computed over, read off the marks. */
const marked = () =>
  ((h.slider?.milestones ?? []) as { value: number }[])
    .map((m) => cardByMark.get(m.value))
    .sort();
const onCanvas = () => (h.ldv.nodes as { id: string }[]).map((n) => n.id).sort();
const edgePairs = () =>
  (h.ldv.edges as { source: string; target: string; type: string }[])
    .map((e) => `${e.source}>${e.target}${e.type === "hierarchy" ? " (hierarchy)" : ""}`)
    .sort();

async function renderLdv(center = "c") {
  serve(SCOPE);
  h.config = { view: "chart", chartMode: "c4", center };
  renderReport();
  await screen.findByTestId("ldv");
  await waitFor(() => expect(h.ldv.centerId).toBe(center));
}

describe("DependencyReport timeline mark scope", () => {
  it("marks the centred card and its direct neighbours only, in the chart", async () => {
    await renderLdv();
    await waitFor(() => expect(marked()).toEqual(["c", "n1", "n2", "x"]));
  });

  it("marks the whole graph in the table, centred or not", async () => {
    serve(SCOPE);
    h.config = { view: "table", center: "c" };
    renderReport();
    await screen.findAllByText("Krypton");
    await waitFor(() => expect(marked()).toHaveLength(10));
  });

  it("marks the whole graph in an uncentred table", async () => {
    serve(SCOPE);
    h.config = { view: "table" };
    renderReport();
    await screen.findAllByText("Krypton");
    await waitFor(() => expect(marked()).toHaveLength(10));
  });

  it("follows the layered view's expansions, and forgets one that left the screen", async () => {
    await renderLdv();
    act(() => h.ldv.onNodeExpand("n1"));
    await waitFor(() => expect(onCanvas()).toEqual(["c", "deep", "n1", "n2", "x"]));
    expect(marked()).toEqual(["c", "deep", "n1", "n2", "x"]);

    act(() => h.ldv.onNodeExpand("deep"));
    await waitFor(() => expect(onCanvas()).toContain("deeper"));
    expect(marked()).toContain("deeper");

    // Collapsing Argon takes Krypton off screen; its own expansion must lapse
    // with it rather than keep Radon floating there.
    act(() => h.ldv.onNodeExpand("n1"));
    await waitFor(() => expect(onCanvas()).toEqual(["c", "n1", "n2", "x"]));
    expect(marked()).toEqual(["c", "n1", "n2", "x"]);
  });

  it("follows the reveal tools", async () => {
    await renderLdv();
    act(() => h.ldv.onNodeReveal("n1", "parents"));
    await waitFor(() => expect(onCanvas()).toContain("p"));
    expect(marked()).toEqual(["c", "n1", "n2", "p", "x"]);

    act(() => h.ldv.onNodeReveal("n2", "children"));
    await waitFor(() => expect(onCanvas()).toContain("kid"));
    expect(marked()).toEqual(["c", "kid", "n1", "n2", "p", "x"]);
  });

  it("follows the tree's expanded branches", async () => {
    serve(SCOPE);
    h.config = { view: "chart", chartMode: "tree", center: "c" };
    renderReport();
    await screen.findByRole("button", { name: /collapse all branches/i });
    await waitFor(() => expect(marked()).toEqual(["c", "n1", "n2", "x"]));

    fireEvent.click(treeCard("Argon"));
    await screen.findByText("Krypton");
    await waitFor(() => expect(marked()).toEqual(["c", "deep", "n1", "n2", "x"]));
  });
});

describe("DependencyReport layered view neighbourhood", () => {
  it("hands over only the relations between cards on the canvas, and no containment lines", async () => {
    await renderLdv();
    expect(edgePairs()).toEqual(["c>n1", "n2>c", "x>c"]);
  });

  it("draws the containment line for revealed children", async () => {
    await renderLdv();
    act(() => h.ldv.onNodeReveal("n2", "children"));
    await waitFor(() => expect(edgePairs()).toContain("n2>kid (hierarchy)"));
  });

  it("never hands over a containment line to a revealed card the timeline hid", async () => {
    await renderLdv();
    act(() => h.ldv.onNodeReveal("n1", "parents"));
    act(() => h.ldv.onNodeReveal("n2", "children"));
    await waitFor(() => expect(edgePairs()).toContain("p>n1 (hierarchy)"));
    expect(edgePairs()).toContain("kid>c (hierarchy)");

    // Parent Co and Kid retired before today: dropping "persist retired" hides them.
    await userEvent.click(screen.getByRole("checkbox", { name: /Keep retired cards/ }));
    await waitFor(() => expect(onCanvas()).toEqual(["c", "n1", "n2", "x"]));
    const ids = new Set(onCanvas());
    for (const e of h.ldv.edges as { source: string; target: string }[]) {
      expect(ids.has(e.source) && ids.has(e.target)).toBe(true);
    }
  });

  it("falls back to the picker when the stored centre is not in the graph", async () => {
    serve(SCOPE);
    h.config = { view: "chart", chartMode: "c4", center: "ghost" };
    renderReport();
    expect(await pickerShown()).toBeInTheDocument();
    expect(screen.queryByTestId("ldv")).toBeNull();
  });

  it("starts a new centre with no expansions or reveals carried over", async () => {
    await renderLdv();
    act(() => h.ldv.onNodeExpand("n1"));
    await waitFor(() => expect(onCanvas()).toContain("deep"));
    // Krypton's neighbours are Argon and Radon; the old expansion of Argon must
    // not drag the old centre in.
    act(() => h.ldv.onNodeShiftClick("deep"));
    await waitFor(() => expect(h.ldv.centerId).toBe("deep"));
    await waitFor(() => expect(onCanvas()).toEqual(["deep", "deeper", "n1"]));
  });

  it("drops revealed parents when the centre changes", async () => {
    await renderLdv();
    act(() => h.ldv.onNodeReveal("n1", "parents"));
    await waitFor(() => expect(onCanvas()).toContain("p"));
    act(() => h.ldv.onNodeShiftClick("n2"));
    await waitFor(() => expect(h.ldv.centerId).toBe("n2"));
    await waitFor(() => expect(onCanvas()).toEqual(["c", "n2"]));
  });

  it("drops revealed children when the centre changes", async () => {
    await renderLdv();
    act(() => h.ldv.onNodeReveal("n2", "children"));
    await waitFor(() => expect(onCanvas()).toContain("kid"));
    act(() => h.ldv.onNodeShiftClick("n1"));
    await waitFor(() => expect(h.ldv.centerId).toBe("n1"));
    await waitFor(() => expect(onCanvas()).toEqual(["c", "deep", "n1"]));
  });

  it("clears expansions and revealed children on Reset", async () => {
    await renderLdv();
    act(() => h.ldv.onNodeExpand("n1"));
    act(() => h.ldv.onNodeReveal("n2", "children"));
    await waitFor(() => expect(onCanvas()).toEqual(["c", "deep", "kid", "n1", "n2", "x"]));
    act(() => h.ldv.onReset());
    await waitFor(() => expect(onCanvas()).toEqual(["c", "n1", "n2", "x"]));
  });
});

// ---------------------------------------------------------------------------
// Navigation history
// ---------------------------------------------------------------------------

describe("DependencyReport layered view history", () => {
  it("does nothing on Back before any navigation", async () => {
    await renderLdv();
    act(() => h.ldv.onPrev());
    expect(screen.getByTestId("ldv")).toBeInTheDocument();
    expect(screen.queryByText("Select a card to explore")).toBeNull();
    expect(h.ldv.centerId).toBe("c");
  });

  it("does nothing on Back at the start of the history after a Reset", async () => {
    await renderLdv();
    act(() => h.ldv.onReset());
    act(() => h.ldv.onPrev());
    expect(screen.getByTestId("ldv")).toBeInTheDocument();
    expect(screen.queryByText("Select a card to explore")).toBeNull();
    expect(h.ldv.centerId).toBe("c");
  });

  it("moves the cursor on Forward, so the end of the history has no Forward", async () => {
    await renderLdv();
    act(() => h.ldv.onNodeShiftClick("n1"));
    act(() => h.ldv.onNodeShiftClick("deep"));
    act(() => h.ldv.onPrev());
    await waitFor(() => expect(h.ldv.centerId).toBe("n1"));
    act(() => h.ldv.onNext());
    await waitFor(() => expect(h.ldv.centerId).toBe("deep"));
    expect(h.ldv.hasNext).toBe(false);
    expect(h.ldv.hasPrev).toBe(true);
  });

  it("drops the forward history when navigating from the middle of it", async () => {
    await renderLdv();
    act(() => h.ldv.onNodeShiftClick("n1"));
    act(() => h.ldv.onNodeShiftClick("deep"));
    act(() => h.ldv.onPrev());
    await waitFor(() => expect(h.ldv.centerId).toBe("n1"));
    act(() => h.ldv.onNodeShiftClick("c"));
    await waitFor(() => expect(h.ldv.centerId).toBe("c"));
    expect(h.ldv.hasNext).toBe(false);
    act(() => h.ldv.onPrev());
    await waitFor(() => expect(h.ldv.centerId).toBe("n1"));
  });

  it("keeps the current centre as the start of the history after Reset", async () => {
    await renderLdv();
    act(() => h.ldv.onReset());
    act(() => h.ldv.onNodeShiftClick("x"));
    await waitFor(() => expect(h.ldv.centerId).toBe("x"));
    act(() => h.ldv.onPrev());
    await waitFor(() => expect(h.ldv.centerId).toBe("c"));
  });

  it("goes Home to the picker with no centre, no timeline and no history", async () => {
    await renderLdv();
    act(() => h.ldv.onNodeShiftClick("n1"));
    act(() => h.ldv.onNodeShiftClick("n2"));
    act(() => h.ldv.onHome());
    await pickerShown();
    expect(screen.queryByTestId("timeline-slider")).toBeNull();
    await waitFor(() => expect(lastPersisted().center).toBe(""));

    fireEvent.click(screen.getByText("Krypton"));
    await screen.findByTestId("ldv");
    await waitFor(() => expect(h.ldv.centerId).toBe("deep"));
    expect(h.ldv.hasPrev).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Who may create a diagram, and which types are offered
// ---------------------------------------------------------------------------

describe("DependencyReport permissions", () => {
  it.each([
    ["the wildcard admin", { "*": true }, true],
    ["a diagram manager", { "diagrams.manage": true }, true],
    ["a report reader", { "reports.ea_dashboard": true }, false],
  ])("lets %s create a diagram: %s", async (_who, permissions, allowed) => {
    h.user = { permissions };
    await renderLdv();
    expect(h.ldv.canCreateDiagram).toBe(allowed);
  });

  it("lets nobody create a diagram when signed out", async () => {
    h.user = null;
    await renderLdv();
    expect(h.ldv.canCreateDiagram).toBe(false);
  });

  it("offers every type to a report reader without inventory access", async () => {
    h.user = { permissions: { "reports.ea_dashboard": true } };
    serve(SCOPE);
    h.config = { view: "chart" };
    renderReport();
    await pickerShown();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /^type$/i }));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All Types",
      "Organization",
      "Application",
      "IT Component",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Saved config, deep link, reset
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  cardTypeKey: "",
  center: "",
  view: "chart",
  chartMode: "c4",
  timelineDate: undefined,
  persistRetired: true,
  previewPlanned: false,
};

describe("DependencyReport saved configuration", () => {
  beforeEach(() => serve(SCOPE));

  it("opens on the picker when nothing is stored", async () => {
    renderReport();
    expect(await pickerShown()).toBeInTheDocument();
    expect(h.reportType).toBe("dependencies");
    expect(h.restore).toHaveBeenCalledWith(undefined);
    // Nothing is centred, so there is no diagram for the timeline to act on.
    expect(screen.queryByTestId("timeline-slider")).toBeNull();
    await waitFor(() => expect(lastPersisted()).toEqual(DEFAULT_CONFIG));
  });

  it("falls back to the defaults for every key a stored config lacks", async () => {
    h.config = {};
    renderReport();
    expect(await pickerShown()).toBeInTheDocument();
    await waitFor(() => expect(lastPersisted()).toEqual(DEFAULT_CONFIG));
  });

  it("restores every stored setting", async () => {
    h.config = {
      cardTypeKey: "Application",
      center: "c",
      view: "table",
      chartMode: "tree",
      persistRetired: false,
      previewPlanned: true,
      timelineDate: 1_234_567,
    };
    renderReport();
    await screen.findAllByText("Krypton");
    expect(h.restore).toHaveBeenCalledWith(1_234_567);
    expect(screen.getByRole("checkbox", { name: /Keep retired cards/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Show cards that have not started/ })).toBeChecked();
    await waitFor(() =>
      expect(lastPersisted()).toEqual({
        cardTypeKey: "Application",
        center: "c",
        view: "table",
        chartMode: "tree",
        timelineDate: undefined,
        persistRetired: false,
        previewPlanned: true,
      }),
    );
  });

  it("re-applies the config when a different saved report loads", async () => {
    h.config = { view: "table" };
    const r = renderReport();
    await screen.findAllByText("Krypton");
    expect(screen.queryByTestId("ldv")).toBeNull();

    h.loadedConfig = { id: "saved-1" };
    h.config = { view: "chart", chartMode: "c4", center: "n1" };
    r.rerender(ui());
    await screen.findByTestId("ldv");
    await waitFor(() => expect(h.ldv.centerId).toBe("n1"));
  });

  it("opens the save dialog once the thumbnail is captured", async () => {
    renderReport();
    await pickerShown();
    act(() => h.onThumbnailSave!());
    expect(h.setSaveDialogOpen).toHaveBeenCalledWith(true);
  });

  it("consumes a deep link, keeping the other query parameters, without a history entry", async () => {
    h.config = { view: "table", cardTypeKey: "Organization" };
    renderReport({ route: "/reports/dependencies?center=n1&mode=tree&keep=1" });
    await screen.findByRole("button", { name: /collapse all branches/i });
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("?keep=1|REPLACE"));
    await waitFor(() =>
      expect(lastPersisted()).toEqual({
        ...DEFAULT_CONFIG,
        center: "n1",
        chartMode: "tree",
      }),
    );
  });

  it("resets the picker filters and both visibility switches", async () => {
    h.config = { view: "chart", persistRetired: false, previewPlanned: true };
    const user = userEvent.setup();
    renderReport();
    await pickerShown();

    fireEvent.click(screen.getByText("Organization (1)"));
    await waitFor(() => expect(screen.queryByText("Center")).toBeNull());
    await user.click(screen.getByRole("checkbox", { name: /Hide end-of-life/ }));
    await waitFor(() => expect(screen.queryByText("Parent Co")).toBeNull());
    await user.type(screen.getByPlaceholderText("Search cards..."), "zz");

    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(await screen.findByText("Center")).toBeInTheDocument();
    expect(screen.getByText("Parent Co")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search cards...")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: /Hide end-of-life/ })).not.toBeChecked();
    await waitFor(() => expect(lastPersisted()).toEqual(DEFAULT_CONFIG));
  });
});

// ---------------------------------------------------------------------------
// The graph fetch
// ---------------------------------------------------------------------------

describe("DependencyReport graph fetch", () => {
  it("shows a spinner on first paint, before any data", () => {
    serve(SCOPE);
    const html = renderToStaticMarkup(ui());
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain("Select a card to explore");
  });

  it("fetches the whole graph once, abortably", async () => {
    serve(SCOPE);
    renderReport();
    await pickerShown();
    expect(mockApi.api.get).toHaveBeenCalledTimes(1);
    expect(mockApi.api.get).toHaveBeenCalledWith("/reports/dependencies?", {
      signal: expect.any(AbortSignal),
    });
  });

  it("settles on an empty picker when the fetch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.fail("get", "/reports/dependencies*");
    renderReport();
    expect(await screen.findByText("No cards to explore")).toBeInTheDocument();
  });

  it("never lets a superseded response overwrite the current one", async () => {
    const replies: ((v: unknown) => void)[] = [];
    const pending = () => new Promise((resolve) => replies.push(resolve));
    vi.mocked(mockApi.api.get).mockImplementationOnce(pending).mockImplementationOnce(pending);
    // StrictMode mounts twice: the first request is superseded by the second.
    renderReport({ strict: true });
    await waitFor(() => expect(replies).toHaveLength(2));

    await act(async () => replies[1]({ nodes: [card("new", "Current Card")], edges: [] }));
    expect(await screen.findByText("Current Card")).toBeInTheDocument();
    await act(async () => replies[0]({ nodes: [card("old", "Stale Card")], edges: [] }));
    expect(screen.queryByText("Stale Card")).toBeNull();
    expect(screen.getByText("Current Card")).toBeInTheDocument();
  });

  it("keeps spinning while the current request is in flight", async () => {
    const replies: ((v: unknown) => void)[] = [];
    const pending = () => new Promise((resolve) => replies.push(resolve));
    vi.mocked(mockApi.api.get).mockImplementationOnce(pending).mockImplementationOnce(pending);
    renderReport({ strict: true });
    await waitFor(() => expect(replies).toHaveLength(2));

    await act(async () => replies[0]({ nodes: [card("old", "Stale Card")], edges: [] }));
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    await act(async () => replies[1]({ nodes: [card("new", "Current Card")], edges: [] }));
    expect(await screen.findByText("Current Card")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The centre picker and the "Center on" drop-down
// ---------------------------------------------------------------------------

describe("DependencyReport centre choosers", () => {
  it("counts every relation a card takes part in, either end", async () => {
    serve(TT);
    h.config = { view: "chart" };
    renderReport();
    await pickerShown();
    const row = (name: string) => screen.getByText(name).parentElement!.parentElement!;
    // Web Portal: source of one relation, target of two.
    expect(within(row("Web Portal")).getByText("3")).toBeInTheDocument();
    // Legacy ERP: source of one.
    expect(within(row("Legacy ERP")).getByText("1")).toBeInTheDocument();
  });

  it("ranks the typed term in the drop-down, keeping an exact match", async () => {
    serve({
      nodes: [card("hub", "Cloud Work Hub"), card("wd", "Workday"), card("zz", "Zebra")],
      edges: [],
    });
    h.config = { view: "chart" };
    const user = userEvent.setup();
    renderReport();
    await pickerShown();
    const input = screen.getByRole("combobox", { name: /center on/i });
    await user.click(input);
    await user.type(input, "work");
    const names = () =>
      Array.from(document.querySelectorAll('[role="option"]')).map(
        (el) => el.querySelector("p")?.textContent,
      );
    // Starts-with beats starts-a-word, against alphabetical order.
    expect(names()).toEqual(["Workday", "Cloud Work Hub"]);
    await user.type(input, "day");
    expect(names()).toEqual(["Workday"]);
  });
});
