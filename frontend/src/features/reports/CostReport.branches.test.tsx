/**
 * Branch coverage for the Cost report beyond scope and fiscal year (those live
 * in CostReport.test.tsx): the permission gate, the treemap and its tooltip,
 * related-card cost sources and the drill-down they enable, saved-config
 * restore (including the legacy drill-frame shapes), the table's sorting and
 * grouping, and the shell actions.
 *
 * Recharts lays out nothing in jsdom, so `Treemap` is replaced by a stub that
 * hands each datum to the page's own `content` renderer at a fixed size —
 * which is the code under test — and renders the tooltip content once, active.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { cloneElement, createRef, type ReactElement } from "react";

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

// Cell sizes by position: large (label + cost), medium (label only), tiny (nothing).
const CELL_SIZES = [
  [300, 100],
  [60, 35],
  [3, 3],
];

vi.mock("recharts", async () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { createContext, useContext } = await vi.importActual<typeof import("react")>("react");
  const Data = createContext<any[]>([]);
  return {
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    Treemap: ({ data, content, children }: any) => (
      <div data-testid="treemap">
        <svg>
          {data.map((d: any, i: number) => {
            const [width, height] = CELL_SIZES[i % CELL_SIZES.length];
            return cloneElement(content as ReactElement<any>, {
              key: d.id,
              ...d,
              x: 10,
              y: 10,
              width,
              height,
            });
          })}
        </svg>
        <Data.Provider value={data}>{children}</Data.Provider>
      </div>
    ),
    Tooltip: ({ content }: any) => {
      const data = useContext(Data);
      return (
        <div data-testid="treemap-tooltip">
          {cloneElement(content, { active: true, payload: [{ payload: data[0] }] })}
          {cloneElement(content, { active: false })}
        </div>
      );
    },
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
});

import { mockApi } from "@/test/apiMock";
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
    expect(await screen.findByTestId("treemap")).toBeInTheDocument();
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
    const treemap = await screen.findByTestId("treemap");
    const svg = treemap.querySelector("svg")!;
    // ERP (500) leads at full size: name + cost.
    expect(within(svg as unknown as HTMLElement).getByText("ERP")).toBeInTheDocument();
    expect(within(svg as unknown as HTMLElement).getByText("$500")).toBeInTheDocument();
    // CRM (100) is medium — a label but no cost line; HR (80) is too small to draw.
    expect(within(svg as unknown as HTMLElement).getByText("CRM")).toBeInTheDocument();
    expect(within(svg as unknown as HTMLElement).queryByText("$100")).not.toBeInTheDocument();
    expect(within(svg as unknown as HTMLElement).queryByText("HR")).not.toBeInTheDocument();
    // Fourth item (CRM Web Portal) cycles back to large: its name fits there.
    expect(within(svg as unknown as HTMLElement).getByText("CRM Web Portal")).toBeInTheDocument();

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
    const tip = await screen.findByTestId("treemap-tooltip");
    expect(await within(tip).findByText("ERP")).toBeInTheDocument();
    expect(within(tip).getByText("$500")).toBeInTheDocument();
  });

  it("truncates a name that does not fit its cell", async () => {
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [
        { id: "a", name: "Big", cost: 900 },
        { id: "b", name: "A Very Long Application Name", cost: 50 },
      ],
      total: 950,
    });
    renderCost();
    await screen.findByTestId("treemap");
    expect(screen.getByText("A Very …")).toBeInTheDocument();
  });

  it("anchors the labels on the right in a right-to-left locale", async () => {
    hookState.isRtl = true;
    renderCost();
    const label = await screen.findByText("ERP", { selector: "text" });
    expect(label).toHaveAttribute("text-anchor", "end");
    expect(label).toHaveAttribute("x", String(10 + 300 - 6));
  });

  it("opens the card's side panel when a cell is clicked without an aggregate", async () => {
    renderCost();
    fireEvent.click(await screen.findByText("ERP", { selector: "text" }));
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
    await screen.findByTestId("treemap");
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /cost source/i }));
    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Contract · Contract Value", "IT Component · License Cost"]);
  });

  it("sums a related source instead of the direct field and offers the drill", async () => {
    renderCost();
    await screen.findByTestId("treemap");
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
    fireEvent.click(await screen.findByText("ERP", { selector: "text" }));

    await waitFor(() => expect(lastTreemapParams().get("parent_card_id")).toBe("erp"));
    expect(lastTreemapParams().get("type")).toBe("ITComponent");
    expect(lastTreemapParams().get("cost_field")).toBe("licenseCost");

    const crumbs = await screen.findByRole("navigation", { name: /drill-down path/i });
    expect(within(crumbs).getByText("ERP")).toBeInTheDocument();
    // The drilled panel is labelled with its source and total.
    expect(await screen.findByText("Database", { selector: "text" })).toBeInTheDocument();
    const panel = screen.getByTestId("treemap").closest(".MuiPaper-root") as HTMLElement;
    expect(within(panel).getByText("IT Component · License Cost")).toBeInTheDocument();
    expect(within(panel).getByText("$50")).toBeInTheDocument();
    // The scope filter is gone while drilled.
    expect(screen.queryByText("All cards")).not.toBeInTheDocument();

    // A click at depth 1 opens the card rather than drilling further.
    fireEvent.click(screen.getByText("Database", { selector: "text" }));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("erp-db");

    fireEvent.click(within(crumbs).getByRole("button", { name: /All Application/ }));
    await waitFor(() =>
      expect(screen.queryByRole("navigation", { name: /drill-down path/i })).not.toBeInTheDocument(),
    );
    expect(await screen.findByText("ERP", { selector: "text" })).toBeInTheDocument();
  });

  it("renders one panel per source when several are summed, and an empty one says so", async () => {
    saved.config = { costSources: ["ITComponent:licenseCost", "Contract:contractValue"] };
    renderCost();
    await screen.findByTestId("treemap");
    expect(screen.getByRole("combobox", { name: /cost source/i })).toHaveTextContent("2 sources");
    // Sent in the options' (alphabetical) order.
    expect(lastTreemapParams().getAll("aggregate")).toEqual([
      "Contract:contractValue",
      "ITComponent:licenseCost",
    ]);

    fireEvent.click(screen.getByText("ERP", { selector: "text" }));
    // Wait for the drilled panels themselves: the root treemap is still on
    // screen until both per-source responses have landed.
    const empty = await screen.findByText("No cost data found.");
    expect(await screen.findByText("Database", { selector: "text" })).toBeInTheDocument();
    const drilled = treemapCalls().filter((p) => p.includes("parent_card_id=erp"));
    expect(drilled).toHaveLength(2);
    const panels = empty.closest(".MuiPaper-root") as HTMLElement;
    expect(within(panels).getByText("Contract · Contract Value")).toBeInTheDocument();
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
    await screen.findByTestId("treemap");
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
    await screen.findByTestId("treemap");
    await pickOption(/card type/i, /Project/);
    await waitFor(() => expect(lastTreemapParams().get("type")).toBe("Project"));
    expect(lastTreemapParams().get("cost_field")).toBe("capex");
  });

  it("switches card type and picks that type's only cost field", async () => {
    renderCost();
    await screen.findByTestId("treemap");
    await pickOption(/card type/i, /IT Component/);
    await waitFor(() => expect(lastTreemapParams().get("type")).toBe("ITComponent"));
    expect(lastTreemapParams().get("cost_field")).toBe("licenseCost");
  });

  it("saves through the thumbnail capture and closes the save dialog", async () => {
    saved.saveDialogOpen = true;
    renderCost();
    await screen.findByTestId("treemap");
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
    expect(await screen.findByTestId("treemap")).toBeInTheDocument();
    expect(saved.persistConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ view: "chart", sortK: "cost", sortD: "desc", groupBy: "" }),
    );
  });

  it("shows the saved-report banner with its reset action", async () => {
    saved.savedReportName = "Q3 costs";
    renderCost();
    await screen.findByTestId("treemap");
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
    expect(await screen.findByTestId("treemap")).toBeInTheDocument();
    await act(async () => {});
  });
});
