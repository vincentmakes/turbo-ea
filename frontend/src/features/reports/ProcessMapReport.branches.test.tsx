/**
 * Branch coverage for the Process Map beyond its scope filter and column
 * picker (ProcessMapReport.test.tsx): the heatmap metrics and their legends,
 * display depth, related-card chips, the detail drawer and its drill-down
 * zoom, the Organization / Business Context filters and the empty states.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useCurrency", () => import("@/test/hooks").then((m) => m.useCurrencyModule()));

const saved = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  resetAll: (() => {}) as () => void,
  persistConfig: (() => {}) as (cfg: unknown) => void,
}));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: () => ({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: () => {},
    loadedConfig: null,
    consumeConfig: () => saved.config,
    resetSavedReport: () => {},
    persistConfig: saved.persistConfig,
    resetAll: saved.resetAll,
    reportType: "process-map",
  }),
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

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import {
  APPLICATION_TYPE,
  makeCardType,
  makeField,
  makeOption,
  makeSection,
} from "@/test/fixtures/metamodel";
import ProcessMapReport from "./ProcessMapReport";

const BP_TYPE = makeCardType({
  key: "BusinessProcess",
  label: "Business Process",
  has_hierarchy: true,
  fields_schema: [
    makeSection({
      section: "Process",
      fields: [
        makeField({
          key: "processType",
          label: "Process Type",
          type: "single_select",
          options: [
            makeOption({ key: "core", label: "Core", color: "#1976d2" }),
            makeOption({ key: "support", label: "Support", color: "#607d8b" }),
          ],
        }),
      ],
    }),
  ],
});

const APP_A = {
  id: "app-a",
  name: "Alpha App",
  subtype: "businessApplication",
  attributes: { costTotalAnnual: 100 },
  lifecycle: { endOfLife: "2025-01-01" },
};
const APP_B = { id: "app-b", name: "Beta App", attributes: { totalAnnualCost: 50 } };
const APP_C = { id: "app-c", name: "Gamma App", attributes: {} };

const proc = (over: Record<string, unknown> & { id: string; name: string }) => ({
  subtype: "process",
  parent_id: null,
  attributes: {},
  lifecycle: {},
  app_count: 0,
  total_cost: 0,
  apps: [],
  data_objects: [],
  org_ids: [],
  ctx_ids: [],
  ...over,
});

/**
 *  Order to Cash (category)          apps: Gamma (own) · do: Ledger
 *    ├─ Collections (variant)
 *    └─ Invoicing (group)            apps: Beta · do: Invoice
 *         └─ Send Invoice (process)  apps: Alpha
 *  Hire to Retire (unknown subtype)
 */
const ITEMS = [
  proc({
    id: "otc",
    name: "Order to Cash",
    subtype: "category",
    attributes: { maturity: "defined", riskLevel: "high", automationLevel: "partially", processType: "core" },
    apps: [APP_C],
    data_objects: [{ id: "do-ledger", name: "Ledger" }],
    org_ids: ["org-1"],
    ctx_ids: ["ctx-1"],
  }),
  proc({ id: "col", name: "Collections", subtype: "variant", parent_id: "otc" }),
  proc({
    id: "inv",
    name: "Invoicing",
    subtype: "group",
    parent_id: "otc",
    attributes: { maturity: "optimized" },
    apps: [APP_B],
    data_objects: [{ id: "do-invoice", name: "Invoice" }],
    org_ids: ["org-1"],
  }),
  proc({
    id: "send",
    name: "Send Invoice",
    parent_id: "inv",
    attributes: { processType: "support", automationLevel: "fully", riskLevel: "critical" },
    apps: [APP_A],
    org_ids: ["org-2"],
  }),
  proc({ id: "hire", name: "Hire to Retire", subtype: "foo", ctx_ids: ["ctx-2"] }),
];

function reply(items = ITEMS, extra: Record<string, unknown> = {}) {
  mockApi.on("get", "/reports/bpm/process-map", {
    items,
    organizations: [
      { id: "org-1", name: "Sales" },
      { id: "org-2", name: "Finance" },
    ],
    business_contexts: [{ id: "ctx-1", name: "Retail" }],
    ...extra,
  });
}

function renderMap() {
  return render(
    <MemoryRouter>
      <ProcessMapReport />
    </MemoryRouter>,
  );
}

const chart = () => document.querySelector(".report-chart-area") as HTMLElement;
const legend = () => document.querySelector(".report-legend") as HTMLElement;
const drawer = () => screen.getByRole("presentation");

async function pick(label: RegExp, option: RegExp) {
  // The request the caller waited on is recorded when it is sent, not when its
  // response renders, so the toolbar may still be behind a spinner here.
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }, { timeout: 5000 }));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
}

async function openDrawerFor(name: string) {
  fireEvent.click(within(chart()).getByText(name));
  return screen.findByRole("presentation");
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel([BP_TYPE, APPLICATION_TYPE]);
  saved.config = null;
  saved.resetAll = vi.fn();
  saved.persistConfig = vi.fn();
  reply();
});

describe("ProcessMapReport heatmap metrics", () => {
  it("shows a spinner until the map loads", () => {
    mockApi.on("get", "/reports/bpm/process-map", () => new Promise(() => {}));
    renderMap();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("labels each card with its maturity and lists the maturity scale", async () => {
    renderMap();
    await within(document.body).findByText("Order to Cash");
    // Display depth 2 by default: Invoicing is a leaf at level 2.
    expect(within(chart()).getByText("5 - Optimized")).toBeInTheDocument();
    // A process without a maturity gets a dash.
    expect(within(chart()).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(legend()).getByText("1 - Initial")).toBeInTheDocument();
    expect(within(legend()).getByText("Core")).toBeInTheDocument();
    // Subtype chips: known ones are labelled, an unknown one is not.
    expect(within(chart()).getByText("Category")).toBeInTheDocument();
    expect(within(chart()).getByText("Variant")).toBeInTheDocument();
    expect(within(chart()).queryByText("foo")).not.toBeInTheDocument();
  });

  it("switches the legend and labels for automation and risk", async () => {
    saved.config = { displayLevel: 3 };
    renderMap();
    await within(document.body).findByText("Send Invoice");
    await pick(/heatmap metric/i, /Automation Level/);
    expect(within(legend()).getByText("Partially Automated")).toBeInTheDocument();
    expect(within(chart()).getByText("Fully Automated")).toBeInTheDocument();
    // The process-type chip on the leaf.
    expect(within(chart()).getByText("Support")).toBeInTheDocument();

    await pick(/heatmap metric/i, /Risk Level/);
    expect(within(legend()).getByText("Critical")).toBeInTheDocument();
    expect(within(chart()).getByText("Critical")).toBeInTheDocument();
  });

  it("draws a low-to-high gradient with the maximum for app count and cost", async () => {
    saved.config = { metric: "app_count" };
    renderMap();
    await within(document.body).findByText("Order to Cash");
    expect(within(legend()).getByText("Low")).toBeInTheDocument();
    expect(within(legend()).getByText("High")).toBeInTheDocument();
    // Hire to Retire is a root leaf with no apps; Order to Cash rolls up three.
    expect(within(legend()).getByText("Max: 3")).toBeInTheDocument();
    expect(within(chart()).getByText("3 apps")).toBeInTheDocument();

    await pick(/heatmap metric/i, /Total Cost/);
    // Alpha (costTotalAnnual 100) + Beta (totalAnnualCost 50) + Gamma (none).
    expect(within(legend()).getByText("Max: $150")).toBeInTheDocument();
    expect(within(chart()).getByText("$150")).toBeInTheDocument();
  });
});

describe("ProcessMapReport depth and related cards", () => {
  it("reveals deeper levels and lists every level up to the deepest", async () => {
    renderMap();
    await within(document.body).findByText("Order to Cash");
    expect(within(chart()).queryByText("Send Invoice")).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /display depth/i }));
    const options = within(await screen.findByRole("listbox"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["Level 1", "Level 2", "Level 3", "All levels"]);
    fireEvent.click(screen.getByRole("option", { name: "All levels" }));
    expect(await within(chart()).findByText("Send Invoice")).toBeInTheDocument();
  });

  it("pulls a stored depth deeper than the tree back to its deepest level", async () => {
    saved.config = { displayLevel: 7 };
    renderMap();
    await within(document.body).findByText("Order to Cash");
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /display depth/i })).toHaveTextContent("Level 3"),
    );
  });

  it("shows applications as chips, each only where it is not shown further down", async () => {
    saved.config = { showRelated: "apps", displayLevel: 3 };
    renderMap();
    await within(document.body).findByText("Send Invoice");
    // Gamma hangs on Order to Cash itself; Beta on Invoicing; Alpha on the leaf.
    expect(within(chart()).getAllByText("Gamma App")).toHaveLength(1);
    expect(within(chart()).getAllByText("Beta App")).toHaveLength(1);
    expect(within(chart()).getAllByText("Alpha App")).toHaveLength(1);

    fireEvent.click(within(chart()).getByText("Alpha App"));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("app-a");
    // The chip click does not open the process drawer underneath.
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "close-panel" }));
    expect(screen.queryByTestId("side-panel")).not.toBeInTheDocument();

    fireEvent.click(within(chart()).getByText("Gamma App"));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("app-c");
  });

  it("rolls a collapsed branch's apps up into its leaf card", async () => {
    saved.config = { showRelated: "apps", displayLevel: 1 };
    renderMap();
    await within(document.body).findByText("Order to Cash");
    for (const name of ["Alpha App", "Beta App", "Gamma App"]) {
      expect(within(chart()).getByText(name)).toBeInTheDocument();
    }
  });

  it("shows data objects instead when asked", async () => {
    saved.config = { showRelated: "data_objects" };
    renderMap();
    await within(document.body).findByText("Order to Cash");
    // Ledger is Order to Cash's own; Invoice lives on the Invoicing leaf.
    expect(within(chart()).getByText("Ledger")).toBeInTheDocument();
    expect(within(chart()).getByText("Invoice")).toBeInTheDocument();
    await pick(/show related/i, /^None$/);
    expect(within(chart()).queryByText("Ledger")).not.toBeInTheDocument();
  });
});

describe("ProcessMapReport detail drawer", () => {
  it("opens a leaf with its metadata, apps, data objects and inventory link", async () => {
    saved.config = { displayLevel: 3 };
    renderMap();
    await within(document.body).findByText("Send Invoice");
    const panel = await openDrawerFor("Send Invoice");
    expect(within(panel).getByRole("heading", { name: "Send Invoice" })).toBeInTheDocument();
    expect(within(panel).getByText("Process")).toBeInTheDocument();
    expect(within(panel).getByText("Support")).toBeInTheDocument();
    expect(within(panel).getByText("Risk: Critical")).toBeInTheDocument();
    expect(within(panel).getByText("Fully Automated")).toBeInTheDocument();
    expect(within(panel).getByText("Applications (1)")).toBeInTheDocument();
    // Alpha resolves its Application subtype and carries an end-of-life warning.
    expect(within(panel).getByText("Business Application")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: /view in inventory/i })).toBeInTheDocument();
    // A leaf cannot be zoomed into.
    expect(within(panel).queryByText("Drill Down")).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByText("Alpha App"));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("app-a");
  });

  it("opens the process card itself", async () => {
    renderMap();
    await within(document.body).findByText("Hire to Retire");
    const panel = await openDrawerFor("Hire to Retire");
    expect(within(panel).getByText("No linked applications")).toBeInTheDocument();
    fireEvent.click(within(panel).getByText("Open Card"));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("hire");
    await waitFor(() => expect(screen.queryByRole("presentation")).not.toBeInTheDocument());
  });

  it("lists a branch's sub-processes and data objects, and walks into a child", async () => {
    renderMap();
    await within(document.body).findByText("Order to Cash");
    const panel = await openDrawerFor("Order to Cash");
    expect(within(panel).getByText("Category")).toBeInTheDocument();
    expect(within(panel).getByText("3 - Defined")).toBeInTheDocument();
    expect(within(panel).getByText("Risk: High")).toBeInTheDocument();
    expect(within(panel).getByText("Partially Automated")).toBeInTheDocument();
    expect(within(panel).getByText("Sub-Processes (2)")).toBeInTheDocument();
    expect(within(panel).getByText("Data Objects (2)")).toBeInTheDocument();
    // A branch has no inventory link: the panel lists more than one relation covers.
    expect(within(panel).queryByRole("link", { name: /view in inventory/i })).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByText("Ledger"));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("do-ledger");
  });

  it("swaps to a sub-process when its chip is clicked, and closes", async () => {
    const user = userEvent.setup();
    renderMap();
    await within(document.body).findByText("Order to Cash");
    const panel = await openDrawerFor("Order to Cash");
    fireEvent.click(within(panel).getByText("Invoicing (2)"));
    expect(within(drawer()).getByRole("heading", { name: "Invoicing" })).toBeInTheDocument();
    await user.click(within(drawer()).getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("presentation")).not.toBeInTheDocument());
  });

  it("zooms into a branch, deeper, and back out through the breadcrumbs", async () => {
    saved.config = { displayLevel: 99 };
    renderMap();
    await within(document.body).findByText("Order to Cash");
    let panel = await openDrawerFor("Order to Cash");
    fireEvent.click(within(panel).getByText("Drill Down"));
    await waitFor(() => expect(screen.queryByRole("presentation")).not.toBeInTheDocument());

    const crumbs = () => screen.getByRole("navigation");
    expect(within(crumbs()).getByText("Order to Cash")).toBeInTheDocument();
    expect(within(chart()).queryByText("Hire to Retire")).not.toBeInTheDocument();

    panel = await openDrawerFor("Invoicing");
    fireEvent.click(within(panel).getByText("Drill Down"));
    await waitFor(() => expect(within(crumbs()).getByText("Invoicing")).toBeInTheDocument());
    expect(within(chart()).queryByText("Collections")).not.toBeInTheDocument();

    fireEvent.click(within(crumbs()).getByRole("button", { name: "Order to Cash" }));
    await waitFor(() => expect(within(chart()).getByText("Collections")).toBeInTheDocument());

    fireEvent.click(within(crumbs()).getByRole("button", { name: "All Processes" }));
    await waitFor(() => expect(within(chart()).getByText("Hire to Retire")).toBeInTheDocument());
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});

describe("ProcessMapReport filters and empty states", () => {
  it("keeps a filtered process's ancestors so the hierarchy survives", async () => {
    saved.config = { filterOrgs: ["org-2"], displayLevel: 99 };
    renderMap();
    await within(document.body).findByText("Send Invoice");
    expect(within(chart()).getByText("Order to Cash")).toBeInTheDocument();
    expect(within(chart()).getByText("Invoicing")).toBeInTheDocument();
    expect(within(chart()).queryByText("Collections")).not.toBeInTheDocument();
    expect(within(chart()).queryByText("Hire to Retire")).not.toBeInTheDocument();
  });

  it("narrows by business context and clears every filter at once", async () => {
    saved.config = { filterCtxs: ["ctx-2"], filterOrgs: ["org-9"] };
    renderMap();
    expect(
      await screen.findByText("No processes match the current filters."),
    ).toBeInTheDocument();

    const clear = screen.getByText("Clear all").closest(".MuiChip-root") as HTMLElement;
    fireEvent.click(within(clear).getByTestId("CancelIcon"));
    expect(await within(chart()).findByText("Hire to Retire")).toBeInTheDocument();
    expect(within(chart()).getByText("Order to Cash")).toBeInTheDocument();
  });

  it("keeps processes matching a business context", async () => {
    saved.config = { filterCtxs: ["ctx-2"] };
    renderMap();
    expect(await within(document.body).findByText("Hire to Retire")).toBeInTheDocument();
    expect(within(chart()).queryByText("Order to Cash")).not.toBeInTheDocument();
  });

  it("explains an empty landscape, without org or context filters to offer", async () => {
    mockApi.on("get", "/reports/bpm/process-map", { items: [] });
    renderMap();
    expect(
      await screen.findByText(/No Business Processes found/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Business Context")).not.toBeInTheDocument();
  });

  it("resets every control to its default", async () => {
    saved.config = { metric: "risk", displayLevel: 3, showRelated: "apps", filterOrgs: ["org-2"] };
    renderMap();
    await within(document.body).findByText("Send Invoice");
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(saved.resetAll).toHaveBeenCalled();
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({
          metric: "maturity",
          displayLevel: 2,
          showRelated: "none",
          filterOrgs: [],
          filterCtxs: [],
          scopeIds: [],
        }),
      ),
    );
    expect(within(chart()).queryByText("Send Invoice")).not.toBeInTheDocument();
  });
});
