/**
 * The PPM portfolio board's model, rule by rule: values, cost bars and
 * totals, the timeline window and its bars, the quarter-label overlap rule,
 * filters, groups and URL params, and the print summary and export sheet.
 * Expectations are literals, never the module's own constants, and the label
 * resolvers echo what they were asked, so each assertion reads which label
 * went where. Dates are built in local time, as the model reads them.
 */
import { describe, expect, it } from "vitest";

import type { PpmPortfolioItem, PpmPortfolioReport } from "@/types";
import {
  ALL_LEVELS,
  barModel,
  buildPortfolioExport,
  buildPrintParams,
  costBarModel,
  depthLabel,
  filterItems,
  filterSearchParams,
  groupItems,
  groupLayout,
  groupRowsInOrder,
  groupTotals,
  groupTypeLabel,
  hasAnyCost,
  hasHierarchy,
  healthLabelKey,
  maxTreeDepth,
  money,
  nowPct,
  parseDepth,
  pctOf,
  portfolioWindow,
  projectManager,
  ragColor,
  rowFigures,
  subtypeKeys,
  subGroupId,
  subtypeName,
  subtypeSubGroups,
  parentsWithin,
  bucketBySubtype,
  toggleCollapsed,
  treeRows,
  visibleQuarterLabels,
  type FilterState,
  type PortfolioWindow,
} from "./ppmPortfolioModel";

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}${JSON.stringify(options)}` : key;

const subtypeLabel = (key: string) => `S:${key}`;

const report = (over: Partial<PpmPortfolioReport> = {}): PpmPortfolioReport => ({
  report_date: "2026-09-30",
  schedule_health: "onTrack",
  cost_health: "atRisk",
  scope_health: "offTrack",
  ...over,
});

const item = (over: Partial<PpmPortfolioItem> = {}): PpmPortfolioItem => ({
  id: "i1",
  name: "Initiative",
  subtype: null,
  start_date: null,
  end_date: null,
  group_id: null,
  group_name: null,
  stakeholders: [],
  latest_report: null,
  ...over,
});

/** Eight days, 1–9 January 2026: a day is 12.5 percent, exact in binary. */
const eightDays: PortfolioWindow = {
  start: new Date(2026, 0, 1),
  end: new Date(2026, 0, 9),
  ms: new Date(2026, 0, 9).getTime() - new Date(2026, 0, 1).getTime(),
};

/* ------------------------------------------------------------------ */

describe("money", () => {
  it("reads a withheld or missing figure as zero and keeps a real one", () => {
    expect(money(null)).toBe(0);
    expect(money(undefined)).toBe(0);
    expect(money(0)).toBe(0);
    expect(money(1250)).toBe(1250);
    expect(money(-40)).toBe(-40);
  });
});

describe("projectManager", () => {
  const pm = { display_name: "Pat", role_key: "itProjectManager" };
  const resp = { display_name: "Rita", role_key: "responsible" };
  const other = { display_name: "Olaf", role_key: "observer" };

  it("prefers the IT project manager even when someone responsible is listed first", () => {
    expect(projectManager([other, resp, pm])).toBe(pm);
  });

  it("falls back to whoever is responsible", () => {
    expect(projectManager([other, resp])).toBe(resp);
  });

  it("names nobody when neither role is held, or no one is listed", () => {
    expect(projectManager([other, { display_name: "Nil", role_key: null }])).toBeUndefined();
    expect(projectManager([])).toBeUndefined();
  });
});

describe("ragColor", () => {
  it("colours each known health value", () => {
    expect(ragColor("onTrack")).toBe("#2e7d32");
    expect(ragColor("atRisk")).toBe("#ed6c02");
    expect(ragColor("offTrack")).toBe("#d32f2f");
  });

  it("greys out no report and a value the board does not know", () => {
    expect(ragColor(undefined)).toBe("#bdbdbd");
    expect(ragColor(null)).toBe("#bdbdbd");
    expect(ragColor("")).toBe("#bdbdbd");
    expect(ragColor("unknown")).toBe("#bdbdbd");
  });
});

describe("healthLabelKey", () => {
  it("names each known health value", () => {
    expect(healthLabelKey("onTrack")).toBe("health_onTrack");
    expect(healthLabelKey("atRisk")).toBe("health_atRisk");
    expect(healthLabelKey("offTrack")).toBe("health_offTrack");
  });

  it("reads no report, and an unknown value, as no report", () => {
    expect(healthLabelKey(undefined)).toBe("health_noReport");
    expect(healthLabelKey(null)).toBe("health_noReport");
    expect(healthLabelKey("")).toBe("health_noReport");
    expect(healthLabelKey("unknown")).toBe("health_noReport");
  });
});

describe("subtypeName", () => {
  const defs = [{ key: "project", label: "Project" }, { key: "epic", label: "Epic" }];
  const label = (def: { key: string } | undefined) => (def ? `L:${def.key}` : "");

  it("renders an em-dash for no subtype", () => {
    expect(subtypeName(null, defs, label)).toBe("—");
    expect(subtypeName(undefined, defs, label)).toBe("—");
    expect(subtypeName("", defs, label)).toBe("—");
  });

  it("resolves the subtype's own definition", () => {
    expect(subtypeName("epic", defs, label)).toBe("L:epic");
    expect(subtypeName("project", defs, label)).toBe("L:project");
  });

  it("falls back to the raw key when there is no definition or no label", () => {
    expect(subtypeName("program", defs, label)).toBe("program");
    expect(subtypeName("epic", undefined, label)).toBe("epic");
    expect(subtypeName("epic", defs, () => "")).toBe("epic");
  });
});

/* ------------------------------------------------------------------ */

describe("costBarModel", () => {
  it("shows nothing when both sides are zero", () => {
    expect(costBarModel(0, 0, "CHF")).toBeNull();
  });

  it("fills the track in proportion to the plan", () => {
    expect(costBarModel(250, 500, "CHF")).toEqual({
      overBudget: false,
      fillPct: 50,
      overPct: 50,
      unit: "CHF",
      actualText: "250",
      plannedText: "500",
    });
  });

  it("is not over budget when spend equals the plan", () => {
    expect(costBarModel(500, 500, "CHF")).toMatchObject({
      overBudget: false,
      fillPct: 100,
      overPct: 100,
    });
  });

  it("caps the fill at the track and the over-budget band at 130 percent", () => {
    expect(costBarModel(600, 500, "CHF")).toMatchObject({
      overBudget: true,
      fillPct: 100,
      overPct: 120,
    });
    expect(costBarModel(800, 500, "CHF")).toMatchObject({
      overBudget: true,
      fillPct: 100,
      overPct: 130,
    });
  });

  it("never calls spend against no plan over budget, and draws no fill for it", () => {
    expect(costBarModel(200, 0, "CHF")).toEqual({
      overBudget: false,
      fillPct: 0,
      overPct: 0,
      unit: "CHF",
      actualText: "200",
      plannedText: "0",
    });
  });

  it("draws a plan with nothing spent yet as an empty track", () => {
    expect(costBarModel(0, 500, "CHF")).toMatchObject({ fillPct: 0, actualText: "0" });
  });

  it("switches both figures to thousands once either side reaches a thousand", () => {
    expect(costBarModel(578_000, 900_000, "CHF")).toMatchObject({
      unit: "kCHF",
      actualText: "578",
      plannedText: "900",
    });
  });
});

describe("groupTotals", () => {
  it("sums each figure over the group, reading a withheld one as zero", () => {
    const rows = [
      item({ capex_planned: 100, capex_actual: 40, opex_planned: 10, opex_actual: 5 }),
      item({ capex_planned: 50, capex_actual: null, opex_planned: undefined, opex_actual: 7 }),
    ];
    expect(groupTotals(rows)).toEqual({
      capexPlanned: 150,
      capexActual: 40,
      opexPlanned: 10,
      opexActual: 12,
    });
  });

  it("sums recorded lines only, never a parent's derived figures", () => {
    const parent = item({
      id: "p",
      rollup: {
        descendant_count: 1,
        capex_planned: 100,
        capex_actual: 0,
        opex_planned: 0,
        opex_actual: 0,
      },
    });
    const child = item({ id: "c", parent_id: "p", capex_planned: 100 });
    expect(groupTotals([parent, child])).toEqual({
      capexPlanned: 100,
      capexActual: 0,
      opexPlanned: 0,
      opexActual: 0,
    });
    expect(groupTotals([parent])).toBeNull();
  });

  it("has no totals row when every sum is zero", () => {
    expect(groupTotals([])).toBeNull();
    expect(groupTotals([item(), item({ capex_planned: 0, opex_actual: null })])).toBeNull();
  });

  it.each([
    ["capex_planned", { capexPlanned: 1, capexActual: 0, opexPlanned: 0, opexActual: 0 }],
    ["capex_actual", { capexPlanned: 0, capexActual: 1, opexPlanned: 0, opexActual: 0 }],
    ["opex_planned", { capexPlanned: 0, capexActual: 0, opexPlanned: 1, opexActual: 0 }],
    ["opex_actual", { capexPlanned: 0, capexActual: 0, opexPlanned: 0, opexActual: 1 }],
  ] as const)("keeps the row when only %s is non-zero", (field, totals) => {
    expect(groupTotals([item({ [field]: 1 })])).toEqual(totals);
  });
});

describe("hasAnyCost", () => {
  it.each(["capex_planned", "capex_actual", "opex_planned", "opex_actual"] as const)(
    "shows the cost row when %s is above zero",
    (field) => {
      expect(hasAnyCost(item({ [field]: 1 }))).toBe(true);
    },
  );

  it("shows the cost row for a parent whose only figures are derived", () => {
    expect(
      hasAnyCost(
        item({
          capex_planned: 0,
          rollup: {
            descendant_count: 1,
            capex_planned: 0,
            capex_actual: 0,
            opex_planned: 0,
            opex_actual: 3,
          },
        }),
      ),
    ).toBe(true);
    expect(
      hasAnyCost(
        item({
          capex_planned: 5,
          rollup: {
            descendant_count: 1,
            capex_planned: 0,
            capex_actual: 0,
            opex_planned: 0,
            opex_actual: 0,
          },
        }),
      ),
    ).toBe(false);
  });

  it("hides it when every figure is zero, negative or withheld", () => {
    expect(hasAnyCost(item())).toBe(false);
    expect(
      hasAnyCost(item({ capex_planned: 0, capex_actual: -5, opex_planned: null, opex_actual: 0 })),
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

describe("portfolioWindow", () => {
  it("runs from six months back to the last day of the 14th month ahead", () => {
    const w = portfolioWindow(new Date(2026, 9, 15));
    expect(w.start).toEqual(new Date(2026, 3, 1));
    expect(w.end).toEqual(new Date(2027, 10, 30));
    expect(w.ms).toBe(new Date(2027, 10, 30).getTime() - new Date(2026, 3, 1).getTime());
  });

  it("crosses the year boundary both ways", () => {
    const w = portfolioWindow(new Date(2026, 1, 10));
    expect(w.start).toEqual(new Date(2025, 7, 1));
    expect(w.end).toEqual(new Date(2027, 2, 31));
  });
});

describe("pctOf", () => {
  it("places a date across the window", () => {
    expect(pctOf(eightDays, "2026-01-01")).toBe(0);
    expect(pctOf(eightDays, "2026-01-03")).toBe(25);
    expect(pctOf(eightDays, "2026-01-07")).toBe(75);
    expect(pctOf(eightDays, "2026-01-09")).toBe(100);
  });

  it("clamps a date outside the window to its edge", () => {
    expect(pctOf(eightDays, "2025-12-01")).toBe(0);
    expect(pctOf(eightDays, "2026-03-01")).toBe(100);
  });

  it("has no position for a missing or unparseable date", () => {
    expect(pctOf(eightDays, null)).toBeNull();
    expect(pctOf(eightDays, "not a date")).toBeNull();
  });
});

describe("nowPct", () => {
  it("places now across the window without clamping", () => {
    expect(nowPct(eightDays, new Date(2026, 0, 2))).toBe(12.5);
    expect(nowPct(eightDays, new Date(2025, 11, 31))).toBe(-12.5);
    expect(nowPct(eightDays, new Date(2026, 0, 10))).toBe(112.5);
  });
});

describe("barModel", () => {
  const dated = (start: string | null, end: string | null, health?: string) =>
    item({
      start_date: start,
      end_date: end,
      latest_report: health ? report({ schedule_health: health }) : null,
    });

  it("spans the initiative's dates in the default colour, rounded at both ends", () => {
    expect(barModel(dated("2026-01-03", "2026-01-05"), eightDays)).toEqual({
      left: 25,
      width: 25,
      color: "#1976d2",
      borderRadius: "8px 8px 8px 8px",
      derived: false,
    });
  });

  it("takes the colour of an at-risk or off-track schedule", () => {
    expect(barModel(dated("2026-01-03", "2026-01-05", "atRisk"), eightDays)?.color).toBe("#ed6c02");
    expect(barModel(dated("2026-01-03", "2026-01-05", "offTrack"), eightDays)?.color).toBe(
      "#d32f2f",
    );
    expect(barModel(dated("2026-01-03", "2026-01-05", "onTrack"), eightDays)?.color).toBe(
      "#1976d2",
    );
  });

  it("squares the side the window cuts off, including a start exactly on its edge", () => {
    expect(barModel(dated("2025-12-01", "2026-01-05"), eightDays)?.borderRadius).toBe(
      "0px 8px 8px 0px",
    );
    expect(barModel(dated("2026-01-01", "2026-01-05"), eightDays)?.borderRadius).toBe(
      "0px 8px 8px 0px",
    );
    expect(barModel(dated("2026-01-03", "2026-01-09"), eightDays)?.borderRadius).toBe(
      "8px 0px 0px 8px",
    );
    expect(barModel(dated("2025-12-01", "2026-02-01"), eightDays)?.borderRadius).toBe(
      "0px 0px 0px 0px",
    );
  });

  it("keeps a one-day initiative visible at half a percent", () => {
    expect(barModel(dated("2026-01-03", "2026-01-03"), eightDays)).toMatchObject({
      left: 25,
      width: 0.5,
    });
  });

  it("draws no bar without both dates", () => {
    expect(barModel(dated(null, "2026-01-05"), eightDays)).toBeNull();
    expect(barModel(dated("2026-01-03", null), eightDays)).toBeNull();
  });

  it("spans the dates beneath a parent without its own, and says so", () => {
    const parent = item({
      rollup: {
        descendant_count: 2,
        start_date: "2026-01-02",
        end_date: "2026-01-07",
      },
    });
    expect(barModel(parent, eightDays)).toEqual({
      left: 12.5,
      width: 62.5,
      color: "#1976d2",
      borderRadius: "8px 8px 8px 8px",
      derived: true,
    });
  });
});

describe("visibleQuarterLabels", () => {
  it("hides a label that crowds the last visible one, or runs past the edge", () => {
    const rects = [
      { left: 0, right: 30 },
      { left: 33, right: 60 }, // starts 3px after the last: hidden
      { left: 34, right: 62 }, // exactly the 4px gap after the first: shown
      { left: 70, right: 120 }, // past the right edge: hidden
      { left: 80, right: 100 }, // ends exactly on the edge: shown
    ];
    expect(visibleQuarterLabels(rects, 100)).toEqual([true, false, true, false, true]);
  });

  it("measures the gap from the last label shown, not the last one hidden", () => {
    const rects = [
      { left: 0, right: 30 },
      { left: 31, right: 90 },
      { left: 40, right: 50 },
    ];
    expect(visibleQuarterLabels(rects, 100)).toEqual([true, false, true]);
  });

  it("takes a custom gap", () => {
    expect(
      visibleQuarterLabels(
        [
          { left: 0, right: 30 },
          { left: 30, right: 60 },
        ],
        100,
        0,
      ),
    ).toEqual([true, true]);
  });

  it("shows the first label whatever its position, and has nothing to say about none", () => {
    expect(visibleQuarterLabels([{ left: -50, right: -10 }], 100)).toEqual([true]);
    expect(visibleQuarterLabels([], 100)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */

describe("subtypeKeys", () => {
  it("lists each subtype once, in first-seen order, skipping none", () => {
    const rows = [
      item({ subtype: "project" }),
      item({ subtype: null }),
      item({ subtype: "epic" }),
      item({ subtype: "project" }),
      item({ subtype: "" }),
    ];
    expect(subtypeKeys(rows)).toEqual(["project", "epic"]);
  });
});

describe("filterItems", () => {
  const rows = [
    item({ id: "a", name: "CRM Rollout", subtype: "project" }),
    item({ id: "b", name: "crm sunset", subtype: "epic" }),
    item({ id: "c", name: "ERP", subtype: "project" }),
  ];
  const ids = (list: PpmPortfolioItem[]) => list.map((i) => i.id);

  it("keeps everything with no search and no subtype", () => {
    expect(ids(filterItems(rows, "", ""))).toEqual(["a", "b", "c"]);
  });

  it("matches the name in any case, both ways round", () => {
    expect(ids(filterItems(rows, "crm", ""))).toEqual(["a", "b"]);
    expect(ids(filterItems(rows, "CRM S", ""))).toEqual(["b"]);
  });

  it("narrows to the picked subtype, and combines with the search", () => {
    expect(ids(filterItems(rows, "", "project"))).toEqual(["a", "c"]);
    expect(ids(filterItems(rows, "crm", "project"))).toEqual(["a"]);
  });
});

describe("groupItems", () => {
  it("groups by card, sorted by name, with the ungrouped last under their label", () => {
    const rows = [
      item({ id: "1", group_id: "g-z", group_name: "Zeta" }),
      item({ id: "2" }),
      item({ id: "3", group_id: "g-a", group_name: "Alpha" }),
      item({ id: "4", group_id: "g-z", group_name: "Zeta" }),
      item({ id: "5", group_id: "g-x", group_name: null }),
      item({ id: "6", group_id: null, group_name: "Orphan" }),
    ];
    const groups = groupItems(rows, "No group");
    expect(groups.map(([id, g]) => [id, g.name, g.items.map((i) => i.id)])).toEqual([
      ["g-a", "Alpha", ["3"]],
      ["g-z", "Zeta", ["1", "4"]],
      ["__ungrouped", "No group", ["2", "5", "6"]],
    ]);
  });

  it("adds no ungrouped entry when every initiative has a group", () => {
    const groups = groupItems([item({ group_id: "g", group_name: "G" })], "No group");
    expect(groups.map(([id]) => id)).toEqual(["g"]);
  });

  it("has no groups at all for an empty board", () => {
    expect(groupItems([], "No group")).toEqual([]);
  });
});

describe("toggleCollapsed", () => {
  it("collapses an open group and opens a collapsed one, leaving the old set alone", () => {
    const before = new Set(["a"]);
    const added = toggleCollapsed(before, "b");
    expect([...added].sort()).toEqual(["a", "b"]);
    expect([...toggleCollapsed(added, "a")]).toEqual(["b"]);
    expect([...before]).toEqual(["a"]);
  });
});

describe("filterSearchParams", () => {
  const opening: FilterState = {
    groupBy: "Organization",
    search: "",
    subtype: "",
    initialGroupBy: "Organization",
    initialSubtype: "",
  };
  const params = (prev: string, s: Partial<FilterState>) =>
    filterSearchParams(new URLSearchParams(prev), { ...opening, ...s }).toString();

  it("writes nothing at the opening state, and drops what the URL carried", () => {
    expect(params("", {})).toBe("");
    expect(params("groupBy=Platform&search=crm&subtype=epic", {})).toBe("");
  });

  it("carries each departure from the opening state", () => {
    expect(params("", { groupBy: "Platform", search: "crm", subtype: "epic" })).toBe(
      "groupBy=Platform&search=crm&subtype=epic",
    );
  });

  it("keeps a portal's configured grouping and subtype out of the address bar", () => {
    const portal = { initialGroupBy: "Platform", initialSubtype: "project" };
    expect(params("", { ...portal, groupBy: "Platform", subtype: "project" })).toBe("");
    expect(params("", { ...portal, groupBy: "Organization", subtype: "epic" })).toBe(
      "groupBy=Organization&subtype=epic",
    );
  });

  it("drops a cleared subtype rather than writing an empty one", () => {
    expect(params("subtype=project", { initialSubtype: "project", subtype: "" })).toBe("");
  });

  it("drops an empty grouping", () => {
    expect(params("groupBy=Platform", { groupBy: "" })).toBe("");
  });

  it("keeps every other param, and leaves the previous params untouched", () => {
    const prev = new URLSearchParams("tab=2");
    expect(filterSearchParams(prev, { ...opening, search: "x" }).toString()).toBe("tab=2&search=x");
    expect(prev.toString()).toBe("tab=2");
  });
});

describe("groupTypeLabel", () => {
  const options = [
    {
      type_key: "Organization",
      label: "Organization",
      translations: { label: { de: "Organisation" } },
    },
    { type_key: "Platform", label: "Platform" },
  ];

  it("names the grouping in the user's language", () => {
    expect(groupTypeLabel(options, "Organization", "de")).toBe("Organisation");
    expect(groupTypeLabel(options, "Organization", "fr")).toBe("Organization");
    expect(groupTypeLabel(options, "Platform", "de")).toBe("Platform");
  });

  it("falls back to the raw key for a grouping it does not offer", () => {
    expect(groupTypeLabel(options, "Objective", "de")).toBe("Objective");
  });
});

/* ------------------------------------------------------------------ */

describe("buildPrintParams", () => {
  it("summarises the grouping, the subtype and the search", () => {
    expect(
      buildPrintParams(
        { groupTypeLabel: "Platform", subtype: "epic", search: "crm" },
        t,
        subtypeLabel,
      ),
    ).toEqual([
      { label: "groupBy", value: "Platform" },
      { label: "subtype", value: "S:epic" },
      { label: 'common:actions.search{"defaultValue":"Search"}', value: "crm" },
    ]);
  });

  it("leaves the subtype empty when none is picked", () => {
    expect(
      buildPrintParams({ groupTypeLabel: "Platform", subtype: "", search: "" }, t, subtypeLabel)[1],
    ).toEqual({ label: "subtype", value: "" });
  });
});

describe("buildPortfolioExport", () => {
  const full = item({
    id: "a",
    name: "CRM Rollout",
    subtype: "project",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    capex_planned: 100,
    capex_actual: 40,
    opex_planned: 0,
    opex_actual: 5,
    stakeholders: [
      { display_name: "Rita", role_key: "responsible" },
      { display_name: "Pat", role_key: "itProjectManager" },
    ],
    latest_report: report(),
  });
  const withheld = item({
    id: "b",
    name: "Quiet",
    capex_planned: null,
    capex_actual: null,
    opex_planned: undefined,
    opex_actual: null,
  });
  const chartNode = { nodeName: "DIV" } as unknown as HTMLElement;
  // Built inside each test, never at collection time: Stryker switches a
  // mutant on per test, so a describe-level build would never see one.
  const build = () =>
    buildPortfolioExport(
      {
        groups: [
          ["g", { name: "Sales", items: [full] }],
          ["__ungrouped", { name: "No group", items: [withheld] }],
        ],
        groupTypeLabel: "Organization",
        printParams: [
          { label: "groupBy", value: "Organization" },
          { label: "subtype", value: "" },
          { label: "search", value: "crm" },
        ],
        chartNode,
        layout: { kind: "flat" },
        allItems: [full, withheld],
      },
      t,
      subtypeLabel,
    );

  it("names the workbook, keeps only the filters in use, and paginates per row", () => {
    const data = build();
    expect(data.title).toBe("title");
    expect(data.filterSummary).toEqual([
      { label: "groupBy", value: "Organization" },
      { label: "search", value: "crm" },
    ]);
    expect(data.chartNode).toBe(chartNode);
    expect(data.paginateRowSelector).toBe("[data-export-row]");
    expect(data.sheets.map((s) => s.name)).toEqual(["tabs.portfolio"]);
  });

  it("exports every column the grid shows, typed for the workbook", () => {
    expect(build().sheets[0].columns).toEqual([
      { key: "group", label: "Organization", type: "text" },
      { key: "name", label: "initiativeName", type: "text" },
      { key: "subtype", label: "subtype", type: "text" },
      { key: "pm", label: "projectManager", type: "text" },
      { key: "start", label: "startDate", type: "date" },
      { key: "end", label: "endDate", type: "date" },
      { key: "schedule", label: "health_schedule", type: "text" },
      { key: "cost", label: "health_cost", type: "text" },
      { key: "scope", label: "health_scope", type: "text" },
      { key: "capexPlanned", label: "capex — planned", type: "currency" },
      { key: "capexActual", label: "capex — actual", type: "currency" },
      { key: "opexPlanned", label: "opex — planned", type: "currency" },
      { key: "opexActual", label: "opex — actual", type: "currency" },
      { key: "lastReport", label: 'lastReport{"defaultValue":"Report"}', type: "date" },
      { key: "costsFrom", label: "costsFrom", type: "text" },
      { key: "datesFrom", label: "datesFrom", type: "text" },
    ]);
  });

  it("writes one row per initiative in group order, with its manager and health", () => {
    expect(build().sheets[0].rows[0]).toEqual({
      group: "Sales",
      name: "CRM Rollout",
      subtype: "S:project",
      pm: "Pat",
      start: "2026-01-01",
      end: "2026-12-31",
      schedule: "health_onTrack",
      cost: "health_atRisk",
      scope: "health_offTrack",
      capexPlanned: 100,
      capexActual: 40,
      opexPlanned: 0,
      opexActual: 5,
      lastReport: "2026-09-30",
      costsFrom: "fromOwn",
      datesFrom: "fromOwn",
    });
  });

  it("leaves a withheld cost, an absent person, date or subtype and a missing report empty", () => {
    expect(build().sheets[0].rows[1]).toEqual({
      group: "No group",
      name: "Quiet",
      subtype: "",
      pm: "",
      start: "",
      end: "",
      schedule: "health_noReport",
      cost: "health_noReport",
      scope: "health_noReport",
      capexPlanned: "",
      capexActual: "",
      opexPlanned: "",
      opexActual: "",
      lastReport: "",
      costsFrom: "fromOwn",
      datesFrom: "fromOwn",
    });
  });

  it("exports a parent's derived costs and dates and says where they come from", () => {
    const program = item({
      id: "p",
      name: "Program",
      start_date: null,
      end_date: null,
      capex_planned: 0,
      capex_actual: 0,
      opex_planned: 0,
      opex_actual: 0,
      rollup: {
        descendant_count: 3,
        capex_planned: 300,
        capex_actual: 120,
        opex_planned: 30,
        opex_actual: 12,
        start_date: "2026-02-01",
        end_date: "2027-03-31",
      },
    });
    const half = item({
      id: "h",
      name: "Half",
      start_date: "2026-05-01",
      end_date: "2026-06-30",
      capex_planned: 7,
      rollup: {
        descendant_count: 2,
        capex_planned: null,
        capex_actual: null,
        opex_planned: null,
        opex_actual: null,
        start_date: null,
        end_date: null,
      },
    });
    const rows = buildPortfolioExport(
      {
        groups: [["g", { name: "G", items: [program, half] }]],
        groupTypeLabel: "Organization",
        printParams: [],
        chartNode: null,
        layout: { kind: "flat" },
        allItems: [program, half],
      },
      t,
      subtypeLabel,
    ).sheets[0].rows;
    expect(rows[0]).toMatchObject({
      start: "2026-02-01",
      end: "2027-03-31",
      capexPlanned: 300,
      capexActual: 120,
      opexPlanned: 30,
      opexActual: 12,
      costsFrom: 'fromBeneath{"count":3}',
      datesFrom: 'fromBeneath{"count":3}',
    });
    expect(rows[1]).toMatchObject({
      start: "2026-05-01",
      end: "2026-06-30",
      capexPlanned: 7,
      costsFrom: "fromOwn",
      datesFrom: "fromOwn",
    });
  });
});

describe("rowFigures", () => {
  const own = {
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    capex_planned: 1,
    capex_actual: 2,
    opex_planned: 3,
    opex_actual: 4,
  };
  const noCosts = {
    capex_planned: null,
    capex_actual: null,
    opex_planned: null,
    opex_actual: null,
  };
  const noDates = { start_date: null, end_date: null };

  it("is the row's own data when there is no roll-up", () => {
    expect(rowFigures(item(own))).toEqual({
      capexPlanned: 1,
      capexActual: 2,
      opexPlanned: 3,
      opexActual: 4,
      derivedCosts: false,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      derivedDates: false,
      descendantCount: 0,
    });
  });

  it("takes the derived costs alone when only they are set", () => {
    const f = rowFigures(
      item({
        ...own,
        rollup: {
          descendant_count: 2,
          capex_planned: 10,
          capex_actual: 20,
          opex_planned: 30,
          opex_actual: 40,
          ...noDates,
        },
      }),
    );
    expect(f).toEqual({
      capexPlanned: 10,
      capexActual: 20,
      opexPlanned: 30,
      opexActual: 40,
      derivedCosts: true,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      derivedDates: false,
      descendantCount: 2,
    });
  });

  it("takes the derived dates alone when only they are set", () => {
    const f = rowFigures(
      item({
        ...own,
        rollup: {
          descendant_count: 4,
          ...noCosts,
          start_date: "2025-03-01",
          end_date: null,
        },
      }),
    );
    expect(f).toMatchObject({
      capexPlanned: 1,
      opexActual: 4,
      derivedCosts: false,
      startDate: "2025-03-01",
      endDate: null,
      derivedDates: true,
      descendantCount: 4,
    });
    // An end date alone is a derived span too.
    expect(
      rowFigures(
        item({
          ...own,
          rollup: {
            descendant_count: 1,
            ...noCosts,
            start_date: null,
            end_date: "2027-01-31",
          },
        }),
      ),
    ).toMatchObject({
      startDate: null,
      endDate: "2027-01-31",
      derivedDates: true,
    });
  });

  it("takes both when both are derived", () => {
    const f = rowFigures(
      item({
        ...noDates,
        rollup: {
          descendant_count: 5,
          capex_planned: 0,
          capex_actual: 0,
          opex_planned: 0,
          opex_actual: 9,
          start_date: "2026-02-01",
          end_date: "2026-03-01",
        },
      }),
    );
    expect(f).toEqual({
      capexPlanned: 0,
      capexActual: 0,
      opexPlanned: 0,
      opexActual: 9,
      derivedCosts: true,
      startDate: "2026-02-01",
      endDate: "2026-03-01",
      derivedDates: true,
      descendantCount: 5,
    });
  });

  it("keeps its own data when the roll-up derives nothing", () => {
    expect(
      rowFigures(
        item({
          ...own,
          rollup: { descendant_count: 3, ...noCosts, ...noDates },
        }),
      ),
    ).toMatchObject({
      capexPlanned: 1,
      derivedCosts: false,
      startDate: "2026-01-01",
      derivedDates: false,
      descendantCount: 3,
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Hierarchy and subtype sub-groups                                   */
/* ------------------------------------------------------------------ */

// Program P has projects B and A (out of name order); A has a sub-project S.
// X is a root of its own; Y names a parent that is not on the board.
const tree = () => [
  item({ id: "S", name: "Sub", parent_id: "A", subtype: "epic" }),
  item({ id: "P", name: "Program", subtype: "program" }),
  item({ id: "B", name: "Beta", parent_id: "P", subtype: "project" }),
  item({ id: "A", name: "Alpha", parent_id: "P", subtype: "project" }),
  item({ id: "X", name: "Lone" }),
  item({ id: "Y", name: "Adrift", parent_id: "gone", subtype: "project" }),
];
const shape = (rows: { item: PpmPortfolioItem; depth: number; hasChildren: boolean }[]) =>
  rows.map((r) => `${r.item.id}@${r.depth}${r.hasChildren ? "+" : ""}`);

describe("hasHierarchy", () => {
  it("is true only when some row names a parent", () => {
    expect(hasHierarchy([item({ id: "a" }), item({ id: "b", parent_id: "a" })])).toBe(true);
    expect(hasHierarchy([item({ id: "a" }), item({ id: "b", parent_id: null })])).toBe(false);
    expect(hasHierarchy([item({ id: "a", parent_id: "" })])).toBe(false);
    expect(hasHierarchy([])).toBe(false);
  });
});

describe("treeRows", () => {
  const all = { collapsed: new Set<string>(), maxDepth: ALL_LEVELS };

  it("walks depth first with siblings by name, and makes an absent parent's child a root", () => {
    expect(shape(treeRows(tree(), all))).toEqual([
      "Y@0",
      "X@0",
      "P@0+",
      "A@1+",
      "S@2",
      "B@1",
    ]);
  });

  it("stops at the depth cap, and a row at the cap has no chevron", () => {
    expect(shape(treeRows(tree(), { ...all, maxDepth: 2 }))).toEqual([
      "Y@0",
      "X@0",
      "P@0+",
      "A@1",
      "B@1",
    ]);
    expect(shape(treeRows(tree(), { ...all, maxDepth: 1 }))).toEqual(["Y@0", "X@0", "P@0"]);
    expect(treeRows(tree(), { ...all, maxDepth: 0 })).toEqual([]);
  });

  it("emits nothing below a collapsed parent, and keeps its chevron", () => {
    expect(shape(treeRows(tree(), { ...all, collapsed: new Set(["A"]) }))).toEqual([
      "Y@0",
      "X@0",
      "P@0+",
      "A@1+",
      "B@1",
    ]);
    expect(shape(treeRows(tree(), { ...all, collapsed: new Set(["P"]) }))).toEqual([
      "Y@0",
      "X@0",
      "P@0+",
    ]);
  });

  it("nests only within the items it is given: a parent in another group leaves a root", () => {
    const [sub, , beta] = tree();
    expect(shape(treeRows([sub, beta], all))).toEqual(["B@0", "S@0"]);
  });

  it("returns the very items it was given", () => {
    const items = tree();
    const rows = treeRows(items, all);
    expect(rows.find((r) => r.item.id === "S")!.item).toBe(items[0]);
    expect(rows).toHaveLength(items.length);
  });

  it("shows the members of a cycle as roots rather than losing them", () => {
    const cyclic = [
      item({ id: "a", name: "A", parent_id: "b" }),
      item({ id: "b", name: "B", parent_id: "a" }),
      item({ id: "c", name: "C", parent_id: "b" }),
    ];
    expect(shape(treeRows(cyclic, all))).toEqual(["a@0", "b@0+", "c@1"]);
  });

  it("keeps a child under its parent when a cycle sits higher up", () => {
    const rows = [
      item({ id: "a", name: "A", parent_id: "b" }),
      item({ id: "b", name: "B", parent_id: "a" }),
      item({ id: "c", name: "C", parent_id: "a" }),
      item({ id: "d", name: "D", parent_id: "c" }),
    ];
    expect(shape(treeRows(rows, all))).toEqual(["a@0+", "c@1+", "d@2", "b@0"]);
  });
});

describe("maxTreeDepth", () => {
  it("counts the levels of the deepest chain", () => {
    expect(maxTreeDepth(tree())).toBe(3);
    expect(maxTreeDepth([item({ id: "a" }), item({ id: "b" })])).toBe(1);
    expect(maxTreeDepth([])).toBe(0);
  });
});

describe("parseDepth", () => {
  it("reads a whole number of levels from 1, and anything else as every level", () => {
    expect(parseDepth("2")).toBe(2);
    expect(parseDepth("1")).toBe(1);
    expect(parseDepth(null)).toBe(ALL_LEVELS);
    expect(parseDepth("0")).toBe(ALL_LEVELS);
    expect(parseDepth("-1")).toBe(ALL_LEVELS);
    expect(parseDepth("1.5")).toBe(ALL_LEVELS);
    expect(parseDepth("deep")).toBe(ALL_LEVELS);
  });

  it("is the reports' all-levels value", () => {
    expect(ALL_LEVELS).toBe(99);
  });
});

describe("depthLabel", () => {
  it("names a level, or every level", () => {
    expect(depthLabel(2, t)).toBe('levelN{"n":2}');
    expect(depthLabel(99, t)).toBe("allLevels");
  });
});

describe("parentsWithin", () => {
  it("keeps a parent that is in the set, and nulls one that is absent or missing", () => {
    const items = [
      item({ id: "p", parent_id: null }),
      item({ id: "c", parent_id: "p" }),
      item({ id: "o", parent_id: "elsewhere" }),
      item({ id: "r" }),
    ];
    const parents = parentsWithin(items);
    expect([...parents.entries()]).toEqual([
      ["p", null],
      ["c", "p"],
      ["o", null],
      ["r", null],
    ]);
  });

  it("nulls every member of a cycle, and keeps a child hanging off one", () => {
    const items = [
      item({ id: "a", parent_id: "b" }),
      item({ id: "b", parent_id: "a" }),
      item({ id: "c", parent_id: "a" }),
    ];
    expect([...parentsWithin(items).entries()]).toEqual([
      ["a", null],
      ["b", null],
      ["c", "a"],
    ]);
  });
});

describe("bucketBySubtype", () => {
  it("buckets in metamodel order, unknown next, none last, keeping each bucket's order", () => {
    const items = [
      item({ id: "1", subtype: null }),
      item({ id: "2", subtype: "project" }),
      item({ id: "3", subtype: "custom" }),
      item({ id: "4", subtype: "program" }),
      item({ id: "5", subtype: "project" }),
    ];
    expect(
      bucketBySubtype(items, ["program", "project"]).map(([k, l]) => [k, l.map((i) => i.id)]),
    ).toEqual([
      ["program", ["4"]],
      ["project", ["2", "5"]],
      ["custom", ["3"]],
      [null, ["1"]],
    ]);
  });
});

describe("subtypeSubGroups", () => {
  const label = (key: string | null) => `L:${key ?? "none"}`;

  it("orders sub-groups as the metamodel lists them, unknown ones next, none last", () => {
    const items = [
      item({ id: "1", subtype: null }),
      item({ id: "2", subtype: "project" }),
      item({ id: "3", subtype: "custom" }),
      item({ id: "4", subtype: "program" }),
      item({ id: "5", subtype: "project" }),
      item({ id: "6", subtype: "" }),
    ];
    const subs = subtypeSubGroups("g1", items, ["program", "project"], label);
    expect(subs.map(([id, g]) => [id, g.name, g.items.map((i) => i.id)])).toEqual([
      ["g1::program", "L:program", ["4"]],
      ["g1::project", "L:project", ["2", "5"]],
      ["g1::custom", "L:custom", ["3"]],
      ["g1::", "L:none", ["1", "6"]],
    ]);
  });

  it("keeps several unknown subtypes in first-seen order", () => {
    const items = [item({ id: "1", subtype: "zeta" }), item({ id: "2", subtype: "alpha" })];
    expect(subtypeSubGroups("g", items, [], label).map(([id]) => id)).toEqual([
      "g::zeta",
      "g::alpha",
    ]);
  });

  it("gives each sub-group an id no group or row can carry", () => {
    expect(subGroupId("__ungrouped", "epic")).toBe("__ungrouped::epic");
    expect(subGroupId("g", null)).toBe("g::");
  });
});

describe("groupLayout", () => {
  it("lets the hierarchy win, then the subtype sub-groups, else a flat list", () => {
    expect(groupLayout(true, 2, true, ["a"])).toEqual({ kind: "hierarchy", maxDepth: 2 });
    expect(groupLayout(false, 2, true, ["a"])).toEqual({ kind: "subtype", order: ["a"] });
    expect(groupLayout(false, 2, false, ["a"])).toEqual({ kind: "flat" });
  });
});

describe("groupRowsInOrder", () => {
  it("lists a tree in tree order, ignoring collapse but honouring the depth cap", () => {
    const ids = (layout: Parameters<typeof groupRowsInOrder>[2]) =>
      groupRowsInOrder(tree(), layout).map((i) => i.id);
    expect(ids({ kind: "hierarchy", maxDepth: ALL_LEVELS })).toEqual([
      "Y",
      "X",
      "P",
      "A",
      "S",
      "B",
    ]);
    expect(ids({ kind: "hierarchy", maxDepth: 2 })).toEqual(["Y", "X", "P", "A", "B"]);
    expect(ids({ kind: "subtype", order: ["project", "program"] })).toEqual([
      "B",
      "A",
      "Y",
      "P",
      "S",
      "X",
    ]);
    expect(ids({ kind: "flat" })).toEqual(["S", "P", "B", "A", "X", "Y"]);
  });
});

describe("filterSearchParams — hierarchy and sub-groups", () => {
  const opening: FilterState = {
    groupBy: "Organization",
    search: "",
    subtype: "",
    initialGroupBy: "Organization",
    initialSubtype: "",
  };
  const params = (prev: string, s: Partial<FilterState>) =>
    filterSearchParams(new URLSearchParams(prev), { ...opening, ...s }).toString();

  it("carries the hierarchy, and its depth only when capped", () => {
    expect(params("", { hierarchy: true, depth: ALL_LEVELS })).toBe("hierarchy=1");
    expect(params("", { hierarchy: true, depth: 2 })).toBe("hierarchy=1&depth=2");
  });

  it("drops the depth with the hierarchy off", () => {
    expect(params("hierarchy=1&depth=2", { hierarchy: false, depth: 2 })).toBe("");
  });

  it("carries the subtype sub-groups, unless the hierarchy is on", () => {
    expect(params("", { bySubtype: true })).toBe("bySubtype=1");
    expect(params("bySubtype=1", { bySubtype: true, hierarchy: true, depth: ALL_LEVELS })).toBe(
      "hierarchy=1",
    );
    expect(params("bySubtype=1", { bySubtype: false })).toBe("");
  });
});

describe("buildPrintParams — hierarchy and sub-groups", () => {
  const base = { groupTypeLabel: "Platform", subtype: "", search: "" };

  it("adds the hierarchy and its depth while the tree is on", () => {
    const params = buildPrintParams(
      { ...base, layout: { kind: "hierarchy", maxDepth: 3 } },
      t,
      subtypeLabel,
    );
    expect(params).toHaveLength(4);
    expect(params[3]).toEqual({ label: "showHierarchy", value: 'levelN{"n":3}' });
  });

  it("adds the subtype sub-groups while they are on", () => {
    const params = buildPrintParams(
      { ...base, layout: { kind: "subtype", order: [] } },
      t,
      subtypeLabel,
    );
    expect(params).toHaveLength(4);
    expect(params[3]).toEqual({ label: "subGroupBySubtype", value: "printOn" });
  });

  it("adds nothing for a flat board", () => {
    expect(buildPrintParams({ ...base, layout: { kind: "flat" } }, t, subtypeLabel)).toHaveLength(
      3,
    );
    expect(buildPrintParams(base, t, subtypeLabel)).toHaveLength(3);
  });
});

describe("buildPortfolioExport — hierarchy", () => {
  const build = (
    layout: Parameters<typeof groupRowsInOrder>[1] = { kind: "flat" },
    allItems: PpmPortfolioItem[] = [],
  ) =>
    buildPortfolioExport(
      {
        groups: [["g", { name: "Sales", items: tree() }]],
        groupTypeLabel: "Organization",
        printParams: [],
        chartNode: null,
        layout,
        allItems,
      },
      t,
      subtypeLabel,
    );

  it("adds a Parent column after the name only while the tree is on", () => {
    const keys = (layout?: Parameters<typeof groupRowsInOrder>[1]) =>
      build(layout).sheets[0].columns.map((c) => c.key);
    expect(keys({ kind: "hierarchy", maxDepth: ALL_LEVELS }).slice(0, 4)).toEqual([
      "group",
      "name",
      "parent",
      "subtype",
    ]);
    expect(build({ kind: "hierarchy", maxDepth: ALL_LEVELS }).sheets[0].columns[2]).toEqual({
      key: "parent",
      label: "parentColumn",
      type: "text",
    });
    expect(keys({ kind: "subtype", order: [] })).not.toContain("parent");
    expect(keys()).not.toContain("parent");
  });

  it("writes the rows in tree order, each naming its parent", () => {
    const rows = build({ kind: "hierarchy", maxDepth: ALL_LEVELS }).sheets[0].rows;
    expect(rows.map((r) => [r.name, r.parent])).toEqual([
      ["Adrift", ""],
      ["Lone", ""],
      ["Program", ""],
      ["Alpha", "Program"],
      ["Sub", "Alpha"],
      ["Beta", "Program"],
    ]);
  });

  it("names a parent the filters left off the grid, from the whole board", () => {
    const rows = build(
      { kind: "hierarchy", maxDepth: ALL_LEVELS },
      [item({ id: "gone", name: "Hidden by search" })],
    ).sheets[0].rows;
    expect(rows[0]).toMatchObject({ name: "Adrift", parent: "Hidden by search" });
  });

  it("writes no parent cell without the tree, in sub-group order", () => {
    const rows = build({ kind: "subtype", order: ["program"] }).sheets[0].rows;
    expect(rows.map((r) => r.name)).toEqual(["Program", "Sub", "Beta", "Alpha", "Adrift", "Lone"]);
    expect(rows.every((r) => !("parent" in r))).toBe(true);
  });
});
