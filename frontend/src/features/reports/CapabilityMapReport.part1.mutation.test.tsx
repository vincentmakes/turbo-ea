/**
 * Mutation-hardening for the Capability Map's helpers, tree builder,
 * capability cards and state plumbing (CapabilityMapReport.tsx up to the
 * drawer link). The heat colour of a capability IS the report's data
 * encoding, so exact colours for a given metric value are asserted here;
 * a chip's fill is likewise the colour-by encoding. Application colours are
 * also read at the timeline slider boundary (the pill colours), which needs
 * no style lookup at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));

const ctl = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  persistConfig: (() => {}) as (cfg: unknown) => void,
  setSaveDialogOpen: (() => {}) as (open: boolean) => void,
  resetAll: (() => {}) as () => void,
  restore: (() => {}) as (v: unknown) => void,
  tlReset: (() => {}) as () => void,
  timelineDate: 0,
  todayMs: 0,
  sliderProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: () => ({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: ctl.setSaveDialogOpen,
    loadedConfig: null,
    consumeConfig: () => ctl.config,
    resetSavedReport: () => {},
    persistConfig: ctl.persistConfig,
    resetAll: ctl.resetAll,
    reportType: "capability-map",
  }),
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  // The report hands the hook the callback that opens the save dialog once
  // the thumbnail is captured; run it the way the real hook does.
  useThumbnailCapture: (onCaptured: () => void) => ({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: () => onCaptured(),
  }),
}));
vi.mock("@/hooks/useTimeline", () => ({
  useTimeline: () => ({
    timelineDate: ctl.timelineDate,
    setTimelineDate: () => {},
    todayMs: ctl.todayMs,
    isTimeTraveling: ctl.timelineDate !== ctl.todayMs,
    persistValue: undefined,
    printParam: null,
    restore: (v: unknown) => ctl.restore(v),
    reset: () => ctl.tlReset(),
  }),
}));
vi.mock("@/components/TimelineSlider", () => ({
  default: (props: Record<string, unknown>) => {
    ctl.sliderProps.push(props);
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
import { EMPTY_FILTER_KEY } from "@/components/FilterSelect";
import CapabilityMapReport from "./CapabilityMapReport";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Application gets a colour distinct from the CARD_TYPE_COLORS fallback. */
const APP_HEX = "#123456";
const APP_COLOR = "rgb(18, 52, 86)"; // APP_HEX, as computed
const UNSET = "rgba(128, 128, 128, 0.2)";

const TYPES = [
  makeCardType({ key: "BusinessCapability", label: "Business Capability", color: "#003399" }),
  makeCardType({ key: "Application", label: "Application", color: "#123456" }),
  makeCardType({ key: "Organization", label: "Organization" }),
  makeCardType({ key: "Provider", label: "Provider" }),
];

type App = {
  id: string;
  name: string;
  attributes?: Record<string, unknown>;
  lifecycle?: Record<string, string>;
  org_ids?: string[];
  related_by_type?: Record<string, string[]>;
  related_by_rel_type?: Record<string, string[]>;
  tag_ids?: string[];
};

const app = (id: string, name: string, over: Partial<App> = {}): App => ({
  id,
  name,
  attributes: {},
  lifecycle: { active: "2015-01-01" },
  org_ids: [],
  related_by_type: {},
  related_by_rel_type: {},
  tag_ids: [],
  ...over,
});

type Cap = {
  id: string;
  name: string;
  parent_id: string | null;
  app_count: number;
  total_cost: number;
  risk_count: number;
  attributes?: Record<string, unknown>;
  apps: App[];
};

const cap = (
  id: string,
  name: string,
  parent_id: string | null,
  apps: App[] = [],
  attributes: Record<string, unknown> = {},
): Cap => ({
  id,
  name,
  parent_id,
  app_count: apps.length,
  total_cost: 0,
  risk_count: 0,
  attributes,
  apps,
});

/** The payload's `attributes` is optional; a capability may omit it. */
function withoutAttributes(c: Cap): Cap {
  const out = { ...c };
  delete out.attributes;
  return out;
}

/**
 * Two single_select fields (Hosting first, so a lookup that grabs the first
 * field instead of the coloured one is caught), one without options, a cost
 * and a text field (neither may become a colour-by option).
 */
const FIELDS_SCHEMA = [
  {
    section: "Business",
    fields: [
      {
        key: "hosting",
        label: "Hosting",
        type: "single_select",
        options: [{ key: "cloud", label: "Cloud", color: "#00aa00" }],
      },
      {
        key: "criticality",
        label: "Criticality",
        type: "single_select",
        options: [
          { key: "low", label: "Low Crit", color: "#00ff00" },
          { key: "high", label: "High Crit", color: "#ff0000" },
          { key: "plain", label: "Plain Crit" },
        ],
      },
      { key: "noOpts", label: "No Options", type: "single_select" },
      { key: "costTotalAnnual", label: "Annual Cost", type: "cost" },
      { key: "notes", label: "Notes", type: "text" },
    ],
  },
];

function payload(items: Cap[], extra: Record<string, unknown> = {}) {
  return {
    items,
    fields_schema: FIELDS_SCHEMA,
    filterable_types: {},
    relation_types: [],
    tag_groups: [],
    ...extra,
  };
}

function serve(body: unknown) {
  mockApi.on("get", "/reports/capability-heatmap*", body);
}

function renderMap() {
  return render(
    <MemoryRouter>
      <CapabilityMapReport />
    </MemoryRouter>,
  );
}

const chart = () => document.querySelector(".report-chart-area") as HTMLElement;
const toolbar = () => document.querySelector(".report-toolbar") as HTMLElement;

/** The coloured header strip of the capability card titled `name`. */
const header = (name: string) => within(chart()).getByText(name).parentElement as HTMLElement;
const bg = (el: Element) => getComputedStyle(el).backgroundColor;

/** Capability titles in document order. */
const titles = () => Array.from(chart().querySelectorAll("h6")).map((h) => h.textContent);

/** Application chip labels in document order (value / count chips excluded). */
const chipNames = (names: string[]) =>
  Array.from(chart().querySelectorAll(".MuiChip-label"))
    .map((e) => e.textContent ?? "")
    .filter((n) => names.includes(n));

/** The last element (`Array#at` is ES2022, past this project's lib). */
const last = <T,>(xs: T[]): T => xs[xs.length - 1];

const lastPersisted = () =>
  last(vi.mocked(ctl.persistConfig).mock.calls)?.[0] as Record<string, unknown>;

const heatmapPaths = () => mockApi.callsOf("get", "/reports/capability-heatmap*").map((c) => c.path);

/** Generous timeout: the mutation run executes this file single-threaded on a busy box. */
async function loaded(name: string) {
  await waitFor(() => expect(within(chart()).getByText(name)).toBeInTheDocument(), {
    timeout: 5000,
  });
}

/** The pill colours the slider would draw, for every card going live. */
function pillColors(): Record<string, string | undefined> {
  const props = last(ctl.sliderProps);
  const cards = (props.milestoneCards as (from: number, to: number) => {
    id: string;
    color?: string;
  }[])(-Infinity, Infinity);
  return Object.fromEntries(cards.map((c) => [c.id, c.color]));
}

async function openSelect(label: RegExp): Promise<string[]> {
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }));
  const listbox = await screen.findByRole("listbox");
  return within(listbox)
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(TYPES);
  ctl.config = null;
  ctl.persistConfig = vi.fn();
  ctl.setSaveDialogOpen = vi.fn();
  ctl.resetAll = vi.fn();
  ctl.restore = vi.fn();
  ctl.tlReset = vi.fn();
  ctl.timelineDate = Date.parse("2026-08-22");
  ctl.todayMs = ctl.timelineDate;
  ctl.sliderProps.length = 0;
  mockApi.on("get", "/cards*", { items: [], total: 0 });
});

// ---------------------------------------------------------------------------
// Heat colours
// ---------------------------------------------------------------------------

describe("heat colours", () => {
  const eol = { active: "2015-01-01", endOfLife: "2099-01-01" };
  const HEAT = payload([
    cap("two", "Two Apps", null, [app("x", "X", { lifecycle: eol }), app("y", "Y", { lifecycle: eol })]),
    cap("one", "One App", null, [app("z", "Z", { lifecycle: eol })]),
    cap("none", "No Apps", null),
  ]);

  it("shades application counts from pale to deep blue, relative to the busiest capability", async () => {
    serve(HEAT);
    renderMap();
    await loaded("Two Apps");
    expect(bg(header("Two Apps"))).toBe("rgb(25, 90, 202)");
    expect(bg(header("One App"))).toBe("rgb(126, 166, 228)");
    expect(bg(header("No Apps"))).toBe("rgb(227, 242, 253)");
  });

  it("shades the EOL risk metric on a white-to-red scale", async () => {
    serve(HEAT);
    ctl.config = { metric: "risk_count" };
    renderMap();
    await loaded("Two Apps");
    await waitFor(() => expect(bg(header("Two Apps"))).toBe("rgb(200, 48, 40)"));
    expect(bg(header("One App"))).toBe("rgb(228, 152, 148)");
    expect(bg(header("No Apps"))).toBe("rgb(255, 255, 255)");
  });

  it("greys every capability out when nothing has a value", async () => {
    serve(payload([cap("a", "Empty A", null), cap("b", "Empty B", null)]));
    renderMap();
    await loaded("Empty A");
    expect(bg(header("Empty A"))).toBe("rgba(128, 128, 128, 0.1)");
    expect(bg(header("Empty B"))).toBe("rgba(128, 128, 128, 0.1)");
  });

  it("shades a branch header by its rolled-up value", async () => {
    serve(
      payload([
        cap("p", "Parent", null),
        cap("c1", "Child One", "p", [app("x", "X")]),
        cap("c2", "Child Two", "p", [app("y", "Y")]),
      ]),
    );
    renderMap();
    await loaded("Parent");
    // The branch rolls up two apps — the maximum — the children one each.
    expect(bg(header("Parent"))).toBe("rgb(25, 90, 202)");
    expect(bg(header("Child One"))).toBe("rgb(126, 166, 228)");
  });
});

// ---------------------------------------------------------------------------
// Application colours
// ---------------------------------------------------------------------------

const ALPHA = app("alpha", "Alpha", {
  attributes: { criticality: "high", hosting: "cloud", costTotalAnnual: 1000, noOpts: "x" },
});
const BETA = app("beta", "Beta", { attributes: { criticality: "plain" } });
const GAMMA = app("gamma", "Gamma");
const DELTA = app("delta", "Delta", { attributes: { criticality: "mystery" } });
const COLOURED = payload([cap("pool", "Pool", null, [ALPHA, BETA, GAMMA, DELTA])]);

describe("application colours", () => {
  it("uses the metamodel's Application colour when not colouring by a field", async () => {
    serve(COLOURED);
    renderMap();
    await loaded("Pool");
    expect(pillColors()).toEqual({ alpha: APP_HEX, beta: APP_HEX, gamma: APP_HEX, delta: APP_HEX });
  });

  it("treats a stored 'none' as no colouring", async () => {
    serve(COLOURED);
    ctl.config = { colorBy: "none" };
    renderMap();
    await loaded("Pool");
    expect(pillColors()).toEqual({ alpha: APP_HEX, beta: APP_HEX, gamma: APP_HEX, delta: APP_HEX });
  });

  it("colours by the chosen field's option, greying unset, unknown and colourless values", async () => {
    serve(COLOURED);
    ctl.config = { colorBy: "criticality" };
    renderMap();
    await loaded("Pool");
    expect(pillColors()).toEqual({
      alpha: "#ff0000",
      beta: UNSET,
      gamma: UNSET,
      delta: UNSET,
    });
  });

  it("greys a value on a select field that defines no options", async () => {
    serve(COLOURED);
    ctl.config = { colorBy: "noOpts", showApps: true };
    renderMap();
    await loaded("Pool");
    expect(pillColors().alpha).toBe(UNSET);
    // The chip names the raw value it could not resolve.
    expect(within(chart()).getByLabelText("Alpha — x")).toBeInTheDocument();
  });

  it("greys a value on a field that is not a select field at all", async () => {
    serve(COLOURED);
    ctl.config = { colorBy: "costTotalAnnual", showApps: true };
    renderMap();
    await loaded("Pool");
    expect(pillColors().alpha).toBe(UNSET);
    expect(within(chart()).getByLabelText("Alpha — 1000")).toBeInTheDocument();
  });

  it("fills the chips with the Application colour, or the option colour", async () => {
    serve(COLOURED);
    ctl.config = { showApps: true };
    const first = renderMap();
    await loaded("Pool");
    expect(bg(within(chart()).getByLabelText("Alpha"))).toBe(APP_COLOR);
    first.unmount();

    ctl.config = { showApps: true, colorBy: "criticality" };
    renderMap();
    await loaded("Pool");
    expect(bg(within(chart()).getByLabelText("Alpha — High Crit"))).toBe("rgb(255, 0, 0)");
    expect(bg(within(chart()).getByLabelText("Beta — Plain Crit"))).toBe(UNSET);
    expect(bg(within(chart()).getByLabelText("Gamma"))).toBe(UNSET);
  });

  it("falls back to the built-in Application colour when the metamodel has none", async () => {
    withMetamodel(TYPES.filter((t) => t.key !== "Application"));
    serve(COLOURED);
    ctl.config = { showApps: true };
    renderMap();
    await loaded("Pool");
    expect(bg(within(chart()).getByLabelText("Alpha"))).toBe("rgb(15, 126, 181)");
  });

  it("offers only the single-select fields as colour-by options", async () => {
    serve(COLOURED);
    ctl.config = { showApps: true };
    renderMap();
    await loaded("Pool");
    // Uncoloured reads as the "No color" option, not as a blank select.
    expect(screen.getByRole("combobox", { name: /color apps by/i })).toHaveTextContent("No color");
    expect(await openSelect(/color apps by/i)).toEqual([
      "No color",
      "Hosting",
      "Criticality",
      "No Options",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

describe("attribute filters", () => {
  const POOL = payload([
    cap("pool", "Pool", null, [
      app("a", "High One", { attributes: { criticality: "high" } }),
      app("b", "Null One", { attributes: { criticality: null } }),
      app("c", "Blank One", { attributes: { criticality: "" } }),
      app("d", "Missing One"),
      app("e", "Low One", { attributes: { criticality: "low" } }),
    ]),
  ]);
  const NAMES = ["High One", "Null One", "Blank One", "Missing One", "Low One"];

  it("treats a missing, null or blank value as empty", async () => {
    serve(POOL);
    ctl.config = { showApps: true, attrFilters: { criticality: [EMPTY_FILTER_KEY] } };
    renderMap();
    await loaded("Pool");
    expect(chipNames(NAMES)).toEqual(["Blank One", "Missing One", "Null One"]);
  });

  it("matches empty OR a picked value when both are selected", async () => {
    serve(POOL);
    ctl.config = { showApps: true, attrFilters: { criticality: [EMPTY_FILTER_KEY, "high"] } };
    renderMap();
    await loaded("Pool");
    expect(chipNames(NAMES)).toEqual(["Blank One", "High One", "Missing One", "Null One"]);
  });

  it("keeps only the picked value", async () => {
    serve(POOL);
    ctl.config = { showApps: true, attrFilters: { criticality: ["high"] } };
    renderMap();
    await loaded("Pool");
    expect(chipNames(NAMES)).toEqual(["High One"]);
  });
});

describe("relation filters", () => {
  const REL_TYPES = [
    { key: "relOrgOwnsApp", label: "owns", reverse_label: "is owned by", source_type_key: "Organization", target_type_key: "Application", other_type_key: "Organization" },
    { key: "relAppToApp", label: "calls", reverse_label: "is called by", source_type_key: "Application", target_type_key: "Application", other_type_key: "Application" },
  ];
  const POOL = payload(
    [
      cap("pool", "Pool", null, [
        app("r1", "Owned", {
          related_by_type: { Organization: ["o1"] },
          related_by_rel_type: { relOrgOwnsApp: ["o1"] },
        }),
        app("r3", "Unrelated"),
        { ...app("r4", "No Org Ids"), org_ids: undefined, related_by_type: undefined },
        app("s1", "Caller", { related_by_rel_type: { relAppToApp__out: ["s9"] } }),
        app("s2", "Callee", { related_by_rel_type: { relAppToApp__in: ["s9"] } }),
      ]),
    ],
    { relation_types: REL_TYPES },
  );
  const NAMES = ["Owned", "Unrelated", "No Org Ids", "Caller", "Callee"];

  it("ignores a relation filter with nothing picked", async () => {
    serve(POOL);
    ctl.config = { showApps: true, relationFilters: { Organization: [] } };
    renderMap();
    await loaded("Pool");
    expect(chipNames(NAMES)).toHaveLength(5);
  });

  it("keeps only the apps related to a picked card", async () => {
    serve(POOL);
    ctl.config = { showApps: true, relationFilters: { Organization: ["o1"] } };
    renderMap();
    await loaded("Pool");
    expect(chipNames(NAMES)).toEqual(["Owned"]);
  });

  it("matches '(empty)' on a relation type for apps with no relation of that type", async () => {
    serve(POOL);
    ctl.config = { showApps: true, relationFilters: { relOrgOwnsApp: [EMPTY_FILTER_KEY] } };
    renderMap();
    await loaded("Pool");
    expect(chipNames(NAMES)).toEqual(["Callee", "Caller", "No Org Ids", "Unrelated"]);
  });

  it("matches '(empty)' on a card type for an app whose payload carries no relations at all", async () => {
    serve(POOL);
    ctl.config = { showApps: true, relationFilters: { Provider: [EMPTY_FILTER_KEY] } };
    renderMap();
    await loaded("Pool");
    expect(chipNames(NAMES)).toEqual(
      expect.arrayContaining(["No Org Ids", "Unrelated", "Owned"]),
    );
  });

  it("filters each side of a self-referencing relation type on its own", async () => {
    serve(POOL);
    ctl.config = { showApps: true, relationFilters: { relAppToApp__out: ["s9"] } };
    const first = renderMap();
    await loaded("Pool");
    expect(chipNames(NAMES)).toEqual(["Caller"]);
    first.unmount();

    ctl.config = { showApps: true, relationFilters: { relAppToApp__in: ["s9"] } };
    renderMap();
    await loaded("Pool");
    expect(chipNames(NAMES)).toEqual(["Callee"]);
  });
});

describe("tag filters", () => {
  const POOL = payload(
    [
      cap("pool", "Pool", null, [
        app("t1", "Cloudy", { tag_ids: ["t-cloud"] }),
        app("t2", "Grounded", { tag_ids: ["t-onprem"] }),
        app("t3", "Cloudy Gold", { tag_ids: ["t-cloud", "t-gold"] }),
        { ...app("t4", "Untagged"), tag_ids: undefined },
      ]),
    ],
    {
      tag_groups: [
        { id: "g-host", name: "Hosting", mode: "multi", tags: [{ id: "t-cloud", name: "Cloud" }, { id: "t-onprem", name: "On-Prem" }] },
        { id: "g-tier", name: "Tier", mode: "multi", tags: [{ id: "t-gold", name: "Gold" }] },
      ],
    },
  );
  const NAMES = ["Cloudy", "Grounded", "Cloudy Gold", "Untagged"];

  it("ORs tags picked within one group", async () => {
    serve(POOL);
    ctl.config = { showApps: true, tagFilterIds: ["t-cloud", "t-onprem"] };
    renderMap();
    await loaded("Pool");
    expect(chipNames(NAMES)).toEqual(["Cloudy", "Cloudy Gold", "Grounded"]);
  });

  it("ANDs tags picked across groups", async () => {
    serve(POOL);
    ctl.config = { showApps: true, tagFilterIds: ["t-cloud", "t-gold"] };
    renderMap();
    await loaded("Pool");
    expect(chipNames(NAMES)).toEqual(["Cloudy Gold"]);
  });
});

// ---------------------------------------------------------------------------
// Tree, cards and chips
//
//   Ops (L1)          own: OpsDesk, Atlas, Shared
//     └ Logistics     own: Shared
//         └ Routing   RouteMaster (EOL 2099)
//   Sales (L1, no attributes)
//     ├ Pipeline
//     └ Leads         Lead1 (no lifecycle)
//   Solo (L1, leaf)   Zed, Abe
//
// The payload lists roots and children out of alphabetical order.
// ---------------------------------------------------------------------------

const SHARED = app("shared", "Shared");
const TREE = payload([
  cap("solo", "Solo", null, [app("zed", "Zed"), app("abe", "Abe")]),
  withoutAttributes(cap("sales", "Sales", null)),
  cap("pipeline", "Pipeline", "sales"),
  cap("leads", "Leads", "sales", [{ ...app("lead1", "Lead1"), lifecycle: undefined }]),
  cap("ops", "Ops", null, [app("opsdesk", "OpsDesk"), app("atlas", "Atlas"), SHARED]),
  cap("logistics", "Logistics", "ops", [SHARED]),
  cap("routing", "Routing", "logistics", [
    app("route", "RouteMaster", { lifecycle: { active: "2015-01-01", endOfLife: "2099-01-01" } }),
  ]),
]);
const TREE_APPS = ["OpsDesk", "Atlas", "Shared", "RouteMaster", "Lead1", "Zed", "Abe"];

describe("capability tree", () => {
  it("sorts roots and children by name and survives sparse payloads", async () => {
    serve(TREE);
    renderMap();
    await loaded("Ops");
    expect(titles()).toEqual(["Ops", "Logistics", "Sales", "Leads", "Pipeline", "Solo"]);
  });

  it("shows each app at its deepest visible capability, in name order", async () => {
    serve(TREE);
    ctl.config = { showApps: true };
    renderMap();
    await loaded("Ops");
    // Ops keeps only its own apps not already under Logistics; Logistics is
    // the depth-2 leaf, so it rolls up Routing's app as well.
    expect(chipNames(TREE_APPS)).toEqual([
      "Atlas",
      "OpsDesk",
      "RouteMaster",
      "Shared",
      "Lead1",
      "Abe",
      "Zed",
    ]);
  });

  it("hides every chip while Show Applications is off", async () => {
    serve(TREE);
    renderMap();
    await loaded("Ops");
    expect(chipNames(TREE_APPS)).toEqual([]);
  });

  it("labels branches with their app count and leaves with the metric value", async () => {
    serve(TREE);
    renderMap();
    await loaded("Ops");
    expect(within(header("Ops")).getByText("4 apps")).toBeInTheDocument();
    expect(within(header("Sales")).getByText("1 app")).toBeInTheDocument();
    // A childless root is a leaf even above the display depth.
    expect(within(header("Solo")).getByText("2")).toBeInTheDocument();
    expect(within(header("Solo")).queryByText("2 apps")).not.toBeInTheDocument();
  });

  it("flags EOL risk on the branch and the leaf that roll it up, and nowhere else", async () => {
    serve(TREE);
    renderMap();
    await loaded("Ops");
    expect(within(header("Ops")).getByLabelText("1 EOL risk")).toBeInTheDocument();
    expect(within(header("Logistics")).getByLabelText("1 EOL risk")).toBeInTheDocument();
    expect(within(header("Sales")).queryByLabelText(/EOL risk/)).not.toBeInTheDocument();
    expect(within(header("Solo")).queryByLabelText(/EOL risk/)).not.toBeInTheDocument();
  });

  it("offers a depth option per level the tree actually has", async () => {
    serve(TREE);
    renderMap();
    await loaded("Ops");
    expect(await openSelect(/display depth/i)).toEqual([
      "Level 1",
      "Level 2",
      "Level 3",
      "All levels",
    ]);
  });

  it("opens the side panel from a chip without also opening the capability drawer", async () => {
    serve(TREE);
    ctl.config = { showApps: true };
    renderMap();
    await loaded("Ops");
    fireEvent.click(within(chart()).getByText("Abe"));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("abe");
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Saved config, reset and the shell
// ---------------------------------------------------------------------------

describe("saved configuration", () => {
  it("restores the timeline date", async () => {
    serve(TREE);
    ctl.config = { timelineDate: 1234 };
    renderMap();
    await loaded("Ops");
    expect(ctl.restore).toHaveBeenCalledWith(1234);
  });

  it("restores the metric and fetches for it", async () => {
    serve(TREE);
    ctl.config = { metric: "total_cost" };
    renderMap();
    await loaded("Ops");
    await waitFor(() =>
      expect(heatmapPaths()).toContain("/reports/capability-heatmap?metric=total_cost"),
    );
    expect(lastPersisted()).toMatchObject({ metric: "total_cost" });
  });

  it("keeps the defaults for every key a partial config leaves out", async () => {
    serve(TREE);
    ctl.config = { metric: "app_count" };
    renderMap();
    await loaded("Ops");
    expect(lastPersisted()).toMatchObject({
      displayLevel: 2,
      showApps: false,
      colorBy: "",
      scopeIds: [],
      tagFilterIds: [],
    });
    // Depth 2 still rolls Routing up into Logistics.
    expect(within(chart()).queryByText("Routing")).not.toBeInTheDocument();
  });

  it("drops non-string scope ids", async () => {
    serve(TREE);
    ctl.config = { scopeIds: ["ops", 42] };
    renderMap();
    await loaded("Ops");
    expect(lastPersisted()).toMatchObject({ scopeIds: ["ops"] });
  });

  it("migrates the legacy grouped tag filter, skipping malformed groups", async () => {
    serve(TREE);
    ctl.config = { tagFilters: { "g-host": ["t-cloud"], bad: "x" } };
    renderMap();
    await loaded("Ops");
    expect(lastPersisted()).toMatchObject({ tagFilterIds: ["t-cloud"] });
  });

  it("ignores a null legacy tag filter", async () => {
    serve(TREE);
    ctl.config = { tagFilters: null };
    renderMap();
    await loaded("Ops");
    expect(lastPersisted()).toMatchObject({ tagFilterIds: [] });
  });

  it("starts uncoloured and with no tag section when the payload has no tag groups", async () => {
    const noTags: Record<string, unknown> = { ...COLOURED };
    delete noTags.tag_groups;
    serve(noTags);
    ctl.config = { showApps: true };
    renderMap();
    await loaded("Pool");
    expect(within(toolbar()).getByRole("button", { name: /Application Filters/ })).toBeInTheDocument();
    expect(within(toolbar()).queryByText("Tags")).not.toBeInTheDocument();
    expect(within(toolbar()).getByText("Fields")).toBeInTheDocument();
  });
});

describe("reset", () => {
  const FACETS = payload([cap("pool", "Pool", null, [ALPHA])], {
    filterable_types: {
      Organization: [{ id: "o1", name: "Sales Org", type: "Organization" }],
      Provider: [{ id: "p1", name: "Acme", type: "Provider" }],
    },
    relation_types: [
      { key: "relOrgOwnsApp", label: "owns", reverse_label: "is owned by", source_type_key: "Organization", target_type_key: "Application", other_type_key: "Organization" },
      { key: "relOrgUsesApp", label: "uses", reverse_label: "is used by", source_type_key: "Organization", target_type_key: "Application", other_type_key: "Organization" },
    ],
  });

  it("restores every control to its default", async () => {
    serve(TREE);
    ctl.config = {
      metric: "risk_count",
      displayLevel: 3,
      columns: 1,
      showApps: true,
      colorBy: "criticality",
      scopeIds: ["ops"],
      attrFilters: { criticality: ["high"] },
      relationFilters: { Organization: ["o1"] },
      tagFilterIds: ["t1"],
      filtersCollapsed: true,
    };
    renderMap();
    await loaded("Ops");
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({
        metric: "app_count",
        displayLevel: 2,
        columns: 3,
        showApps: false,
        colorBy: "",
        scopeIds: [],
        tagFilterIds: [],
        filtersCollapsed: false,
      }),
    );
    // toMatchObject treats `{}` as "any object", so the maps are compared exactly.
    expect(lastPersisted().attrFilters).toEqual({});
    expect(lastPersisted().relationFilters).toEqual({});
    expect(ctl.resetAll).toHaveBeenCalled();
  });

  it("folds the extra relation facets away again", async () => {
    serve(FACETS);
    ctl.config = { showApps: true };
    renderMap();
    await loaded("Pool");
    fireEvent.click(within(toolbar()).getByText("2 more"));
    expect(within(toolbar()).getByText("Less")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await waitFor(() =>
      expect(within(toolbar()).queryByRole("button", { name: /Application Filters/ })).not.toBeInTheDocument(),
    );
    fireEvent.click(within(toolbar()).getByRole("checkbox", { name: /show applications/i }));
    expect(await within(toolbar()).findByText("2 more")).toBeInTheDocument();
    expect(within(toolbar()).queryByText("Less")).not.toBeInTheDocument();
  });
});

describe("shell wiring", () => {
  it("opens the save dialog once the thumbnail is captured", async () => {
    serve(TREE);
    renderMap();
    await loaded("Ops");
    fireEvent.click(screen.getByRole("button", { name: /save report/i }));
    expect(ctl.setSaveDialogOpen).toHaveBeenCalledWith(true);
  });

  it("passes an abort signal with the heatmap request", async () => {
    serve(TREE);
    renderMap();
    await loaded("Ops");
    const call = vi
      .mocked(mockApi.api.get)
      .mock.calls.find(([p]) => String(p).startsWith("/reports/capability-heatmap"));
    expect(call?.[1]).toEqual({ signal: expect.any(AbortSignal) });
  });
});

describe("filter section visibility", () => {
  const filtersButton = () =>
    within(toolbar()).queryByRole("button", { name: /Application Filters/ });

  it("stays hidden while every stored filter is empty", async () => {
    serve(TREE);
    ctl.config = { attrFilters: { criticality: [] }, relationFilters: { Organization: [] } };
    renderMap();
    await loaded("Ops");
    expect(filtersButton()).not.toBeInTheDocument();
  });

  it("shows with Show Applications off once a relation filter is active", async () => {
    serve(TREE);
    ctl.config = { relationFilters: { Organization: ["o1"] } };
    renderMap();
    await loaded("Ops");
    expect(filtersButton()).toBeInTheDocument();
  });

  it("shows with Show Applications off once an attribute filter is active", async () => {
    serve(TREE);
    ctl.config = { attrFilters: { criticality: ["high"] } };
    renderMap();
    await loaded("Ops");
    expect(filtersButton()).toBeInTheDocument();
  });
});

describe("drawer inventory link", () => {
  const LINKED = payload([cap("leaf", "Leaf Cap", null, [ALPHA])], {
    filterable_types: {
      Organization: [
        { id: "o1", name: "Sales Org", type: "Organization" },
        { id: "o2", name: "Ops Org", type: "Organization" },
      ],
      Provider: [{ id: "p1", name: "Acme", type: "Provider" }],
    },
    relation_types: [
      { key: "relProvToApp", label: "supplies", reverse_label: "is supplied by", source_type_key: "Provider", target_type_key: "Application", other_type_key: "Provider" },
      { key: "relOrgOwnsApp", label: "owns", reverse_label: "is owned by", source_type_key: "Organization", target_type_key: "Application", other_type_key: "Organization" },
    ],
  });

  it("carries relation filters by member name and lands on the clicked capability", async () => {
    serve(LINKED);
    ctl.config = {
      relationFilters: {
        relOrgOwnsApp: ["o2"],
        Organization: ["o1", "gone"],
        Provider: ["nope"],
      },
    };
    renderMap();
    await loaded("Leaf Cap");
    fireEvent.click(within(chart()).getByText("Leaf Cap"));
    const panel = await screen.findByRole("presentation");
    const href = within(panel).getByRole("link", { name: /view in inventory/i }).getAttribute("href")!;
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/inventory");
    expect(Object.fromEntries([...new Set(url.searchParams.keys())].map((k) => [k, url.searchParams.getAll(k)]))).toEqual({
      type: ["Application"],
      rel_relOrgOwnsApp: ["Ops Org"],
      rel_Organization: ["Sales Org"],
      rel_BusinessCapability: ["Leaf Cap"],
    });
  });
});

// ---------------------------------------------------------------------------
// Mark-click spotlight
//
//   Hub (L1)       own: Retiree, Stayer
//     └ Spoke      LeafRetiree, LeafStay
//   Quiet (L1)     Calm
//
// Travelled to 2028, so both retirees (EOL 2027) are hidden until a mark
// click reveals them for the pulse.
// ---------------------------------------------------------------------------

describe("mark-click spotlight", () => {
  const EOL = "2027-06-01";
  const retiring = { active: "2015-01-01", endOfLife: EOL };
  const SPOT = payload([
    cap("hub", "Hub", null, [app("ret", "Retiree", { lifecycle: retiring }), app("stay", "Stayer")]),
    cap("spoke", "Spoke", "hub", [
      app("lret", "LeafRetiree", { lifecycle: retiring }),
      app("lstay", "LeafStay"),
    ]),
    cap("quiet", "Quiet", null, [app("calm", "Calm")]),
  ]);
  const PULSE = "tl-pulse-retire 0.65s ease-in-out 2";

  function clickRetirementMark() {
    const at = Date.parse(EOL);
    act(() =>
      (last(ctl.sliderProps).onMilestoneClick as (from: number, to: number) => void)(at, at),
    );
  }

  beforeEach(() => {
    ctl.todayMs = Date.parse("2026-08-22");
    ctl.timelineDate = Date.parse("2028-06-01");
  });

  it("pulses the retiring chips and dims the rest, on branches and leaves alike", async () => {
    serve(SPOT);
    ctl.config = { showApps: true };
    renderMap();
    await loaded("Hub");
    const chip = (name: string) => within(chart()).getByLabelText(name);
    // Nothing is dimmed or pulsing before a mark is clicked.
    for (const name of ["Stayer", "LeafStay", "Calm"]) {
      expect(getComputedStyle(chip(name)).opacity).toBe("");
      expect(getComputedStyle(chip(name)).animation).toBe("");
    }

    clickRetirementMark();

    await waitFor(() =>
      expect(getComputedStyle(within(chart()).getByLabelText("Retiree")).animation).toBe(PULSE),
    );
    expect(getComputedStyle(chip("LeafRetiree")).animation).toBe(PULSE);
    expect(getComputedStyle(chip("Retiree")).opacity).toBe("");
    expect(getComputedStyle(chip("LeafRetiree")).opacity).toBe("");
    for (const name of ["Stayer", "LeafStay", "Calm"]) {
      expect(getComputedStyle(chip(name)).opacity).toBe("0.3");
      expect(getComputedStyle(chip(name)).animation).toBe("");
    }
  });

  it("with chips hidden, pulses the boxes that would hold them", async () => {
    serve(SPOT);
    renderMap();
    await loaded("Hub");
    const box = (name: string) => header(name).parentElement as HTMLElement;
    expect(getComputedStyle(box("Hub")).animation).toBe("");

    clickRetirementMark();

    await waitFor(() => expect(getComputedStyle(box("Hub")).animation).toBe(PULSE));
    expect(getComputedStyle(box("Spoke")).animation).toBe(PULSE);
    expect(getComputedStyle(box("Quiet")).animation).toBe("");
  });
});
