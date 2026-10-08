/**
 * Behaviour of the Capability Map's main component that its other two suites
 * do not pin down: the detail drawer's rows and metrics, the pill colours and
 * transformation delta handed to the timeline slider, which capability box a
 * mark-click spotlight lights up (and as which kind) with chips hidden, the
 * Display Depth options and clamp, the print-parameter summary, the filter
 * toolbar's facets, the legend and the shell wiring.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

type SliderProps = {
  delta?: { arriving: number; retiring: number };
  onMilestoneClick?: (from: number, to: number) => void;
  milestoneCards?: (
    from: number,
    to: number,
  ) => { id: string; name: string; kind: string; color?: string }[];
};

const h = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  savedReportName: null as string | null,
  persistConfig: (() => {}) as (cfg: Record<string, unknown>) => void,
  timeline: {
    timelineDate: 0,
    todayMs: 0,
    printParam: null as { label: string; value: string } | null,
  },
  slider: [] as SliderProps[],
}));

vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: () => ({
    savedReport: null,
    savedReportName: h.savedReportName,
    saveDialogOpen: false,
    setSaveDialogOpen: () => {},
    loadedConfig: null,
    consumeConfig: () => h.config,
    resetSavedReport: () => {},
    persistConfig: (cfg: Record<string, unknown>) => h.persistConfig(cfg),
    resetAll: () => {},
    reportType: "capability-map",
  }),
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({ chartRef: createRef(), thumbnail: undefined, captureAndSave: () => {} }),
}));
vi.mock("@/hooks/useTimeline", () => ({
  useTimeline: () => ({
    timelineDate: h.timeline.timelineDate,
    setTimelineDate: () => {},
    todayMs: h.timeline.todayMs,
    isTimeTraveling: h.timeline.timelineDate !== h.timeline.todayMs,
    persistValue: undefined,
    printParam: h.timeline.printParam,
    restore: () => {},
    reset: () => {},
  }),
}));
vi.mock("@/components/TimelineSlider", () => ({
  default: (props: SliderProps) => {
    h.slider.push(props);
    return <div data-testid="timeline-slider" />;
  },
}));
vi.mock("@/features/reports/SaveReportDialog", () => ({ default: () => null }));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: (props: { cardId: string | null; open: boolean }) =>
    props.open ? <div data-testid="side-panel">{props.cardId}</div> : null,
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import CapabilityMapReport from "./CapabilityMapReport";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ms = (iso: string) => new Date(iso).getTime();
const TODAY = ms("2026-08-22");
const FUTURE = ms("2028-06-01");

// Every colour distinct from the static CARD_TYPE_COLORS tokens and from each
// other, and Application / BusinessCapability deliberately NOT first, so a
// colour read from the wrong type — or the fallback — is told apart.
const TYPES = [
  makeCardType({ key: "Organization", label: "Organization", color: "#111111" }),
  makeCardType({ key: "Provider", label: "Vendor", color: "#222222" }),
  makeCardType({ key: "Application", label: "Application", color: "#aa5500" }),
  makeCardType({ key: "BusinessCapability", label: "Business Capability", color: "#5500aa" }),
];

type App = {
  id: string;
  name: string;
  attributes?: Record<string, unknown>;
  lifecycle?: Record<string, string>;
  org_ids: string[];
  related_by_type?: Record<string, string[]>;
  related_by_rel_type?: Record<string, string[]>;
  tag_ids?: string[];
};

const app = (id: string, name: string, over: Partial<App> = {}): App => ({
  id,
  name,
  attributes: {},
  lifecycle: {},
  org_ids: [],
  related_by_type: {},
  related_by_rel_type: {},
  tag_ids: [],
  ...over,
});

const cap = (id: string, name: string, parent_id: string | null, apps: App[] = []) => ({
  id,
  name,
  parent_id,
  app_count: apps.length,
  total_cost: 0,
  risk_count: 0,
  attributes: {},
  apps,
});

const CRITICALITY = {
  key: "criticality",
  label: "Criticality",
  type: "single_select",
  options: [
    { key: "high", label: "High Crit", color: "#d32f2f" },
    { key: "low", label: "Low Crit", color: "#388e3c" },
    { key: "plain", label: "Plain" },
  ],
};
const COST = { key: "costTotalAnnual", label: "Annual Cost", type: "cost" };
const FIELDS = [{ section: "Business", fields: [CRITICALITY, COST] }];

const ALPHA = app("alpha", "Alpha", {
  attributes: { criticality: "high", costTotalAnnual: 1000 },
  lifecycle: { active: "2015-01-01", endOfLife: "2099-01-01" },
});
// No criticality, but an end of life.
const BETA = app("beta", "Beta", {
  attributes: { costTotalAnnual: 200 },
  lifecycle: { endOfLife: "2098-01-01" },
});
// No lifecycle at all — the payload may omit it.
const DELTA: App = { id: "delta", name: "Delta", attributes: { criticality: "low" }, org_ids: [] };
const ZETA = app("zeta", "Zeta");

/**
 *  Sales (L1)
 *    └─ Lead Management (L2)   · Zeta
 *         └─ Lead Scoring (L3) · Alpha
 *  Finance (L1)
 *    └─ Billing (L2)           · Beta · Delta · Alpha   (payload order, unsorted)
 */
const MAIN = {
  items: [
    cap("sales", "Sales", null),
    cap("leads", "Lead Management", "sales", [ZETA]),
    cap("scoring", "Lead Scoring", "leads", [ALPHA]),
    cap("finance", "Finance", null),
    cap("billing", "Billing", "finance", [BETA, DELTA, ALPHA]),
  ],
  fields_schema: FIELDS,
  filterable_types: {},
  relation_types: [],
  tag_groups: [],
};

const heatmapRoute = (payload: unknown) =>
  mockApi.on("get", "/reports/capability-heatmap*", payload);

function renderMap() {
  return render(
    <MemoryRouter>
      <CapabilityMapReport />
    </MemoryRouter>,
  );
}

const chart = () => document.querySelector(".report-chart-area") as HTMLElement;
const toolbar = () => document.querySelector(".report-toolbar") as HTMLElement;
const legend = () => document.querySelector(".report-legend") as HTMLElement;
const loaded = (name = "Finance") => within(document.body).findByText(name);

/** The print-only parameter summary, one `Label: value` string per entry. */
const printParams = () =>
  Array.from(document.querySelectorAll(".report-print-params > *")).map((el) =>
    (el.textContent ?? "").replace(/\|$/, "").trim(),
  );

const lastPersisted = () => vi.mocked(h.persistConfig).mock.calls.at(-1)?.[0];

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(TYPES);
  h.config = null;
  h.savedReportName = null;
  h.persistConfig = vi.fn();
  h.timeline = { timelineDate: TODAY, todayMs: TODAY, printParam: null };
  h.slider.length = 0;
  heatmapRoute(MAIN);
  mockApi.on("get", "/cards*", { items: [], total: 0 });
});

// ---------------------------------------------------------------------------
// Spotlight on capability boxes (Show Applications off)
// ---------------------------------------------------------------------------

const ARRIVER = app("arriver", "Arriver", { lifecycle: { active: "2027-03-01" } });
const RETIREE = app("retiree", "Retiree", {
  lifecycle: { active: "2015-01-01", endOfLife: "2027-06-01" },
});
const STAYER = app("stayer", "Stayer", { lifecycle: { active: "2015-01-01" } });

/**
 *  Core (L1)                         — no apps of its own
 *    ├─ Arrivals   · Arriver
 *    ├─ Departures · Retiree
 *    ├─ Both       · Arriver · Retiree
 *    └─ Quiet      · Stayer
 *  Solo (L1, leaf) · Retiree
 */
const PULSE = {
  ...MAIN,
  items: [
    cap("core", "Core", null),
    cap("arr", "Arrivals", "core", [ARRIVER]),
    cap("dep", "Departures", "core", [RETIREE]),
    cap("both", "Both", "core", [ARRIVER, RETIREE]),
    cap("quiet", "Quiet", "core", [STAYER]),
    cap("solo", "Solo", null, [RETIREE]),
  ],
};


/** The capability box a title sits in (title → header → box). */
const box = (name: string) =>
  within(chart()).getByText(name).parentElement!.parentElement as HTMLElement;
/** Which spotlight a box is running: "live" / "retire" / "mixed", or null. */
const pulseOf = (name: string) =>
  /^tl-pulse-(\S*)/.exec(getComputedStyle(box(name)).animation)?.[1] ?? null;
const PULSE_NAMES = ["Core", "Arrivals", "Departures", "Both", "Quiet", "Solo"];
const pulses = () => Object.fromEntries(PULSE_NAMES.map((n) => [n, pulseOf(n)]));

describe("CapabilityMapReport spotlight on capability boxes", () => {
  beforeEach(() => {
    h.timeline = { timelineDate: FUTURE, todayMs: TODAY, printParam: null };
    heatmapRoute(PULSE);
  });

  it("lights each box as live, retire or mixed from the apps it displays", async () => {
    renderMap();
    await loaded("Quiet");
    expect(pulses()).toEqual(Object.fromEntries(PULSE_NAMES.map((n) => [n, null])));

    // One span covering the arrival and the retirement.
    act(() => h.slider.at(-1)!.onMilestoneClick!(ms("2027-03-01"), ms("2027-06-01")));

    // Read synchronously: the spotlight clears itself after a timeout.
    expect(pulses()).toEqual({
      // A branch with no apps of its own stays dark; its children carry it.
      Core: null,
      Arrivals: "live",
      Departures: "retire",
      Both: "mixed",
      // A box whose apps do not change is not part of the spotlight.
      Quiet: null,
      Solo: "retire",
    });
  });

  it("lights only the arriving side for an arrival-only mark", async () => {
    renderMap();
    await loaded("Quiet");

    act(() => h.slider.at(-1)!.onMilestoneClick!(ms("2027-03-01"), ms("2027-03-01")));

    expect(pulses()).toEqual({
      Core: null,
      Arrivals: "live",
      Departures: null,
      Both: "live",
      Quiet: null,
      Solo: null,
    });
  });

  it("does not light boxes while the chips are shown", async () => {
    h.config = { showApps: true };
    renderMap();
    await loaded("Quiet");

    act(() => h.slider.at(-1)!.onMilestoneClick!(ms("2027-03-01"), ms("2027-06-01")));

    expect(pulses()).toEqual(Object.fromEntries(PULSE_NAMES.map((n) => [n, null])));
  });
});

// ---------------------------------------------------------------------------
// Timeline slider wiring: pill colours and the transformation delta
// ---------------------------------------------------------------------------

describe("CapabilityMapReport timeline pills", () => {
  const pills = () =>
    h.slider
      .at(-1)!
      .milestoneCards!(ms("2098-01-01"), ms("2099-01-01"))
      .map((c) => [c.name, c.color]);

  it("accents each pill with the metamodel Application colour when not colouring", async () => {
    renderMap();
    await loaded();
    expect(pills()).toEqual([
      ["Alpha", "#aa5500"],
      ["Beta", "#aa5500"],
    ]);
  });

  it("accents each pill with the colour-by option, and the unset grey", async () => {
    h.config = { showApps: true, colorBy: "criticality" };
    renderMap();
    await loaded();
    expect(pills()).toEqual([
      ["Alpha", "#d32f2f"],
      ["Beta", "rgba(128, 128, 128, 0.2)"],
    ]);
  });

  it("falls back to the static Application colour when the metamodel has none", async () => {
    withMetamodel(TYPES.filter((t) => t.key !== "Application"));
    renderMap();
    await loaded();
    expect(pills()[0]).toEqual(["Alpha", "#0f7eb5"]);
  });

  it("hands the slider a zero delta when not travelling", async () => {
    renderMap();
    await loaded();
    expect(h.slider.at(-1)!.delta).toEqual({ arriving: 0, retiring: 0 });
    expect(printParams()).not.toContainEqual(expect.stringMatching(/^Transformation/));
  });
});

const GHOST = app("ghost", "Ghost", {
  lifecycle: { active: "2010-01-01", endOfLife: "2020-01-01" },
});
const LATE = app("late", "Late", { lifecycle: { active: "2015-01-01", endOfLife: "2030-01-01" } });
const deltaPayload = (apps: App[]) => ({ ...MAIN, items: [cap("ops", "Operations", null, apps)] });

describe("CapabilityMapReport transformation delta", () => {
  beforeEach(() => {
    h.timeline = {
      timelineDate: FUTURE,
      todayMs: TODAY,
      printParam: { label: "Time Travel", value: "Jun 1, 2028" },
    };
  });

  it("counts one arrival and one retirement, ignoring what is unchanged", async () => {
    // Stayer lives through both dates, Ghost retired long ago, Late retires
    // after the travelled date: none of them is part of the transformation.
    heatmapRoute(deltaPayload([ARRIVER, RETIREE, STAYER, GHOST, LATE]));
    renderMap();
    await loaded("Operations");
    expect(h.slider.at(-1)!.delta).toEqual({ arriving: 1, retiring: 1 });
    expect(printParams()).toEqual([
      "Metric: Application Count",
      "Depth: Level 1",
      "Columns: 3",
      "Time Travel: Jun 1, 2028",
      "Transformation: +1 / −1",
    ]);
  });

  it("summarises an arrival-only transformation", async () => {
    heatmapRoute(deltaPayload([ARRIVER, STAYER]));
    renderMap();
    await loaded("Operations");
    expect(h.slider.at(-1)!.delta).toEqual({ arriving: 1, retiring: 0 });
    expect(printParams()).toContain("Transformation: +1 / −0");
  });

  it("summarises a retirement-only transformation", async () => {
    heatmapRoute(deltaPayload([RETIREE, STAYER]));
    renderMap();
    await loaded("Operations");
    expect(h.slider.at(-1)!.delta).toEqual({ arriving: 0, retiring: 1 });
    expect(printParams()).toContain("Transformation: +0 / −1");
  });

  it("omits the summary when nothing changes by the travelled date", async () => {
    heatmapRoute(deltaPayload([STAYER, LATE]));
    renderMap();
    await loaded("Operations");
    expect(h.slider.at(-1)!.delta).toEqual({ arriving: 0, retiring: 0 });
    expect(printParams()).toEqual([
      "Metric: Application Count",
      "Depth: Level 1",
      "Columns: 3",
      "Time Travel: Jun 1, 2028",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------

const panel = () => screen.getByRole("presentation");
/** The drawer's card rows, as [name, secondary text]. */
const rows = () =>
  Array.from(panel().querySelectorAll(".MuiListItemButton-root")).map((row) => [
    row.querySelector(".MuiListItemText-primary")?.textContent ?? null,
    row.querySelector(".MuiListItemText-secondary")?.textContent ?? null,
  ]);
const row = (name: string) =>
  within(panel()).getByText(name).closest(".MuiListItemButton-root") as HTMLElement;
/** A row's trailing colour swatch, or null. */
const dot = (name: string) => {
  const el = Array.from(row(name).children).find(
    (c) => c.tagName === "DIV" && !c.classList.contains("MuiListItemText-root"),
  );
  return el ? getComputedStyle(el).backgroundColor : null;
};
const warned = (name: string) => within(row(name)).queryByText("warning") !== null;
const metric = (label: string) =>
  within(panel()).getByText(label).previousElementSibling?.textContent;

async function openDrawer(name: string) {
  fireEvent.click(within(chart()).getByText(name));
  return screen.findByRole("presentation");
}

describe("CapabilityMapReport detail drawer", () => {
  it("lists a leaf's apps alphabetically with EOL notes and warnings, and no swatches", async () => {
    renderMap();
    await loaded();
    await openDrawer("Billing");

    expect(within(panel()).getByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(rows()).toEqual([
      ["Alpha", "End of Life: 2099-01-01"],
      ["Beta", "End of Life: 2098-01-01"],
      ["Delta", null],
    ]);
    expect([dot("Alpha"), dot("Beta"), dot("Delta")]).toEqual([null, null, null]);
    expect([warned("Alpha"), warned("Beta"), warned("Delta")]).toEqual([true, true, false]);
    // A leaf has no sub-capabilities to list.
    expect(within(panel()).queryByText(/Sub-Capabilities/)).not.toBeInTheDocument();
  });

  it("adds the colour-by label and swatch when colouring, grey for an unset value", async () => {
    h.config = { colorBy: "criticality" };
    renderMap();
    await loaded();
    await openDrawer("Billing");

    expect(rows()).toEqual([
      ["Alpha", "High Crit · End of Life: 2099-01-01"],
      ["Beta", "End of Life: 2098-01-01"],
      ["Delta", "Low Crit"],
    ]);
    expect([dot("Alpha"), dot("Beta"), dot("Delta")]).toEqual([
      "rgb(211, 47, 47)",
      "rgba(128, 128, 128, 0.2)",
      "rgb(56, 142, 60)",
    ]);
  });

  it("treats a stored 'none' colour-by as not colouring", async () => {
    h.config = { colorBy: "none" };
    renderMap();
    await loaded();
    await openDrawer("Billing");

    expect([dot("Alpha"), dot("Beta"), dot("Delta")]).toEqual([null, null, null]);
    expect(rows()[0]).toEqual(["Alpha", "End of Life: 2099-01-01"]);
  });

  it("shows each metric plainly, only the cost formatted as money", async () => {
    renderMap();
    await loaded();
    await openDrawer("Billing");

    expect(metric("Application Count")).toBe("3");
    expect(metric("Total Cost")).toBe("$1200");
    expect(metric("Risk (EOL count)")).toBe("2");
  });

  it("links a leaf to the inventory filtered on that capability", async () => {
    renderMap();
    await loaded();
    await openDrawer("Billing");

    const link = within(panel()).getByRole("link", { name: /view in inventory/i });
    expect(new URL(link.getAttribute("href")!, "http://x").searchParams.get("rel_BusinessCapability"))
      .toBe("Billing");
  });

  it("closes itself when an app is opened, with no stale title while it slides out", async () => {
    renderMap();
    await loaded();
    await openDrawer("Billing");

    fireEvent.click(within(panel()).getByText("Alpha"));

    expect(screen.getByTestId("side-panel")).toHaveTextContent("alpha");
    // The drawer is still animating out (hidden from the accessibility tree),
    // but has already let go of its capability.
    expect(document.querySelector(".MuiDrawer-paper h6")?.textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Display depth
// ---------------------------------------------------------------------------

const depthSelect = () => screen.getByRole("combobox", { name: "Display Depth" });

describe("CapabilityMapReport display depth", () => {
  it("offers one level per tier of the tree, plus all levels", async () => {
    renderMap();
    await loaded();
    expect(depthSelect()).toHaveTextContent("Level 2");

    fireEvent.mouseDown(depthSelect());
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Level 1",
      "Level 2",
      "Level 3",
      "All levels",
    ]);

    fireEvent.click(within(listbox).getByRole("option", { name: "Level 3" }));
    expect(await within(chart()).findByText("Lead Scoring")).toBeInTheDocument();
    expect(printParams()).toContain("Depth: Level 3");
  });

  it("clamps a stored depth deeper than the tree back into range", async () => {
    h.config = { displayLevel: 5 };
    renderMap();
    await loaded();
    await waitFor(() => expect(depthSelect()).toHaveTextContent("Level 3"));
    expect(printParams()).toContain("Depth: Level 3");
  });

  it("names no depth when the stored one matches no option", async () => {
    // Nothing to clamp against in an empty map.
    h.config = { displayLevel: 5 };
    heatmapRoute({ ...MAIN, items: [] });
    renderMap();
    expect(await screen.findByText(/No Business Capabilities found/)).toBeInTheDocument();
    expect(printParams()).toEqual(["Metric: Application Count", "Columns: 3"]);
  });
});

// ---------------------------------------------------------------------------
// Print parameters
// ---------------------------------------------------------------------------

describe("CapabilityMapReport print parameters", () => {
  it("lists only metric, depth and columns by default", async () => {
    renderMap();
    await loaded();
    expect(printParams()).toEqual(["Metric: Application Count", "Depth: Level 2", "Columns: 3"]);
  });

  it("lists scope, applications, colour, time travel and filters when set", async () => {
    h.config = {
      showApps: true,
      colorBy: "criticality",
      scopeIds: ["finance"],
      attrFilters: { criticality: ["high"] },
    };
    h.timeline = {
      timelineDate: FUTURE,
      todayMs: TODAY,
      printParam: { label: "Time Travel", value: "Jun 1, 2028" },
    };
    renderMap();
    await loaded();
    expect(printParams()).toEqual([
      "Metric: Application Count",
      "Depth: Level 2",
      "Columns: 3",
      "Scope: 1 capability",
      "Show Apps: Yes",
      "Color by: Criticality",
      "Time Travel: Jun 1, 2028",
      "Filters: 1 active",
    ]);
  });

  it("names no colour while the applications are hidden", async () => {
    h.config = { colorBy: "criticality" };
    renderMap();
    await loaded();
    expect(printParams()).toEqual(["Metric: Application Count", "Depth: Level 2", "Columns: 3"]);
  });

  it("names no colour for a stored 'none'", async () => {
    h.config = { showApps: true, colorBy: "none" };
    renderMap();
    await loaded();
    expect(printParams()).toEqual([
      "Metric: Application Count",
      "Depth: Level 2",
      "Columns: 3",
      "Show Apps: Yes",
    ]);
  });

  it("names no colour, and draws no colour legend, for a field that no longer exists", async () => {
    h.config = { showApps: true, colorBy: "retiredField" };
    renderMap();
    await loaded();
    expect(printParams()).toEqual([
      "Metric: Application Count",
      "Depth: Level 2",
      "Columns: 3",
      "Show Apps: Yes",
    ]);
    expect(within(legend()).queryByText("Not set")).not.toBeInTheDocument();
  });

  it("names the cost metric", async () => {
    h.config = { metric: "total_cost" };
    renderMap();
    await loaded();
    expect(printParams()[0]).toBe("Metric: Total Cost");
  });
});

// ---------------------------------------------------------------------------
// Legend and heat scale
// ---------------------------------------------------------------------------

/** The five heat-scale swatches between "Low" and "High". */
const swatches = () =>
  Array.from(within(legend()).getByText("Low").nextElementSibling!.children).map(
    (s) => getComputedStyle(s).backgroundColor,
  );

describe("CapabilityMapReport legend", () => {
  it("draws the heat scale from low to high against the maximum", async () => {
    renderMap();
    await loaded();
    expect(within(legend()).getByText("Low")).toBeInTheDocument();
    expect(within(legend()).getByText("High")).toBeInTheDocument();
    expect(within(legend()).getByText("Max: 3")).toBeInTheDocument();
    expect(swatches()).toEqual([
      "rgb(227, 242, 253)",
      "rgb(177, 204, 240)",
      "rgb(126, 166, 228)",
      "rgb(76, 128, 215)",
      "rgb(25, 90, 202)",
    ]);
  });

  it("takes the maximum from every level, not just the roots", async () => {
    // A credit on the parent's own app pulls its roll-up below its child's.
    h.config = { metric: "total_cost" };
    heatmapRoute({
      ...MAIN,
      items: [
        cap("parent", "Parent", null, [app("credit", "Credit", { attributes: { costTotalAnnual: -1000 } })]),
        cap("child", "Child", "parent", [app("spend", "Spend", { attributes: { costTotalAnnual: 500 } })]),
      ],
    });
    renderMap();
    await loaded("Child");
    expect(within(legend()).getByText("Max: $500")).toBeInTheDocument();
  });

  it("keeps the colour legend off while the applications are hidden", async () => {
    h.config = { colorBy: "criticality" };
    renderMap();
    await loaded();
    expect(within(legend()).queryByText("Criticality:")).not.toBeInTheDocument();
  });

  it("names the colour-by field over its coloured options", async () => {
    h.config = { showApps: true, colorBy: "criticality" };
    renderMap();
    await loaded();
    expect(within(legend()).getByText("Criticality:")).toBeInTheDocument();
    expect(within(legend()).getByText("High Crit")).toBeInTheDocument();
    expect(within(legend()).getByText("Not set")).toBeInTheDocument();
  });

  it("draws no colour legend for a field none of whose options carry a colour", async () => {
    h.config = { showApps: true, colorBy: "tier" };
    heatmapRoute({
      ...MAIN,
      fields_schema: [
        {
          section: "Business",
          fields: [
            {
              key: "tier",
              label: "Tier",
              type: "single_select",
              options: [{ key: "gold", label: "Gold" }],
            },
          ],
        },
      ],
    });
    renderMap();
    await loaded();
    expect(within(legend()).queryByText("Tier:")).not.toBeInTheDocument();
    expect(within(legend()).queryByText("Not set")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Toolbar: Color Apps By
// ---------------------------------------------------------------------------

describe("CapabilityMapReport colour picker", () => {
  const colorSelect = () => screen.getByRole("combobox", { name: "Color Apps By" });
  async function pickColor(option: string) {
    fireEvent.mouseDown(colorSelect());
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByRole("option", { name: option }));
  }

  it("shows the current pick, and stores 'No color' as no colour at all", async () => {
    h.config = { showApps: true };
    renderMap();
    await loaded();
    expect(colorSelect()).toHaveTextContent("No color");

    await pickColor("Criticality");
    await waitFor(() => expect(colorSelect()).toHaveTextContent("Criticality"));
    await waitFor(() => expect(lastPersisted()).toMatchObject({ colorBy: "criticality" }));

    await pickColor("No color");
    await waitFor(() => expect(colorSelect()).toHaveTextContent("No color"));
    await waitFor(() => expect(lastPersisted()).toMatchObject({ colorBy: "" }));
  });
});

// ---------------------------------------------------------------------------
// Toolbar: relation facets
// ---------------------------------------------------------------------------

const member = (id: string, name: string, type: string) => ({ id, name, type });

/** The relation-facet labels in the "Related By" row, in order. */
const facets = () =>
  Array.from(
    within(toolbar()).getByText("Related By").parentElement!.querySelectorAll("label"),
  ).map((l) => l.textContent);

describe("CapabilityMapReport relation facets", () => {
  beforeEach(() => {
    h.config = { showApps: true };
  });

  it("puts Organization first, then the rest by key, labelled from the metamodel", async () => {
    heatmapRoute({
      ...MAIN,
      // Organization deliberately neither first nor last in the payload.
      filterable_types: {
        DataObject: [member("do-1", "Ledger", "DataObject")],
        Organization: [member("org-1", "Sales Org", "Organization")],
        Initiative: [member("ini-1", "Cloud Move", "Initiative")],
        Provider: [member("prov-1", "Acme", "Provider")],
        Empty: [],
      },
    });
    renderMap();
    await loaded();

    expect(facets()).toEqual(["Organization", "DataObject"]);
    const more = within(toolbar()).getByLabelText("Show 2 more relation filters");
    expect(more).toHaveTextContent("2 more");
    expect(within(toolbar()).queryByText("Less")).not.toBeInTheDocument();

    fireEvent.click(within(more).getByText("2 more"));
    // Provider carries the metamodel label, unknown types their key.
    expect(facets()).toEqual(["Organization", "DataObject", "Initiative", "Vendor"]);
    expect(within(toolbar()).queryByText("2 more")).not.toBeInTheDocument();

    fireEvent.click(within(toolbar()).getByText("Less"));
    expect(facets()).toEqual(["Organization", "DataObject"]);
    expect(within(toolbar()).queryByText("Less")).not.toBeInTheDocument();
  });

  it("adds a facet per relation type only where several reach one card type", async () => {
    heatmapRoute({
      ...MAIN,
      filterable_types: {
        Organization: [member("org-1", "Sales Org", "Organization")],
        Provider: [member("prov-1", "Acme", "Provider")],
      },
      relation_types: [
        { key: "relOrgOwnsApp", label: "owns", reverse_label: "is owned by", source_type_key: "Organization", target_type_key: "Application", other_type_key: "Organization" },
        { key: "relOrgUsesApp", label: "uses", reverse_label: "is used by", source_type_key: "Organization", target_type_key: "Application", other_type_key: "Organization" },
        { key: "relProvToApp", label: "supplies", reverse_label: "is supplied by", source_type_key: "Provider", target_type_key: "Application", other_type_key: "Provider" },
      ],
    });
    renderMap();
    await loaded();
    fireEvent.click(within(toolbar()).getByText("2 more"));
    expect(facets()).toEqual([
      "Organization",
      "Vendor",
      "Organization · is owned by",
      "Organization · is used by",
    ]);
  });

  it("offers no More with exactly two facets", async () => {
    heatmapRoute({
      ...MAIN,
      filterable_types: {
        Organization: [member("org-1", "Sales Org", "Organization")],
        Provider: [member("prov-1", "Acme", "Provider")],
      },
    });
    renderMap();
    await loaded();
    expect(facets()).toEqual(["Organization", "Vendor"]);
    expect(within(toolbar()).queryByText(/^\d+ more$/)).not.toBeInTheDocument();
    expect(within(toolbar()).queryByText("Less")).not.toBeInTheDocument();
  });

  it("offers no More or Less with only two facets, even after the facet set shrinks", async () => {
    const two = {
      Organization: [member("org-1", "Sales Org", "Organization")],
      Provider: [member("prov-1", "Acme", "Provider")],
    };
    mockApi.on("get", "/reports/capability-heatmap*", (path: string) => ({
      ...MAIN,
      filterable_types: path.includes("total_cost")
        ? two
        : { ...two, Initiative: [member("ini-1", "Cloud Move", "Initiative")] },
    }));
    renderMap();
    await loaded();
    fireEvent.click(within(toolbar()).getByText("1 more"));
    expect(facets()).toEqual(["Organization", "Initiative", "Vendor"]);

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Heatmap Metric" }));
    fireEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Total Cost" }));

    await waitFor(() => expect(facets()).toEqual(["Organization", "Vendor"]));
    expect(within(toolbar()).queryByText("Less")).not.toBeInTheDocument();
    expect(within(toolbar()).queryByText(/^\d+ more$/)).not.toBeInTheDocument();
  });

  it("starts every facet unfiltered", async () => {
    heatmapRoute({
      ...MAIN,
      filterable_types: { Organization: [member("org-1", "Sales Org", "Organization")] },
    });
    renderMap();
    await loaded();
    expect(within(toolbar()).getByLabelText("Organization")).toHaveAttribute("placeholder", "All");
  });

  it("drops the Related By row when nothing relates to applications", async () => {
    renderMap();
    await loaded();
    expect(within(toolbar()).getByRole("button", { name: /Application Filters/ })).toBeInTheDocument();
    expect(within(toolbar()).queryByText("Related By")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Toolbar: tags and field facets
// ---------------------------------------------------------------------------

const TAG_GROUPS = [
  { id: "g-host", name: "Hosting", mode: "multi", tags: [{ id: "t-cloud", name: "Cloud" }] },
];

/** The field-facet labels in the "Fields" row, in order. */
const fieldFacets = () =>
  Array.from(
    within(toolbar()).getByText("Fields").parentElement!.querySelectorAll("label"),
  ).map((l) => l.textContent);

describe("CapabilityMapReport tag and field facets", () => {
  beforeEach(() => {
    h.config = { showApps: true };
  });

  it("offers a tag picker when tag groups exist", async () => {
    heatmapRoute({ ...MAIN, tag_groups: TAG_GROUPS });
    renderMap();
    await loaded();
    expect(within(toolbar()).getByText("Tags", { selector: ".MuiTypography-caption" })).toBeInTheDocument();
    expect(within(toolbar()).getByLabelText("Tags")).toBeInTheDocument();
  });

  it("offers no tag picker without tag groups", async () => {
    renderMap();
    await loaded();
    expect(within(toolbar()).getByRole("button", { name: /Application Filters/ })).toBeInTheDocument();
    expect(within(toolbar()).queryByText("Tags")).not.toBeInTheDocument();
  });

  it("clears tags with the rest of the filters", async () => {
    h.config = { showApps: true, tagFilterIds: ["t-cloud"] };
    heatmapRoute({ ...MAIN, tag_groups: TAG_GROUPS });
    renderMap();
    await loaded();
    const clear = within(toolbar()).getByText("Clear all").closest(".MuiChip-root") as HTMLElement;
    fireEvent.click(within(clear).getByTestId("CancelIcon"));

    await waitFor(() => expect(within(toolbar()).queryByText("Clear all")).not.toBeInTheDocument());
    expect(lastPersisted()).toMatchObject({ tagFilterIds: [], attrFilters: {}, relationFilters: {} });
  });

  it("offers a facet only for select fields that have options", async () => {
    heatmapRoute({
      ...MAIN,
      fields_schema: [
        {
          section: "Business",
          fields: [
            CRITICALITY,
            { key: "plainSelect", label: "Plain Select", type: "single_select", options: [] },
            { key: "bareSelect", label: "Bare Select", type: "single_select" },
            COST,
          ],
        },
      ],
    });
    renderMap();
    await loaded();
    expect(fieldFacets()).toEqual(["Criticality"]);
    expect(within(toolbar()).getByLabelText("Criticality")).toHaveAttribute("placeholder", "All");
  });

  it("drops the Fields row when no select field has options", async () => {
    heatmapRoute({
      ...MAIN,
      fields_schema: [
        {
          section: "Business",
          fields: [
            { key: "plainSelect", label: "Plain Select", type: "single_select", options: [] },
            { key: "bareSelect", label: "Bare Select", type: "single_select" },
          ],
        },
      ],
    });
    renderMap();
    await loaded();
    expect(within(toolbar()).getByRole("button", { name: /Application Filters/ })).toBeInTheDocument();
    expect(within(toolbar()).queryByText("Fields")).not.toBeInTheDocument();
  });

  it("drops the Fields row when there are no select fields at all", async () => {
    heatmapRoute({ ...MAIN, fields_schema: [{ section: "Business", fields: [COST] }] });
    renderMap();
    await loaded();
    expect(within(toolbar()).getByRole("button", { name: /Application Filters/ })).toBeInTheDocument();
    expect(within(toolbar()).queryByText("Fields")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

describe("CapabilityMapReport shell", () => {
  it("shows a spinner, not an empty map, until the heatmap arrives", () => {
    mockApi.on("get", "/reports/capability-heatmap*", () => new Promise(() => {}));
    renderMap();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText(/No Business Capabilities found/)).not.toBeInTheDocument();
  });

  it("titles the report and paints its icon in the capability type's colour", async () => {
    renderMap();
    await loaded();
    expect(screen.getByRole("heading", { name: "Business Capability Map" })).toBeInTheDocument();
    expect(screen.getByText("grid_view")).toHaveStyle({ color: "#5500aa" });
  });

  it("falls back to the static capability colour when the metamodel has none", async () => {
    withMetamodel(TYPES.filter((t) => t.key !== "BusinessCapability"));
    renderMap();
    await loaded();
    expect(screen.getByText("grid_view")).toHaveStyle({ color: "#003399" });
  });

  it("names the saved report being viewed", async () => {
    h.savedReportName = "Q3 landscape";
    renderMap();
    await loaded();
    expect(document.querySelector(".report-saved-banner")).toHaveTextContent("Q3 landscape");
  });

  it("explains the scope control and labels its dialog", async () => {
    renderMap();
    await loaded();
    const chip = within(toolbar()).getByLabelText(
      "Show only the selected capabilities and everything beneath them",
    );
    fireEvent.click(within(chip).getByText("All capabilities"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Scope to capabilities")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Sub-capabilities of a selected capability are included automatically.",
      ),
    ).toBeInTheDocument();
  });
});
