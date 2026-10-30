/**
 * Cost report behaviour the coverage-oriented suites ran but never checked
 * (CostReport.test.tsx covers scope + fiscal year, CostReport.branches.test.tsx
 * the branches): the exact print parameters, how a saved configuration is
 * restored and persisted, out-of-order answers, how each treemap tile is drawn
 * and labelled, the table's per-group ordering and shares, and which toolbar
 * controls appear when.
 *
 * jsdom has no canvas, so the chart wrapper is the shared `echartMock`: the
 * tests read the treemap option the page built (tiles, colours, labels,
 * cursor, tooltip, height) and deliver a tile click the way ECharts would.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));
vi.mock("@/hooks/useAuth", () => import("@/test/hooks").then((m) => m.useAuthModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

const saved = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  loadedConfig: null as Record<string, unknown> | null,
  reportTypes: [] as string[],
  setSaveDialogOpen: (() => {}) as (open: boolean) => void,
  resetAll: (() => {}) as () => void,
  persistConfig: (() => {}) as (cfg: Record<string, unknown>) => void,
}));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: (reportType: string) => {
    saved.reportTypes.push(reportType);
    return {
      savedReport: null,
      savedReportName: null,
      saveDialogOpen: false,
      setSaveDialogOpen: saved.setSaveDialogOpen,
      loadedConfig: saved.loadedConfig,
      consumeConfig: () => saved.config,
      resetSavedReport: () => {},
      persistConfig: saved.persistConfig,
      resetAll: saved.resetAll,
      reportType,
    };
  },
}));

vi.mock("@/hooks/useThumbnailCapture", () => ({
  // Saving captures a thumbnail first, then hands over to the page's callback.
  useThumbnailCapture: (onCaptured: () => void) => ({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: () => onCaptured(),
  }),
}));

vi.mock("@/features/reports/SaveReportDialog", () => ({ default: () => null }));

vi.mock("@/components/CardDetailSidePanel", () => ({
  default: (props: { cardId: string | null; open: boolean }) =>
    props.open ? <div data-testid="side-panel">{props.cardId}</div> : null,
}));

vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));

import { mockApi } from "@/test/apiMock";
import { echartState, type CapturedEChart } from "@/test/echartMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeUser, renderWithProviders, userWith } from "@/test/render";
import {
  APPLICATION_TYPE,
  HIDDEN_TYPE,
  IT_COMPONENT_TYPE,
  makeCardType,
  makeField,
  makeOption,
  makeRelationType,
  makeSection,
} from "@/test/fixtures/metamodel";
import CostReport from "./CostReport";
import { createTheme } from "@mui/material/styles";
import { CHART_LABEL_ON_DARK, CHART_LABEL_ON_DARK_MUTED, COST_TREEMAP_COLORS } from "@/theme/tokens";
import { costTooltipHtml } from "./costTreemapOption";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                            */
/* ------------------------------------------------------------------ */

const CONTRACT_TYPE = makeCardType({
  key: "Contract",
  label: "Contract",
  fields_schema: [
    makeSection({
      section: "Money",
      fields: [makeField({ key: "contractValue", label: "Contract Value", type: "cost" })],
    }),
  ],
});

/** Application with a second cost field, so a cost field picker exists. */
const APP_TWO_COSTS = makeCardType({
  ...APPLICATION_TYPE,
  fields_schema: [
    ...APPLICATION_TYPE.fields_schema,
    makeSection({
      section: "Run",
      fields: [makeField({ key: "costRun", label: "Run Cost", type: "cost" })],
    }),
  ],
});

const REL_APP_ITC = makeRelationType({
  key: "relAppToITC",
  source_type_key: "Application",
  target_type_key: "ITComponent",
});
const REL_CONTRACT_APP = makeRelationType({
  key: "relContractToApp",
  source_type_key: "Contract",
  target_type_key: "Application",
});
const REL_ITC_CONTRACT = makeRelationType({
  key: "relItcToContract",
  source_type_key: "ITComponent",
  target_type_key: "Contract",
});
const RELATIONS = [REL_APP_ITC, REL_CONTRACT_APP, REL_ITC_CONTRACT];

const ITEMS = [
  { id: "crm", name: "CRM", cost: 100, attributes: { businessCriticality: "missionCritical" } },
  { id: "web", name: "CRM Web Portal", cost: 20, attributes: { businessCriticality: "bogus" } },
  { id: "erp", name: "ERP", cost: 500, attributes: { businessCriticality: "missionCritical" } },
  { id: "hr", name: "HR", cost: 80, attributes: {} },
];

/** crm → web (child); erp and hr are separate roots. */
const HIERARCHY = [
  { id: "crm", name: "CRM", type: "Application", parent_id: null },
  { id: "web", name: "CRM Web Portal", type: "Application", parent_id: "crm" },
  { id: "erp", name: "ERP", type: "Application", parent_id: null },
  { id: "hr", name: "HR", type: "Application", parent_id: null },
];

const ITC = "ITComponent:licenseCost";
const ITC_SOURCE = { typeKey: "ITComponent", fieldKey: "licenseCost", label: "IT Component · License Cost" };
const ERP_FRAME = { cardId: "erp", cardName: "ERP", sources: [ITC_SOURCE] };

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function renderCost() {
  return render(
    <MemoryRouter>
      <CostReport />
    </MemoryRouter>,
  );
}

const params = (path: string) => new URLSearchParams(path.split("?")[1]);
const treemapCalls = () => mockApi.callsOf("get", "/reports/cost-treemap*").map((c) => c.path);
const lastTreemapParams = () => params(treemapCalls()[treemapCalls().length - 1]);
const toolbar = () => document.querySelector(".report-toolbar") as HTMLElement;
const metricValue = (label: string) =>
  screen.getByText(label).closest(".MuiPaper-root")!.querySelector("h5")!.textContent;

/* eslint-disable @typescript-eslint/no-explicit-any -- an option tree is plain JSON a test digs into */

/** The charts on screen now: a drill unmounts the root treemap, whose slot `echartState` keeps. */
function mountedCharts(): CapturedEChart[] {
  return screen
    .queryAllByTestId("echart")
    .map((el) => echartState.props[Number(el.getAttribute("data-echart"))]);
}

/** A chart's treemap series, and its tiles. */
const seriesOf = (chart: CapturedEChart): any => chart.option.series[0];
const tilesOf = (chart: CapturedEChart): any[] => seriesOf(chart).data;

function chartWithTile(name: string): CapturedEChart | undefined {
  return mountedCharts().find((c) => tilesOf(c).some((d) => d.name === name));
}

/** The tile named `name` on a chart on screen now, if any. */
function tile(name: string): any {
  const chart = chartWithTile(name);
  return chart && tilesOf(chart).find((d) => d.name === name);
}

/** Wait for a chart on screen to draw a tile named `name`. */
function findTile(name: string): Promise<any> {
  return waitFor(() => {
    const d = tile(name);
    expect(d, `a tile named ${name}`).toBeDefined();
    return d;
  });
}

/** Click a tile the way ECharts delivers it: with the tile's own datum. */
async function clickTile(name: string): Promise<void> {
  const datum = await findTile(name);
  const chart = chartWithTile(name)!;
  act(() => chart.onClick!({ name, data: datum }));
}

/** The first chart on screen, once there is one. */
const findChart = async () => (await screen.findAllByTestId("echart"))[0];

/** The root treemap, named after the report. */
const rootChart = () => echartState.byName("Cost Analysis");

/** What the root treemap's tooltip shows for the tile named `name`. */
const tipOf = (name: string): string =>
  rootChart().option.tooltip.formatter({ data: tilesOf(rootChart()).find((d) => d.name === name) });
const drillNav = () => screen.queryByRole("navigation", { name: /drill-down path/i });
const crumbTexts = (nav: HTMLElement) =>
  within(nav)
    .getAllByRole("listitem")
    .map((li) => (li.textContent ?? "").replace(/^home/, ""));
const rowTexts = () => screen.getAllByRole("row").map((r) => r.textContent ?? "");

/** The print-only parameter strip, as [label, value] pairs. */
function printParams(): [string, string][] {
  return Array.from(document.querySelectorAll(".report-print-params > *")).map((el) => {
    const strong = el.querySelector("strong")?.textContent ?? "";
    const rest = (el.textContent ?? "").slice(strong.length).replace(/\|$/, "").trim();
    return [strong.replace(/:$/, ""), rest];
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Let an already-answered request's continuation land. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function pickOption(label: RegExp, option: RegExp) {
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }, { timeout: 5000 }));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
  if (screen.queryByRole("listbox")) {
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  }
}

async function optionsOf(label: RegExp): Promise<string[]> {
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }, { timeout: 5000 }));
  const listbox = await screen.findByRole("listbox");
  const out = within(listbox)
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");
  fireEvent.keyDown(listbox, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  return out;
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  hookState.auth.user = userWith("costs.view");
  withMetamodel([APPLICATION_TYPE, IT_COMPONENT_TYPE, CONTRACT_TYPE], RELATIONS);
  saved.config = null;
  saved.loadedConfig = null;
  saved.reportTypes = [];
  saved.setSaveDialogOpen = vi.fn();
  saved.resetAll = vi.fn();
  saved.persistConfig = vi.fn();
  echartState.reset();

  mockApi.on("get", "/cards*", { items: HIERARCHY, total: HIERARCHY.length });
  mockApi.on("get", "/reports/cost-treemap*", (path: string) => {
    const parent = params(path).get("parent_card_id");
    if (parent) {
      return params(path).get("type") === "ITComponent"
        ? {
            items: [
              { id: `${parent}-db`, name: "Database", cost: 40 },
              { id: `${parent}-os`, name: "OS", cost: 10 },
            ],
            total: 50,
            fiscal_year: 2026,
            fiscal_year_start: 1,
          }
        : { items: [], total: 0 };
    }
    return { items: ITEMS, total: 700, fiscal_year: 2026, fiscal_year_start: 1 };
  });
});

/* ------------------------------------------------------------------ */
/*  Loading and requests                                                */
/* ------------------------------------------------------------------ */

describe("CostReport loading and requests", () => {
  it("shows a spinner, not an empty report, until the first answer arrives", async () => {
    const pending = deferred<unknown>();
    mockApi.on("get", "/reports/cost-treemap*", () => pending.promise);
    renderCost();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("No cost data found.")).not.toBeInTheDocument();
    expect(screen.queryByText("Total Cost")).not.toBeInTheDocument();

    await act(async () => pending.resolve({ items: ITEMS, total: 700 }));
    expect(await findChart()).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("asks for the default cost field from the very first request", async () => {
    renderCost();
    await findChart();
    expect(treemapCalls().length).toBeGreaterThan(0);
    for (const path of treemapCalls()) expect(params(path).get("cost_field")).toBe("costTotalAnnual");
  });

  it("sends every report request, root and drilled, with an abort signal", async () => {
    saved.config = { costSources: [ITC], drillStack: [ERP_FRAME] };
    renderCost();
    await findTile("Database");
    const calls = mockApi.api.get.mock.calls.filter(([p]) =>
      String(p).startsWith("/reports/cost-treemap"),
    );
    const root = calls.find(([p]) => !String(p).includes("parent_card_id"));
    const drilled = calls.find(([p]) => String(p).includes("parent_card_id"));
    expect((root?.[1] as { signal?: unknown } | undefined)?.signal).toBeInstanceOf(AbortSignal);
    expect((drilled?.[1] as { signal?: unknown } | undefined)?.signal).toBeInstanceOf(AbortSignal);
  });

  it("ignores a root answer that lands after a newer one", async () => {
    withMetamodel([APP_TWO_COSTS], []);
    const stale = deferred<unknown>();
    mockApi.on("get", "/reports/cost-treemap*", (path: string) =>
      params(path).get("cost_field") === "costRun" ? stale.promise : { items: ITEMS, total: 700 },
    );
    renderCost();
    await findTile("ERP");
    await pickOption(/cost field/i, /Run Cost/);
    await waitFor(() => expect(lastTreemapParams().get("cost_field")).toBe("costRun"));
    await pickOption(/cost field/i, /Total Annual Cost/);
    await waitFor(() => expect(lastTreemapParams().get("cost_field")).toBe("costTotalAnnual"));
    await settle();

    await act(async () => stale.resolve({ items: [{ id: "old", name: "Stale", cost: 999 }], total: 999 }));
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
    expect(tile("Stale")).toBeUndefined();
    expect(tile("ERP")).toBeDefined();
  });

  it("ignores a drilled answer that lands after the user went back to the root", async () => {
    saved.config = { costSources: [ITC] };
    const late = deferred<unknown>();
    mockApi.on("get", "/reports/cost-treemap*", (path: string) =>
      params(path).get("parent_card_id") ? late.promise : { items: ITEMS, total: 700 },
    );
    renderCost();
    await clickTile("ERP");
    const nav = await screen.findByRole("navigation", { name: /drill-down path/i });
    await waitFor(() => expect(lastTreemapParams().get("parent_card_id")).toBe("erp"));
    fireEvent.click(within(nav).getByRole("button", { name: /All Application/ }));
    await waitFor(() => expect(lastTreemapParams().get("parent_card_id")).toBeNull());
    await settle();

    await act(async () =>
      late.resolve({ items: [{ id: "db", name: "Database", cost: 40 }], total: 40 }),
    );
    expect(screen.queryByText("Database")).not.toBeInTheDocument();
    expect(tile("Database")).toBeUndefined();
    expect(tile("ERP")).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Fiscal year                                                         */
/* ------------------------------------------------------------------ */

describe("CostReport fiscal year", () => {
  const chip = () => screen.queryByTestId("cost-fiscal-year");

  it("names no year when the answer gives the year without its start month", async () => {
    mockApi.on("get", "/reports/cost-treemap*", { items: ITEMS, total: 700, fiscal_year: 2026 });
    renderCost();
    await findChart();
    expect(chip()).toBeNull();
    expect(printParams().map(([l]) => l)).not.toContain("Fiscal year");
  });

  it("names no year when the answer gives the start month without the year", async () => {
    mockApi.on("get", "/reports/cost-treemap*", { items: ITEMS, total: 700, fiscal_year_start: 1 });
    renderCost();
    await findChart();
    expect(chip()).toBeNull();
  });

  it("keeps the year already shown when a drilled answer names none", async () => {
    saved.config = { costSources: [ITC] };
    mockApi.on("get", "/reports/cost-treemap*", (path: string) =>
      params(path).get("parent_card_id")
        ? { items: [{ id: "db", name: "Database", cost: 40 }], total: 40 }
        : { items: ITEMS, total: 700, fiscal_year: 2026, fiscal_year_start: 1 },
    );
    renderCost();
    await clickTile("ERP");
    await findTile("Database");
    expect(chip()).toHaveTextContent("Current fiscal year: FY 2026");
  });

  it("takes the year from the drilled answer when the page opens drilled", async () => {
    saved.config = { costSources: [ITC], drillStack: [ERP_FRAME] };
    mockApi.on("get", "/reports/cost-treemap*", (path: string) =>
      params(path).get("parent_card_id")
        ? {
            items: [{ id: "db", name: "Database", cost: 40 }],
            total: 40,
            fiscal_year: 2027,
            fiscal_year_start: 1,
          }
        : { items: ITEMS, total: 700, fiscal_year: 2025, fiscal_year_start: 1 },
    );
    renderCost();
    await findTile("Database");
    await waitFor(() => expect(chip()).toHaveTextContent("Current fiscal year: FY 2027"));
  });

  it("explains the year on hover", async () => {
    renderCost();
    fireEvent.mouseOver(await screen.findByTestId("cost-fiscal-year"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      /Annual costs of the cards live in this fiscal year/,
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Print parameters                                                    */
/* ------------------------------------------------------------------ */

describe("CostReport print parameters", () => {
  it("states only the card type and the fiscal year by default", async () => {
    saved.config = { view: "chart" };
    renderCost();
    await findChart();
    await waitFor(() =>
      expect(printParams()).toEqual([
        ["Type", "Application"],
        ["Fiscal year", "FY 2026"],
      ]),
    );
  });

  it("names a restored card type by its label", async () => {
    saved.config = { cardTypeKey: "ITComponent" };
    renderCost();
    await waitFor(() => expect(lastTreemapParams().get("type")).toBe("ITComponent"));
    await waitFor(() => expect(printParams()[0]).toEqual(["Type", "IT Component"]));
  });

  it("names a card type the metamodel no longer has by its key, and still renders", async () => {
    saved.config = { cardTypeKey: "Gone" };
    renderCost();
    await waitFor(() => expect(lastTreemapParams().get("type")).toBe("Gone"));
    expect(await findChart()).toBeInTheDocument();
    await waitFor(() => expect(printParams()[0]).toEqual(["Type", "Gone"]));
    for (const path of treemapCalls()) expect(params(path).get("cost_field")).not.toBe("undefined");
  });

  it("offers no grouping or source for a card type the metamodel no longer has", async () => {
    // A stale relation type still names the vanished type.
    withMetamodel(
      [APPLICATION_TYPE, IT_COMPONENT_TYPE, CONTRACT_TYPE],
      [
        ...RELATIONS,
        makeRelationType({ key: "relGoneToITC", source_type_key: "Gone", target_type_key: "ITComponent" }),
      ],
    );
    saved.config = { cardTypeKey: "Gone", view: "table" };
    renderCost();
    await waitFor(() => expect(lastTreemapParams().get("type")).toBe("Gone"));
    await screen.findByRole("table");
    expect(screen.queryByRole("combobox", { name: /group by/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /cost source/i })).not.toBeInTheDocument();
  });

  it("states the chosen cost field when the type has several", async () => {
    withMetamodel([APP_TWO_COSTS, IT_COMPONENT_TYPE, CONTRACT_TYPE], RELATIONS);
    renderCost();
    await findChart();
    await waitFor(() =>
      expect(printParams()).toEqual([
        ["Type", "Application"],
        ["Fiscal year", "FY 2026"],
        ["Cost Field", "Total Annual Cost"],
      ]),
    );
    await pickOption(/cost field/i, /Run Cost/);
    await waitFor(() => expect(printParams()).toContainEqual(["Cost Field", "Run Cost"]));
  });

  it("states every summed source, joined, instead of a cost field", async () => {
    withMetamodel([APP_TWO_COSTS, IT_COMPONENT_TYPE, CONTRACT_TYPE], RELATIONS);
    saved.config = { costSources: [ITC, "Contract:contractValue"] };
    renderCost();
    await findChart();
    await waitFor(() =>
      expect(printParams()).toEqual([
        ["Type", "Application"],
        ["Fiscal year", "FY 2026"],
        ["Cost Source", "Contract · Contract Value + IT Component · License Cost"],
      ]),
    );
    // Summing related sources replaces the direct field, so its picker goes.
    expect(screen.queryByRole("combobox", { name: /cost field/i })).not.toBeInTheDocument();
  });

  it("states the grouping and the table view", async () => {
    saved.config = { view: "table", groupBy: "businessCriticality" };
    renderCost();
    await screen.findByRole("table");
    await waitFor(() =>
      expect(printParams()).toEqual([
        ["Type", "Application"],
        ["Fiscal year", "FY 2026"],
        ["Group By", "Business Criticality"],
        ["View", "Table"],
      ]),
    );
  });

  it("states a grouping field it no longer knows by its key and lists the rows ungrouped", async () => {
    saved.config = { view: "table", groupBy: "retired" };
    renderCost();
    await screen.findByRole("table");
    await waitFor(() => expect(printParams()).toContainEqual(["Group By", "retired"]));
    expect(rowTexts().slice(1).map((r) => r.replace(/\$.*/, ""))).toEqual([
      "ERP",
      "CRM",
      "HR",
      "CRM Web Portal",
      "Total",
    ]);
  });

  it("states the scope", async () => {
    saved.config = { scopeIds: ["crm"] };
    renderCost();
    await findChart();
    await waitFor(() => expect(printParams()).toContainEqual(["Scope", "1 card"]));
  });
});

/* ------------------------------------------------------------------ */
/*  Drill-down                                                          */
/* ------------------------------------------------------------------ */

describe("CostReport drill-down", () => {
  it("restores only well-formed saved frames and migrates the legacy shape", async () => {
    saved.config = {
      costSources: [ITC],
      drillStack: [
        {
          cardId: "erp",
          cardName: "ERP",
          sources: [{ typeKey: "ITComponent", fieldKey: "licenseCost", label: "Licences" }],
        },
        { cardId: 5, cardName: "Numeric id", sources: [ITC_SOURCE] },
        { cardId: "n1", cardName: 7, sources: [ITC_SOURCE] },
        { cardId: "n2", sources: [ITC_SOURCE] },
        { cardId: "n3", cardName: "No sources", sources: [] },
        {
          cardId: "n4",
          cardName: "Broken sources",
          sources: [{ typeKey: "ITComponent" }, { fieldKey: "licenseCost" }, null],
        },
        { cardId: "n5", cardName: "Type only", type: "ITComponent" },
        { cardId: "n6", cardName: "Field only", costField: "licenseCost" },
        { cardId: "n7", cardName: "Bare" },
        // Legacy single-source shape, as the current level.
        { cardId: "erp-db", cardName: "Database", type: "ITComponent", costField: "licenseCost" },
      ],
    };
    renderCost();
    const nav = await screen.findByRole("navigation", { name: /drill-down path/i });
    expect(crumbTexts(nav)).toEqual(["All Application", "ERP", "Database"]);
    await waitFor(() => expect(lastTreemapParams().get("parent_card_id")).toBe("erp-db"));
    expect(lastTreemapParams().get("type")).toBe("ITComponent");
    expect(lastTreemapParams().get("cost_field")).toBe("licenseCost");
    // A legacy frame's source is labelled "<type> · <field>".
    expect(await screen.findByText("ITComponent · licenseCost")).toBeInTheDocument();

    // A saved source keeps its own label.
    fireEvent.click(within(nav).getByRole("button", { name: "ERP" }));
    expect(await screen.findByText("Licences")).toBeInTheDocument();
  });

  it("drills with the good sources of a frame and drops the broken ones", async () => {
    saved.config = {
      costSources: [ITC],
      drillStack: [
        { cardId: "erp", cardName: "ERP", sources: [null, { typeKey: "ITComponent", fieldKey: "licenseCost" }] },
      ],
    };
    renderCost();
    await findTile("Database");
    expect(treemapCalls().filter((p) => p.includes("parent_card_id"))).toHaveLength(1);
    expect(screen.getAllByTestId("echart")).toHaveLength(1);
    // A drilled panel is named after its source; an unlabelled one after "<type> · <field>".
    expect(screen.getByRole("img", { name: "ITComponent · licenseCost" })).toBeInTheDocument();
  });

  it("shows the current level as text and pops back to a middle crumb", async () => {
    saved.config = {
      costSources: [ITC],
      drillStack: [
        ERP_FRAME,
        { cardId: "erp-db", cardName: "Database", sources: [ITC_SOURCE] },
        { cardId: "erp-db-db", cardName: "Shard", sources: [ITC_SOURCE] },
      ],
    };
    renderCost();
    const nav = await screen.findByRole("navigation", { name: /drill-down path/i });
    expect(crumbTexts(nav)).toEqual(["All Application", "ERP", "Database", "Shard"]);
    expect(within(nav).queryByRole("button", { name: "Shard" })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(printParams()).toContainEqual(["Drill-down path", "ERP › Database › Shard"]),
    );

    fireEvent.click(within(nav).getByRole("button", { name: "Database" }));
    await waitFor(() => expect(lastTreemapParams().get("parent_card_id")).toBe("erp-db"));
    expect(crumbTexts(nav)).toEqual(["All Application", "ERP", "Database"]);
    expect(within(nav).queryByRole("button", { name: "Database" })).not.toBeInTheDocument();
    await waitFor(() => expect(printParams()).toContainEqual(["Drill-down path", "ERP › Database"]));
  });

  it("names the root crumb after the root card type", async () => {
    saved.config = {
      cardTypeKey: "ITComponent",
      costSources: ["Contract:contractValue"],
      drillStack: [
        {
          cardId: "c1",
          cardName: "Cluster",
          sources: [{ typeKey: "Contract", fieldKey: "contractValue", label: "Contract · Contract Value" }],
        },
      ],
    };
    renderCost();
    const nav = await screen.findByRole("navigation", { name: /drill-down path/i });
    expect(within(nav).getByRole("button", { name: /All IT Component$/ })).toBeInTheDocument();
  });

  it("drops the scope while drilled and brings it back at the root", async () => {
    saved.config = { scopeIds: ["crm"], costSources: [ITC], drillStack: [ERP_FRAME] };
    renderCost();
    await findTile("Database");
    expect(printParams().map(([l]) => l)).not.toContain("Scope");
    expect(mockApi.callsOf("get", "/cards*")).toHaveLength(0);

    fireEvent.click(within(drillNav()!).getByRole("button", { name: /All Application/ }));
    await waitFor(() => expect(printParams()).toContainEqual(["Scope", "1 card"]));
  });

  it("makes only drillable cells clickable and leaves a cell without a card id inert", async () => {
    saved.config = { costSources: [ITC] };
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [
        { id: "erp", name: "ERP", cost: 500 },
        { name: "Unlinked", cost: 50 },
      ],
      total: 550,
    });
    renderCost();
    await findTile("Unlinked");
    // ECharts sets the cursor per series, not per tile: the pointer stands
    // over every tile once the treemap drills, an id-less one included.
    expect(seriesOf(rootChart()).cursor).toBe("pointer");
    expect(tile("ERP").id).toBe("erp");
    expect(tile("Unlinked").id).toBeUndefined();

    await clickTile("Unlinked");
    expect(drillNav()).not.toBeInTheDocument();
    expect(treemapCalls().some((p) => p.includes("parent_card_id"))).toBe(false);
    expect(screen.queryByTestId("side-panel")).not.toBeInTheDocument();
  });

  it("draws no click affordance when there is nothing to drill into", async () => {
    renderCost();
    await findTile("ERP");
    expect(seriesOf(rootChart()).cursor).toBe("default");
  });

  it("drills on a tile click that carries no name, under an empty crumb", async () => {
    saved.config = { costSources: [ITC] };
    renderCost();
    await findTile("ERP");
    act(() => rootChart().onClick!({ data: { id: "erp" } }));
    await waitFor(() => expect(lastTreemapParams().get("parent_card_id")).toBe("erp"));
    expect(crumbTexts(drillNav()!)).toEqual(["All Application", ""]);
  });

  it("ignores a click that hands back no datum", async () => {
    saved.config = { costSources: [ITC] };
    renderCost();
    await findTile("ERP");
    act(() => rootChart().onClick!({ name: "ERP" }));
    expect(drillNav()).not.toBeInTheDocument();
    expect(treemapCalls().some((p) => p.includes("parent_card_id"))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Treemap cells and tooltip                                           */
/* ------------------------------------------------------------------ */

describe("CostReport treemap cells", () => {
  // [name, cost] — costs fix the order, so each tile's palette index too;
  // eleven of them, so the palette wraps once.
  const SIZED: [string, number][] = [
    ["Big", 1100],
    ["W4", 1000],
    ["W3", 900],
    ["H4", 800],
    ["H3", 700],
    ["L51", 600],
    ["L50", 500],
    ["L30", 400],
    ["C71", 300],
    ["ABCDEFGHIJ", 200],
    ["C45", 100],
  ];

  beforeEach(() => {
    mockApi.on("get", "/reports/cost-treemap*", {
      items: SIZED.map(([name, cost]) => ({ id: name.toLowerCase(), name, cost })),
      total: 6600,
    });
  });

  it("draws, labels and prices each tile, hiding only the ones too small to see", async () => {
    renderCost();
    await findTile("Big");
    const series = seriesOf(rootChart());

    // ECharts lays the tiles out and skips any smaller than 4 px²; whether a
    // name or its cost fits is measured by ECharts and truncated, not decided
    // by the page's old width/height thresholds.
    expect(series.visibleMin).toBe(4);
    expect(series.label.show).toBe(true);
    expect(series.label.overflow).toBe("truncate");
    expect(tilesOf(rootChart()).map((d) => [d.name, d.value, d.id])).toEqual(
      SIZED.map(([name, cost]) => [name, cost, name.toLowerCase()]),
    );

    // Each tile reads its name, then its cost on a second, smaller line.
    expect(series.label.formatter(tile("C71"))).toBe("C71\n{value|$300}");
    expect(series.label.formatter(tile("ABCDEFGHIJ"))).toBe("ABCDEFGHIJ\n{value|$200}");
    expect(series.label).toMatchObject({ color: CHART_LABEL_ON_DARK, fontSize: 11, fontWeight: 600 });
    expect(series.label.rich.value).toEqual({ color: CHART_LABEL_ON_DARK_MUTED, fontSize: 10, lineHeight: 16 });
  });

  it("places the label and the cost in the tile's top-left corner", async () => {
    renderCost();
    await findTile("Big");
    const { label } = seriesOf(rootChart());
    expect(label.position).toBe("insideTopLeft");
    expect(label.align).toBe("left");
    expect(label.padding).toEqual([6, 6]);
    expect(label.formatter(tile("Big"))).toBe("Big\n{value|$1100}");
  });

  it("places them in the top-right corner in a right-to-left locale", async () => {
    hookState.isRtl = true;
    renderCost();
    await findTile("Big");
    const { label } = seriesOf(rootChart());
    expect(label.position).toBe("insideTopRight");
    expect(label.align).toBe("right");
  });

  it("separates the tiles with a paper-coloured, rounded border and nothing else to click", async () => {
    renderCost();
    await findTile("Big");
    const series = seriesOf(rootChart());
    expect(series.itemStyle).toEqual({
      borderColor: createTheme().palette.background.paper,
      borderWidth: 2,
      gapWidth: 2,
      borderRadius: 3,
    });
    expect(series).toMatchObject({ type: "treemap", roam: false, nodeClick: false, breadcrumb: { show: false } });
    expect(rootChart().option.animationDuration).toBe(300);
  });

  it("cycles the palette by position", async () => {
    renderCost();
    await findTile("Big");
    const fill = (name: string) => tile(name).itemStyle.color;
    expect(fill("Big")).toBe(COST_TREEMAP_COLORS[0]);
    expect(fill("W4")).toBe(COST_TREEMAP_COLORS[1]);
    expect(fill("ABCDEFGHIJ")).toBe(COST_TREEMAP_COLORS[9]);
    // The eleventh tile wraps back to the first blue.
    expect(fill("C45")).toBe(COST_TREEMAP_COLORS[0]);
    expect(tilesOf(rootChart()).map((d) => d.itemStyle.color)).toEqual(
      SIZED.map((_, i) => COST_TREEMAP_COLORS[i % 10]),
    );
  });
});

describe("CostReport treemap tooltip", () => {
  it("names the hovered card, its cost and its share, and nothing without a datum", async () => {
    renderCost();
    await findTile("ERP");
    // 500 of 700.
    expect(tipOf("ERP")).toBe(
      '<div style="font-weight:700">ERP</div>' +
        '<div style="font-size:12px">$500</div>' +
        '<div style="font-size:12px;opacity:.7">71.4% of total</div>',
    );
    expect(rootChart().option.tooltip.trigger).toBe("item");
    expect(rootChart().option.tooltip.formatter({})).toBe("");
    expect(rootChart().option.tooltip.formatter(undefined)).toBe("");
  });

  it("draws no tile for a card that costs nothing, but prices one if ECharts hands it over", async () => {
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [{ id: "z", name: "Zero", cost: 0 }, { id: "r", name: "Real", cost: 10 }],
      total: 10,
    });
    renderCost();
    await findChart();
    // ECharts cannot lay out a zero area, so the tile is left out of the option.
    expect(tilesOf(rootChart()).map((d: { name: string }) => d.name)).toEqual(["Real"]);
    // The tooltip still reads a zero-cost datum, and leaves the share out when
    // the panel totals nothing.
    const html = '<div style="font-weight:700">Zero</div><div style="font-size:12px">$0</div>';
    expect(
      costTooltipHtml({ name: "Zero", cost: 0 }, { format: (v) => `$${v}`, panelTotal: 0, percentOfTotal: () => "x" }),
    ).toBe(html);
  });

  it("shows the empty state, not a blank chart, when every card costs nothing", async () => {
    mockApi.on("get", "/reports/cost-treemap*", { items: [{ id: "z", name: "Zero", cost: 0 }], total: 0 });
    renderCost();
    expect(await screen.findByText("No cost data found.")).toBeInTheDocument();
    expect(mountedCharts()).toEqual([]);
  });

  it("reads each drilled panel's share against that panel's own total", async () => {
    saved.config = { costSources: [ITC], drillStack: [ERP_FRAME] };
    renderCost();
    const database = await findTile("Database");
    const panel = echartState.byName("IT Component · License Cost");
    // 40 of the panel's 50, not of anything summed across panels.
    expect(panel.option.tooltip.formatter({ data: database })).toContain(">80.0% of total</div>");
  });

  it("escapes a card name before the tooltip renders it as HTML", async () => {
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [{ id: "x", name: "<b>Bold</b> & co", cost: 10 }],
      total: 10,
    });
    renderCost();
    await findTile("<b>Bold</b> & co");
    const html = tipOf("<b>Bold</b> & co");
    expect(html).toContain("&lt;b&gt;Bold&lt;/b&gt; &amp; co");
    expect(html).not.toContain("<b>");
  });
});

/* ------------------------------------------------------------------ */
/*  Permission                                                          */
/* ------------------------------------------------------------------ */

describe("CostReport permission", () => {
  it("restricts a signed-out session, under the report's own title", async () => {
    hookState.auth.user = null;
    renderCost();
    expect(await screen.findByText("Cost data restricted")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cost Analysis" })).toBeInTheDocument();
    expect(screen.getByText(/You don't have permission to view cost reports/)).toBeInTheDocument();
    expect(treemapCalls()).toHaveLength(0);
  });

  it("restricts a user record that carries no permission map", async () => {
    hookState.auth.user = makeUser({ role: "member", permissions: undefined });
    renderCost();
    expect(await screen.findByText("Cost data restricted")).toBeInTheDocument();
  });

  it("shows a spinner, not an empty report, the moment costs.view is granted", async () => {
    hookState.auth.user = userWith("reports.view");
    const pending = deferred<unknown>();
    mockApi.on("get", "/reports/cost-treemap*", () => pending.promise);
    const view = renderCost();
    expect(await screen.findByText("Cost data restricted")).toBeInTheDocument();

    hookState.auth.user = userWith("costs.view");
    view.rerender(
      <MemoryRouter>
        <CostReport />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();
    await waitFor(() => expect(treemapCalls()).toHaveLength(1));
    expect(screen.queryByText("Cost data restricted")).not.toBeInTheDocument();
    expect(screen.queryByText("No cost data found.")).not.toBeInTheDocument();
    expect(screen.queryByText("Total Cost")).not.toBeInTheDocument();

    await act(async () => pending.resolve({ items: ITEMS, total: 700 }));
    expect(await findChart()).toBeInTheDocument();
    expect(metricValue("Total Cost")).toBe("$700");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("forgets the costs it showed when costs.view is withdrawn, so a regrant spins first", async () => {
    const view = renderCost();
    await findChart();
    expect(metricValue("Total Cost")).toBe("$700");
    const page = () => (
      <MemoryRouter>
        <CostReport />
      </MemoryRouter>
    );

    hookState.auth.user = userWith("reports.view");
    view.rerender(page());
    expect(await screen.findByText("Cost data restricted")).toBeInTheDocument();

    const pending = deferred<unknown>();
    mockApi.on("get", "/reports/cost-treemap*", () => pending.promise);
    hookState.auth.user = userWith("costs.view");
    view.rerender(page());
    await waitFor(() => expect(treemapCalls()).toHaveLength(2));
    // The figures from before the withdrawal are not shown as if current.
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).not.toBeInTheDocument();
    expect(screen.queryByText("Total Cost")).not.toBeInTheDocument();

    await act(async () => pending.resolve({ items: [{ id: "n", name: "New", cost: 5 }], total: 5 }));
    expect(await findChart()).toBeInTheDocument();
    expect(metricValue("Total Cost")).toBe("$5");
  });

  it("titles the report", async () => {
    renderCost();
    await findChart();
    expect(screen.getByRole("heading", { name: "Cost Analysis" })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  Saved configuration                                                 */
/* ------------------------------------------------------------------ */

describe("CostReport saved configuration", () => {
  const lastPersisted = () =>
    vi.mocked(saved.persistConfig).mock.calls[vi.mocked(saved.persistConfig).mock.calls.length - 1][0];

  it("persists every parameter at its default when the saved config sets none", async () => {
    saved.config = { view: "chart" };
    renderCost();
    await findChart();
    await waitFor(() =>
      expect(lastPersisted()).toEqual({
        cardTypeKey: "Application",
        costField: "costTotalAnnual",
        costSources: [],
        groupBy: "",
        view: "chart",
        sortK: "cost",
        sortD: "desc",
        drillStack: [],
        scopeIds: [],
      }),
    );
  });

  it("persists a parameter as soon as it changes", async () => {
    renderCost();
    await findChart();
    fireEvent.click(screen.getByRole("button", { name: /table view/i }));
    await screen.findByRole("table");
    await waitFor(() => expect(lastPersisted()).toMatchObject({ view: "table" }));
  });

  it("restores the sort column", async () => {
    saved.config = { view: "table", sortK: "name" };
    renderCost();
    await screen.findByRole("table");
    expect(rowTexts().slice(1, 5).map((r) => r.replace(/\$.*/, ""))).toEqual([
      "HR",
      "ERP",
      "CRM Web Portal",
      "CRM",
    ]);
  });

  it("restores the sort direction", async () => {
    saved.config = { view: "table", sortD: "asc" };
    renderCost();
    await screen.findByRole("table");
    expect(rowTexts().slice(1, 5).map((r) => r.replace(/\$.*/, ""))).toEqual([
      "CRM Web Portal",
      "HR",
      "CRM",
      "ERP",
    ]);
  });

  it("treats an empty legacy cost source as none", async () => {
    saved.config = { costSource: "" };
    renderCost();
    await findChart();
    expect(screen.getByRole("combobox", { name: /cost source/i })).toHaveTextContent(
      "Direct (this card type)",
    );
  });

  it("treats a non-string legacy cost source as none", async () => {
    saved.config = { costSource: 7 };
    renderCost();
    await findChart();
    expect(screen.getByRole("combobox", { name: /cost source/i })).toHaveTextContent(
      "Direct (this card type)",
    );
  });

  it("keeps only string scope ids", async () => {
    saved.config = { scopeIds: ["crm", 5, null] };
    renderCost();
    await findChart();
    await waitFor(() => expect(lastPersisted()).toMatchObject({ scopeIds: ["crm"] }));
  });

  it("keeps the scope of a saved report that names another card type", async () => {
    // The page opens on Application; the report scopes IT Components. The
    // scope is restored for its own type, so the type change cannot drop it.
    saved.config = { cardTypeKey: "ITComponent", scopeIds: ["crm"] };
    renderCost();
    await findChart();
    expect(await within(toolbar()).findByText("1 card")).toBeInTheDocument();
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({ cardTypeKey: "ITComponent", scopeIds: ["crm"] }),
    );
  });

  it("ignores a saved card type that is not a string, keeping the page's type and its scope", async () => {
    // A hand-edited or corrupt config: the type stays on the default and the
    // scope is kept for it.
    saved.config = { cardTypeKey: 7, scopeIds: ["crm"] };
    renderCost();
    await findChart();
    expect(lastTreemapParams().get("type")).toBe("Application");
    expect(await within(toolbar()).findByText("1 card")).toBeInTheDocument();
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({ cardTypeKey: "Application", scopeIds: ["crm"] }),
    );
  });

  it("applies a saved report that finishes loading after the page mounted", async () => {
    const view = renderCost();
    await findChart();
    saved.config = { view: "table" };
    saved.loadedConfig = { view: "table" };
    view.rerender(
      <MemoryRouter>
        <CostReport />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("keeps the default cost field when the saved config names none", async () => {
    // Two cost fields, so the auto-select does not step in and mask the restore.
    withMetamodel([APP_TWO_COSTS], []);
    saved.config = { view: "chart" };
    renderCost();
    await findChart();
    await waitFor(() => expect(lastPersisted()).toMatchObject({ costField: "costTotalAnnual" }));
    for (const path of treemapCalls()) expect(params(path).get("cost_field")).toBe("costTotalAnnual");
  });

  it("restores a cost field other than the type's first", async () => {
    withMetamodel([APP_TWO_COSTS], []);
    saved.config = { costField: "costRun" };
    renderCost();
    await findChart();
    await waitFor(() => expect(lastTreemapParams().get("cost_field")).toBe("costRun"));
    expect(screen.getByRole("combobox", { name: /cost field/i })).toHaveTextContent("Run Cost");
  });
});

/* ------------------------------------------------------------------ */
/*  Reset                                                               */
/* ------------------------------------------------------------------ */

describe("CostReport reset", () => {
  it("clears the cost field, sources, drill and scope", async () => {
    withMetamodel([APP_TWO_COSTS, IT_COMPONENT_TYPE, CONTRACT_TYPE], RELATIONS);
    saved.config = { costField: "costRun", costSources: [ITC], drillStack: [ERP_FRAME], scopeIds: ["crm"] };
    renderCost();
    await findTile("Database");

    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(saved.resetAll).toHaveBeenCalled();
    await waitFor(() => {
      const p = lastTreemapParams();
      expect(p.get("parent_card_id")).toBeNull();
      expect(p.get("cost_field")).toBe("costTotalAnnual");
      expect(p.getAll("aggregate")).toEqual([]);
    });
    expect(drillNav()).not.toBeInTheDocument();
    expect(await screen.findByRole("combobox", { name: /cost source/i })).toHaveTextContent(
      "Direct (this card type)",
    );
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({
          costField: "costTotalAnnual",
          costSources: [],
          drillStack: [],
          scopeIds: [],
        }),
      ),
    );
  });

  it("returns to the Application type", async () => {
    saved.config = { cardTypeKey: "ITComponent" };
    renderCost();
    await waitFor(() => expect(lastTreemapParams().get("type")).toBe("ITComponent"));
    await findChart();
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await waitFor(() => expect(lastTreemapParams().get("type")).toBe("Application"));
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ cardTypeKey: "Application" }),
      ),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Toolbar                                                             */
/* ------------------------------------------------------------------ */

describe("CostReport toolbar", () => {
  it("offers None plus each single-select and yes/no field as a grouping, in table view only", async () => {
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    // The multi-select Regions cannot put a card in one group, so it is not offered.
    expect(await optionsOf(/group by/i)).toEqual(["None", "Business Criticality", "Cloud Hosted"]);

    fireEvent.click(screen.getByRole("button", { name: /chart view/i }));
    await findChart();
    expect(screen.queryByRole("combobox", { name: /group by/i })).not.toBeInTheDocument();
  });

  it("offers no grouping while drilled, even in table view", async () => {
    saved.config = { view: "table", costSources: [ITC], drillStack: [ERP_FRAME] };
    renderCost();
    expect(await screen.findByRole("cell", { name: "Database" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /group by/i })).not.toBeInTheDocument();
  });

  it("drops the grouping picker when the new type has nothing to group by", async () => {
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("combobox", { name: /group by/i });
    await pickOption(/card type/i, /IT Component/);
    await waitFor(() => expect(lastTreemapParams().get("type")).toBe("ITComponent"));
    await waitFor(() =>
      expect(screen.queryByRole("combobox", { name: /group by/i })).not.toBeInTheDocument(),
    );
  });

  it("groups a value no option names by its raw value", async () => {
    const SVC = makeCardType({
      key: "Svc",
      label: "Service",
      fields_schema: [
        makeSection({
          fields: [
            makeField({
              key: "tier",
              label: "Tier",
              type: "single_select",
              options: [makeOption({ key: "silver", label: "Silver" })],
            }),
            makeField({ key: "svcCost", label: "Service Cost", type: "cost" }),
          ],
        }),
      ],
    });
    withMetamodel([APPLICATION_TYPE, SVC], []);
    saved.config = { cardTypeKey: "Svc", view: "table", groupBy: "tier" };
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [
        { id: "g", name: "Gold One", cost: 30, attributes: { tier: "gold" } },
        { id: "n", name: "No Attributes", cost: 10 },
      ],
      total: 40,
    });
    renderCost();
    await screen.findByRole("table");
    await waitFor(() =>
      expect(rowTexts().filter((r) => /\(\d\)/.test(r))).toEqual([
        "gold(1)$3075.0%",
        "Unspecified(1)$1025.0%",
      ]),
    );
  });

  it("groups by a yes/no field as Yes / No / Unspecified", async () => {
    const SVC = makeCardType({
      key: "Svc",
      label: "Service",
      fields_schema: [
        makeSection({
          fields: [
            makeField({ key: "tier", label: "Tier", type: "single_select" }),
            makeField({ key: "managed", label: "Managed", type: "boolean" }),
            makeField({ key: "svcCost", label: "Service Cost", type: "cost" }),
          ],
        }),
      ],
    });
    withMetamodel([APPLICATION_TYPE, SVC], []);
    saved.config = { cardTypeKey: "Svc", view: "table", groupBy: "managed" };
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [
        { id: "y", name: "Managed One", cost: 50, attributes: { managed: true } },
        { id: "f", name: "Self Run", cost: 30, attributes: { managed: false } },
        { id: "l", name: "Legacy Yes", cost: 10, attributes: { managed: "Yes" } },
        { id: "n", name: "No Attributes", cost: 10 },
      ],
      total: 100,
    });
    renderCost();
    await screen.findByRole("table");
    await waitFor(() =>
      expect(rowTexts().filter((r) => /\(\d\)/.test(r))).toEqual([
        "Yes(2)$6060.0%",
        "No(1)$3030.0%",
        "Unspecified(1)$1010.0%",
      ]),
    );
    // A single-select with no options cannot group: only the yes/no field is offered.
    expect(await optionsOf(/group by/i)).toEqual(["None", "Managed"]);
  });

  it("offers each related type's cost field once, never through hidden, unrelated or unknown types", async () => {
    const VENDOR = makeCardType({
      key: "Vendor",
      label: "Vendor",
      fields_schema: [makeSection({ fields: [makeField({ key: "fee", label: "Fee", type: "cost" })] })],
    });
    const SUPPLIER = makeCardType({
      key: "Supplier",
      label: "Supplier",
      fields_schema: [
        makeSection({ fields: [makeField({ key: "supplierCost", label: "Supplier Cost", type: "cost" })] }),
      ],
    });
    withMetamodel(
      [APPLICATION_TYPE, IT_COMPONENT_TYPE, CONTRACT_TYPE, VENDOR, SUPPLIER],
      [
        ...RELATIONS,
        makeRelationType({
          key: "relAppToVendor",
          source_type_key: "Application",
          target_type_key: "Vendor",
          is_hidden: true,
        }),
        makeRelationType({
          key: "relSupplierToContract",
          source_type_key: "Supplier",
          target_type_key: "Contract",
        }),
        makeRelationType({ key: "relAppToGhost", source_type_key: "Application", target_type_key: "Ghost" }),
      ],
    );
    renderCost();
    await findChart();
    expect(await optionsOf(/cost source/i)).toEqual([
      "Contract · Contract Value",
      "IT Component · License Cost",
    ]);
  });

  it("leaves the cost source picker out when no related type carries a cost", async () => {
    withMetamodel([APPLICATION_TYPE], []);
    renderCost();
    await findChart();
    expect(screen.queryByRole("combobox", { name: /cost source/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Sum costs from related cards/)).not.toBeInTheDocument();
  });

  it("explains what summing a source does", async () => {
    renderCost();
    await findChart();
    const help = screen.getByLabelText(/Sum costs from related cards/);
    fireEvent.mouseOver(help);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/Each entry targets a unique/);
  });

  it("lets several sources be ticked in one opening of the picker", async () => {
    renderCost();
    await findChart();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /cost source/i }));
    const listbox = await screen.findByRole("listbox");
    expect(listbox).toHaveAttribute("aria-multiselectable", "true");
    fireEvent.click(within(listbox).getByRole("option", { name: /Contract · Contract Value/ }));
    fireEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", { name: /IT Component · License Cost/ }),
    );
    await waitFor(() =>
      expect(lastTreemapParams().getAll("aggregate")).toEqual([
        "Contract:contractValue",
        "ITComponent:licenseCost",
      ]),
    );
  });

  it("accepts a source the browser autofills into the picker's hidden input", async () => {
    renderCost();
    await findChart();
    const combo = screen.getByRole("combobox", { name: /cost source/i });
    fireEvent.change(combo.parentElement!.querySelector("input")!, { target: { value: ITC } });
    await waitFor(() => expect(lastTreemapParams().getAll("aggregate")).toEqual([ITC]));
    expect(screen.getByRole("combobox", { name: /cost source/i })).toHaveTextContent(
      "IT Component · License Cost",
    );
  });

  it("forgets a source the card type cannot reach, even after switching back", async () => {
    saved.config = { costSources: ["Contract:contractValue"] };
    renderCost();
    await waitFor(() =>
      expect(lastTreemapParams().getAll("aggregate")).toEqual(["Contract:contractValue"]),
    );
    await pickOption(/card type/i, /^Contract$/);
    await waitFor(() => expect(lastTreemapParams().get("type")).toBe("Contract"));
    await pickOption(/card type/i, /^Application$/);
    await waitFor(() => expect(lastTreemapParams().get("type")).toBe("Application"));
    expect(lastTreemapParams().getAll("aggregate")).toEqual([]);
    expect(lastTreemapParams().get("cost_field")).toBe("costTotalAnnual");
  });

  it("offers no cost field picker for a type with a single cost field", async () => {
    renderCost();
    await findChart();
    expect(screen.queryByRole("combobox", { name: /cost field/i })).not.toBeInTheDocument();
  });

  it("survives switching to a type that has no cost field at all", async () => {
    const TEAM = makeCardType({ key: "Team", label: "Team" });
    withMetamodel([APPLICATION_TYPE, TEAM], []);
    renderCost();
    await findChart();
    await pickOption(/card type/i, /^Team$/);
    await waitFor(() => expect(lastTreemapParams().get("type")).toBe("Team"));
    expect(await findChart()).toBeInTheDocument();
  });

  it("never offers a hidden card type", async () => {
    withMetamodel([APPLICATION_TYPE, IT_COMPONENT_TYPE, CONTRACT_TYPE, HIDDEN_TYPE], RELATIONS);
    renderCost();
    await findChart();
    expect(await optionsOf(/card type/i)).toEqual(["Application", "IT Component", "Contract"]);
  });

  it("offers every type to a reports user who may not browse the inventory", async () => {
    renderWithProviders(<CostReport />, { user: userWith("costs.view") });
    await findChart();
    expect(screen.getByRole("combobox", { name: /cost source/i })).toBeInTheDocument();
    expect(await optionsOf(/card type/i)).toEqual(["Application", "IT Component", "Contract"]);
  });
});

/* ------------------------------------------------------------------ */
/*  Tile labels by tile rectangle                                       */
/* ------------------------------------------------------------------ */

describe("CostReport tile labels by tile rectangle", () => {
  /** A stand-in ECharts instance whose treemap lays tile `i` out as `rects[i]`. */
  function fakeChart(rects: Record<number, { width: number; height: number }>) {
    const getItemLayout = vi.fn((i: number) => (rects[i] ? { x: 0, y: 0, ...rects[i] } : undefined));
    const getSeriesByIndex = vi.fn(() => ({ getData: () => ({ getItemLayout }) }));
    return { chart: { getModel: () => ({ getSeriesByIndex }) }, getItemLayout, getSeriesByIndex };
  }
  /** What the chart's series label prints for the tile at `dataIndex`. */
  const labelOf = (chart: CapturedEChart, dataIndex: number) => {
    const d = tilesOf(chart)[dataIndex];
    return seriesOf(chart).label.formatter({ dataIndex, name: d.name, value: d.value });
  };

  beforeEach(() => {
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [
        { id: "big", name: "Big", cost: 1_000_000 },
        { id: "mid", name: "Mid", cost: 95_000 },
        { id: "tiny", name: "Tiny", cost: 1_000 },
      ],
      total: 1_096_000,
    });
  });

  it("hands the chart to the panel, which labels each tile by the rectangle ECharts laid it out in", async () => {
    renderCost();
    await findTile("Big");
    const chart = rootChart();
    expect(typeof chart.onInit).toBe("function");
    const option = chart.option;
    const fake = fakeChart({
      0: { width: 300, height: 100 },
      1: { width: 60, height: 35 },
      2: { width: 48, height: 28 },
    });
    act(() => chart.onInit!(fake.chart));
    // The chart is read at label time, so handing it over rebuilds nothing.
    expect(rootChart().option).toBe(option);
    expect(labelOf(rootChart(), 0)).toBe("Big\n{value|$1000000}");
    expect(labelOf(rootChart(), 1)).toBe("Mid");
    expect(labelOf(rootChart(), 2)).toBe("");
    expect(fake.getSeriesByIndex).toHaveBeenCalledWith(0);
    expect(fake.getItemLayout.mock.calls.map((c) => c[0])).toEqual([0, 1, 2]);
    // No tile carries a label of its own: the series formatter decides.
    expect(tilesOf(rootChart()).filter((d) => "label" in d)).toEqual([]);
  });

  it("re-reads the rectangles on every render ECharts does, as a resize re-lays the tiles", async () => {
    renderCost();
    await findTile("Big");
    const rects: Record<number, { width: number; height: number }> = { 1: { width: 60, height: 35 } };
    act(() => rootChart().onInit!(fakeChart(rects).chart));
    expect(labelOf(rootChart(), 1)).toBe("Mid");
    rects[1] = { width: 120, height: 80 };
    expect(labelOf(rootChart(), 1)).toBe("Mid\n{value|$95000}");
  });

  it("prints every tile's name and cost before the chart is handed over", async () => {
    renderCost();
    await findTile("Big");
    expect(labelOf(rootChart(), 0)).toBe("Big\n{value|$1000000}");
    expect(labelOf(rootChart(), 1)).toBe("Mid\n{value|$95000}");
    expect(labelOf(rootChart(), 2)).toBe("Tiny\n{value|$1000}");
  });

  it("falls back to name and cost when ECharts' internals throw", async () => {
    renderCost();
    await findTile("Big");
    const broken = {
      getModel: () => {
        throw new Error("disposed");
      },
    };
    act(() => rootChart().onInit!(broken));
    expect(labelOf(rootChart(), 2)).toBe("Tiny\n{value|$1000}");
  });

  it("labels each drilled panel by its own chart", async () => {
    mockApi.on("get", "/reports/cost-treemap*", (path: string) => {
      if (!params(path).get("parent_card_id")) return { items: ITEMS, total: 700 };
      return params(path).get("type") === "ITComponent"
        ? { items: [{ id: "db", name: "Database", cost: 40 }, { id: "os", name: "OS", cost: 10 }], total: 50 }
        : { items: [{ id: "lic", name: "Licence", cost: 30 }], total: 30 };
    });
    saved.config = { costSources: [ITC, "Contract:contractValue"], drillStack: [] };
    renderCost();
    await clickTile("ERP");
    await findTile("Database");
    await findTile("Licence");
    const itc = echartState.byName("IT Component · License Cost");
    const contract = echartState.byName("Contract · Contract Value");
    act(() => itc.onInit!(fakeChart({ 0: { width: 48, height: 28 }, 1: { width: 48, height: 28 } }).chart));
    act(() => contract.onInit!(fakeChart({ 0: { width: 60, height: 35 } }).chart));
    expect(labelOf(echartState.byName("IT Component · License Cost"), 0)).toBe("");
    expect(labelOf(echartState.byName("Contract · Contract Value"), 0)).toBe("Licence");
  });
});

/* ------------------------------------------------------------------ */
/*  Summary metrics and panels                                          */
/* ------------------------------------------------------------------ */

describe("CostReport summary and panels", () => {
  it("averages to zero, not NaN, when there is no cost data", async () => {
    mockApi.on("get", "/reports/cost-treemap*", { items: [], total: 0 });
    renderCost();
    expect(await screen.findByText("No cost data found.")).toBeInTheDocument();
    expect(metricValue("Average")).toBe("$0");
    expect(metricValue("Items")).toBe("0");
  });

  it("gives a top driver that costs nothing a zero share", async () => {
    mockApi.on("get", "/reports/cost-treemap*", { items: [{ id: "z", name: "Zero", cost: 0 }], total: 0 });
    renderCost();
    expect(await screen.findByText("$0 (0%)")).toBeInTheDocument();
  });

  it("offers no drill hint over an empty report", async () => {
    saved.config = { costSources: [ITC] };
    mockApi.on("get", "/reports/cost-treemap*", { items: [], total: 0 });
    renderCost();
    expect(await screen.findByText("No cost data found.")).toBeInTheDocument();
    expect(screen.queryByText(/click a rectangle/i)).not.toBeInTheDocument();
  });

  it("gives a single panel the full height", async () => {
    renderCost();
    await findChart();
    expect(mountedCharts().map((c) => c.style?.height)).toEqual([450]);
    // Drawn at the export's pixel ratio, so the saved PNG / PPTX stays crisp.
    expect(rootChart().devicePixelRatio).toBe(2);
    expect(screen.getByRole("img", { name: "Cost Analysis" })).toHaveStyle({ height: "450px" });
  });

  it("shortens the panels when several sources sit side by side", async () => {
    saved.config = { costSources: [ITC, "Contract:contractValue"], drillStack: [] };
    renderCost();
    await clickTile("ERP");
    await findTile("Database");
    // The contract panel is empty, so only the IT Component panel draws a chart.
    expect(mountedCharts().map((c) => c.style?.height)).toEqual([360]);
    expect(echartState.byName("IT Component · License Cost").devicePixelRatio).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*  Table                                                               */
/* ------------------------------------------------------------------ */

describe("CostReport table", () => {
  // Name order, cost order, arrival order and its reverse all differ.
  const GROUP_ITEMS = [
    { id: "a", name: "Alpha", cost: 500, attributes: { businessCriticality: "missionCritical" } },
    { id: "z", name: "Zulu", cost: 10, attributes: { businessCriticality: "missionCritical" } },
    { id: "m", name: "Mango", cost: 900, attributes: { businessCriticality: "missionCritical" } },
  ];

  it("orders cards inside each group by the active sort and shares each of the total", async () => {
    mockApi.on("get", "/reports/cost-treemap*", { items: GROUP_ITEMS, total: 1410 });
    saved.config = { view: "table", groupBy: "businessCriticality" };
    renderCost();
    await screen.findByRole("table");
    await waitFor(() =>
      expect(rowTexts()).toEqual([
        "NameCost% of Total",
        "Mission Critical(3)$1410100.0%",
        "Mango$90063.8%",
        "Alpha$50035.5%",
        "Zulu$100.7%",
        "Total$1410100%",
      ]),
    );
    const names = () => rowTexts().slice(2, 5).map((r) => r.replace(/\$.*/, ""));

    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(names()).toEqual(["Alpha", "Mango", "Zulu"]);
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(names()).toEqual(["Zulu", "Mango", "Alpha"]);
    fireEvent.click(screen.getByRole("button", { name: "Cost" }));
    expect(names()).toEqual(["Zulu", "Alpha", "Mango"]);
  });

  it("lists each card's share of the total", async () => {
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    expect(rowTexts()).toEqual([
      "NameCost% of Total",
      "ERP$50071.4%",
      "CRM$10014.3%",
      "HR$8011.4%",
      "CRM Web Portal$202.9%",
      "Total$700100%",
    ]);
  });

  it("shows a dash for the share when nothing costs anything", async () => {
    mockApi.on("get", "/reports/cost-treemap*", { items: [{ id: "z", name: "Zero", cost: 0 }], total: 0 });
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    expect(rowTexts()).toEqual(["NameCost% of Total", "Zero$0—", "Total$0100%"]);
  });

  it("marks the sorted column and its direction, and flips cost first", async () => {
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    const state = (name: string) => {
      const label = screen.getByRole("button", { name });
      const cls = label.querySelector("svg")?.getAttribute("class") ?? "";
      return [label.classList.contains("Mui-active"), cls.match(/iconDirection(\w*)/)?.[1]];
    };
    expect(state("Cost")).toEqual([true, "Desc"]);
    expect(state("Name")).toEqual([false, "Asc"]);

    // Clicking the active descending column flips it to ascending.
    fireEvent.click(screen.getByRole("button", { name: "Cost" }));
    expect(state("Cost")).toEqual([true, "Asc"]);
    expect(rowTexts().slice(1, 5).map((r) => r.replace(/\$.*/, ""))).toEqual([
      "CRM Web Portal",
      "HR",
      "CRM",
      "ERP",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(state("Name")).toEqual([true, "Asc"]);
    expect(state("Cost")).toEqual([false, "Asc"]);
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(state("Name")).toEqual([true, "Desc"]);
    expect(state("Cost")).toEqual([false, "Asc"]);
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ sortK: "name", sortD: "desc" }),
      ),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Scope chip and saving                                               */
/* ------------------------------------------------------------------ */

describe("CostReport scope chip", () => {
  it("counts the scoped cards, and clearing the scope widens the report back", async () => {
    saved.config = { scopeIds: ["crm"] };
    renderCost();
    await findChart();
    const label = await within(toolbar()).findByText("1 card");
    await waitFor(() => expect(tile("ERP")).toBeUndefined());

    fireEvent.click(label.closest(".MuiChip-root")!.querySelector(".MuiChip-deleteIcon")!);
    expect(await within(toolbar()).findByText("All cards")).toBeInTheDocument();
    await findTile("ERP");
    expect(drillNav()).not.toBeInTheDocument();
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ scopeIds: [], drillStack: [] }),
      ),
    );
  });

  it("opens the scope picker with the report's own title and help", async () => {
    renderCost();
    await findChart();
    fireEvent.click(within(toolbar()).getByText("All cards"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Scope to cards")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Cards beneath a selected card are included automatically."),
    ).toBeInTheDocument();
  });

  it("explains the scope chip on hover", async () => {
    renderCost();
    await findChart();
    fireEvent.mouseOver(within(toolbar()).getByText("All cards"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Show only the selected cards and everything beneath them",
    );
  });
});

describe("CostReport saving", () => {
  it("saves as a cost report and opens the save dialog once the thumbnail is captured", async () => {
    renderCost();
    await findChart();
    expect(new Set(saved.reportTypes)).toEqual(new Set(["cost"]));
    fireEvent.click(screen.getByRole("button", { name: /save report/i }));
    expect(saved.setSaveDialogOpen).toHaveBeenCalledWith(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Fixes found by the mutation pass                                    */
/* ------------------------------------------------------------------ */

describe("CostReport fixes", () => {
  const lastPersisted = () =>
    vi.mocked(saved.persistConfig).mock.calls[vi.mocked(saved.persistConfig).mock.calls.length - 1][0];

  const PROJECT_TYPE = makeCardType({
    key: "Project",
    label: "Project",
    fields_schema: [
      makeSection({
        section: "Budget",
        fields: [
          makeField({ key: "capex", label: "Capex", type: "cost" }),
          makeField({ key: "opex", label: "Opex", type: "cost" }),
        ],
      }),
    ],
  });

  it("keeps a restored cost field when the page opens on a single-cost-field type", async () => {
    // Application (the page's starting type) carries a single cost field.
    withMetamodel([APPLICATION_TYPE, PROJECT_TYPE], []);
    saved.config = { cardTypeKey: "Project", costField: "opex" };
    renderCost();
    await findChart();
    await waitFor(() => expect(lastTreemapParams().get("type")).toBe("Project"));
    expect(screen.getByRole("combobox", { name: /cost field/i })).toHaveTextContent("Opex");
    const projectFields = treemapCalls()
      .map(params)
      .filter((p) => p.get("type") === "Project")
      .map((p) => p.get("cost_field"));
    expect(projectFields).toEqual(["opex"]);
    await waitFor(() => expect(lastPersisted()).toMatchObject({ cardTypeKey: "Project", costField: "opex" }));
  });

  it("drops a restored cost source that is no longer offered", async () => {
    saved.config = { costSources: ["Gone:budget", ITC] };
    renderCost();
    await findChart();
    await waitFor(() => expect(lastPersisted()).toMatchObject({ costSources: [ITC] }));
    expect(screen.getByRole("combobox", { name: /cost source/i })).toHaveTextContent(
      "IT Component · License Cost",
    );
    expect(lastTreemapParams().getAll("aggregate")).toEqual([ITC]);
  });

  it("keeps a restored cost source while the metamodel is still loading", async () => {
    // Nothing is offered until the metamodel arrives; that is not "no longer offered".
    hookState.metamodel = { types: [], relationTypes: [], loading: true };
    saved.config = { costSources: [ITC] };
    const view = renderCost();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    withMetamodel([APPLICATION_TYPE, IT_COMPONENT_TYPE, CONTRACT_TYPE], RELATIONS);
    view.rerender(
      <MemoryRouter>
        <CostReport />
      </MemoryRouter>,
    );
    await findChart();
    await waitFor(() => expect(lastTreemapParams().getAll("aggregate")).toEqual([ITC]));
    expect(lastPersisted()).toMatchObject({ costSources: [ITC] });
  });
});
