/**
 * Mutation-hardening tests for the Dependencies report's rendering half: the
 * toolbar, the print summary, the legend, the tree view's cards, connections
 * and tooltips, the centre picker's list, and the relation table.
 *
 * The LDV itself is mocked (React Flow cannot lay out in jsdom); its props are
 * captured so what the report hands it can be asserted at the boundary. Every
 * sibling is mocked through the `@/` alias so the mocks also apply to an
 * out-of-tree copy of the report.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({ user: { permissions: { "*": true } } }),
}));

const saved = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  savedReportName: null as string | null,
  persistConfig: (() => {}) as (cfg: Record<string, unknown>) => void,
}));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: () => ({
    savedReport: null,
    savedReportName: saved.savedReportName,
    saveDialogOpen: false,
    setSaveDialogOpen: () => {},
    loadedConfig: null,
    consumeConfig: () => saved.config,
    resetSavedReport: () => {},
    persistConfig: saved.persistConfig,
    resetAll: () => {},
    reportType: "dependencies",
  }),
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({ chartRef: createRef(), thumbnail: undefined, captureAndSave: () => {} }),
}));

const tl = vi.hoisted(() => ({
  today: 0,
  date: 0,
  printParam: null as { label: string; value: string } | null,
}));
vi.mock("@/hooks/useTimeline", () => ({
  useTimeline: () => ({
    timelineDate: tl.date,
    setTimelineDate: () => {},
    todayMs: tl.today,
    isTimeTraveling: tl.date !== tl.today,
    persistValue: undefined,
    printParam: tl.printParam,
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
const ldv = vi.hoisted(() => ({ props: null as any }));
vi.mock("@/features/reports/LayeredDependencyView", () => ({
  default: (props: any) => {
    ldv.props = props;
    return <div data-testid="ldv" />;
  },
  readableTypeColor: (color: string) => color,
}));
/* eslint-enable @typescript-eslint/no-explicit-any */
vi.mock("@/features/reports/SaveReportDialog", () => ({ default: () => null }));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: (props: { cardId: string | null; open: boolean }) =>
    props.open ? <div data-testid="side-panel">{props.cardId}</div> : null,
}));

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

const TYPES = [
  makeCardType({ key: "Organization", label: "Organization", color: ORG, sort_order: 1 }),
  makeCardType({ key: "Application", label: "Application", color: APP, sort_order: 2 }),
  makeCardType({ key: "ITComponent", label: "IT Component", color: ITC, sort_order: 3 }),
  makeCardType({ key: "Secret", label: "Secret Type", color: "#123456", sort_order: 4, is_hidden: true }),
];

/**
 * A graph with no lifecycle dates, listed type-shuffled (IT Components first)
 * so any ordering on screen is the report's own.
 *
 *   fin ── owns ──▶ alpha ── uses ──▶ db ── runs on ──▶ os
 *                     └── sends data to ──▶ beta ── uses ──▶ os
 */
const GRAPH = {
  nodes: [
    { id: "db", name: "Oracle DB", type: "ITComponent", lifecycle: {}, path: ["Infra", "Databases"] },
    { id: "os", name: "Linux", type: "ITComponent", lifecycle: {} },
    { id: "fin", name: "Finance", type: "Organization", lifecycle: {} },
    { id: "ops", name: "Operations", type: "Organization", lifecycle: {} },
    { id: "alpha", name: "Alpha", type: "Application", lifecycle: {}, path: ["Group", "Suite"] },
    { id: "beta", name: "Beta", type: "Application", lifecycle: {} },
  ],
  edges: [
    {
      source: "alpha",
      target: "db",
      type: "relAppToITC",
      label: "uses",
      description: "Primary database, see https://db.example.com/docs",
    },
    { source: "alpha", target: "beta", type: "relAppToApp", label: "sends data to" },
    { source: "beta", target: "os", type: "relAppToITC", label: "uses" },
    { source: "fin", target: "alpha", type: "relOrgToApp", label: "owns" },
    { source: "db", target: "os", type: "relItcToItc", label: "runs on" },
  ],
};

const ms = (iso: string) => new Date(iso).getTime();
const TODAY = ms("2026-08-22");
const FUTURE = ms("2028-06-01");
const LEGACY_EOL = ms("2027-06-01");

/** A graph whose cards come and go: one retires inside the window, one long ago. */
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
  ],
  edges: [
    // The retiring card sits on the TARGET side, so both table columns badge.
    { source: "portal", target: "legacy", type: "relAppToApp", label: "uses" },
    { source: "portal", target: "crm", type: "relAppToApp", label: "uses" },
    { source: "mainframe", target: "crm", type: "relAppToApp", label: "uses" },
  ],
};

function renderReport(cfg: Record<string, unknown> | null, entry = "/reports/dependencies") {
  saved.config = cfg;
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <DependencyReport />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(TYPES);
  ldv.props = null;
  slider.props = null;
  saved.config = null;
  saved.savedReportName = null;
  saved.persistConfig = vi.fn();
  tl.today = TODAY;
  tl.date = TODAY;
  tl.printParam = null;
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

async function openTree(center = "alpha") {
  const utils = renderReport({ view: "chart", chartMode: "tree", center });
  await screen.findByRole("button", { name: /collapse all branches/i });
  return utils;
}

/** Tree columns start at PADDING + n·(CARD_W + COL_GAP); a line leaves at x + CARD_W. */
const COL0_OUT = 276;
const COL1_OUT = 614;

/** The drawn (visible) line from a parent in a given column to a child of a given type colour. */
function line(container: HTMLElement, color: string, fromX: number): SVGPathElement {
  const hit = Array.from(
    container.querySelectorAll<SVGPathElement>(`path[fill="none"][stroke="${color}"]`),
  ).find((p) => p.getAttribute("d")!.startsWith(`M ${fromX} `));
  if (!hit) throw new Error(`no ${color} line from x=${fromX}`);
  return hit;
}
/** The invisible, wider hit area laid over a drawn line. */
function hitArea(container: HTMLElement, drawn: SVGPathElement): SVGPathElement {
  return container.querySelector(
    `path[stroke="transparent"][d="${drawn.getAttribute("d")}"]`,
  ) as SVGPathElement;
}
const look = (p: SVGPathElement) => `${p.getAttribute("stroke-width")}/${p.getAttribute("stroke-opacity")}`;

function printParams(container: HTMLElement): string[] {
  const box = container.querySelector(".report-print-params");
  if (!box) return [];
  return Array.from(box.children).map((el) => (el.textContent ?? "").replace(/\|$/, ""));
}
function legendEntries(container: HTMLElement): string[] {
  const box = container.querySelector(".report-legend");
  if (!box) return [];
  return Array.from(box.querySelectorAll(".MuiTypography-caption")).map((el) => el.textContent ?? "");
}
function optionNames(): string[] {
  return Array.from(document.querySelectorAll('[role="option"]')).map(
    (el) => el.querySelector("p")?.textContent ?? "",
  );
}
/** A picker row: the clickable box around a card's name. */
function pickerRow(name: string): HTMLElement {
  return screen.getByText(name).parentElement!.parentElement as HTMLElement;
}
async function pick(label: RegExp, option: RegExp) {
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
}
/** Tell the report the slider is standing on a transition mark. */
function standOn(date: number) {
  act(() => slider.props.onActiveSpanChange({ from: date, to: date }));
}
const lastPersisted = () =>
  vi.mocked(saved.persistConfig).mock.calls.at(-1)?.[0] as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Tree view — hover highlighting
// ---------------------------------------------------------------------------

describe("tree view hover", () => {
  it("lights the hovered card's ancestry, then its children, and clears on leave", async () => {
    const { container } = await openTree();
    fireEvent.click(tile("Beta"));
    await screen.findByText("Linux");

    const toFin = () => line(container, ORG, COL0_OUT);
    const toBeta = () => line(container, APP, COL0_OUT);
    const toDb = () => line(container, ITC, COL0_OUT);
    const betaToOs = () => line(container, ITC, COL1_OUT);

    // At rest every line is drawn the same.
    expect([toFin(), toBeta(), toDb(), betaToOs()].map(look)).toEqual([
      "1.4/0.35",
      "1.4/0.35",
      "1.4/0.35",
      "1.4/0.35",
    ]);
    expect(tile("Alpha").className).toContain("MuiPaper-elevation2");

    // Hovering a leaf lights the whole path back to the root…
    fireEvent.mouseEnter(tile("Linux"));
    expect([toBeta(), betaToOs()].map(look)).toEqual(["2.4/0.9", "2.4/0.9"]);
    // …and dims the branches off it, even those leaving a lit card.
    expect([toFin(), toDb()].map(look)).toEqual(["1.4/0.1", "1.4/0.1"]);
    for (const name of ["Linux", "Beta", "Alpha"])
      expect(tile(name).className).toContain("MuiPaper-elevation4");
    expect(tile("Finance").className).toContain("MuiPaper-elevation0");
    expect(tile("Finance")).toHaveStyle({ opacity: "0.4" });
    expect(tile("Beta")).toHaveStyle({ opacity: "1" });
    fireEvent.mouseLeave(tile("Linux"));

    // Hovering a card lights its own children too.
    fireEvent.mouseEnter(tile("Beta"));
    expect([toBeta(), betaToOs()].map(look)).toEqual(["2.4/0.9", "2.4/0.9"]);
    expect([toFin(), toDb()].map(look)).toEqual(["1.4/0.1", "1.4/0.1"]);
    expect(tile("Linux").className).toContain("MuiPaper-elevation4");
    expect(tile("Oracle DB").className).toContain("MuiPaper-elevation0");

    fireEvent.mouseLeave(tile("Beta"));
    expect([toFin(), toBeta(), toDb(), betaToOs()].map(look)).toEqual([
      "1.4/0.35",
      "1.4/0.35",
      "1.4/0.35",
      "1.4/0.35",
    ]);
    expect(tile("Finance")).toHaveStyle({ opacity: "1" });
  });

  it("survives re-centring on the card under the pointer", async () => {
    // Right-click re-centres; the hovered tile's instance is gone from the new
    // tree, and the pointer has not left it yet.
    await openTree();
    fireEvent.click(tile("Beta"));
    await screen.findByText("Linux");
    fireEvent.mouseEnter(tile("Linux"));
    fireEvent.contextMenu(tile("Linux"));
    expect(await screen.findByText("3 nodes · 2 relations")).toBeInTheDocument();
    expect(tile("Linux").textContent).toContain("IT Component");
  });
});

// ---------------------------------------------------------------------------
// Tree view — a hovered connection
// ---------------------------------------------------------------------------

describe("tree view connection tooltip", () => {
  it("names the relation and its two ends, follows the pointer and goes on leave", async () => {
    const { container } = await openTree();
    const drawn = line(container, ITC, COL0_OUT);
    const hit = hitArea(container, drawn);
    (hit.closest("svg") as SVGSVGElement).getBoundingClientRect = () =>
      ({ left: 100, top: 50, right: 0, bottom: 0, width: 0, height: 0, x: 100, y: 50 }) as DOMRect;

    // A stray move with nothing hovered opens nothing.
    fireEvent.mouseMove(hit, { clientX: 120, clientY: 60 });
    expect(screen.queryByText("Primary database", { exact: false })).toBeNull();

    fireEvent.mouseEnter(hit, { clientX: 130, clientY: 80 });
    const tip = screen.getByText("uses").closest(".MuiPaper-root") as HTMLElement;
    expect(tip.textContent).toBe("usesAlpha→Oracle DBPrimary database, see https://db.example.com/docs");
    expect(within(tip).getByRole("link", { name: "https://db.example.com/docs" })).toHaveAttribute(
      "href",
      "https://db.example.com/docs",
    );
    expect(tip).toHaveStyle({ left: "42px", top: "20px" });

    // Only the hovered line is emphasised.
    expect(look(drawn)).toBe("3/1");
    expect(look(line(container, APP, COL0_OUT))).toBe("1.4/0.35");
    expect(look(line(container, ORG, COL0_OUT))).toBe("1.4/0.35");

    fireEvent.mouseMove(hit, { clientX: 150, clientY: 90 });
    const moved = screen.getByText("uses").closest(".MuiPaper-root") as HTMLElement;
    expect(moved).toHaveStyle({ left: "62px", top: "30px" });
    expect(look(drawn)).toBe("3/1");

    fireEvent.mouseLeave(hit);
    expect(screen.queryByText("uses")).toBeNull();
    expect(look(drawn)).toBe("1.4/0.35");
  });

  it("shows no description line for a relation without one", async () => {
    const { container } = await openTree();
    fireEvent.mouseEnter(hitArea(container, line(container, APP, COL0_OUT)), { clientX: 5, clientY: 5 });
    const tip = screen.getByText("sends data to").closest(".MuiPaper-root") as HTMLElement;
    expect(tip.textContent).toBe("sends data toAlpha→Beta");
    expect(tip.querySelectorAll(".MuiTypography-caption")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tree view — tiles
// ---------------------------------------------------------------------------

/**
 * A tile tooltip reads "<Type> · <n> connections[ · <repeat note>]" over an
 * italic usage hint. Returns the part between the type and the hint.
 */
function tooltipMiddle(tip: HTMLElement, type: string): string {
  expect(tip.querySelector("strong")?.textContent).toBe(type);
  expect(tip.querySelector("em")?.textContent).toBe("Click to expand · Right-click to re-center");
  const m = (tip.textContent ?? "").match(
    new RegExp(`^${type} · (.*)Click to expand · Right-click to re-center$`),
  );
  expect(m).not.toBeNull();
  return m![1];
}

describe("tree view tiles", () => {
  it("draws each tile with its breadcrumb, connection count and expand state", async () => {
    await openTree();
    expect(tile("Alpha").textContent).toBe("ApplicationAlphaopen_in_newexpand_more3");
    expect(tile("Beta").textContent).toBe("Betaopen_in_newchevron_right2");
    expect(tile("Oracle DB").textContent).toBe("Infra / DatabasesOracle DBopen_in_newchevron_right2");
    // Nothing to expand under Finance: no count, no chevron.
    expect(tile("Finance").textContent).toBe("Financeopen_in_new");
    expect(screen.getByText("4 nodes · 3 relations")).toBeInTheDocument();
    expect(screen.getAllByText("(1)")).toHaveLength(3);
  });

  it("names the centre in the navigation bar", async () => {
    await openTree();
    const nav = screen.getByRole("button", { name: "Back to card picker" }).parentElement as HTMLElement;
    expect(nav.textContent).toBe("homeAlpha");
  });

  it("keeps the browser menu off a right-clicked tile", async () => {
    await openTree();
    expect(fireEvent.contextMenu(tile("Beta"))).toBe(false);
  });

  it("flags a card that appears twice, and says so in its tooltip", async () => {
    await openTree();
    expect(screen.queryAllByLabelText("Also appears elsewhere in this tree")).toHaveLength(0);
    fireEvent.click(tile("Beta"));
    await screen.findByText("Linux");
    fireEvent.click(tile("Linux"));
    await waitFor(() => expect(tiles("Oracle DB")).toHaveLength(2));

    // Oracle DB is reached through Linux and directly from Alpha: one repeat.
    const marks = screen.getAllByLabelText("Also appears elsewhere in this tree");
    expect(marks).toHaveLength(1);
    const repeat = marks[0].closest(".MuiPaper-root") as HTMLElement;
    expect(within(repeat).getByText("Oracle DB")).toBeInTheDocument();

    fireEvent.mouseOver(repeat);
    const tip = await screen.findByRole("tooltip", {}, { timeout: 4000 });
    expect(tooltipMiddle(tip, "IT Component")).toBe(
      "2 connections · Also appears elsewhere in this tree",
    );
  });

  it("describes a first appearance without the repeat note", async () => {
    await openTree();
    fireEvent.mouseOver(tile("Beta"));
    const tip = await screen.findByRole("tooltip", {}, { timeout: 4000 });
    expect(tooltipMiddle(tip, "Application")).toBe("2 connections");
  });

  it("badges a retired neighbour RETIRED", async () => {
    mockApi.on("get", "/reports/dependencies*", TIMELINE_GRAPH);
    tl.date = FUTURE;
    await openTree("portal");
    expect(tile("Legacy ERP").textContent).toBe("Legacy ERPRETIREDopen_in_new");
    expect(tile("CRM Cloud").textContent).toBe("CRM Cloudopen_in_newchevron_right2");
  });
});

// ---------------------------------------------------------------------------
// Which view renders
// ---------------------------------------------------------------------------

describe("view routing", () => {
  it("hands the layered view the centre's name", async () => {
    renderReport({ view: "chart", chartMode: "c4", center: "alpha" });
    await screen.findByTestId("ldv");
    await waitFor(() => expect(ldv.props.centerName).toBe("Alpha"));
    // The tree's own control belongs to the tree.
    expect(screen.queryByRole("button", { name: /collapse all branches/i })).toBeNull();
  });

  it("shows the picker, not a canvas, when nothing is centred", async () => {
    renderReport({ view: "chart", chartMode: "tree" });
    expect(await screen.findByText("Select a card to explore")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Search and pick a starting point. Click to center, then expand branches interactively.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("ldv")).toBeNull();
    expect(screen.queryByRole("button", { name: /collapse all branches/i })).toBeNull();
  });

  it("falls back to the picker when the stored centre is gone (layered view)", async () => {
    renderReport({ view: "chart", chartMode: "c4", center: "gone" });
    expect(await screen.findByText("Select a card to explore")).toBeInTheDocument();
    expect(screen.queryByTestId("ldv")).toBeNull();
  });

  it("falls back to the picker when the stored centre is gone (tree view)", async () => {
    renderReport({ view: "chart", chartMode: "tree", center: "gone" });
    expect(await screen.findByText("Select a card to explore")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

describe("toolbar", () => {
  it("titles the report and names the saved report it is showing", async () => {
    saved.savedReportName = "Quarterly view";
    renderReport({ view: "table" });
    expect(await screen.findByRole("heading", { name: "Dependencies" })).toBeInTheDocument();
    expect(screen.getByText("Quarterly view")).toBeInTheDocument();
  });

  it("offers every visible card type, but not a hidden one", async () => {
    renderReport({ view: "table" });
    await screen.findAllByText("Alpha");
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /^type$/i }));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All Types",
      "Organization",
      "Application",
      "IT Component",
    ]);
  });

  it("shows and names the centred card in the Center-on field", async () => {
    renderReport({ view: "chart", chartMode: "c4", center: "alpha" });
    await screen.findByTestId("ldv");
    const input = screen.getByRole("combobox", { name: /center on/i });
    await waitFor(() => expect(input).toHaveValue("Alpha"));
    expect(input).toHaveAttribute("title", "Alpha");
  });

  it("leaves the Center-on field blank and untitled with no centre", async () => {
    renderReport({ view: "chart" });
    await screen.findByText("Select a card to explore");
    const input = screen.getByRole("combobox", { name: /center on/i });
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("title", "");
  });

  it("clearing Center-on returns to the picker and forgets the centre", async () => {
    renderReport({ view: "chart", chartMode: "c4", center: "alpha" });
    await screen.findByTestId("ldv");
    const input = screen.getByRole("combobox", { name: /center on/i });
    await waitFor(() => expect(input).toHaveValue("Alpha"));
    // Deleting the text clears the choice, as the clear button does.
    fireEvent.change(input, { target: { value: "" } });
    expect(await screen.findByText("Select a card to explore")).toBeInTheDocument();
    await waitFor(() => expect(lastPersisted()).toEqual(expect.objectContaining({ center: "" })));
  });

  it("changing the type drops the centre", async () => {
    renderReport({ view: "chart", chartMode: "c4", center: "alpha" });
    await screen.findByTestId("ldv");
    await pick(/^type$/i, /IT Component/);
    expect(await screen.findByText("Select a card to explore")).toBeInTheDocument();
    await waitFor(() =>
      expect(lastPersisted()).toEqual(
        expect.objectContaining({ center: "", cardTypeKey: "ITComponent" }),
      ),
    );
  });

  it("lists every card alphabetically under Center on", async () => {
    const user = userEvent.setup();
    renderReport({ view: "chart" });
    await screen.findByText("Select a card to explore");
    await user.click(screen.getByRole("combobox", { name: /center on/i }));
    await screen.findAllByRole("option");
    expect(optionNames()).toEqual(["Alpha", "Beta", "Finance", "Linux", "Operations", "Oracle DB"]);
  });

  it("narrows Center on to the chosen type, still alphabetical", async () => {
    const user = userEvent.setup();
    renderReport({ view: "chart", cardTypeKey: "ITComponent" });
    await screen.findByText("Select a card to explore");
    await user.click(screen.getByRole("combobox", { name: /center on/i }));
    await screen.findAllByRole("option");
    expect(optionNames()).toEqual(["Linux", "Oracle DB"]);
  });

  it("offers the tree/layered toggle on the chart only", async () => {
    renderReport({ view: "chart", chartMode: "c4", center: "alpha" });
    await screen.findByTestId("ldv");
    expect(screen.getByRole("button", { name: "Layered Dependency View" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tree View" })).toBeInTheDocument();
  });

  it("has no tree/layered toggle on the table", async () => {
    renderReport({ view: "table" });
    await screen.findAllByText("Alpha");
    expect(screen.queryByRole("button", { name: "Tree View" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Layered Dependency View" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Time-travel controls in the toolbar
// ---------------------------------------------------------------------------

describe("time-travel controls", () => {
  it("are offered on a diagram of dated cards, labelled", async () => {
    mockApi.on("get", "/reports/dependencies*", TIMELINE_GRAPH);
    renderReport({ view: "table" });
    expect(await screen.findByTestId("timeline-slider")).toBeInTheDocument();
    expect(screen.getByText("Persist retired cards")).toBeInTheDocument();
    expect(screen.getByText("Preview planned cards")).toBeInTheDocument();
  });

  it("are hidden on the picker, which shows no diagram", async () => {
    mockApi.on("get", "/reports/dependencies*", TIMELINE_GRAPH);
    renderReport({ view: "chart" });
    await screen.findByText("Select a card to explore");
    expect(screen.queryByTestId("timeline-slider")).toBeNull();
    expect(screen.queryByText("Persist retired cards")).toBeNull();
    expect(screen.queryByText("Preview planned cards")).toBeNull();
  });

  it("are hidden when no card carries a date", async () => {
    renderReport({ view: "table" });
    await screen.findAllByText("Alpha");
    expect(screen.queryByTestId("timeline-slider")).toBeNull();
    expect(screen.queryByText("Persist retired cards")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Print summary
// ---------------------------------------------------------------------------

describe("print summary", () => {
  it("lists the type, centre, view, mode and date", async () => {
    tl.printParam = { label: "Time Travel", value: "Jun 1, 2028" };
    const { container } = renderReport({
      view: "table",
      chartMode: "c4",
      center: "alpha",
      cardTypeKey: "ITComponent",
    });
    await screen.findAllByText("Alpha");
    await waitFor(() =>
      expect(printParams(container)).toEqual([
        "Type: IT Component",
        "Center on: Alpha",
        "View: Table",
        "View: Layered Dependency View",
        "Time Travel: Jun 1, 2028",
      ]),
    );
  });

  it("names only the centre for the tree", async () => {
    const { container } = await openTree();
    expect(printParams(container)).toEqual(["Center on: Alpha"]);
  });

  it("counts what retires between today and the viewed date", async () => {
    mockApi.on("get", "/reports/dependencies*", TIMELINE_GRAPH);
    tl.date = FUTURE;
    const { container } = renderReport({ view: "table" });
    await screen.findAllByText("Web Portal");
    await waitFor(() => expect(printParams(container)).toContain("Transformation: +0 / −1"));
  });

  it("counts what arrives between today and the viewed date", async () => {
    mockApi.on("get", "/reports/dependencies*", {
      nodes: [
        TIMELINE_GRAPH.nodes[1],
        TIMELINE_GRAPH.nodes[2],
        { id: "new", name: "Arriving Platform", type: "Application", lifecycle: { active: "2027-09-01" } },
      ],
      edges: [{ source: "new", target: "crm", type: "relAppToApp", label: "uses" }],
    });
    tl.date = FUTURE;
    const { container } = renderReport({ view: "table" });
    await screen.findAllByText("Arriving Platform");
    await waitFor(() => expect(printParams(container)).toContain("Transformation: +1 / −0"));
  });

  it("says nothing of a transformation at today", async () => {
    mockApi.on("get", "/reports/dependencies*", TIMELINE_GRAPH);
    const { container } = renderReport({ view: "table" });
    await screen.findAllByText("Web Portal");
    await waitFor(() => expect(printParams(container)).toContain("View: Table"));
    expect(printParams(container).some((p) => p.startsWith("Transformation"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

describe("legend", () => {
  it("lists the card types on screen, in order of appearance", async () => {
    const { container } = renderReport({ view: "table" });
    await screen.findAllByText("Alpha");
    expect(legendEntries(container)).toEqual(["IT Component", "Organization", "Application"]);
  });

  it("adds the retirement and lost-connection keys standing on a retirement", async () => {
    mockApi.on("get", "/reports/dependencies*", TIMELINE_GRAPH);
    tl.date = LEGACY_EOL;
    const { container } = renderReport({ view: "table" });
    await screen.findAllByText("Web Portal");
    expect(legendEntries(container)).toEqual(["Application", "Retired by the selected date"]);
    standOn(LEGACY_EOL);
    await waitFor(() =>
      expect(legendEntries(container)).toEqual([
        "Application",
        "Retired by the selected date",
        "Loses a connection at this marker",
      ]),
    );
  });

  it("adds the arrival and gained-connection keys standing on a go-live", async () => {
    const live = ms("2027-09-01");
    mockApi.on("get", "/reports/dependencies*", {
      nodes: [
        ...TIMELINE_GRAPH.nodes,
        { id: "new", name: "Arriving Platform", type: "Application", lifecycle: { active: "2027-09-01" } },
      ],
      edges: [
        ...TIMELINE_GRAPH.edges,
        { source: "new", target: "crm", type: "relAppToApp", label: "uses" },
      ],
    });
    tl.date = live;
    const { container } = renderReport({ view: "table" });
    await screen.findAllByText("Arriving Platform");
    standOn(live);
    await waitFor(() =>
      expect(legendEntries(container)).toEqual([
        "Application",
        "Arrives by the selected date",
        "Retired by the selected date",
        "Gains a connection at this marker",
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// Centre picker
// ---------------------------------------------------------------------------

/**
 * GRAPH plus a weakly-connected Application, and two cards whose types the
 * metamodel does not know — one listed first, one last.
 */
const PICKER_GRAPH = {
  nodes: [
    { id: "gizmo", name: "Mystery Box", type: "Gadget", lifecycle: {} },
    ...GRAPH.nodes,
    { id: "aard", name: "Aardvark", type: "Application", lifecycle: {} },
    { id: "wid", name: "Thing", type: "Widget", lifecycle: {} },
  ],
  edges: [...GRAPH.edges, { source: "aard", target: "os", type: "relAppToITC", label: "uses" }],
};

/** "Type (count)" per picker group, top to bottom. */
function pickerGroups(): string[] {
  return screen
    .getAllByRole("heading", { level: 6 })
    .filter((h) => h.textContent !== "Select a card to explore")
    .map((h) => `${h.textContent} ${h.nextElementSibling?.textContent}`);
}
/** Card names in one picker group, top to bottom. */
function groupNames(type: string): string[] {
  const heading = screen.getByRole("heading", { level: 6, name: type });
  const group = heading.parentElement!.parentElement as HTMLElement;
  return Array.from(group.querySelectorAll("p")).map((p) => p.textContent ?? "");
}

describe("centre picker list", () => {
  it("groups by the metamodel's type order, unknown types last", async () => {
    mockApi.on("get", "/reports/dependencies*", PICKER_GRAPH);
    renderReport({ view: "chart" });
    await screen.findByText("Select a card to explore");
    expect(pickerGroups()).toEqual([
      "Organization (2)",
      "Application (3)",
      "IT Component (2)",
      "Gadget (1)",
      "Widget (1)",
    ]);
  });

  it("ranks the best-connected cards first within a group", async () => {
    mockApi.on("get", "/reports/dependencies*", PICKER_GRAPH);
    renderReport({ view: "chart" });
    await screen.findByText("Select a card to explore");
    // Alpha 3, Beta 2, Aardvark 1 — alphabetical would be the reverse.
    expect(groupNames("Application")).toEqual(["Alpha", "Beta", "Aardvark"]);
  });

  it("shows a row's path and connection count, and neither when it has none", async () => {
    renderReport({ view: "chart" });
    await screen.findByText("Select a card to explore");
    expect(pickerRow("Alpha").textContent).toBe("Group / SuiteAlpha3chevron_right");
    expect(pickerRow("Oracle DB").textContent).toBe("Infra / DatabasesOracle DB2chevron_right");
    expect(pickerRow("Operations").textContent).toBe("Operationschevron_right");
    expect(pickerRow("Operations").querySelectorAll(".MuiChip-root")).toHaveLength(0);
  });

  it("searches trimmed text in names, case-insensitively", async () => {
    renderReport({ view: "chart" });
    await screen.findByText("Select a card to explore");
    fireEvent.change(screen.getByPlaceholderText("Search cards..."), { target: { value: " BET " } });
    await waitFor(() => expect(screen.queryByText("Alpha")).toBeNull());
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("searches any segment of a card's path", async () => {
    renderReport({ view: "chart" });
    await screen.findByText("Select a card to explore");
    fireEvent.change(screen.getByPlaceholderText("Search cards..."), { target: { value: "suite" } });
    await waitFor(() => expect(screen.queryByText("Beta")).toBeNull());
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("says so when a search matches nothing", async () => {
    renderReport({ view: "chart" });
    await screen.findByText("Select a card to explore");
    fireEvent.change(screen.getByPlaceholderText("Search cards..."), { target: { value: "zzz" } });
    expect(await screen.findByText("No results")).toBeInTheDocument();
    expect(screen.queryByText("No cards to explore")).toBeNull();
  });

  it("says so when there is nothing to explore at all", async () => {
    mockApi.on("get", "/reports/dependencies*", { nodes: [], edges: [] });
    renderReport({ view: "chart" });
    expect(await screen.findByText("No cards to explore")).toBeInTheDocument();
    expect(screen.queryByText("No results")).toBeNull();
  });

  it("narrows by a type chip, and marks which chip is on", async () => {
    renderReport({ view: "chart" });
    await screen.findByText("Select a card to explore");
    const all = () => screen.getByText("All").closest(".MuiChip-root") as HTMLElement;
    const itc = () => screen.getByText("IT Component (2)").closest(".MuiChip-root") as HTMLElement;
    expect(all().className).toContain("MuiChip-filled");
    expect(itc().className).toContain("MuiChip-outlined");

    fireEvent.click(itc());
    await waitFor(() => expect(screen.queryByText("Alpha")).toBeNull());
    expect(screen.getByText("Linux")).toBeInTheDocument();
    expect(all().className).toContain("MuiChip-outlined");
    expect(itc().className).toContain("MuiChip-filled");
  });

  it("drops the chip filter when the type drop-down changes", async () => {
    renderReport({ view: "chart" });
    await screen.findByText("Select a card to explore");
    fireEvent.click(screen.getByText("IT Component (2)"));
    await waitFor(() => expect(screen.queryByText("Alpha")).toBeNull());
    await pick(/^type$/i, /^Application$/);
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
  });

  it("offers only the chosen type's chip once a type is picked", async () => {
    renderReport({ view: "chart" });
    await screen.findByText("Select a card to explore");
    expect(screen.getByText("Application (2)")).toBeInTheDocument();
    await pick(/^type$/i, /IT Component/);
    await waitFor(() => expect(screen.queryByText("Application (2)")).toBeNull());
    expect(screen.getByText("IT Component (2)")).toBeInTheDocument();
  });

  it("offers the end-of-life switch only when some card is at end of life", async () => {
    renderReport({ view: "chart" });
    await screen.findByText("Select a card to explore");
    expect(screen.queryByText("Hide end-of-life")).toBeNull();
  });

  it("dates a retired card's badge", async () => {
    mockApi.on("get", "/reports/dependencies*", TIMELINE_GRAPH);
    renderReport({ view: "chart" });
    await screen.findByText("Select a card to explore");
    expect(screen.getByText("Hide end-of-life")).toBeInTheDocument();
    expect(screen.getByLabelText("Reached End of Life on 2015-01-01")).toHaveTextContent("RETIRED");
  });
});

// ---------------------------------------------------------------------------
// Relation table
// ---------------------------------------------------------------------------

describe("relation table", () => {
  it("heads its columns and labels each relation by its verb", async () => {
    renderReport({ view: "table" });
    await screen.findAllByText("Alpha");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Source",
      "Relation",
      "Target",
    ]);
    expect(screen.getAllByText("uses")).toHaveLength(2);
    // The hover text is the description when there is one, else the type key.
    expect(screen.getByLabelText("Primary database, see https://db.example.com/docs")).toHaveTextContent(
      "uses",
    );
    expect(screen.getByLabelText("relAppToApp")).toHaveTextContent("sends data to");
  });

  it("falls back to the relation type for an unlabelled relation", async () => {
    mockApi.on("get", "/reports/dependencies*", {
      nodes: GRAPH.nodes,
      edges: [{ source: "alpha", target: "beta", type: "relAppToApp" }],
    });
    renderReport({ view: "table" });
    await screen.findAllByText("Alpha");
    expect(screen.getByLabelText("relAppToApp")).toHaveTextContent("relAppToApp");
  });

  it("badges a retired card on either side of a relation", async () => {
    mockApi.on("get", "/reports/dependencies*", TIMELINE_GRAPH);
    tl.date = FUTURE;
    renderReport({ view: "table" });
    await screen.findAllByText("Web Portal");
    const row = (src: string, dst: string) =>
      screen
        .getAllByRole("row")
        .slice(1)
        .find((r) => r.cells[0].textContent?.startsWith(src) && r.cells[2].textContent?.startsWith(dst))!;
    expect(row("Web Portal", "Legacy ERP").cells[2].textContent).toBe("Legacy ERPRETIRED");
    expect(row("Legacy Mainframe", "CRM Cloud").cells[0].textContent).toBe("Legacy MainframeRETIRED");
    expect(screen.getAllByText("RETIRED")).toHaveLength(2);
  });

  it("marks a source card that loses a connection at the mark", async () => {
    mockApi.on("get", "/reports/dependencies*", TIMELINE_GRAPH);
    tl.date = LEGACY_EOL;
    const { container } = renderReport({ view: "table" });
    await screen.findAllByText("Web Portal");
    standOn(LEGACY_EOL);
    // Web Portal is the source of both its relations, and loses Legacy ERP here.
    await waitFor(() =>
      expect(container.querySelectorAll('[title="Loses a connection here"]')).toHaveLength(2),
    );
  });
});


// ---------------------------------------------------------------------------
// Visual states the views draw: ghosts, spotlights, the tile grammar
// ---------------------------------------------------------------------------

/** TIMELINE_GRAPH plus a card that goes live between today and FUTURE. */
const ARRIVING_GRAPH = {
  nodes: [
    ...TIMELINE_GRAPH.nodes,
    { id: "new", name: "Arriving Platform", type: "Application", lifecycle: { active: "2027-09-01" } },
  ],
  edges: [...TIMELINE_GRAPH.edges, { source: "portal", target: "new", type: "relAppToApp", label: "uses" }],
};
const style = (el: HTMLElement) => getComputedStyle(el);

describe("tree tile states", () => {
  it("ghosts a retired card with a dashed outline, and outlines an arrived one solid", async () => {
    mockApi.on("get", "/reports/dependencies*", ARRIVING_GRAPH);
    tl.date = FUTURE;
    await openTree("portal");

    const retired = style(tile("Legacy ERP"));
    expect([retired.opacity, retired.borderTopStyle, retired.borderTopWidth]).toEqual(["0.6", "dashed", "1.5px"]);
    // Part of the landscape at the viewed date: drawn solid, not ghosted.
    const arrived = style(tile("Arriving Platform"));
    expect([arrived.opacity, arrived.borderTopStyle, arrived.borderTopWidth]).toEqual(["1", "solid", "1.5px"]);
    // No change at all: the plain collapsed outline.
    const plain = style(tile("CRM Cloud"));
    expect([plain.opacity, plain.borderTopStyle, plain.borderTopWidth]).toEqual(["1", "solid", "1px"]);

    // Dimmed by a hover elsewhere, a ghost fades further.
    fireEvent.mouseEnter(tile("CRM Cloud"));
    expect(style(tile("Legacy ERP")).opacity).toBe("0.4");
    expect(style(tile("Arriving Platform")).opacity).toBe("0.4");
  });

  it("draws the root heavier, expanded tiles tinted, collapsed tiles outlined, repeats dashed", async () => {
    await openTree();
    fireEvent.click(tile("Beta"));
    await screen.findByText("Linux");
    fireEvent.click(tile("Linux"));
    await waitFor(() => expect(tiles("Oracle DB")).toHaveLength(2));
    const repeat = screen
      .getByLabelText("Also appears elsewhere in this tree")
      .closest(".MuiPaper-root") as HTMLElement;
    const first = tiles("Oracle DB").find((t) => t !== repeat)!;

    const root = style(tile("Alpha"));
    expect([root.borderLeftWidth, root.borderTopStyle, root.backgroundColor]).toEqual([
      "4px",
      "",
      "rgba(0, 0, 0, 0.025)",
    ]);
    // Expanded, not the root: tinted, with only the coloured left edge.
    const open = style(tile("Beta"));
    expect([open.borderLeftWidth, open.borderTopStyle, open.backgroundColor]).toEqual([
      "3.5px",
      "",
      "rgba(0, 0, 0, 0.025)",
    ]);
    // Collapsed: a thin outline on a plain surface.
    const shut = style(first);
    expect([shut.borderLeftWidth, shut.borderTopStyle, shut.borderTopWidth, shut.backgroundColor]).toEqual([
      "3.5px",
      "solid",
      "1px",
      "rgb(255, 255, 255)",
    ]);
    // A repeat is dashed, its coloured edge kept solid.
    const rep = style(repeat);
    expect([rep.borderTopStyle, rep.borderLeftStyle]).toEqual(["dashed", "solid"]);
  });
});

describe("spotlight in the tree and the table", () => {
  it("pulses the retiring card in the tree and fades the rest", async () => {
    mockApi.on("get", "/reports/dependencies*", TIMELINE_GRAPH);
    tl.date = FUTURE;
    await openTree("portal");
    expect(style(tile("CRM Cloud")).opacity).toBe("1");

    act(() => slider.props.onMilestoneClick(LEGACY_EOL, LEGACY_EOL));
    const hit = style(tile("Legacy ERP"));
    expect([hit.animation, hit.boxShadow]).toEqual(["tl-pulse-retire 0.65s ease-in-out 2", "0 0 0 4px #f4433655"]);
    const rest = style(tile("CRM Cloud"));
    expect([rest.opacity, rest.animation]).toEqual(["0.3", ""]);
  });

  it("pulses a go-live in the tree in the go-live colour", async () => {
    mockApi.on("get", "/reports/dependencies*", TIMELINE_GRAPH);
    tl.date = FUTURE;
    await openTree("portal");
    const live = ms("2021-01-01");
    act(() => slider.props.onMilestoneClick(live, live));
    const hit = style(tile("CRM Cloud"));
    expect([hit.opacity, hit.animation, hit.boxShadow]).toEqual([
      "1",
      "tl-pulse-live 0.65s ease-in-out 2",
      "0 0 0 4px #0177FF55",
    ]);
  });

  /** The body row for a relation, by its two ends. */
  function relationRow(src: string, dst: string): HTMLTableRowElement {
    return screen
      .getAllByRole("row")
      .slice(1)
      .find(
        (r) =>
          (r as HTMLTableRowElement).cells[0].textContent?.startsWith(src) &&
          (r as HTMLTableRowElement).cells[2].textContent?.startsWith(dst),
      ) as HTMLTableRowElement;
  }

  it("pulses the table rows touching a retiring card, through either end", async () => {
    mockApi.on("get", "/reports/dependencies*", TIMELINE_GRAPH);
    tl.date = FUTURE;
    renderReport({ view: "table" });
    await screen.findAllByText("Web Portal");
    // No spotlight, no fading.
    expect(style(relationRow("Web Portal", "CRM Cloud")).opacity).toBe("");

    act(() => slider.props.onMilestoneClick(LEGACY_EOL, LEGACY_EOL));
    // Legacy ERP is the TARGET of its row.
    const hit = style(relationRow("Web Portal", "Legacy ERP"));
    expect([hit.opacity, hit.animation, hit.backgroundColor]).toEqual([
      "1",
      "tl-pulse-row-retire 0.65s ease-in-out 2",
      "rgba(244, 67, 54, 0.12)",
    ]);
    const rest = style(relationRow("Web Portal", "CRM Cloud"));
    expect([rest.opacity, rest.animation]).toEqual(["0.35", ""]);
  });

  it("pulses the table rows touching a go-live in the go-live colour", async () => {
    mockApi.on("get", "/reports/dependencies*", TIMELINE_GRAPH);
    tl.date = FUTURE;
    renderReport({ view: "table" });
    await screen.findAllByText("Web Portal");
    const live = ms("2021-01-01");
    act(() => slider.props.onMilestoneClick(live, live));
    const hit = style(relationRow("Legacy Mainframe", "CRM Cloud"));
    expect([hit.opacity, hit.animation, hit.backgroundColor]).toEqual([
      "1",
      "tl-pulse-row-live 0.65s ease-in-out 2",
      "rgba(1, 119, 255, 0.12)",
    ]);
  });
});

describe("picker chip states", () => {
  it("bolds the chip that is on and colours an active type chip", async () => {
    renderReport({ view: "chart" });
    await screen.findByText("Select a card to explore");
    const chip = (label: string) => screen.getByText(label).closest(".MuiChip-root") as HTMLElement;
    expect(style(chip("All")).fontWeight).toBe("700");
    expect(style(chip("IT Component (2)")).fontWeight).toBe("400");

    fireEvent.click(chip("IT Component (2)"));
    await waitFor(() => expect(style(chip("All")).fontWeight).toBe("400"));
    const on = style(chip("IT Component (2)"));
    expect([on.fontWeight, on.color, on.borderColor]).toEqual(["700", "rgb(210, 146, 112)", "rgb(210, 146, 112)"]);
    expect(style(chip("Application (2)")).color).not.toBe("rgb(15, 126, 181)");
  });
});

describe("tree navigation and pointer edge cases", () => {
  it("going home from the tree forgets the centre", async () => {
    await openTree();
    fireEvent.click(screen.getByRole("button", { name: "Back to card picker" }));
    expect(await screen.findByText("Select a card to explore")).toBeInTheDocument();
    await waitFor(() => expect(lastPersisted()).toEqual(expect.objectContaining({ center: "" })));
  });

  it("a move over another line does not drag the open tooltip", async () => {
    const { container } = await openTree();
    const toDb = hitArea(container, line(container, ITC, COL0_OUT));
    const toBeta = hitArea(container, line(container, APP, COL0_OUT));
    (toDb.closest("svg") as SVGSVGElement).getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
    fireEvent.mouseEnter(toDb, { clientX: 30, clientY: 40 });
    fireEvent.mouseMove(toBeta, { clientX: 300, clientY: 400 });
    const tip = screen.getByText("uses").closest(".MuiPaper-root") as HTMLElement;
    expect(tip).toHaveStyle({ left: "42px", top: "30px" });
  });
});
