/**
 * Mutation-hardening for PortfolioReport.tsx, lines 1325 to the end: the table
 * view and its sort, the print-parameter summary, the toolbar menus and filter
 * sections, the legend, the AI insights panel, the chart's empty states and
 * ungrouped section, the time-travel spotlight on chips and rows, and the group
 * drawer. Every assertion is on what a reader sees, or on what the report hands
 * to a collaborator (the print summary, the AI request).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

type SliderProps = {
  onMilestoneCardClick?: (card: { id: string; name: string; kind: string }) => void;
};

const state = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  loadedConfig: null as unknown,
  savedReportName: null as string | null,
  timelineDate: null as number | null,
  printParam: null as { label: string; value: string } | null,
  aiEnabled: false,
  sliderProps: [] as SliderProps[],
}));

vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: (key: string) => ({
    savedReport: null,
    savedReportName: state.savedReportName,
    saveDialogOpen: false,
    setSaveDialogOpen: () => {},
    loadedConfig: state.loadedConfig,
    consumeConfig: () => state.config,
    resetSavedReport: () => {},
    persistConfig: () => {},
    resetAll: () => {},
    reportType: key,
  }),
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({ chartRef: createRef(), thumbnail: undefined, captureAndSave: () => {} }),
}));
vi.mock("@/hooks/useTimeline", () => ({
  useTimeline: () => {
    const now = Date.now();
    const at = state.timelineDate ?? now;
    return {
      timelineDate: at,
      setTimelineDate: () => {},
      todayMs: now,
      isTimeTraveling: at !== now,
      persistValue: undefined,
      printParam: state.printParam,
      restore: () => {},
      reset: () => {},
    };
  },
}));
vi.mock("@/hooks/useAiStatus", async () => ({
  ...(await vi.importActual<typeof import("@/hooks/useAiStatus")>("@/hooks/useAiStatus")),
  useAiStatus: () => ({ aiStatus: { portfolio_insights_enabled: state.aiEnabled } }),
}));
vi.mock("@/components/TimelineSlider", () => ({
  default: (props: SliderProps) => {
    state.sliderProps.push(props);
    return <div data-testid="timeline-slider" />;
  },
}));
// Aliased, not "./SaveReportDialog": the mutation harness runs a copy of the
// report from another directory, and only the resolved path matches both.
vi.mock("@/features/reports/SaveReportDialog", () => ({ default: () => null }));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: (props: { cardId: string | null; open: boolean }) =>
    props.open ? <div data-testid="side-panel">{props.cardId}</div> : null,
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { APPLICATION_TYPE, makeCardType } from "@/test/fixtures/metamodel";
import PortfolioReport from "./PortfolioReport";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const ORG_TYPE = makeCardType({ key: "Organization", label: "Organization", icon: "corporate_fare", has_hierarchy: true });
const PROVIDER_TYPE = makeCardType({ key: "Provider", label: "Provider", icon: "storefront" });
const BP_TYPE = makeCardType({ key: "BusinessProcess", label: "Business Process", icon: "route" });
const METAMODEL = [APPLICATION_TYPE, ORG_TYPE, PROVIDER_TYPE, BP_TYPE];

type Item = {
  id: string;
  name: string;
  subtype?: string;
  attributes?: Record<string, unknown>;
  lifecycle?: Record<string, string>;
  relations: Record<string, unknown>[];
  org_ids: string[];
  tag_ids?: string[];
};

const rel = (relation_type: string, related_id: string, related_name: string, related_type: string, attributes?: Record<string, unknown>) => ({
  relation_type,
  related_id,
  related_name,
  related_type,
  ...(attributes ? { attributes } : {}),
});
const owns = (id: string, name: string, usage?: string) =>
  rel("relOrgOwnsApp", id, name, "Organization", usage ? { usage } : undefined);
const uses = (id: string, name: string) => rel("relOrgUsesApp", id, name, "Organization");
const supplies = () => rel("relProvToApp", "prov-1", "Acme", "Provider");
const app = (id: string, name: string, extra: Partial<Item> = {}): Item => ({
  id,
  name,
  attributes: {},
  lifecycle: {},
  relations: [],
  org_ids: [],
  ...extra,
});

const CRIT = {
  key: "crit",
  label: "Business Criticality",
  type: "single_select",
  options: [
    { key: "high", label: "High", color: "#f44336" },
    { key: "medium", label: "Medium", color: "#ff9800" },
    { key: "low", label: "Low", color: "#4caf50" },
  ],
};
const TIER = { key: "tier", label: "Tier", type: "single_select", options: [{ key: "t1", label: "Tier 1", color: "#000000" }] };

const REL_OWNS = {
  key: "relOrgOwnsApp",
  label: "owns",
  reverse_label: "is owned by",
  source_type_key: "Organization",
  target_type_key: "Application",
  other_type_key: "Organization",
  attributes_schema: [
    {
      key: "usage",
      label: "Usage",
      type: "single_select",
      options: [
        { key: "owner", label: "Owner", color: "#3f51b5" },
        { key: "user", label: "User", color: "#009688" },
      ],
    },
  ],
};
const REL_SUPPLIES = {
  key: "relProvToApp",
  label: "supplies",
  reverse_label: "is supplied by",
  source_type_key: "Provider",
  target_type_key: "Application",
  other_type_key: "Provider",
};

const ORG_MEMBERS = [
  { id: "org-hq", name: "Finance HQ", type: "Organization" },
  { id: "org-pay", name: "Payments Team", type: "Organization", parent_id: "org-hq" },
];

const ITEMS: Item[] = [
  app("erp", "SAP ERP", {
    subtype: "businessApplication",
    attributes: { crit: "high", tier: "t1" },
    lifecycle: { active: "2020-01-01" },
    relations: [owns("org-hq", "Finance HQ", "owner")],
    tag_ids: ["tag-cloud"],
  }),
  app("crm", "Salesforce", {
    subtype: "microservice",
    attributes: { crit: "medium" },
    lifecycle: { active: "2021-01-01", endOfLife: "2099-12-31" },
    relations: [owns("org-pay", "Payments Team", "user"), uses("org-hq", "Finance HQ")],
  }),
  app("tool", "Standalone Tool"),
  app("zeta", "Zeta", { attributes: { crit: "unknownKey" }, relations: [supplies()] }),
];

/** One relation type per related card type, so no per-relation-type axes or facets. */
const PAYLOAD = {
  items: ITEMS,
  fields_schema: [{ section: "Details", fields: [CRIT, TIER] }],
  relation_types: [REL_SUPPLIES, REL_OWNS],
  groupable_types: {
    Organization: ORG_MEMBERS,
    Provider: [{ id: "prov-1", name: "Acme", type: "Provider" }],
  },
  organizations: [],
  tag_groups: [{ id: "g-host", name: "Hosting", mode: "multi", tags: [{ id: "tag-cloud", name: "Cloud" }] }],
};

/** Organization three deep: HQ > Division > Team. */
const NESTED = {
  ...PAYLOAD,
  items: [
    app("n1", "Yankee", { attributes: { crit: "high" }, relations: [owns("team", "Team")] }),
    app("n2", "Xray", { attributes: { crit: "medium" }, relations: [owns("team", "Team")] }),
    app("n3", "Alpha", { attributes: { crit: "high" }, relations: [owns("hq", "HQ")] }),
  ],
  groupable_types: {
    Organization: [
      { id: "hq", name: "HQ", type: "Organization" },
      { id: "div", name: "Division", type: "Organization", parent_id: "hq" },
      { id: "team", name: "Team", type: "Organization", parent_id: "div" },
    ],
  },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const chart = () => document.querySelector(".report-chart-area") as HTMLElement;
const toolbar = () => document.querySelector(".report-toolbar") as HTMLElement;
const legend = () => document.querySelector(".report-legend") as HTMLElement;
const printParams = () => document.querySelector(".report-print-params")?.textContent ?? "";
const filtersToggle = () => screen.getByRole("button", { name: /Filters/ });
const chipLabels = (el: HTMLElement) =>
  Array.from(el.querySelectorAll(".MuiChip-label")).map((c) => c.textContent);

function ui(props: Parameters<typeof PortfolioReport>[0] = {}) {
  return (
    <MemoryRouter>
      <PortfolioReport {...props} />
    </MemoryRouter>
  );
}
function renderPortfolio(props: Parameters<typeof PortfolioReport>[0] = {}) {
  return render(ui(props));
}
/** Render, then wait for a card name the payload is known to show. */
async function renderLoaded(name: string, props: Parameters<typeof PortfolioReport>[0] = {}) {
  const r = renderPortfolio(props);
  await within(document.body).findAllByText(name, {}, { timeout: 5000 });
  return r;
}

async function openMenu(label: RegExp) {
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }, { timeout: 5000 }));
  return screen.findByRole("listbox");
}
async function menuOptions(label: RegExp) {
  const listbox = await openMenu(label);
  const texts = within(listbox).queryAllByRole("option").map((o) => o.textContent);
  fireEvent.keyDown(listbox, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  return texts;
}

/** A promise the test settles by hand, for a request that must stay in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(METAMODEL);
  state.config = null;
  state.loadedConfig = null;
  state.savedReportName = null;
  state.timelineDate = null;
  state.printParam = null;
  state.aiEnabled = false;
  state.sliderProps = [];
  mockApi.on("get", "/reports/app-portfolio*", PAYLOAD);
});

/* ------------------------------------------------------------------ */
/*  Table view                                                         */
/* ------------------------------------------------------------------ */

describe("table view", () => {
  // Data order is deliberately not the order of any column.
  const TABLE = {
    ...PAYLOAD,
    items: [
      app("d", "Delta", {
        subtype: "microservice",
        attributes: { crit: "low", tier: "t1" },
        relations: [owns("org-pay", "Payments Team"), uses("org-hq", "Finance HQ"), supplies()],
      }),
      app("a", "Alpha", { attributes: { crit: "high" }, relations: [owns("org-hq", "Finance HQ")] }),
      app("c", "Charlie", { subtype: "businessApplication", attributes: { tier: "t1" } }),
      app("b", "Bravo", { subtype: "microservice", attributes: { crit: "medium" }, relations: [supplies()] }),
    ],
  };

  const headers = () => screen.getAllByRole("columnheader").map((h) => h.textContent);
  const rows = () =>
    screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
  const names = () => rows().map((r) => r[0]);
  /** "active asc", "idle asc", … for the sortable header at `i`. */
  const sortState = (i: number) => {
    const label = screen.getAllByRole("columnheader")[i].querySelector(".MuiTableSortLabel-root")!;
    const dir = label.classList.contains("MuiTableSortLabel-directionDesc")
      ? "desc"
      : label.classList.contains("MuiTableSortLabel-directionAsc")
        ? "asc"
        : "none";
    return `${label.classList.contains("Mui-active") ? "active" : "idle"} ${dir}`;
  };
  const allSortStates = () => [0, 1, 2, 3].map(sortState);
  const clickHeader = (i: number) =>
    fireEvent.click(screen.getAllByRole("columnheader")[i].querySelector(".MuiTableSortLabel-root")!);

  it("sorts by every sortable column, both ways, and marks the one in use", async () => {
    mockApi.on("get", "/reports/app-portfolio*", TABLE);
    state.config = { view: "table", groupByRaw: "attr:tier", colorBy: "crit" };
    renderPortfolio();
    await screen.findByRole("table", {}, { timeout: 5000 });

    expect(headers()).toEqual(["Name", "Subtype", "Tier", "Business Criticality"]);
    expect(rows()).toEqual([
      ["Alpha", "—", "—", "High"],
      ["Bravo", "Microservice", "—", "Medium"],
      ["Charlie", "Business Application", "Tier 1", "—"],
      ["Delta", "Microservice", "Tier 1", "Low"],
    ]);
    expect(allSortStates()).toEqual(["active asc", "idle asc", "idle asc", "idle asc"]);

    clickHeader(0);
    expect(names()).toEqual(["Delta", "Charlie", "Bravo", "Alpha"]);
    expect(allSortStates()).toEqual(["active desc", "idle asc", "idle asc", "idle asc"]);
    clickHeader(0);
    expect(names()).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);

    // Subtype sorts by the label shown; ties keep their data order.
    clickHeader(1);
    expect(names()).toEqual(["Alpha", "Charlie", "Delta", "Bravo"]);
    expect(allSortStates()).toEqual(["idle asc", "active asc", "idle asc", "idle asc"]);
    clickHeader(1);
    expect(names()).toEqual(["Delta", "Bravo", "Charlie", "Alpha"]);
    expect(allSortStates()).toEqual(["idle asc", "active desc", "idle asc", "idle asc"]);

    clickHeader(2);
    expect(names()).toEqual(["Alpha", "Bravo", "Delta", "Charlie"]);
    expect(allSortStates()).toEqual(["idle asc", "idle asc", "active asc", "idle asc"]);
    clickHeader(2);
    expect(names()).toEqual(["Delta", "Charlie", "Alpha", "Bravo"]);
    expect(allSortStates()).toEqual(["idle asc", "idle asc", "active desc", "idle asc"]);

    // A card with no value sorts first, then the stored keys.
    clickHeader(3);
    expect(names()).toEqual(["Charlie", "Alpha", "Delta", "Bravo"]);
    expect(allSortStates()).toEqual(["idle asc", "idle asc", "idle asc", "active asc"]);
    clickHeader(3);
    expect(names()).toEqual(["Bravo", "Delta", "Alpha", "Charlie"]);
    expect(allSortStates()).toEqual(["idle asc", "idle asc", "idle asc", "active desc"]);
  });

  it("shows the related cards of the group-by type, and only those", async () => {
    mockApi.on("get", "/reports/app-portfolio*", TABLE);
    state.config = { view: "table", groupByRaw: "rel:Organization", colorBy: "crit" };
    renderPortfolio();
    await screen.findByRole("table", {}, { timeout: 5000 });
    expect(headers()).toEqual(["Name", "Subtype", "Organization", "Business Criticality"]);
    expect(rows().map((r) => r[2])).toEqual(["Finance HQ", "—", "—", "Payments Team, Finance HQ"]);
  });

  it.each([
    // Not coloured: no colour column at all. (A saved colour key whose field is gone is
    // not tested: it is never reset today, which is a bug, not behaviour to pin.)
    ["", ["Name", "Subtype", "Tier"]],
  ])("labels the colour column for colorBy %j", async (colorBy, expected) => {
    mockApi.on("get", "/reports/app-portfolio*", TABLE);
    state.config = { view: "table", groupByRaw: "attr:tier", colorBy };
    renderPortfolio();
    await screen.findByRole("table", {}, { timeout: 5000 });
    expect(headers()).toEqual(expected);
    expect(printParams()).not.toContain("Color by");
  });
});

/* ------------------------------------------------------------------ */
/*  The print summary                                                  */
/* ------------------------------------------------------------------ */

describe("print parameters", () => {
  it("names the default axis, colouring and column count", async () => {
    await renderLoaded("Standalone Tool");
    expect(printParams()).toBe("Group by: Business Criticality|Color by: Business Criticality|Columns: 3");
  });

  it("names a chosen axis, the search, the table view and the active filters", async () => {
    state.config = { groupByRaw: "attr:tier", colorBy: "crit", view: "table", search: "a", tagFilterIds: ["tag-cloud"] };
    renderPortfolio();
    await screen.findByRole("table", {}, { timeout: 5000 });
    expect(printParams()).toBe("Group by: Tier|Color by: Business Criticality|Search: a|View: Table|Filters: 1 active");
    expect(within(filtersToggle()).getByLabelText("1 active")).toBeInTheDocument();
  });

  it.each([
    [99, "All levels"],
    [2, "Level 2"],
  ])("names the nested depth %s", async (groupDepth, label) => {
    mockApi.on("get", "/reports/app-portfolio*", NESTED);
    state.config = { groupByRaw: "rel:Organization", nestedGroups: true, groupDepth, colorBy: "" };
    await renderLoaded("Yankee");
    expect(printParams()).toBe(`Group by: Organization|Nested groups: ${label}|Columns: 3`);
    expect(screen.getByRole("combobox", { name: /display depth/i })).toHaveTextContent(label);
  });

  it.each([
    [{ active: "2090-01-01" }, "+1 / −0"],
    [{ active: "2020-01-01", endOfLife: "2095-01-01" }, "+0 / −1"],
  ])("states the transformation up to the travelled date (%j)", async (lifecycle, delta) => {
    state.timelineDate = Date.UTC(2099, 0, 1);
    state.printParam = { label: "Time travel", value: "2099-01-01" };
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      items: [
        app("mover", "Mover", { attributes: { crit: "high" }, lifecycle }),
        app("steady", "Steady", { attributes: { crit: "high" }, lifecycle: { active: "2020-01-01" } }),
      ],
    });
    await renderLoaded("Steady");
    expect(printParams()).toBe(
      "Group by: Business Criticality|Color by: Business Criticality|Time travel: 2099-01-01|" +
        `Transformation: ${delta}|Columns: 3`,
    );
  });

  it("falls back to a generic axis name when there is nothing to group by", async () => {
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      fields_schema: [],
      relation_types: [],
      groupable_types: {},
    });
    await renderLoaded("Zeta");
    expect(printParams()).toBe("Group by: Group|Columns: 3");
    expect(within(chart()).getByText("Not assigned to any Group")).toBeInTheDocument();
    expect(await menuOptions(/group by/i)).toEqual([]);
  });

  it("shows which saved report is open", async () => {
    state.savedReportName = "Quarterly view";
    await renderLoaded("Standalone Tool");
    expect(document.querySelector(".report-saved-banner")).toHaveTextContent("Viewing saved report: Quarterly view");
  });
});

/* ------------------------------------------------------------------ */
/*  Toolbar menus                                                      */
/* ------------------------------------------------------------------ */

describe("toolbar menus", () => {
  it("lists attributes, then related types, under their own headings", async () => {
    await renderLoaded("Standalone Tool");
    expect(await menuOptions(/group by/i)).toEqual([
      "Attributes",
      "tuneBusiness Criticality",
      "tuneTier",
      "Related Types",
      "corporate_fareOrganization",
      "storefrontProvider",
    ]);
  });

  it("omits the related-types heading when nothing is related", async () => {
    mockApi.on("get", "/reports/app-portfolio*", { ...PAYLOAD, relation_types: [], groupable_types: {} });
    await renderLoaded("Standalone Tool");
    expect(await menuOptions(/group by/i)).toEqual(["Attributes", "tuneBusiness Criticality", "tuneTier"]);
    // Nothing related: no "Related By" filters either.
    expect(within(toolbar()).queryByText("Related By")).not.toBeInTheDocument();
  });

  it("offers relation subtypes as colours only while grouped by their type", async () => {
    await renderLoaded("Standalone Tool");
    expect(await menuOptions(/color apps by/i)).toEqual(["No color", "Business Criticality", "Tier"]);
    expect(within(toolbar()).queryByText("Relation Subtypes")).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("combobox", { name: /group by/i }));
    fireEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name: /Organization$/ }));
    await waitFor(() => expect(within(toolbar()).getByText("Relation Subtypes")).toBeInTheDocument());
    expect(await menuOptions(/color apps by/i)).toEqual([
      "No color",
      "Business Criticality",
      "Tier",
      "Relation Subtypes",
      "linkis owned by · Usage",
    ]);
  });

  it("recolours the report when another colour is picked", async () => {
    await renderLoaded("Standalone Tool");
    fireEvent.click(within(await openMenu(/color apps by/i)).getByRole("option", { name: "Tier" }));
    await waitFor(() => expect(within(legend()).getByText("Tier:")).toBeInTheDocument());
    expect(printParams()).toContain("Color by: Tier");
  });

  it("marks the search box with a search glyph", async () => {
    await renderLoaded("Standalone Tool");
    const box = screen.getByRole("textbox", { name: "Search" }).closest(".MuiInputBase-root") as HTMLElement;
    expect(within(box).getByText("search")).toBeInTheDocument();
  });

  it("offers every visible card type, alphabetically, with its icon", async () => {
    const types = [
      BP_TYPE,
      APPLICATION_TYPE,
      makeCardType({ key: "Secret", label: "Secret", is_hidden: true }),
      makeCardType({ key: "Gadget", label: "Gadget", icon: "" }),
      ORG_TYPE,
    ];
    withMetamodel(types);
    const { rerender } = await renderLoaded("Standalone Tool", { showTypeSelector: true });
    expect(await menuOptions(/card type/i)).toEqual([
      "appsApplication",
      "routeBusiness Process",
      "categoryGadget",
      "corporate_fareOrganization",
    ]);

    // A type added to the metamodel later is offered too.
    withMetamodel([...types, makeCardType({ key: "Aardvark", label: "Aardvark", icon: "pets" })]);
    rerender(ui({ showTypeSelector: true }));
    expect((await menuOptions(/card type/i))[0]).toBe("petsAardvark");
  });
});

/* ------------------------------------------------------------------ */
/*  Title, icon and type wording                                       */
/* ------------------------------------------------------------------ */

describe("title and type wording", () => {
  const titleIcon = (heading: HTMLElement) => heading.previousElementSibling as HTMLElement;

  it("keeps the Application wording whatever the type is labelled", async () => {
    withMetamodel([
      makeCardType({ ...APPLICATION_TYPE, label: "Business App", icon: "apps", color: "#aa3300" }),
      ORG_TYPE,
      PROVIDER_TYPE,
    ]);
    await renderLoaded("Standalone Tool");
    const heading = screen.getByRole("heading", { name: "Application Portfolio" });
    expect(titleIcon(heading)).toHaveTextContent("apps");
    expect(titleIcon(heading).style.color).toBe("rgb(170, 51, 0)");
    const statIcon = legend().querySelector(".material-symbols-outlined") as HTMLElement;
    expect(statIcon).toHaveTextContent("apps");
    expect(statIcon.style.color).toBe("rgb(170, 51, 0)");
    expect(legend().textContent).toMatch(/^apps4 applicationswarning/);

    const high = within(chart()).getByText("High").closest("[data-export-row]") as HTMLElement;
    expect(chipLabels(high)).toEqual(["1 app", "SAP ERP"]);
  });

  it("falls back to a generic icon and colour for a type the metamodel does not know", async () => {
    mockApi.on("get", "/reports/app-portfolio?type=Mystery", PAYLOAD);
    await renderLoaded("Standalone Tool", { initialCardType: "Mystery" });
    const heading = screen.getByRole("heading", { name: "Mystery Portfolio" });
    expect(titleIcon(heading)).toHaveTextContent("dashboard");
    expect(titleIcon(heading).style.color).toBe("rgb(15, 126, 181)");
  });

  it("words counts and the empty drawer by the type for any other type", async () => {
    mockApi.on("get", "/reports/app-portfolio?type=Provider", {
      ...PAYLOAD,
      items: [
        app("acme", "Acme Corp", { attributes: { vendorTier: "gold" } }),
        app("globex", "Globex", { attributes: { vendorTier: "gold" } }),
      ],
      fields_schema: [
        {
          section: "Vendor",
          fields: [
            {
              key: "vendorTier",
              label: "Vendor Tier",
              type: "single_select",
              options: [
                { key: "gold", label: "Gold", color: "#ffd700" },
                { key: "silver", label: "Silver", color: "#c0c0c0" },
              ],
            },
          ],
        },
      ],
    });
    await renderLoaded("Globex", { initialCardType: "Provider" });
    expect(legend().textContent).toMatch(/^storefront2 ProviderVendor Tier:/);
    const gold = within(chart()).getByText("Gold").closest("[data-export-row]") as HTMLElement;
    expect(chipLabels(gold)).toEqual(["2 Provider", "Acme Corp", "Globex"]);

    fireEvent.click(within(chart()).getByText("Silver"));
    const panel = await screen.findByRole("presentation");
    expect(within(panel).getByText("No Provider in this group")).toBeInTheDocument();
    expect(within(panel).getByText("Provider (0)")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  Nested depth control                                               */
/* ------------------------------------------------------------------ */

describe("nested depth control", () => {
  it.each([
    // A restored depth deeper than the tree still has an option to show.
    [5, "Level 5", ["Level 1", "Level 2", "Level 3", "Level 4", "Level 5", "All levels"]],
    // "All levels" adds no numbered levels beyond the tree's own.
    [99, "All levels", ["Level 1", "Level 2", "Level 3", "All levels"]],
  ])("offers levels for a restored depth of %s", async (groupDepth, shown, options) => {
    mockApi.on("get", "/reports/app-portfolio*", NESTED);
    state.config = { groupByRaw: "rel:Organization", nestedGroups: true, groupDepth };
    await renderLoaded("Yankee");
    expect(screen.getByRole("combobox", { name: /display depth/i })).toHaveTextContent(shown);
    expect(await menuOptions(/display depth/i)).toEqual(options);
  });
});

/* ------------------------------------------------------------------ */
/*  Filter sections                                                    */
/* ------------------------------------------------------------------ */

describe("filter sections", () => {
  const BP_MEMBERS = [{ id: "bp-1", name: "Order to Cash", type: "BusinessProcess" }];
  const relatedBy = () => within(toolbar()).queryByText("Related By");
  const facet = (name: string) => within(toolbar()).queryByRole("combobox", { name });

  it("shows two relation facets without a fold", async () => {
    await renderLoaded("Standalone Tool");
    expect(relatedBy()).toBeInTheDocument();
    expect(facet("Organization")).toBeInTheDocument();
    expect(facet("Provider")).toBeInTheDocument();
    expect(within(toolbar()).queryByText(/^\d+ more$/)).not.toBeInTheDocument();
    expect(within(toolbar()).queryByText("Less")).not.toBeInTheDocument();
  });

  it("folds a third relation facet behind a More chip, and back", async () => {
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      groupable_types: { ...PAYLOAD.groupable_types, BusinessProcess: BP_MEMBERS },
    });
    await renderLoaded("Standalone Tool");
    expect(facet("Business Process")).not.toBeInTheDocument();
    expect(within(toolbar()).queryByText("Less")).not.toBeInTheDocument();
    const more = within(toolbar()).getByText("1 more").closest(".MuiChip-root") as HTMLElement;
    expect(more).toHaveAttribute("aria-label", "Show 1 more relation filters");

    fireEvent.click(more);
    expect(await within(toolbar()).findByRole("combobox", { name: "Business Process" })).toBeInTheDocument();
    expect(within(toolbar()).queryByText("1 more")).not.toBeInTheDocument();
    fireEvent.click(within(toolbar()).getByText("Less"));
    await waitFor(() => expect(facet("Business Process")).not.toBeInTheDocument());
    expect(within(toolbar()).getByText("1 more")).toBeInTheDocument();
    expect(within(toolbar()).queryByText("Less")).not.toBeInTheDocument();
  });

  it("drops the Less chip when a reloaded type has only two facets", async () => {
    mockApi.on("get", "/reports/app-portfolio?type=Application", {
      ...PAYLOAD,
      groupable_types: { ...PAYLOAD.groupable_types, BusinessProcess: BP_MEMBERS },
    });
    mockApi.on("get", "/reports/app-portfolio?type=Provider", {
      ...PAYLOAD,
      items: [app("acme", "Acme Corp")],
    });
    const { rerender } = await renderLoaded("Standalone Tool", { showTypeSelector: true });
    fireEvent.click(within(toolbar()).getByText("1 more"));
    expect(await within(toolbar()).findByText("Less")).toBeInTheDocument();

    // A saved report naming another type is opened with the facets unfolded.
    state.config = { cardType: "Provider" };
    state.loadedConfig = { id: "provider-report" };
    rerender(ui({ showTypeSelector: true }));
    await within(document.body).findByText("Acme Corp", {}, { timeout: 5000 });
    expect(facet("Provider")).toBeInTheDocument();
    expect(within(toolbar()).queryByText("Less")).not.toBeInTheDocument();
  });

  it.each([
    [PAYLOAD.tag_groups, true],
    [undefined, false],
  ])("shows the tag filter only when there are tag groups (%#)", async (tag_groups, shown) => {
    mockApi.on("get", "/reports/app-portfolio*", { ...PAYLOAD, tag_groups });
    await renderLoaded("Standalone Tool");
    const caption = within(toolbar()).queryByText("Tags", { selector: ".MuiTypography-caption" });
    if (shown) {
      expect(caption).toBeInTheDocument();
      expect(facet("Tags")).toBeInTheDocument();
    } else {
      expect(caption).not.toBeInTheDocument();
      expect(facet("Tags")).not.toBeInTheDocument();
    }
  });

  it("offers a field filter only for fields that have options", async () => {
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      fields_schema: [
        {
          section: "Details",
          fields: [
            CRIT,
            { key: "draft", label: "Draft Field", type: "single_select" },
            { key: "bare", label: "Bare Field", type: "single_select", options: [] },
          ],
        },
      ],
    });
    await renderLoaded("Standalone Tool");
    expect(within(toolbar()).getByText("Fields")).toBeInTheDocument();
    expect(facet("Business Criticality")).toBeInTheDocument();
    expect(facet("Draft Field")).not.toBeInTheDocument();
    expect(facet("Bare Field")).not.toBeInTheDocument();
  });

  it("has no Fields section when no field has options", async () => {
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      fields_schema: [
        {
          section: "Details",
          fields: [
            { key: "draft", label: "Draft Field", type: "single_select" },
            { key: "bare", label: "Bare Field", type: "single_select", options: [] },
          ],
        },
      ],
    });
    await renderLoaded("Standalone Tool");
    expect(within(toolbar()).queryByText("Fields")).not.toBeInTheDocument();
    expect(facet("Bare Field")).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  Legend                                                             */
/* ------------------------------------------------------------------ */

describe("legend", () => {
  it("counts the EOL and ungrouped cards and keys every colour", async () => {
    await renderLoaded("Standalone Tool");
    expect(legend()).toHaveTextContent("1 with EOL");
    expect(within(legend()).getByText("2 ungrouped")).toBeInTheDocument();
    expect(within(legend()).getByText("Business Criticality:")).toBeInTheDocument();
    expect(within(legend()).getByText("Not set")).toBeInTheDocument();
  });

  it("leaves out counts of nothing, and a key when not coloured", async () => {
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      items: [app("erp", "SAP ERP", { attributes: { crit: "high" } })],
    });
    state.config = { colorBy: "" };
    await renderLoaded("SAP ERP");
    expect(legend().textContent).toBe("apps1 applications");
  });

  it("has no key for a field whose options carry no colours", async () => {
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      fields_schema: [
        {
          section: "Details",
          fields: [{ key: "plain", label: "Plain", type: "single_select", options: [{ key: "a", label: "A" }] }],
        },
      ],
    });
    await renderLoaded("Standalone Tool");
    expect(printParams()).toContain("Color by: Plain");
    expect(legend().textContent).toBe("apps4 applicationswarning1 with EOL4 ungrouped");
  });
});

/* ------------------------------------------------------------------ */
/*  Chart: empty states and the ungrouped section                      */
/* ------------------------------------------------------------------ */

describe("chart contents", () => {
  const ungroupedSection = () =>
    within(chart()).getByText(/^Not assigned to any/).closest("[style], .MuiBox-root")!.parentElement as HTMLElement;

  it("says so when filters leave a nested tree empty", async () => {
    mockApi.on("get", "/reports/app-portfolio*", NESTED);
    state.config = { groupByRaw: "rel:Organization", nestedGroups: true, search: "zzz" };
    renderPortfolio();
    expect(await screen.findByText("No applications match current filters.", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("shows a populated nested tree rather than the empty state", async () => {
    mockApi.on("get", "/reports/app-portfolio*", NESTED);
    state.config = { groupByRaw: "rel:Organization", nestedGroups: true };
    await renderLoaded("Yankee");
    expect(within(chart()).getByText("HQ")).toBeInTheDocument();
    expect(within(chart()).queryByText(/^No applications/)).not.toBeInTheDocument();
  });

  it("lists every card as ungrouped when none is related to the axis type", async () => {
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      items: [app("a", "Lonely App"), app("b", "Other App")],
    });
    state.config = { groupByRaw: "rel:Organization" };
    await renderLoaded("Lonely App");
    expect(within(chart()).getByText("Not assigned to any Organization")).toBeInTheDocument();
    expect(within(chart()).queryByText(/^No applications/)).not.toBeInTheDocument();
  });

  it("has no ungrouped section when every card is grouped", async () => {
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      items: [app("erp", "SAP ERP", { attributes: { crit: "high" } })],
    });
    await renderLoaded("SAP ERP");
    expect(within(chart()).queryByText(/^Not assigned to any/)).not.toBeInTheDocument();
  });

  it("sorts the ungrouped chips and bars their colours", async () => {
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      items: [
        app("zeta", "Zeta", { attributes: { crit: "unknownKey" } }),
        app("tool", "Standalone Tool"),
        app("erp", "SAP ERP", { attributes: { crit: "high" } }),
      ],
    });
    await renderLoaded("Zeta");
    const section = ungroupedSection();
    expect(chipLabels(section)).toEqual(["2 apps", "Standalone Tool", "Zeta"]);
    // The count is tinted as a warning: these cards are missing from every group.
    const count = within(section).getByText("2 apps").closest(".MuiChip-root") as HTMLElement;
    expect(getComputedStyle(count).backgroundColor).toBe("rgba(237, 108, 2, 0.12)");
    const bar = within(section).getByLabelText(/^(unknownKey|Not set): 1 \(50%\) · (unknownKey|Not set): 1 \(50%\)$/);
    expect(bar.children).toHaveLength(2);
  });

  it("draws no colour bar under the ungrouped cards when not colouring", async () => {
    state.config = { colorBy: "" };
    await renderLoaded("Standalone Tool");
    expect(ungroupedSection().querySelector('[aria-label=""]')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Time-travel spotlight on ungrouped chips and table rows            */
/* ------------------------------------------------------------------ */

describe("spotlight", () => {
  const TT = {
    ...PAYLOAD,
    items: [
      app("new", "New System", { lifecycle: { active: "2090-01-01" } }),
      app("steady", "Steady", { lifecycle: { active: "2020-01-01" } }),
    ],
  };
  const spotlight = () =>
    act(() => state.sliderProps.at(-1)!.onMilestoneCardClick!({ id: "new", name: "New System", kind: "activating" }));

  it("dims the other ungrouped chips while one is spotlit", async () => {
    state.timelineDate = Date.UTC(2099, 0, 1);
    mockApi.on("get", "/reports/app-portfolio*", TT);
    await renderLoaded("Steady");
    const chipOf = (name: string) => within(chart()).getByText(name).closest(".MuiChip-root") as HTMLElement;
    expect(getComputedStyle(chipOf("Steady")).opacity).toBe("");
    expect(getComputedStyle(chipOf("New System")).opacity).toBe("");

    spotlight();
    expect(getComputedStyle(chipOf("New System")).opacity).toBe("");
    expect(getComputedStyle(chipOf("Steady")).opacity).toBe("0.3");
  });

  it("pulses the spotlit table row and fades the rest", async () => {
    state.timelineDate = Date.UTC(2099, 0, 1);
    state.config = { view: "table" };
    mockApi.on("get", "/reports/app-portfolio*", TT);
    await renderLoaded("Steady");
    const rowOf = (name: string) => getComputedStyle(screen.getByText(name).closest("tr")!);
    expect(rowOf("Steady").opacity).toBe("");
    expect(rowOf("Steady").animation).toBe("");

    spotlight();
    expect(rowOf("New System").opacity).toBe("1");
    expect(rowOf("New System").animation).toBe("tl-pulse-row-live 0.65s ease-in-out 2");
    expect(rowOf("Steady").opacity).toBe("0.35");
    expect(rowOf("Steady").animation).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/*  Group drawer                                                       */
/* ------------------------------------------------------------------ */

describe("group drawer", () => {
  const rowsOf = (panel: HTMLElement) =>
    Array.from(panel.querySelectorAll(".MuiListItemButton-root")).map((r) => ({
      name: r.querySelector(".MuiListItemText-primary")?.textContent,
      secondary: r.querySelector(".MuiListItemText-secondary")?.textContent ?? null,
      warn: Array.from(r.querySelectorAll(".material-symbols-outlined")).some((s) => s.textContent === "warning"),
    }));
  /** `value|label` for each metric under the drawer title. */
  const metrics = (panel: HTMLElement) =>
    Array.from(panel.querySelectorAll(".MuiTypography-h6"))
      .slice(1)
      .map((h) => `${h.textContent}|${h.nextElementSibling?.textContent ?? ""}`);

  const DRAWER = {
    ...PAYLOAD,
    items: [
      app("erp", "SAP ERP", { subtype: "businessApplication", attributes: { crit: "high" } }),
      app("cob", "Cobalt", { attributes: { crit: "high" }, lifecycle: { active: "2020-01-01", endOfLife: "2099-12-31" } }),
      app("tool", "Standalone Tool", { subtype: "microservice" }),
      app("zeta", "Zeta", { attributes: { crit: "unknownKey" } }),
    ],
  };

  it("describes a group's cards, counts them and flags the EOL ones", async () => {
    mockApi.on("get", "/reports/app-portfolio*", DRAWER);
    await renderLoaded("Cobalt");
    const high = within(chart()).getByText("High").closest("[data-export-row]") as HTMLElement;
    expect(chipLabels(high)).toEqual(["2 apps", "Cobalt", "SAP ERP"]);
    fireEvent.click(within(chart()).getByText("High"));
    const panel = await screen.findByRole("presentation");

    expect(metrics(panel)).toEqual(["2|applications", "1|EOL Risk"]);
    const eol = Array.from(panel.querySelectorAll(".MuiTypography-h6"))[2];
    expect(getComputedStyle(eol).color).toBe("rgb(230, 81, 0)");
    expect(within(panel).getByText("applications (2)")).toBeInTheDocument();
    expect(rowsOf(panel)).toEqual([
      { name: "Cobalt", secondary: "High · End of Life: 2099-12-31", warn: true },
      { name: "SAP ERP", secondary: "Business Application · High", warn: false },
    ]);
  });

  it("lists the ungrouped cards without an EOL metric", async () => {
    mockApi.on("get", "/reports/app-portfolio*", DRAWER);
    await renderLoaded("Cobalt");
    fireEvent.click(within(chart()).getByText("Not assigned to any Business Criticality"));
    const panel = await screen.findByRole("presentation");
    expect(within(panel).getByText("Ungrouped (not linked to any Business Criticality)")).toBeInTheDocument();
    expect(metrics(panel)).toEqual(["2|applications"]);
    expect(rowsOf(panel)).toEqual([
      // No colour value: the subtype alone.
      { name: "Standalone Tool", secondary: "Microservice", warn: false },
      { name: "Zeta", secondary: "unknownKey", warn: false },
    ]);
  });

  it("colours a flat group's rows by their relation to that group's card", async () => {
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      items: [
        app("erp", "SAP ERP", {
          subtype: "businessApplication",
          relations: [owns("org-hq", "Finance HQ", "owner"), owns("org-pay", "Payments Team", "user")],
        }),
      ],
    });
    state.config = { groupByRaw: "rel:Organization", colorBy: "rel:relOrgOwnsApp::usage" };
    await renderLoaded("SAP ERP");
    fireEvent.click(within(chart()).getByText("Payments Team"));
    const panel = await screen.findByRole("presentation");
    expect(rowsOf(panel)).toEqual([{ name: "SAP ERP", secondary: "Business Application · User", warn: false }]);
  });

  it("lists a nested node's rolled-up cards alphabetically, each coloured by its own organisation", async () => {
    mockApi.on("get", "/reports/app-portfolio*", {
      ...PAYLOAD,
      items: [
        app("y", "Yankee", { relations: [owns("org-hq", "Finance HQ", "owner")] }),
        app("a", "Alpha", { relations: [owns("org-pay", "Payments Team", "user")] }),
        app("b", "Bravo", { relations: [owns("org-hq", "Finance HQ", "owner")] }),
      ],
    });
    state.config = {
      groupByRaw: "rel:Organization",
      nestedGroups: true,
      groupDepth: 1,
      colorBy: "rel:relOrgOwnsApp::usage",
    };
    await renderLoaded("Yankee");
    fireEvent.click(within(chart()).getByText("Finance HQ"));
    const panel = await screen.findByRole("presentation");
    expect(rowsOf(panel)).toEqual([
      { name: "Alpha", secondary: "User", warn: false },
      { name: "Bravo", secondary: "Owner", warn: false },
      { name: "Yankee", secondary: "Owner", warn: false },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/*  AI insights panel                                                  */
/* ------------------------------------------------------------------ */

describe("AI insights panel", () => {
  const aiButton = () => within(screen.getByLabelText("AI Insights")).getByRole("button");
  const panel = () => screen.getByText("AI Portfolio Insights").closest(".MuiCollapse-root") as HTMLElement;
  const posts = () => mockApi.callsOf("post", "/ai/portfolio-insights");
  const NO_INSIGHTS = "No insights could be generated for the current portfolio view.";
  const icons = (name: string) =>
    Array.from(panel().querySelectorAll(".material-symbols-outlined")).filter((s) => s.textContent === name);

  it("renders the structured insights, then folds and unfolds without asking again", async () => {
    state.aiEnabled = true;
    mockApi.on("post", "/ai/portfolio-insights", {
      insights: [
        "a bare string",
        { title: "Consolidate CRM", observation: "Two CRMs overlap.", recommendation: "Retire one." },
        { title: "Keep ERP", observation: "Stable." },
      ],
    });
    await renderLoaded("Standalone Tool");
    // Nothing asked yet: no result, no regenerate.
    expect(screen.queryByText(NO_INSIGHTS)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Regenerate/, hidden: true })).not.toBeInTheDocument();

    fireEvent.click(aiButton());
    expect(await screen.findByText("Consolidate CRM")).toBeInTheDocument();
    expect(icons("lightbulb")).toHaveLength(2);
    // Only an insight with a recommendation gets the recommendation line.
    const card = (title: string) => screen.getByText(title).closest(".MuiPaper-outlined") as HTMLElement;
    expect(within(card("Consolidate CRM")).getByText("subdirectory_arrow_right")).toBeInTheDocument();
    expect(within(card("Keep ERP")).queryByText("subdirectory_arrow_right")).not.toBeInTheDocument();
    expect(screen.queryByText(NO_INSIGHTS)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Regenerate/ })).toBeInTheDocument();
    await waitFor(() => expect(panel()).toHaveClass("MuiCollapse-entered"), { timeout: 3000 });

    fireEvent.click(aiButton());
    await waitFor(() => expect(panel()).toHaveClass("MuiCollapse-hidden"), { timeout: 3000 });
    fireEvent.click(aiButton());
    await waitFor(() => expect(panel()).toHaveClass("MuiCollapse-entered"), { timeout: 3000 });
    expect(posts()).toHaveLength(1);
  });

  it("disables the button while a request is out", async () => {
    state.aiEnabled = true;
    const reply = deferred<unknown>();
    mockApi.on("post", "/ai/portfolio-insights", () => reply.promise);
    await renderLoaded("Standalone Tool");
    fireEvent.click(aiButton());
    expect(aiButton()).toBeDisabled();
    await act(async () => reply.resolve({ insights: [] }));
    expect(await screen.findByText(NO_INSIGHTS)).toBeInTheDocument();
    expect(aiButton()).toBeEnabled();
  });

  it("offers no regenerate after a failed request", async () => {
    state.aiEnabled = true;
    mockApi.fail("post", "/ai/portfolio-insights", 502);
    await renderLoaded("Standalone Tool");
    fireEvent.click(aiButton());
    expect(await screen.findByText("POST /ai/portfolio-insights failed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Regenerate/ })).not.toBeInTheDocument();
    expect(screen.queryByText(NO_INSIGHTS)).not.toBeInTheDocument();
  });

  it("cannot be asked about an empty view", async () => {
    state.aiEnabled = true;
    state.config = { search: "zzz" };
    renderPortfolio();
    // Attribute groups stay on screen, empty.
    expect(await within(document.body).findByText("Medium", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(aiButton()).toBeDisabled();
  });
});
