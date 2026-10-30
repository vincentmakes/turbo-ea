/**
 * Branch coverage for the Cost report beyond scope and fiscal year (those live
 * in CostReport.test.tsx): the permission gate, the treemap and its tooltip,
 * related-card cost sources and the drill-down they enable, saved-config
 * restore (including the legacy drill-frame shapes), the table's sorting and
 * grouping, and the shell actions.
 *
 * jsdom has no canvas, so the chart wrapper is the shared `echartMock`: the
 * tests read the treemap option the page built (tiles, labels, tooltip) and
 * deliver a tile click the way ECharts would — with the tile's own datum.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));
vi.mock("@/hooks/useAuth", () => import("@/test/hooks").then((m) => m.useAuthModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

const saved = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  saveDialogOpen: false,
  savedReportName: null as string | null,
  setSaveDialogOpen: (() => {}) as (open: boolean) => void,
  resetAll: (() => {}) as () => void,
  resetSavedReport: (() => {}) as () => void,
  persistConfig: (() => {}) as (cfg: unknown) => void,
}));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: () => ({
    savedReport: null,
    savedReportName: saved.savedReportName,
    saveDialogOpen: saved.saveDialogOpen,
    setSaveDialogOpen: saved.setSaveDialogOpen,
    loadedConfig: null,
    consumeConfig: () => saved.config,
    resetSavedReport: saved.resetSavedReport,
    persistConfig: saved.persistConfig,
    resetAll: saved.resetAll,
    reportType: "cost",
  }),
}));

const captureAndSave = vi.hoisted(() => ({ fn: (() => {}) as () => void }));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: () => captureAndSave.fn(),
  }),
}));

vi.mock("./SaveReportDialog", () => ({
  default: (props: { open: boolean; onClose: () => void; config: Record<string, unknown> }) =>
    props.open ? (
      <div data-testid="save-dialog" data-config={JSON.stringify(props.config)}>
        <button onClick={props.onClose}>close-save</button>
      </div>
    ) : null,
}));

vi.mock("@/components/CardDetailSidePanel", () => ({
  default: (props: { cardId: string | null; open: boolean; onClose: () => void }) =>
    props.open ? (
      <div data-testid="side-panel">
        {props.cardId}
        <button onClick={props.onClose}>close-panel</button>
      </div>
    ) : null,
}));

vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));

import { mockApi } from "@/test/apiMock";
import { echartState, type CapturedEChart } from "@/test/echartMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { userWith } from "@/test/render";
import {
  APPLICATION_TYPE,
  IT_COMPONENT_TYPE,
  makeCardType,
  makeField,
  makeRelationType,
  makeSection,
} from "@/test/fixtures/metamodel";
import CostReport from "./CostReport";
import { COST_TREEMAP_COLORS } from "@/theme/tokens";

/* eslint-disable @typescript-eslint/no-explicit-any -- an option tree is plain JSON a test digs into */

/** The charts on screen now: a drill unmounts the root treemap, whose slot `echartState` keeps. */
function mountedCharts(): CapturedEChart[] {
  return screen
    .queryAllByTestId("echart")
    .map((el) => echartState.props[Number(el.getAttribute("data-echart"))]);
}

/** A chart's tiles: the treemap series' data. */
const tilesOf = (chart: CapturedEChart): any[] => chart.option.series[0].data;

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

/** A second related type with a cost field, so two aggregate sources exist. */
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
const REL_HIDDEN = makeRelationType({
  key: "relHidden",
  source_type_key: "Application",
  target_type_key: "Contract",
  is_hidden: true,
});
const REL_SELF = makeRelationType({
  key: "relAppToApp",
  source_type_key: "Application",
  target_type_key: "Application",
});
const REL_ELSEWHERE = makeRelationType({
  key: "relItcToContract",
  source_type_key: "ITComponent",
  target_type_key: "Contract",
});

const ITEMS = [
  { id: "crm", name: "CRM", cost: 100, attributes: { businessCriticality: "missionCritical" } },
  { id: "web", name: "CRM Web Portal", cost: 20, attributes: { businessCriticality: "bogus" } },
  { id: "erp", name: "ERP", cost: 500, attributes: { businessCriticality: "missionCritical" } },
  { id: "hr", name: "HR", cost: 80, attributes: {} },
];

const treemapCalls = () => mockApi.callsOf("get", "/reports/cost-treemap*").map((c) => c.path);
const lastTreemapParams = () => new URLSearchParams(treemapCalls()[treemapCalls().length - 1].split("?")[1]);

function renderCost() {
  return render(
    <MemoryRouter>
      <CostReport />
    </MemoryRouter>,
  );
}

const metric = (label: string) => screen.getByText(label).closest(".MuiPaper-root");

async function pickOption(label: RegExp, option: RegExp) {
  // The request the caller waited on is recorded when it is sent, not when its
  // response renders, so the toolbar may still be behind a spinner here.
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }, { timeout: 5000 }));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
  // A multi-select keeps its menu open; close it so the page is reachable again.
  if (screen.queryByRole("listbox")) {
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  }
}

beforeEach(() => {
  echartState.reset();
  mockApi.reset();
  hookState.reset();
  hookState.auth.user = userWith("costs.view");
  withMetamodel(
    [APPLICATION_TYPE, IT_COMPONENT_TYPE, CONTRACT_TYPE],
    [REL_APP_ITC, REL_CONTRACT_APP, REL_HIDDEN, REL_SELF, REL_ELSEWHERE],
  );
  saved.config = null;
  saved.saveDialogOpen = false;
  saved.savedReportName = null;
  saved.setSaveDialogOpen = vi.fn();
  saved.resetAll = vi.fn();
  saved.resetSavedReport = vi.fn();
  saved.persistConfig = vi.fn();
  captureAndSave.fn = vi.fn();

  mockApi.on("get", "/reports/cost-treemap*", (path: string) => {
    const p = new URLSearchParams(path.split("?")[1]);
    const parent = p.get("parent_card_id");
    if (parent) {
      // A drilled level answers per source: IT Components carry costs, contracts none.
      return p.get("type") === "ITComponent"
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

describe("CostReport permission gate", () => {
  it("explains the restriction and never asks for cost data without costs.view", async () => {
    hookState.auth.user = userWith("reports.view");
    renderCost();
    expect(await screen.findByText("Cost data restricted")).toBeInTheDocument();
    expect(treemapCalls()).toHaveLength(0);
  });

  it("lets the wildcard role through", async () => {
    hookState.auth.user = userWith("*");
    renderCost();
    expect(await screen.findByRole("img", { name: "Cost Analysis" })).toBeInTheDocument();
  });

  it("shows a spinner while the metamodel is loading", () => {
    hookState.metamodel.loading = true;
    renderCost();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });
});

describe("CostReport treemap", () => {
  it("draws the largest card first with its cost, and summarises the totals", async () => {
    renderCost();
    await findTile("ERP");
    const tiles = tilesOf(rootChart());
    // Largest first, each tile sized by its cost and filled by its position.
    expect(tiles.map((d) => d.name)).toEqual(["ERP", "CRM", "HR", "CRM Web Portal"]);
    expect(tiles.map((d) => d.value)).toEqual([500, 100, 80, 20]);
    expect(tiles.map((d) => d.itemStyle.color)).toEqual(COST_TREEMAP_COLORS.slice(0, 4));
    // ERP's tile is labelled with its name and, below it, its cost.
    expect(rootChart().option.series[0].label.formatter(tiles[0])).toBe("ERP\n{value|$500}");

    expect(metric("Total Cost")).toHaveTextContent("$700");
    expect(metric("Items")).toHaveTextContent("4");
    expect(metric("Average")).toHaveTextContent("$175");
    expect(metric("Top Cost Driver")).toHaveTextContent("ERP");
    expect(screen.getByText(/\$500 \(71%\)/)).toBeInTheDocument();
    // Without an aggregate source there is nothing to drill into.
    expect(screen.queryByText(/click a rectangle/i)).not.toBeInTheDocument();
  });

  it("names the hovered card in the tooltip", async () => {
    renderCost();
    const erp = await findTile("ERP");
    const html = rootChart().option.tooltip.formatter({ data: erp });
    expect(html).toContain(">ERP</div>");
    expect(html).toContain(">$500</div>");
    expect(html).toContain(">71.4% of total</div>");
  });

  it("truncates a name that does not fit its cell", async () => {
    // ECharts measures each label against its tile and ellipsises it; the old
    // characters-per-width estimate is gone, so the option is what is pinned.
    renderCost();
    await findTile("ERP");
    expect(rootChart().option.series[0].label.overflow).toBe("truncate");
  });

  it("anchors the labels on the right in a right-to-left locale", async () => {
    hookState.isRtl = true;
    renderCost();
    await findTile("ERP");
    const label = rootChart().option.series[0].label;
    expect(label.position).toBe("insideTopRight");
    expect(label.align).toBe("right");
  });

  it("anchors the labels on the left in a left-to-right locale", async () => {
    renderCost();
    await findTile("ERP");
    const label = rootChart().option.series[0].label;
    expect(label.position).toBe("insideTopLeft");
    expect(label.align).toBe("left");
  });

  it("opens the card's side panel when a cell is clicked without an aggregate", async () => {
    renderCost();
    await clickTile("ERP");
    expect(screen.getByTestId("side-panel")).toHaveTextContent("erp");
    fireEvent.click(screen.getByRole("button", { name: "close-panel" }));
    expect(screen.queryByTestId("side-panel")).not.toBeInTheDocument();
  });

  it("says so when there is no cost data at all", async () => {
    mockApi.on("get", "/reports/cost-treemap*", { items: [], total: 0 });
    renderCost();
    expect(await screen.findByText("No cost data found.")).toBeInTheDocument();
    expect(screen.queryByText("Top Cost Driver")).not.toBeInTheDocument();
  });
});

describe("CostReport cost sources and drill-down", () => {
  it("offers each related type's cost fields, never hidden, self or unrelated pairs", async () => {
    renderCost();
    await findChart();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /cost source/i }));
    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Contract · Contract Value", "IT Component · License Cost"]);
  });

  it("sums a related source instead of the direct field and offers the drill", async () => {
    renderCost();
    await findChart();
    expect(screen.getByRole("combobox", { name: /cost source/i })).toHaveTextContent(
      "Direct (this card type)",
    );
    await pickOption(/cost source/i, /IT Component · License Cost/);
    await waitFor(() => expect(lastTreemapParams().getAll("aggregate")).toEqual(["ITComponent:licenseCost"]));
    expect(lastTreemapParams().get("cost_field")).toBeNull();
    expect(screen.getByRole("combobox", { name: /cost source/i })).toHaveTextContent(
      "IT Component · License Cost",
    );
    expect(await screen.findByText(/click a rectangle/i)).toBeInTheDocument();
  });

  it("drills into a card, then back to the root via the breadcrumb", async () => {
    saved.config = { costSources: ["ITComponent:licenseCost"] };
    renderCost();
    await clickTile("ERP");

    await waitFor(() => expect(lastTreemapParams().get("parent_card_id")).toBe("erp"));
    expect(lastTreemapParams().get("type")).toBe("ITComponent");
    expect(lastTreemapParams().get("cost_field")).toBe("licenseCost");

    const crumbs = await screen.findByRole("navigation", { name: /drill-down path/i });
    expect(within(crumbs).getByText("ERP")).toBeInTheDocument();
    // The drilled panel is labelled with its source and total.
    await findTile("Database");
    const panel = screen
      .getByRole("img", { name: "IT Component · License Cost" })
      .closest(".MuiPaper-root") as HTMLElement;
    expect(within(panel).getByText("IT Component · License Cost")).toBeInTheDocument();
    expect(within(panel).getByText("$50")).toBeInTheDocument();
    // The scope filter is gone while drilled.
    expect(screen.queryByText("All cards")).not.toBeInTheDocument();

    // A click at depth 1 opens the card rather than drilling further.
    await clickTile("Database");
    expect(screen.getByTestId("side-panel")).toHaveTextContent("erp-db");

    fireEvent.click(within(crumbs).getByRole("button", { name: /All Application/ }));
    await waitFor(() =>
      expect(screen.queryByRole("navigation", { name: /drill-down path/i })).not.toBeInTheDocument(),
    );
    await findTile("ERP");
  });

  it("renders one panel per source when several are summed, and an empty one says so", async () => {
    saved.config = { costSources: ["ITComponent:licenseCost", "Contract:contractValue"] };
    renderCost();
    await findChart();
    expect(screen.getByRole("combobox", { name: /cost source/i })).toHaveTextContent("2 sources");
    // Sent in the options' (alphabetical) order.
    expect(lastTreemapParams().getAll("aggregate")).toEqual([
      "Contract:contractValue",
      "ITComponent:licenseCost",
    ]);

    await clickTile("ERP");
    // Wait for the drilled panels themselves: the root treemap is still on
    // screen until both per-source responses have landed.
    const empty = await screen.findByText("No cost data found.");
    await findTile("Database");
    const drilled = treemapCalls().filter((p) => p.includes("parent_card_id=erp"));
    expect(drilled).toHaveLength(2);
    const panels = empty.closest(".MuiPaper-root") as HTMLElement;
    expect(within(panels).getByText("Contract · Contract Value")).toBeInTheDocument();
  });

  it("hands each drilled panel's chart to that panel alone", async () => {
    saved.config = { costSources: ["ITComponent:licenseCost", "Contract:contractValue"] };
    renderCost();
    await clickTile("ERP");
    await screen.findByText("No cost data found.");
    await findTile("Database");
    const name = "IT Component · License Cost";
    const getItemLayout = vi.fn(() => ({ x: 0, y: 0, width: 48, height: 28 }));
    const chart = { getModel: () => ({ getSeriesByIndex: () => ({ getData: () => ({ getItemLayout }) }) }) };
    act(() => echartState.byName(name).onInit!(chart));
    const label = echartState.byName(name).option.series[0].label;
    expect(label.formatter({ dataIndex: 1, name: "OS", value: 10 })).toBe("");
    expect(getItemLayout).toHaveBeenCalledWith(1);
    // The root treemap, unmounted by the drill, never saw this chart.
    expect(rootChart().option.series[0].label.formatter({ dataIndex: 1, name: "ERP", value: 1 })).toBe(
      "ERP\n{value|$1}",
    );
  });

  it("restores a saved multi-level drill, migrating legacy frames and dropping broken ones", async () => {
    saved.config = {
      costSources: ["ITComponent:licenseCost"],
      drillStack: [
        // Legacy single-source shape.
        { cardId: "erp", cardName: "ERP", type: "ITComponent", costField: "licenseCost" },
        null,
        { cardId: "x" },
        { cardId: "y", cardName: "Y", sources: [null, { typeKey: 1 }] },
        { cardId: "z", cardName: "Z" },
        // Current shape, one source without a label.
        { cardId: "erp-db", cardName: "Database", sources: [{ typeKey: "ITComponent", fieldKey: "licenseCost" }] },
      ],
    };
    renderCost();
    const crumbs = await screen.findByRole("navigation", { name: /drill-down path/i });
    // Two frames survive: ERP (a link to pop back to) and Database (the current level).
    expect(within(crumbs).getByRole("button", { name: "ERP" })).toBeInTheDocument();
    expect(within(crumbs).getByText("Database")).toBeInTheDocument();
    await waitFor(() => expect(lastTreemapParams().get("parent_card_id")).toBe("erp-db"));
    // The unlabelled source falls back to "<type> · <field>".
    expect(await screen.findByText("ITComponent · licenseCost")).toBeInTheDocument();

    fireEvent.click(within(crumbs).getByRole("button", { name: "ERP" }));
    await waitFor(() => expect(lastTreemapParams().get("parent_card_id")).toBe("erp"));
    expect(within(screen.getByRole("navigation", { name: /drill-down path/i })).queryByText("Database"))
      .not.toBeInTheDocument();
  });

  it("restores the legacy single cost source and drops sources no longer offered", async () => {
    saved.config = { costSource: "ITComponent:licenseCost" };
    const first = renderCost();
    await waitFor(() => expect(lastTreemapParams().getAll("aggregate")).toEqual(["ITComponent:licenseCost"]));
    first.unmount();

    mockApi.calls = [];
    saved.config = { costSources: ["Gone:field", "Contract:contractValue"] };
    renderCost();
    await waitFor(() => expect(lastTreemapParams().getAll("aggregate")).toEqual(["Contract:contractValue"]));
  });
});

describe("CostReport source pruning", () => {
  it("drops a selected source the new card type cannot reach", async () => {
    saved.config = { costSources: ["Contract:contractValue"] };
    renderCost();
    await waitFor(() => expect(lastTreemapParams().getAll("aggregate")).toEqual(["Contract:contractValue"]));
    // IT Component reaches Contract too, so the pick survives the switch …
    await pickOption(/card type/i, /IT Component/);
    await waitFor(() => expect(lastTreemapParams().get("type")).toBe("ITComponent"));
    expect(lastTreemapParams().getAll("aggregate")).toEqual(["Contract:contractValue"]);
    // … whereas Contract cannot sum itself, so the pick is dropped.
    await pickOption(/card type/i, /^Contract$/);
    await waitFor(() => expect(lastTreemapParams().get("type")).toBe("Contract"));
    expect(lastTreemapParams().getAll("aggregate")).toEqual([]);
    expect(lastTreemapParams().get("cost_field")).toBe("contractValue");
  });
});

describe("CostReport toolbar", () => {
  const TWO_COSTS = makeCardType({
    key: "Application",
    label: "Application",
    fields_schema: [
      makeSection({
        section: "Costs",
        fields: [
          makeField({ key: "costTotalAnnual", label: "Total Annual Cost", type: "cost" }),
          makeField({ key: "costRun", label: "Run Cost", type: "cost" }),
        ],
      }),
    ],
  });

  it("offers a cost field picker when the type has several cost fields", async () => {
    withMetamodel([TWO_COSTS], []);
    renderCost();
    await findChart();
    expect(lastTreemapParams().get("cost_field")).toBe("costTotalAnnual");
    await pickOption(/cost field/i, /Run Cost/);
    await waitFor(() => expect(lastTreemapParams().get("cost_field")).toBe("costRun"));
  });

  it("falls back to the new type's first cost field when the current one is not on it", async () => {
    const PROJECT = makeCardType({
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
    withMetamodel([TWO_COSTS, PROJECT], []);
    renderCost();
    await findChart();
    await pickOption(/card type/i, /Project/);
    await waitFor(() => expect(lastTreemapParams().get("type")).toBe("Project"));
    expect(lastTreemapParams().get("cost_field")).toBe("capex");
  });

  it("switches card type and picks that type's only cost field", async () => {
    renderCost();
    await findChart();
    await pickOption(/card type/i, /IT Component/);
    await waitFor(() => expect(lastTreemapParams().get("type")).toBe("ITComponent"));
    expect(lastTreemapParams().get("cost_field")).toBe("licenseCost");
  });

  it("saves through the thumbnail capture and closes the save dialog", async () => {
    saved.saveDialogOpen = true;
    renderCost();
    await findChart();
    fireEvent.click(screen.getByRole("button", { name: /save report/i }));
    expect(captureAndSave.fn).toHaveBeenCalled();
    const cfg = JSON.parse(screen.getByTestId("save-dialog").getAttribute("data-config")!);
    expect(cfg).toMatchObject({ cardTypeKey: "Application", view: "chart", costSources: [] });
    fireEvent.click(screen.getByRole("button", { name: "close-save" }));
    expect(saved.setSaveDialogOpen).toHaveBeenCalledWith(false);
  });

  it("resets every parameter to its default", async () => {
    saved.config = { view: "table", sortK: "name", sortD: "asc", groupBy: "businessCriticality" };
    renderCost();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(saved.resetAll).toHaveBeenCalled();
    expect(await findChart()).toBeInTheDocument();
    expect(saved.persistConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ view: "chart", sortK: "cost", sortD: "desc", groupBy: "" }),
    );
  });

  it("shows the saved-report banner with its reset action", async () => {
    saved.savedReportName = "Q3 costs";
    renderCost();
    await findChart();
    expect(screen.getByText("Q3 costs")).toBeInTheDocument();
  });
});

describe("CostReport table", () => {
  const rowNames = () =>
    screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[0].textContent);

  it("sorts by cost, then by name in both directions", async () => {
    const user = userEvent.setup();
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    expect(rowNames()).toEqual(["ERP", "CRM", "HR", "CRM Web Portal", "Total"]);

    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(rowNames()).toEqual(["CRM", "CRM Web Portal", "ERP", "HR", "Total"]);
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(rowNames()).toEqual(["HR", "ERP", "CRM Web Portal", "CRM", "Total"]);
    await user.click(screen.getByRole("button", { name: "Cost" }));
    expect(rowNames()).toEqual(["CRM Web Portal", "HR", "CRM", "ERP", "Total"]);

    await user.click(screen.getByRole("cell", { name: "ERP" }));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("erp");
  });

  it("groups rows by a single-select field, with an Unspecified bucket", async () => {
    const user = userEvent.setup();
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    await pickOption(/group by/i, /Business Criticality/);

    await waitFor(() => expect(screen.getByText("Mission Critical")).toBeInTheDocument());
    // Groups by cost desc: Mission Critical (600), Unspecified (80), then the
    // unknown option key shown raw (20).
    const labels = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    expect(labels.filter((l) => /\(\d\)/.test(l))).toEqual([
      "Mission Critical(2)$60085.7%",
      "Unspecified(1)$8011.4%",
      "bogus(1)$202.9%",
    ]);

    // Sorting applies within each group.
    await user.click(screen.getByRole("button", { name: "Name" }));
    const afterSort = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    const mc = afterSort.findIndex((l) => l.startsWith("Mission Critical"));
    expect(afterSort[mc + 1]).toMatch(/^CRM/);
    expect(afterSort[mc + 2]).toMatch(/^ERP/);
    await user.click(screen.getByRole("button", { name: "Cost" }));
    const byCost = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    expect(byCost[mc + 1]).toMatch(/^CRM\$100/);

    await user.click(screen.getByRole("cell", { name: "CRM Web Portal" }));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("web");
  });

  it("shows a dash instead of a share when every cost is zero", async () => {
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [{ id: "z", name: "Zero", cost: 0, attributes: {} }],
      total: 0,
    });
    saved.config = { view: "table", groupBy: "businessCriticality" };
    renderCost();
    await screen.findByRole("table");
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("toggles back to the chart from the shell", async () => {
    const user = userEvent.setup();
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: /chart view/i }));
    expect(await findChart()).toBeInTheDocument();
    await act(async () => {});
  });
});
