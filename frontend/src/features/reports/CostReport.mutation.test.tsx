/**
 * Cost report behaviour the coverage-oriented suites ran but never checked
 * (CostReport.test.tsx covers scope + fiscal year, CostReport.branches.test.tsx
 * the branches): the exact print parameters, how a saved configuration is
 * restored and persisted, out-of-order answers, how each treemap cell is drawn
 * at its size, the table's per-group ordering and shares, and which toolbar
 * controls appear when.
 *
 * Recharts lays out nothing in jsdom, so `Treemap` is a stub that hands each
 * datum to the page's own `content` renderer at a size the test chooses (by
 * card name), and renders the tooltip once per datum plus the two inert cases.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { cloneElement, createRef, type ReactElement } from "react";

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

/** Cell sizes by card name; anything unlisted is drawn large (300×100). */
const chart = vi.hoisted(() => ({ sizes: {} as Record<string, [number, number]> }));

vi.mock("recharts", async () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { createContext, useContext } = await vi.importActual<typeof import("react")>("react");
  const Data = createContext<any[]>([]);
  return {
    ResponsiveContainer: ({ children, height }: any) => (
      <div data-testid="chart-container" data-height={String(height)}>
        {children}
      </div>
    ),
    Treemap: ({ data, content, children }: any) => (
      <div data-testid="treemap">
        <svg>
          {data.map((d: any, i: number) => {
            const [width, height] = chart.sizes[d.name] ?? [300, 100];
            return (
              <g key={i} data-cell={d.name}>
                {cloneElement(content as ReactElement<any>, { ...d, x: 10, y: 10, width, height })}
              </g>
            );
          })}
        </svg>
        <Data.Provider value={data}>{children}</Data.Provider>
      </div>
    ),
    Tooltip: ({ content }: any) => {
      const data = useContext(Data);
      return (
        <div data-testid="treemap-tooltip">
          {data.map((d: any, i: number) => (
            <div key={i} data-tip={d.name}>
              {cloneElement(content, { active: true, payload: [{ payload: d }] })}
            </div>
          ))}
          <div data-tip="inactive">
            {cloneElement(content, { active: false, payload: [{ payload: data[0] }] })}
          </div>
          <div data-tip="nopayload">{cloneElement(content, { active: true })}</div>
        </div>
      );
    },
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
});

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeUser, renderWithProviders, userWith } from "@/test/render";
import {
  APPLICATION_TYPE,
  HIDDEN_TYPE,
  IT_COMPONENT_TYPE,
  makeCardType,
  makeField,
  makeRelationType,
  makeSection,
} from "@/test/fixtures/metamodel";
import CostReport from "./CostReport";

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
const cell = (name: string) => document.querySelector(`[data-cell="${name}"]`) as Element;
const tip = (name: string) => document.querySelector(`[data-tip="${name}"]`) as HTMLElement;
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
  chart.sizes = {};

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
    expect(await screen.findByTestId("treemap")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("asks for the default cost field from the very first request", async () => {
    renderCost();
    await screen.findByTestId("treemap");
    expect(treemapCalls().length).toBeGreaterThan(0);
    for (const path of treemapCalls()) expect(params(path).get("cost_field")).toBe("costTotalAnnual");
  });

  it("sends every report request, root and drilled, with an abort signal", async () => {
    saved.config = { costSources: [ITC], drillStack: [ERP_FRAME] };
    renderCost();
    await screen.findByText("Database", { selector: "text" });
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
    await screen.findByText("ERP", { selector: "text" });
    await pickOption(/cost field/i, /Run Cost/);
    await waitFor(() => expect(lastTreemapParams().get("cost_field")).toBe("costRun"));
    await pickOption(/cost field/i, /Total Annual Cost/);
    await waitFor(() => expect(lastTreemapParams().get("cost_field")).toBe("costTotalAnnual"));
    await settle();

    await act(async () => stale.resolve({ items: [{ id: "old", name: "Stale", cost: 999 }], total: 999 }));
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
    expect(screen.getByText("ERP", { selector: "text" })).toBeInTheDocument();
  });

  it("ignores a drilled answer that lands after the user went back to the root", async () => {
    saved.config = { costSources: [ITC] };
    const late = deferred<unknown>();
    mockApi.on("get", "/reports/cost-treemap*", (path: string) =>
      params(path).get("parent_card_id") ? late.promise : { items: ITEMS, total: 700 },
    );
    renderCost();
    fireEvent.click(await screen.findByText("ERP", { selector: "text" }));
    const nav = await screen.findByRole("navigation", { name: /drill-down path/i });
    await waitFor(() => expect(lastTreemapParams().get("parent_card_id")).toBe("erp"));
    fireEvent.click(within(nav).getByRole("button", { name: /All Application/ }));
    await waitFor(() => expect(lastTreemapParams().get("parent_card_id")).toBeNull());
    await settle();

    await act(async () =>
      late.resolve({ items: [{ id: "db", name: "Database", cost: 40 }], total: 40 }),
    );
    expect(screen.queryByText("Database")).not.toBeInTheDocument();
    expect(screen.getByText("ERP", { selector: "text" })).toBeInTheDocument();
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
    await screen.findByTestId("treemap");
    expect(chip()).toBeNull();
    expect(printParams().map(([l]) => l)).not.toContain("Fiscal year");
  });

  it("names no year when the answer gives the start month without the year", async () => {
    mockApi.on("get", "/reports/cost-treemap*", { items: ITEMS, total: 700, fiscal_year_start: 1 });
    renderCost();
    await screen.findByTestId("treemap");
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
    fireEvent.click(await screen.findByText("ERP", { selector: "text" }));
    expect(await screen.findByText("Database", { selector: "text" })).toBeInTheDocument();
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
    await screen.findByText("Database", { selector: "text" });
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
    await screen.findByTestId("treemap");
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
    expect(await screen.findByTestId("treemap")).toBeInTheDocument();
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
    await screen.findByTestId("treemap");
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
    await screen.findByTestId("treemap");
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
    await screen.findByTestId("treemap");
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
    expect(await screen.findByText("Database", { selector: "text" })).toBeInTheDocument();
    expect(treemapCalls().filter((p) => p.includes("parent_card_id"))).toHaveLength(1);
    expect(screen.getAllByTestId("treemap")).toHaveLength(1);
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
    await screen.findByText("Database", { selector: "text" });
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
    await screen.findByText("Unlinked", { selector: "text" });
    expect((cell("ERP").firstElementChild as SVGElement).style.cursor).toBe("pointer");
    expect((cell("Unlinked").firstElementChild as SVGElement).style.cursor).toBe("");

    fireEvent.click(screen.getByText("Unlinked", { selector: "text" }));
    expect(drillNav()).not.toBeInTheDocument();
    expect(treemapCalls().some((p) => p.includes("parent_card_id"))).toBe(false);
    expect(screen.queryByTestId("side-panel")).not.toBeInTheDocument();
  });

  it("draws no click affordance when there is nothing to drill into", async () => {
    renderCost();
    await screen.findByText("ERP", { selector: "text" });
    expect((cell("ERP").firstElementChild as SVGElement).style.cursor).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/*  Treemap cells and tooltip                                           */
/* ------------------------------------------------------------------ */

describe("CostReport treemap cells", () => {
  // [name, cost, size] — costs fix the order, so each cell's palette index too.
  const SIZED: [string, number, [number, number]][] = [
    ["Big", 1100, [300, 100]],
    ["W4", 1000, [4, 100]],
    ["W3", 900, [3, 100]],
    ["H4", 800, [100, 4]],
    ["H3", 700, [100, 3]],
    ["L51", 600, [51, 31]],
    ["L50", 500, [50, 100]],
    ["L30", 400, [100, 30]],
    ["C71", 300, [71, 46]],
    ["ABCDEFGHIJ", 200, [70, 100]],
    ["C45", 100, [100, 45]],
  ];

  beforeEach(() => {
    chart.sizes = Object.fromEntries(SIZED.map(([n, , s]) => [n, s]));
    mockApi.on("get", "/reports/cost-treemap*", {
      items: SIZED.map(([name, cost]) => ({ id: name.toLowerCase(), name, cost })),
      total: 6600,
    });
  });

  const drawn = (name: string) => cell(name).querySelector("rect") !== null;
  const texts = (name: string) => Array.from(cell(name).querySelectorAll("text"));

  it("draws, labels and prices each cell according to its size", async () => {
    renderCost();
    await screen.findByText("Big", { selector: "text" });

    // Too small in either direction: nothing at all.
    expect(drawn("W3")).toBe(false);
    expect(drawn("H3")).toBe(false);
    expect(drawn("W4")).toBe(true);
    expect(drawn("H4")).toBe(true);
    expect(texts("W4")).toHaveLength(0);
    expect(texts("H4")).toHaveLength(0);

    // A label needs more than 50 wide and 30 high.
    expect(texts("L51").map((t) => t.textContent)).toEqual(["L51"]);
    expect(texts("L50")).toHaveLength(0);
    expect(texts("L30")).toHaveLength(0);

    // A cost line needs more than 70 wide and 45 high.
    expect(texts("C71").map((t) => t.textContent)).toEqual(["C71", "$300"]);
    expect(texts("C45").map((t) => t.textContent)).toEqual(["C45"]);
    // A name exactly as long as the cell fits is shown whole.
    expect(texts("ABCDEFGHIJ").map((t) => t.textContent)).toEqual(["ABCDEFGHIJ"]);
  });

  it("places the label and the cost in the cell's top-left corner", async () => {
    renderCost();
    await screen.findByText("Big", { selector: "text" });
    const [label, cost] = texts("Big");
    expect(label).toHaveAttribute("x", "16");
    expect(label).toHaveAttribute("y", "26");
    expect(cost).toHaveTextContent("$1100");
    expect(cost).toHaveAttribute("x", "16");
    expect(cost).toHaveAttribute("y", "40");
  });

  it("cycles the palette by position", async () => {
    renderCost();
    await screen.findByText("Big", { selector: "text" });
    const fill = (name: string) => cell(name).querySelector("rect")!.getAttribute("fill");
    expect(fill("Big")).toBe("#1565c0");
    expect(fill("W4")).toBe("#1976d2");
    expect(fill("C45")).toBe("#1565c0");
  });
});

describe("CostReport treemap tooltip", () => {
  it("names the hovered card, its cost and its share, and nothing when inactive", async () => {
    renderCost();
    await screen.findByTestId("treemap-tooltip");
    expect(tip("ERP")).toHaveTextContent("ERP");
    expect(tip("ERP")).toHaveTextContent("$500");
    // 500 of 700.
    expect(tip("ERP")).toHaveTextContent("ERP$50071.4% of total");
    expect(tip("inactive")).toBeEmptyDOMElement();
    expect(tip("nopayload")).toBeEmptyDOMElement();
  });

  it("leaves the share out when the panel totals nothing", async () => {
    mockApi.on("get", "/reports/cost-treemap*", { items: [{ id: "z", name: "Zero", cost: 0 }], total: 0 });
    renderCost();
    await screen.findByTestId("treemap-tooltip");
    expect(tip("Zero").textContent).toBe("Zero$0");
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
    expect(await screen.findByTestId("treemap")).toBeInTheDocument();
    expect(metricValue("Total Cost")).toBe("$700");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("titles the report", async () => {
    renderCost();
    await screen.findByTestId("treemap");
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
    await screen.findByTestId("treemap");
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
    await screen.findByTestId("treemap");
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
    await screen.findByTestId("treemap");
    expect(screen.getByRole("combobox", { name: /cost source/i })).toHaveTextContent(
      "Direct (this card type)",
    );
  });

  it("treats a non-string legacy cost source as none", async () => {
    saved.config = { costSource: 7 };
    renderCost();
    await screen.findByTestId("treemap");
    expect(screen.getByRole("combobox", { name: /cost source/i })).toHaveTextContent(
      "Direct (this card type)",
    );
  });

  it("keeps only string scope ids", async () => {
    saved.config = { scopeIds: ["crm", 5, null] };
    renderCost();
    await screen.findByTestId("treemap");
    await waitFor(() => expect(lastPersisted()).toMatchObject({ scopeIds: ["crm"] }));
  });

  it("applies a saved report that finishes loading after the page mounted", async () => {
    const view = renderCost();
    await screen.findByTestId("treemap");
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
    await screen.findByTestId("treemap");
    await waitFor(() => expect(lastPersisted()).toMatchObject({ costField: "costTotalAnnual" }));
    for (const path of treemapCalls()) expect(params(path).get("cost_field")).toBe("costTotalAnnual");
  });

  it("restores a cost field other than the type's first", async () => {
    withMetamodel([APP_TWO_COSTS], []);
    saved.config = { costField: "costRun" };
    renderCost();
    await screen.findByTestId("treemap");
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
    await screen.findByText("Database", { selector: "text" });

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
    await screen.findByTestId("treemap");
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
  it("offers None plus each single-select field as a grouping, in table view only", async () => {
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    expect(await optionsOf(/group by/i)).toEqual(["None", "Business Criticality"]);

    fireEvent.click(screen.getByRole("button", { name: /chart view/i }));
    await screen.findByTestId("treemap");
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

  it("groups by a single-select field that has no options by raw value", async () => {
    const SVC = makeCardType({
      key: "Svc",
      label: "Service",
      fields_schema: [
        makeSection({
          fields: [
            makeField({ key: "tier", label: "Tier", type: "single_select" }),
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
    await screen.findByTestId("treemap");
    expect(await optionsOf(/cost source/i)).toEqual([
      "Contract · Contract Value",
      "IT Component · License Cost",
    ]);
  });

  it("leaves the cost source picker out when no related type carries a cost", async () => {
    withMetamodel([APPLICATION_TYPE], []);
    renderCost();
    await screen.findByTestId("treemap");
    expect(screen.queryByRole("combobox", { name: /cost source/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Sum costs from related cards/)).not.toBeInTheDocument();
  });

  it("explains what summing a source does", async () => {
    renderCost();
    await screen.findByTestId("treemap");
    const help = screen.getByLabelText(/Sum costs from related cards/);
    fireEvent.mouseOver(help);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/Each entry targets a unique/);
  });

  it("lets several sources be ticked in one opening of the picker", async () => {
    renderCost();
    await screen.findByTestId("treemap");
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
    await screen.findByTestId("treemap");
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
    await screen.findByTestId("treemap");
    expect(screen.queryByRole("combobox", { name: /cost field/i })).not.toBeInTheDocument();
  });

  it("survives switching to a type that has no cost field at all", async () => {
    const TEAM = makeCardType({ key: "Team", label: "Team" });
    withMetamodel([APPLICATION_TYPE, TEAM], []);
    renderCost();
    await screen.findByTestId("treemap");
    await pickOption(/card type/i, /^Team$/);
    await waitFor(() => expect(lastTreemapParams().get("type")).toBe("Team"));
    expect(await screen.findByTestId("treemap")).toBeInTheDocument();
  });

  it("never offers a hidden card type", async () => {
    withMetamodel([APPLICATION_TYPE, IT_COMPONENT_TYPE, CONTRACT_TYPE, HIDDEN_TYPE], RELATIONS);
    renderCost();
    await screen.findByTestId("treemap");
    expect(await optionsOf(/card type/i)).toEqual(["Application", "IT Component", "Contract"]);
  });

  it("offers every type to a reports user who may not browse the inventory", async () => {
    renderWithProviders(<CostReport />, { user: userWith("costs.view") });
    await screen.findByTestId("treemap");
    expect(screen.getByRole("combobox", { name: /cost source/i })).toBeInTheDocument();
    expect(await optionsOf(/card type/i)).toEqual(["Application", "IT Component", "Contract"]);
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
    await screen.findByTestId("treemap");
    expect(screen.getByText("$0 (0%)")).toBeInTheDocument();
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
    await screen.findByTestId("treemap");
    expect(screen.getAllByTestId("chart-container").map((c) => c.getAttribute("data-height"))).toEqual([
      "450",
    ]);
  });

  it("shortens the panels when several sources sit side by side", async () => {
    saved.config = { costSources: [ITC, "Contract:contractValue"], drillStack: [] };
    renderCost();
    fireEvent.click(await screen.findByText("ERP", { selector: "text" }));
    await screen.findByText("Database", { selector: "text" });
    expect(screen.getAllByTestId("chart-container").map((c) => c.getAttribute("data-height"))).toEqual([
      "360",
    ]);
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
    await screen.findByTestId("treemap");
    const label = await within(toolbar()).findByText("1 card");
    await waitFor(() => expect(screen.queryByText("ERP", { selector: "text" })).not.toBeInTheDocument());

    fireEvent.click(label.closest(".MuiChip-root")!.querySelector(".MuiChip-deleteIcon")!);
    expect(await within(toolbar()).findByText("All cards")).toBeInTheDocument();
    expect(await screen.findByText("ERP", { selector: "text" })).toBeInTheDocument();
    expect(drillNav()).not.toBeInTheDocument();
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ scopeIds: [], drillStack: [] }),
      ),
    );
  });

  it("opens the scope picker with the report's own title and help", async () => {
    renderCost();
    await screen.findByTestId("treemap");
    fireEvent.click(within(toolbar()).getByText("All cards"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Scope to cards")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Cards beneath a selected card are included automatically."),
    ).toBeInTheDocument();
  });

  it("explains the scope chip on hover", async () => {
    renderCost();
    await screen.findByTestId("treemap");
    fireEvent.mouseOver(within(toolbar()).getByText("All cards"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Show only the selected cards and everything beneath them",
    );
  });
});

describe("CostReport saving", () => {
  it("saves as a cost report and opens the save dialog once the thumbnail is captured", async () => {
    renderCost();
    await screen.findByTestId("treemap");
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
    await screen.findByTestId("treemap");
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
    await screen.findByTestId("treemap");
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
    await screen.findByTestId("treemap");
    await waitFor(() => expect(lastTreemapParams().getAll("aggregate")).toEqual([ITC]));
    expect(lastPersisted()).toMatchObject({ costSources: [ITC] });
  });
});
