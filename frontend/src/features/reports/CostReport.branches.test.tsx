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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installResizeObserver } from "@/test/dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { cloneElement, createRef, type ReactElement } from "react";

vi.mock("@/api/client", () =>
  import("@/test/apiMock").then((m) => m.apiClientModule()),
);
vi.mock("@/hooks/useMetamodel", () =>
  import("@/test/hooks").then((m) => m.useMetamodelModule()),
);
vi.mock("@/hooks/useCurrency", () =>
  import("@/test/hooks").then((m) => m.useCurrencyModule()),
);
vi.mock("@/hooks/useAuth", () =>
  import("@/test/hooks").then((m) => m.useAuthModule()),
);
vi.mock("@/hooks/useIsRtl", () =>
  import("@/test/hooks").then((m) => m.useIsRtlModule()),
);

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
  default: (props: {
    open: boolean;
    onClose: () => void;
    config: Record<string, unknown>;
  }) =>
    props.open ? (
      <div data-testid="save-dialog" data-config={JSON.stringify(props.config)}>
        <button onClick={props.onClose}>close-save</button>
      </div>
    ) : null,
}));

vi.mock("@/components/CardDetailSidePanel", () => ({
  default: (props: {
    cardId: string | null;
    open: boolean;
    onClose: () => void;
  }) =>
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

// jsdom has no canvas: the charts are drawn as DOM read from the option the page built.
vi.mock("@/components/charts/EChart", () => import("@/test/costChartMock").then((m) => m.costChartModule()));

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

const CONTRACT_TYPE = makeCardType({
  key: "Contract",
  label: "Contract",
  fields_schema: [
    makeSection({
      section: "Money",
      fields: [
        makeField({
          key: "contractValue",
          label: "Contract Value",
          type: "cost",
        }),
      ],
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
  {
    id: "crm",
    name: "CRM",
    cost: 100,
    attributes: { businessCriticality: "missionCritical" },
    group: "missionCritical",
  },
  {
    id: "web",
    name: "CRM Web Portal",
    cost: 20,
    attributes: { businessCriticality: "bogus" },
    group: "bogus",
  },
  {
    id: "erp",
    name: "ERP",
    cost: 500,
    attributes: { businessCriticality: "missionCritical" },
    group: "missionCritical",
  },
  { id: "hr", name: "HR", cost: 80, attributes: {}, group: "__other__" },
];

const treemapCalls = () =>
  mockApi.callsOf("get", "/reports/cost-treemap*").map((c) => c.path);
const lastTreemapParams = () =>
  new URLSearchParams(treemapCalls()[treemapCalls().length - 1].split("?")[1]);

function renderCost() {
  return render(
    <MemoryRouter>
      <CostReport />
    </MemoryRouter>,
  );
}

const metric = (label: string) =>
  screen.getByText(label).closest(".MuiPaper-root");

const typeGroup = async () =>
  within(await screen.findByRole("group", { name: /card type/i }, { timeout: 5000 }));
const typeButtonNames = async () =>
  (await typeGroup()).getAllByRole("button").map((b) => b.textContent);
const pressType = async (name: string) =>
  fireEvent.click((await typeGroup()).getByRole("button", { name }));

async function pickOption(label: RegExp, option: RegExp) {
  // The request the caller waited on is recorded when it is sent, not when its
  // response renders, so the toolbar may still be behind a spinner here.
  fireEvent.mouseDown(
    await screen.findByRole("combobox", { name: label }, { timeout: 5000 }),
  );
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
  // A multi-select keeps its menu open; close it so the page is reachable again.
  if (screen.queryByRole("listbox")) {
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
  }
}

// The fiscal-year slider measures its track with a ResizeObserver, which jsdom lacks.
let restoreResizeObserver: () => void;
afterEach(() => restoreResizeObserver());
beforeEach(() => {
  restoreResizeObserver = installResizeObserver();
  mockApi.reset();
  mockApi.on("get", "/metamodel/cost-item-types", []);
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

  mockApi.on("get", "/reports/cost-treemap*", {
    items: ITEMS,
    total: 700,
    fiscal_year: 2026,
    fiscal_year_start: 1,
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
    expect(
      within(svg as unknown as HTMLElement).getByText("ERP"),
    ).toBeInTheDocument();
    expect(
      within(svg as unknown as HTMLElement).getByText("$500"),
    ).toBeInTheDocument();
    // Every card is a tile; which ones print a name or a cost is the chart's own
    // fit-to-the-tile rule, tested in costTreemapOption.test.ts.
    for (const name of ["CRM", "HR", "CRM Web Portal"])
      expect(within(svg as unknown as HTMLElement).getByText(name)).toBeInTheDocument();

    expect(metric("Total Cost")).toHaveTextContent("$700");
    expect(metric("Items")).toHaveTextContent("4");
    expect(metric("Average")).toHaveTextContent("$175");
    expect(metric("Top Cost Driver")).toHaveTextContent("ERP");
    expect(screen.getByText(/\$500 \(71%\)/)).toBeInTheDocument();
  });

  it("names the hovered card in the tooltip", async () => {
    renderCost();
    const tip = await screen.findByTestId("treemap-tooltip");
    expect(await within(tip).findByText("ERP")).toBeInTheDocument();
    expect(within(tip).getByText("$500")).toBeInTheDocument();
  });

  it("opens the card's side panel when a cell is left-clicked", async () => {
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

  it("shows a delta badge comparing the selected past year to the current year", async () => {
    saved.config = { view: "chart", fiscalYearParam: 2024 };
    mockApi.on("get", "/reports/cost-treemap*", (path: string) => {
      const p = new URLSearchParams(path.split("?")[1]);
      return p.get("fiscal_year") === "2024"
        ? { items: [{ id: "erp", name: "ERP", cost: 600 }], total: 600, fiscal_year: 2024 }
        : { items: [{ id: "erp", name: "ERP", cost: 500 }], total: 500, fiscal_year: 2026 };
    });
    renderCost();
    await screen.findByTestId("treemap");
    expect(await screen.findByText(/\+20%/)).toBeInTheDocument(); // (600-500)/500
  });

  it("handles a card with no current-year baseline as 100% growth from zero, not a crash", async () => {
    saved.config = { view: "chart", fiscalYearParam: 2024 };
    mockApi.on("get", "/reports/cost-treemap*", (path: string) => {
      const p = new URLSearchParams(path.split("?")[1]);
      return p.get("fiscal_year") === "2024"
        ? { items: [{ id: "old", name: "Old", cost: 300 }], total: 300, fiscal_year: 2024 }
        : { items: [], total: 0, fiscal_year: 2026 };
    });
    renderCost();
    await screen.findByTestId("treemap");
    expect(await screen.findByText(/new/i)).toBeInTheDocument();
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
          makeField({
            key: "costTotalAnnual",
            label: "Total Annual Cost",
            type: "cost",
          }),
          makeField({ key: "costRun", label: "Run Cost", type: "cost" }),
        ],
      }),
    ],
  });

  it("offers a cost field picker built from the catalogue", async () => {
    mockApi.on("get", "/metamodel/cost-item-types", [
      { id: "1", key: "licenses", label: "Licenses", sort_order: 1, archived: false, translations: {} },
    ]);
    withMetamodel([TWO_COSTS], []);
    renderCost();
    await screen.findByTestId("treemap");
    expect(lastTreemapParams().get("cost_field")).toBe("costTotalAnnual");
    await pickOption(/cost field/i, /Licenses/);
    await waitFor(() =>
      expect(lastTreemapParams().get("cost_field")).toBe("licenses"),
    );
  });

  it("keeps TCO as the cost field when switching card type", async () => {
    withMetamodel([TWO_COSTS, IT_COMPONENT_TYPE], []);
    renderCost();
    await screen.findByTestId("treemap");
    await pressType("IT Component");
    await pressType("Application");
    await waitFor(() =>
      expect(lastTreemapParams().get("type")).toBe("ITComponent"),
    );
    expect(lastTreemapParams().get("cost_field")).toBe("costTotalAnnual");
  });

  it("saves through the thumbnail capture and closes the save dialog", async () => {
    saved.saveDialogOpen = true;
    renderCost();
    await screen.findByTestId("treemap");
    fireEvent.click(screen.getByRole("button", { name: /save report/i }));
    expect(captureAndSave.fn).toHaveBeenCalled();
    const cfg = JSON.parse(
      screen.getByTestId("save-dialog").getAttribute("data-config")!,
    );
    expect(cfg).toMatchObject({ cardTypeKey: "Application", view: "chart" });
    fireEvent.click(screen.getByRole("button", { name: "close-save" }));
    expect(saved.setSaveDialogOpen).toHaveBeenCalledWith(false);
  });

  it("resets every parameter to its default", async () => {
    saved.config = {
      view: "table",
      sortK: "name",
      sortD: "asc",
      groupBy: "businessCriticality",
    };
    renderCost();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(saved.resetAll).toHaveBeenCalled();
    expect(await screen.findByTestId("treemap")).toBeInTheDocument();
    expect(saved.persistConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        view: "chart",
        sortK: "cost",
        sortD: "desc",
        groupBy: "",
      }),
    );
  });

  it("shows the saved-report banner with its reset action", async () => {
    saved.savedReportName = "Q3 costs";
    renderCost();
    await screen.findByTestId("treemap");
    expect(screen.getByText("Q3 costs")).toBeInTheDocument();
  });
});

describe("CostReport table YoY", () => {
  it("adds a YoY % column comparing the selected year to the prior year", async () => {
    saved.config = { view: "table", fiscalYearParam: 2025 };
    mockApi.on("get", "/reports/cost-treemap*", (path: string) => {
      const p = new URLSearchParams(path.split("?")[1]);
      return p.get("fiscal_year") === "2024"
        ? { items: [{ id: "erp", name: "ERP", cost: 500 }], total: 500 }
        : { items: [{ id: "erp", name: "ERP", cost: 600 }], total: 600 };
    });
    renderCost();
    await screen.findByRole("table");
    expect(screen.getByText("+20.0%")).toBeInTheDocument();
  });

  it("shows the empty sentinel for the earliest year with no prior-year data", async () => {
    saved.config = { view: "table", fiscalYearParam: 2020 }; // picker's own earliest offered year
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [{ id: "erp", name: "ERP", cost: 500 }],
      total: 500,
    });
    renderCost();
    await screen.findByRole("table");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows the empty sentinel instead of Infinity% when the prior year's total was zero", async () => {
    saved.config = { view: "table", fiscalYearParam: 2025 };
    mockApi.on("get", "/reports/cost-treemap*", (path: string) => {
      const p = new URLSearchParams(path.split("?")[1]);
      return p.get("fiscal_year") === "2024"
        ? { items: [], total: 0 }
        : { items: [{ id: "erp", name: "ERP", cost: 600 }], total: 600 };
    });
    renderCost();
    await screen.findByRole("table");
    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "TCO" }));
    expect(rowNames()).toEqual(["CRM Web Portal", "HR", "CRM", "ERP", "Total"]);

    // Left click opens the card; right click drills.
    fireEvent.click(screen.getByRole("cell", { name: /^ERP/ }));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("erp");
  });

  it("groups rows by a single-select field, with an Unspecified bucket", async () => {
    const user = userEvent.setup();
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    await pickOption(/group by/i, /Business Criticality/);

    await waitFor(() =>
      expect(screen.getByText("Mission Critical")).toBeInTheDocument(),
    );
    // Groups by cost desc: Mission Critical (600), then the unknown option key shown raw (20);
    // the Unspecified bucket (80) always closes the list.
    const labels = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    expect(labels.filter((l) => /\(\d\)/.test(l))).toEqual([
      "Mission Critical(2)$60085.7%",
      "bogus(1)$202.9%",
      "Unspecified(1)$8011.4%",
    ]);

    // Sorting applies within each group.
    await user.click(screen.getByRole("button", { name: "Name" }));
    const afterSort = screen
      .getAllByRole("row")
      .map((r) => r.textContent ?? "");
    const mc = afterSort.findIndex((l) => l.startsWith("Mission Critical"));
    expect(afterSort[mc + 1]).toMatch(/^CRM/);
    expect(afterSort[mc + 2]).toMatch(/^ERP/);
    await user.click(screen.getByRole("button", { name: "TCO" }));
    const byCost = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    expect(byCost[mc + 1]).toMatch(/^CRM\$100/);

    fireEvent.click(screen.getByRole("cell", { name: /^CRM Web Portal/ }));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("web");
  });

  it("shows a dash instead of a share when every cost is zero", async () => {
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [{ id: "z", name: "Zero", cost: 0, attributes: {} }],
      total: 0,
    });
    saved.config = { view: "table", groupBy: "field:businessCriticality" };
    renderCost();
    await screen.findByRole("table");
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("toggles back to the chart from the shell", async () => {
    const user = userEvent.setup();
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: /treemap chart view/i }),
    );
    expect(await screen.findByTestId("treemap")).toBeInTheDocument();
    await act(async () => {});
  });

  it("renders a picked column's value per row and a header with its label", async () => {
    saved.config = { view: "table", extraColumns: ["businessCriticality"] };
    renderCost();
    await screen.findByRole("table");
    expect(
      screen.getByRole("columnheader", { name: "Business Criticality" }),
    ).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /ERP/ });
    expect(within(row).getByText("Mission Critical")).toBeInTheDocument();
  });

  it("shows the empty sentinel for a row missing the picked field", async () => {
    saved.config = { view: "table", extraColumns: ["businessCriticality"] };
    renderCost();
    await screen.findByRole("table");
    const row = screen.getByRole("row", { name: /^HR/ });
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("sums a cost-typed picked column per group when grouped", async () => {
    const APP_TWO_COSTS = makeCardType({
      key: "Application",
      label: "Application",
      fields_schema: [
        makeSection({
          section: "Costs",
          fields: [
            makeField({
              key: "businessCriticality",
              label: "Business Criticality",
              type: "single_select",
              options: [{ key: "missionCritical", label: "Mission Critical" }],
            }),
            makeField({
              key: "costRun",
              label: "Run Cost",
              type: "cost",
            }),
          ],
        }),
      ],
    });
    withMetamodel([APP_TWO_COSTS, IT_COMPONENT_TYPE], []);
    saved.config = {
      view: "table",
      groupBy: "field:businessCriticality",
      extraColumns: ["costRun"],
    };
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [
        {
          id: "a",
          name: "A",
          cost: 100,
          attributes: { businessCriticality: "missionCritical", costRun: 40 },
          group: "missionCritical",
        },
        {
          id: "b",
          name: "B",
          cost: 200,
          attributes: { businessCriticality: "missionCritical", costRun: 60 },
          group: "missionCritical",
        },
      ],
      total: 300,
    });
    renderCost();
    await screen.findByRole("table");
    const groupRow = screen.getByRole("row", { name: /Mission Critical/ });
    expect(within(groupRow).getByText("$100")).toBeInTheDocument(); // 40 + 60
  });

  it("renders a cost column's per-row values with no subtotal when ungrouped", async () => {
    saved.config = { view: "table", extraColumns: ["costTotalAnnual"] };
    mockApi.on("get", "/reports/cost-treemap*", {
      items: ITEMS.map((it) => ({
        ...it,
        attributes: { ...it.attributes, costTotalAnnual: it.cost },
      })),
      total: 700,
      fiscal_year: 2026,
      fiscal_year_start: 1,
    });
    renderCost();
    await screen.findByRole("table");
    const row = screen.getByRole("row", { name: /ERP/ });
    expect(within(row).getByText("$500")).toBeInTheDocument();
    expect(
      screen.queryByRole("row", { name: /^Mission Critical/ }),
    ).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  Types, combined option and one set of filters                      */
/* ------------------------------------------------------------------ */

const tierField = makeField({
  key: "tier",
  label: "Tier",
  type: "single_select",
  options: [
    { key: "gold", label: "Gold" },
    { key: "silver", label: "Silver" },
  ],
});
const sharedCost = makeField({
  key: "costTotalAnnual",
  label: "Total Annual Cost",
  type: "cost",
});
const APP_G = makeCardType({
  key: "Application",
  label: "Application",
  fields_schema: [makeSection({ section: "S", fields: [tierField, sharedCost] })],
});
const ITC_G = makeCardType({
  key: "ITComponent",
  label: "IT Component",
  fields_schema: [makeSection({ section: "S", fields: [tierField, sharedCost] })],
});
const INITIATIVE_G = makeCardType({
  key: "Initiative",
  label: "Initiative",
  fields_schema: [makeSection({ section: "S", fields: [sharedCost] })],
});
const REL_APP_OWNER = makeRelationType({
  key: "relAppToOrg",
  label: "owned by",
  source_type_key: "Application",
  target_type_key: "Organization",
  cardinality: "1:n",
});

const sankeyCalls = () =>
  mockApi.callsOf("get", "/reports/cost-sankey*").map((c) => c.path);
const params = (path: string) => new URLSearchParams(path.split("?")[1]);
const lastParams = (paths: string[]) => params(paths[paths.length - 1]);
const optionNames = async () =>
  within(await screen.findByRole("listbox"))
    .getAllByRole("option")
    .map((o) => o.textContent);

describe("CostReport type, cost field and group by selectors", () => {
  beforeEach(() => {
    withMetamodel([APP_G, ITC_G, INITIATIVE_G], [REL_APP_OWNER]);
    mockApi.on("get", "/reports/cost-sankey*", {
      nodes: [
        { id: "item:costTotalAnnual", name: "Total Annual Cost", type: "CostItem" },
      ],
      links: [],
      total: 0,
      fiscal_year: 2026,
      fiscal_year_start: 1,
    });
  });

  it("offers Application and IT Component and no initiative", async () => {
    renderCost();
    expect(await typeButtonNames()).toEqual(["Application", "IT Component"]);
  });

  it("offers one button when a type is not readable", async () => {
    withMetamodel([APP_G, INITIATIVE_G], []);
    renderCost();
    expect(await typeButtonNames()).toEqual(["Application"]);
  });

  it("offers one button, on and not switchable off, when only IT Component is readable", async () => {
    withMetamodel([ITC_G, INITIATIVE_G], []);
    renderCost();
    expect(await typeButtonNames()).toEqual(["IT Component"]);
    const button = (await typeGroup()).getByRole("button", { name: "IT Component" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(lastParams(treemapCalls()).get("type")).toBe("ITComponent"));
  });

  it("both buttons on send type=Application,ITComponent", async () => {
    renderCost();
    await screen.findByTestId("treemap");
    await pressType("IT Component");
    await waitFor(() =>
      expect(lastParams(treemapCalls()).get("type")).toBe(
        "Application,ITComponent",
      ),
    );
  });

  it("all four requests carry type=Application,ITComponent", async () => {
    saved.config = {
      cardTypeKey: "Application+ITComponent",
      view: "chart",
      fiscalYearParam: 2025,
    };
    renderCost();
    await screen.findByTestId("treemap");
    const combinedType = (c: string) =>
      params(c).get("type") === "Application,ITComponent";
    // main (the picked year) and the current-year baseline (no fiscal_year)
    await waitFor(() =>
      expect(
        treemapCalls().some(
          (c) => combinedType(c) && params(c).get("fiscal_year") === "2025",
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        treemapCalls().some(
          (c) => combinedType(c) && params(c).get("fiscal_year") === null,
        ),
      ).toBe(true),
    );

    await userEvent.click(
      screen.getByRole("button", { name: /sankey chart view/i }),
    );
    await waitFor(() => expect(sankeyCalls().length).toBeGreaterThan(0));
    for (const c of sankeyCalls())
      expect(params(c).get("type")).toBe("Application,ITComponent");
  });

  it("the prior-year request carries the type too", async () => {
    saved.config = {
      cardTypeKey: "Application+ITComponent",
      view: "table",
      fiscalYearParam: 2025,
    };
    renderCost();
    await screen.findByRole("table");
    await waitFor(() =>
      expect(
        treemapCalls().some((c) => params(c).get("fiscal_year") === "2024"),
      ).toBe(true),
    );
    const prior = treemapCalls().find(
      (c) => params(c).get("fiscal_year") === "2024",
    );
    expect(params(prior!).get("type")).toBe("Application,ITComponent");
  });

  it("sankey shows the same toolbar as the treemap", async () => {
    saved.config = { view: "sankey" };
    renderCost();
    await screen.findByTestId("sankey");
    expect(
      screen.getByRole("group", { name: /card type/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /group by/i }),
    ).toBeInTheDocument();
    expect(sankeyCalls()[0]).toContain("type=Application");
  });

  it("group by sends field: prefix", async () => {
    renderCost();
    await screen.findByTestId("treemap");
    await pickOption(/group by/i, /Tier/);
    await waitFor(() =>
      expect(lastParams(treemapCalls()).get("group_by")).toBe("field:tier"),
    );
  });

  it("group by offers a relation only for a single type", async () => {
    renderCost();
    await screen.findByTestId("treemap");
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /group by/i }));
    expect(await optionNames()).toContain("owned by");
  });

  it("a bare saved groupBy becomes field:<key>", async () => {
    saved.config = { view: "table", groupBy: "tier" };
    renderCost();
    await screen.findByRole("table");
    await waitFor(() =>
      expect(lastParams(treemapCalls()).get("group_by")).toBe("field:tier"),
    );
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ groupBy: "field:tier" }),
      ),
    );
  });

  it("a saved groupBy that is not offered is dropped", async () => {
    saved.config = { view: "table", groupBy: "ITComponent" };
    renderCost();
    await screen.findByRole("table");
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ groupBy: "" }),
      ),
    );
    expect(lastParams(treemapCalls()).get("group_by")).toBeNull();
  });

  it("group by is disabled with no common option", async () => {
    withMetamodel(
      [
        APP_G,
        makeCardType({
          key: "ITComponent",
          label: "IT Component",
          fields_schema: [makeSection({ section: "S", fields: [sharedCost] })],
        }),
      ],
      [],
    );
    saved.config = { cardTypeKey: "Application+ITComponent", view: "table" };
    renderCost();
    await screen.findByRole("table");
    expect(screen.getByRole("combobox", { name: /group by/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByText("No field or relation to group by.")).toBeInTheDocument();
  });

  it("combined shows scope filter and hides extra columns", async () => {
    saved.config = { cardTypeKey: "Application+ITComponent", view: "table" };
    renderCost();
    await screen.findByRole("table");
    expect(
      screen.queryByRole("combobox", { name: /columns/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("All cards")).toBeInTheDocument();
  });

  it("a single type does show the scope filter", async () => {
    saved.config = { view: "table" };
    renderCost();
    await screen.findByRole("table");
    expect(screen.getByText("All cards")).toBeInTheDocument();
  });

  it("falls back to Application when a saved combined option is no longer readable", async () => {
    withMetamodel([APP_G, INITIATIVE_G], []);
    saved.config = { cardTypeKey: "Application+ITComponent", view: "table" };
    renderCost();
    await screen.findByRole("table");
    await waitFor(() =>
      expect(lastParams(treemapCalls()).get("type")).toBe("Application"),
    );
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ cardTypeKey: "Application" }),
      ),
    );
  });

  it("keeps two raw groups apart when their labels collide", async () => {
    saved.config = { view: "table", groupBy: "rel:relAppToOrg" };
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [
        { id: "a", name: "A", cost: 10, group: "Unspecified" },
        { id: "b", name: "B", cost: 5, group: "__other__" },
      ],
      groups: [],
      total: 15,
    });
    renderCost();
    await screen.findByRole("table");
    const groupRows = screen
      .getAllByRole("row")
      .filter((r) => (r.textContent ?? "").startsWith("Unspecified(1)"));
    expect(groupRows).toHaveLength(2);
  });

  it("names a treemap group once, on its largest card", async () => {
    saved.config = { view: "chart", groupBy: "field:tier" };
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [
        { id: "a", name: "Alpha", cost: 10, group: "gold" },
        { id: "b", name: "Beta", cost: 5, group: "gold" },
        { id: "c", name: "Gamma", cost: 3, group: "silver" },
      ],
      groups: [],
      total: 18,
    });
    renderCost();
    const svg = (await screen.findByTestId("treemap")).querySelector(
      "svg",
    ) as unknown as HTMLElement;
    expect(within(svg).getAllByText("Gold")).toHaveLength(1);
    expect(within(svg).getAllByText("Silver")).toHaveLength(1);
  });

  it("translates the Group nodes of the sankey, and only those", async () => {
    saved.config = { view: "sankey", groupBy: "field:tier" };
    mockApi.on("get", "/reports/cost-sankey*", {
      nodes: [
        { id: "item:__other__", name: "__other__", type: "CostItem" },
        { id: "group:gold", name: "gold", type: "Group" },
        { id: "group:__other__", name: "__other__", type: "Group" },
        { id: "a", name: "A", type: "Application" },
      ],
      links: [],
      total: 0,
      fiscal_year: 2026,
      fiscal_year_start: 1,
    });
    renderCost();
    await screen.findByTestId("sankey");
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByTestId("sankey").getAttribute("data-names")!),
      ).toEqual(["Other costs", "Gold", "Unspecified", "{cardIdentity|apps} A · Application"]),
    );
  });

  it("shows Yes / No for a yes-no group on the sankey", async () => {
    withMetamodel(
      [
        makeCardType({
          key: "Application",
          label: "Application",
          fields_schema: [
            makeSection({
              section: "S",
              fields: [
                makeField({ key: "managed", label: "Managed", type: "boolean" }),
                sharedCost,
              ],
            }),
          ],
        }),
      ],
      [],
    );
    saved.config = { view: "sankey", groupBy: "field:managed" };
    mockApi.on("get", "/reports/cost-sankey*", {
      nodes: [
        { id: "group:true", name: "true", type: "Group" },
        { id: "group:false", name: "false", type: "Group" },
      ],
      links: [],
      total: 0,
      fiscal_year: 2026,
      fiscal_year_start: 1,
    });
    renderCost();
    await screen.findByTestId("sankey");
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByTestId("sankey").getAttribute("data-names")!),
      ).toEqual(["Yes", "No"]),
    );
  });

  it("re-sums the item->group links from the kept cards' own costs", async () => {
    saved.config = {
      view: "sankey",
      groupBy: "field:tier",
      scopeIds: ["a", "c"],
    };
    mockApi.on("get", "/reports/cost-scope*", {
      items: ["a", "b", "c", "d"].map((id) => ({ id, name: id, type: "Application", parent_id: null })),
      total: 4,
    });
    mockApi.on("get", "/reports/cost-sankey*", {
      nodes: [
        { id: "item:x", name: "X", type: "CostItem" }, // 0
        { id: "group:gold", name: "gold", type: "Group" }, // 1
        { id: "group:silver", name: "silver", type: "Group" }, // 2
        { id: "a", name: "A", type: "Application", cost: 6, costs: { x: 6 } }, // 3
        { id: "b", name: "B", type: "Application", cost: 4, costs: { x: 4 } }, // 4
        { id: "c", name: "C", type: "Application", cost: 8, costs: { x: 8 } }, // 5
        { id: "d", name: "D", type: "Application", cost: 0, costs: {} }, // 6
      ],
      links: [
        { source: 0, target: 1, value: 10 },
        { source: 0, target: 2, value: 8 },
        { source: 1, target: 3, value: 6 },
        { source: 1, target: 4, value: 4 },
        { source: 2, target: 5, value: 8 },
        { source: 2, target: 6, value: 0 },
      ],
      total: 18,
      fiscal_year: 2026,
      fiscal_year_start: 1,
    });
    renderCost();
    await screen.findByTestId("sankey");
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByTestId("sankey").getAttribute("data-nodes")!),
      ).toEqual(["item:x", "group:gold", "group:silver", "a", "c"]),
    );
    const links = JSON.parse(
      screen.getByTestId("sankey").getAttribute("data-links")!,
    ) as { source: number; target: number; value: number }[];
    for (const g of [1, 2]) {
      const into = links
        .filter((l) => l.target === g)
        .reduce((n, l) => n + l.value, 0);
      const out = links
        .filter((l) => l.source === g)
        .reduce((n, l) => n + l.value, 0);
      expect(Math.abs(into - out)).toBeLessThan(1e-9);
    }
    expect(links.every((l) => Number.isFinite(l.value))).toBe(true);
    // gold lost b (4 of 10): its item link is 6
    expect(links.find((l) => l.source === 0 && l.target === 1)!.value).toBeCloseTo(6);
  });

  it("never yields NaN when a scoped group loses every card", async () => {
    saved.config = { view: "sankey", groupBy: "field:tier", scopeIds: ["a"] };
    mockApi.on("get", "/reports/cost-scope*", {
      items: ["a", "b"].map((id) => ({ id, name: id, type: "Application", parent_id: null })),
      total: 2,
    });
    mockApi.on("get", "/reports/cost-sankey*", {
      nodes: [
        { id: "item:x", name: "X", type: "CostItem" },
        { id: "group:gold", name: "gold", type: "Group" },
        { id: "group:silver", name: "silver", type: "Group" },
        { id: "a", name: "A", type: "Application", cost: 4, costs: { x: 4 } },
        { id: "b", name: "B", type: "Application", cost: 0, costs: {} },
      ],
      links: [
        { source: 0, target: 1, value: 4 },
        { source: 0, target: 2, value: 0 },
        { source: 1, target: 3, value: 4 },
        { source: 2, target: 4, value: 0 },
      ],
      total: 4,
      fiscal_year: 2026,
      fiscal_year_start: 1,
    });
    renderCost();
    await screen.findByTestId("sankey");
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByTestId("sankey").getAttribute("data-nodes")!),
      ).toEqual(["item:x", "group:gold", "a"]),
    );
    const links = JSON.parse(
      screen.getByTestId("sankey").getAttribute("data-links")!,
    ) as { value: number }[];
    expect(links.every((l) => Number.isFinite(l.value))).toBe(true);
  });

  it("group labels are translated", async () => {
    saved.config = { view: "table", groupBy: "field:tier" };
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [
        { id: "a", name: "A", cost: 10, group: "gold" },
        { id: "b", name: "B", cost: 5, group: "__other__" },
      ],
      groups: [],
      total: 15,
    });
    renderCost();
    await screen.findByRole("table");
    expect(screen.getByText("Gold")).toBeInTheDocument();
    expect(screen.getByText("Unspecified")).toBeInTheDocument();
  });

  it("a linked card name is shown as is", async () => {
    saved.config = { view: "table", groupBy: "rel:relAppToOrg" };
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [{ id: "a", name: "A", cost: 10, group: "Finance" }],
      groups: [],
      total: 10,
    });
    renderCost();
    await screen.findByRole("table");
    expect(screen.getByText("Finance")).toBeInTheDocument();
  });

  it("treemap draws groups", async () => {
    saved.config = { view: "chart", groupBy: "field:tier" };
    mockApi.on("get", "/reports/cost-treemap*", {
      items: [
        { id: "a", name: "Alpha", cost: 10, group: "gold" },
        { id: "b", name: "Beta", cost: 5, group: "gold" },
      ],
      groups: [],
      total: 15,
    });
    renderCost();
    const svg = (await screen.findByTestId("treemap")).querySelector(
      "svg",
    ) as unknown as HTMLElement;
    // the group is a parent node, drawn before the cards it contains
    expect(within(svg).getByText("Gold")).toBeInTheDocument();
    expect(within(svg).getByText("Alpha")).toBeInTheDocument();
  });

  it("sankey scope filter removes dangling nodes", async () => {
    saved.config = { view: "sankey", scopeIds: ["a"] };
    mockApi.on("get", "/reports/cost-scope*", {
      items: [
        { id: "a", name: "A", type: "Application", parent_id: null },
        { id: "b", name: "B", type: "Application", parent_id: null },
      ],
      total: 2,
    });
    mockApi.on("get", "/reports/cost-sankey*", {
      nodes: [
        { id: "item:x", name: "X", type: "CostItem" },
        { id: "group:gold", name: "gold", type: "Group" },
        { id: "group:silver", name: "silver", type: "Group" },
        { id: "a", name: "A", type: "Application", cost: 10, costs: { x: 10 } },
        { id: "b", name: "B", type: "Application", cost: 5, costs: { x: 5 } },
      ],
      links: [
        { source: 0, target: 1, value: 10 },
        { source: 0, target: 2, value: 5 },
        { source: 1, target: 3, value: 10 },
        { source: 2, target: 4, value: 5 },
      ],
      total: 15,
      fiscal_year: 2026,
      fiscal_year_start: 1,
    });
    renderCost();
    await screen.findByTestId("sankey");
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByTestId("sankey").getAttribute("data-nodes")!),
      ).toEqual(["item:x", "group:gold", "a"]),
    );
    expect(
      JSON.parse(screen.getByTestId("sankey").getAttribute("data-links")!),
    ).toEqual([
      { source: 0, target: 1, value: 10 },
      { source: 1, target: 2, value: 10 },
    ]);
  });
});
