/**
 * Behaviour the Process Map's other two suites do not pin down: the heat
 * colours each process is painted with (the report's whole encoding), the
 * metric label per card, the hierarchy's ordering and robustness, which
 * related cards each card lists at each display depth, the drawer's contents,
 * the print-parameter summary and the saved-report config round-trip.
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
  loaded: null as unknown,
  reportTypes: [] as string[],
  resetAll: (() => {}) as () => void,
  persistConfig: (() => {}) as (cfg: unknown) => void,
}));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: (reportType: string) => {
    saved.reportTypes.push(reportType);
    return {
      savedReport: null,
      savedReportName: null,
      saveDialogOpen: false,
      setSaveDialogOpen: () => {},
      loadedConfig: saved.loaded,
      consumeConfig: () => saved.config,
      resetSavedReport: () => {},
      persistConfig: saved.persistConfig,
      resetAll: saved.resetAll,
      reportType,
    };
  },
}));

vi.mock("@/components/CardDetailSidePanel", () => ({
  default: (props: { cardId: string | null; open: boolean }) =>
    props.open ? <div data-testid="side-panel">{props.cardId}</div> : null,
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
// Colours distinct from the static CARD_TYPE_COLORS tokens, so a chip coloured
// from the metamodel can be told apart from one using the fallback.
const APP_TYPE = { ...APPLICATION_TYPE, color: "#aa5500" };
const DO_TYPE = makeCardType({ key: "DataObject", label: "Data Object", color: "#5500aa" });

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
 *  Order to Cash (category)  maturity 3 · risk high · automation partially
 *    ├─ Collections (variant)
 *    └─ Invoicing (group)            maturity 5
 *         └─ Send Invoice (process)  risk critical · automation fully
 *  Hire to Retire (unknown subtype)
 *
 * Apps: Gamma on Order to Cash, Beta on Invoicing, Alpha on Send Invoice —
 * so Order to Cash's roll-up meets them in the order Gamma, Beta, Alpha.
 * Data objects: Ledger on Order to Cash, Invoice on Invoicing.
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

function reply(items: unknown[] = ITEMS) {
  mockApi.on("get", "/reports/bpm/process-map", {
    items,
    organizations: [
      { id: "org-1", name: "Sales" },
      { id: "org-2", name: "Finance" },
    ],
    business_contexts: [{ id: "ctx-1", name: "Retail" }],
  });
}

const ui = () => (
  <MemoryRouter>
    <ProcessMapReport />
  </MemoryRouter>
);
const renderMap = () => render(ui());

const chart = () => document.querySelector(".report-chart-area") as HTMLElement;
const toolbar = () => document.querySelector(".report-toolbar") as HTMLElement;
const legend = () => document.querySelector(".report-legend") as HTMLElement;

/** The print-only parameter summary, one `Label: value` string per entry. */
const printParams = () =>
  Array.from(document.querySelectorAll(".report-print-params > *")).map((el) =>
    (el.textContent ?? "").replace(/\|$/, "").trim(),
  );

/** A card's header row: the title plus its chips, painted with the heat colour. */
const header = (name: string) => within(chart()).getByText(name).parentElement as HTMLElement;
const heat = (name: string) => getComputedStyle(header(name)).backgroundColor;
const titleColor = (name: string) => getComputedStyle(within(chart()).getByText(name)).color;
const headerChips = (name: string) =>
  Array.from(header(name).querySelectorAll(".MuiChip-label")).map((e) => e.textContent);
/** The related-card chips a card lists right under its header. */
const relatedChips = (name: string) =>
  Array.from(header(name).nextElementSibling?.children ?? [])
    .filter((el) => el.classList.contains("MuiChip-root"))
    .map((el) => el.textContent);
const relatedChip = (name: string) =>
  within(chart()).getByText(name).closest(".MuiChip-root") as HTMLElement;
/** Every card title in document order. */
const titles = () =>
  Array.from(chart().querySelectorAll(".MuiTypography-subtitle2")).map((e) => e.textContent);

const GRAY = "rgba(128, 128, 128, 0.1)";
const WHITE_TEXT = "rgb(255, 255, 255)";
const DARK_TEXT = "rgb(51, 51, 51)";

async function pick(label: RegExp, option: RegExp) {
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }, { timeout: 5000 }));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
}

async function openDrawerFor(name: string) {
  fireEvent.click(within(chart()).getByText(name));
  return screen.findByRole("presentation");
}

/** The two drawer lists' primary lines: [applications, data objects]. */
const drawerLists = (panel: HTMLElement) =>
  within(panel)
    .getAllByRole("list")
    .map((list) =>
      Array.from(list.querySelectorAll(".MuiListItemText-primary")).map((e) => e.textContent),
    );

/** The value shown above a drawer metric's caption. */
const drawerMetric = (panel: HTMLElement, label: string) =>
  within(panel).getByText(label, { selector: ".MuiTypography-caption" }).previousElementSibling
    ?.textContent;

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel([BP_TYPE, APP_TYPE, DO_TYPE]);
  saved.config = null;
  saved.loaded = null;
  saved.reportTypes = [];
  saved.resetAll = vi.fn();
  saved.persistConfig = vi.fn();
  reply();
});

describe("ProcessMapReport heat colours", () => {
  it("paints maturity green relative to the best process, grey where unset", async () => {
    renderMap();
    await within(document.body).findByText("Order to Cash");
    // Invoicing (5) sets the maximum; Order to Cash (3) sits at 60% of it.
    expect(heat("Invoicing")).toBe("rgb(42, 125, 45)");
    expect(heat("Order to Cash")).toBe("rgb(127, 177, 129)");
    expect(heat("Hire to Retire")).toBe(GRAY);
    expect(heat("Collections")).toBe(GRAY);
    // Only a process well above the middle of the scale switches to white text.
    expect(titleColor("Invoicing")).toBe(WHITE_TEXT);
    expect(titleColor("Order to Cash")).toBe(DARK_TEXT);
    expect(titleColor("Hire to Retire")).toBe(DARK_TEXT);
  });

  it("paints application counts blue and draws the matching five-step gradient", async () => {
    saved.config = { metric: "app_count" };
    renderMap();
    await within(document.body).findByText("Order to Cash");
    // Order to Cash rolls up three apps (the maximum), Invoicing two.
    expect(heat("Order to Cash")).toBe("rgb(25, 90, 202)");
    expect(heat("Invoicing")).toBe("rgb(92, 141, 219)");
    expect(heat("Collections")).toBe(GRAY);
    expect(titleColor("Order to Cash")).toBe(WHITE_TEXT);
    expect(titleColor("Invoicing")).toBe(WHITE_TEXT);

    const swatches = within(legend()).getByText("Low").nextElementSibling as HTMLElement;
    expect(Array.from(swatches.children).map((s) => getComputedStyle(s).backgroundColor)).toEqual([
      GRAY,
      "rgb(177, 204, 240)",
      "rgb(126, 166, 228)",
      "rgb(76, 128, 215)",
      "rgb(25, 90, 202)",
    ]);
  });

  it("paints automation green and risk red", async () => {
    saved.config = { metric: "automation", displayLevel: 3 };
    renderMap();
    await within(document.body).findByText("Send Invoice");
    expect(heat("Send Invoice")).toBe("rgb(42, 125, 45)");
    expect(heat("Order to Cash")).toBe("rgb(113, 168, 115)");
    expect(heat("Invoicing")).toBe(GRAY);

    await pick(/heatmap metric/i, /Risk Level/);
    expect(heat("Send Invoice")).toBe("rgb(200, 48, 40)");
    expect(heat("Order to Cash")).toBe("rgb(214, 100, 94)");
    expect(heat("Invoicing")).toBe(GRAY);
  });

  it("keeps dark text on a card sitting exactly at the contrast threshold", async () => {
    const apps = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}`, name: `${prefix} ${i}` }));
    reply([
      proc({ id: "big", name: "Big", apps: apps("big", 20) }),
      proc({ id: "mid", name: "Mid", apps: apps("mid", 13) }),
    ]);
    saved.config = { metric: "app_count" };
    renderMap();
    await within(document.body).findByText("Mid");
    // 13 of 20 is exactly 65%: not *above* the threshold, so the text stays dark.
    expect(titleColor("Mid")).toBe(DARK_TEXT);
    expect(titleColor("Big")).toBe(WHITE_TEXT);
  });
});

describe("ProcessMapReport card labels", () => {
  it("labels leaves with the metric and branches with their app roll-up", async () => {
    renderMap();
    await within(document.body).findByText("Order to Cash");
    expect(headerChips("Order to Cash")).toEqual(["Category", "3 apps"]);
    expect(headerChips("Invoicing")).toEqual(["Group", "5 - Optimized"]);
    expect(headerChips("Collections")).toEqual(["Variant", "—"]);
    // A root with no children is a leaf too, whatever the display depth.
    expect(headerChips("Hire to Retire")).toEqual(["—"]);
  });

  it("labels application counts, automation and risk, with a dash where unset", async () => {
    saved.config = { metric: "app_count" };
    renderMap();
    await within(document.body).findByText("Order to Cash");
    expect(headerChips("Invoicing")).toEqual(["Group", "2"]);
    expect(headerChips("Hire to Retire")).toEqual(["0"]);

    await pick(/heatmap metric/i, /Automation Level/);
    expect(headerChips("Invoicing")).toEqual(["Group", "—"]);

    await pick(/heatmap metric/i, /Risk Level/);
    expect(headerChips("Invoicing")).toEqual(["Group", "—"]);
  });

  it("falls back to a dash, uncoloured, for a metric it does not know", async () => {
    reply([proc({ id: "x", name: "Risky", attributes: { riskLevel: "critical", maturity: "optimized" } })]);
    saved.config = { metric: "bogus" };
    renderMap();
    await within(document.body).findByText("Risky");
    expect(headerChips("Risky")).toEqual(["Process", "—"]);
    expect(heat("Risky")).toBe(GRAY);
    expect(printParams()).toContain("Metric: bogus");
  });

  it("titles the legend after the selected scale", async () => {
    renderMap();
    await within(document.body).findByText("Order to Cash");
    expect(within(legend()).getByText("Maturity (CMMI):")).toBeInTheDocument();
    await pick(/heatmap metric/i, /Automation Level/);
    expect(within(legend()).getByText("Automation Level:")).toBeInTheDocument();
    await pick(/heatmap metric/i, /Risk Level/);
    expect(within(legend()).getByText("Risk Level:")).toBeInTheDocument();
  });
});

describe("ProcessMapReport hierarchy", () => {
  /**
   *  Zulu Root   apps: Zeta, Echo
   *    ├─ Yankee
   *    └─ Bravo
   *  Alpha Root  apps: Mike, Delta
   *
   * Everything is delivered out of alphabetical order.
   */
  const UNSORTED = [
    proc({
      id: "z",
      name: "Zulu Root",
      apps: [
        { id: "zeta", name: "Zeta App" },
        { id: "echo", name: "Echo App" },
      ],
    }),
    proc({ id: "y", name: "Yankee", parent_id: "z" }),
    proc({ id: "b", name: "Bravo", parent_id: "z" }),
    proc({
      id: "a",
      name: "Alpha Root",
      apps: [
        { id: "mike", name: "Mike App" },
        { id: "delta", name: "Delta App" },
      ],
    }),
  ];

  it("orders roots, children and their related chips alphabetically", async () => {
    reply(UNSORTED);
    saved.config = { showRelated: "apps" };
    renderMap();
    await within(document.body).findByText("Yankee");
    expect(titles()).toEqual(["Alpha Root", "Zulu Root", "Bravo", "Yankee"]);
    expect(relatedChips("Alpha Root")).toEqual(["Delta App", "Mike App"]);
    expect(relatedChips("Zulu Root")).toEqual(["Echo App", "Zeta App"]);

    const panel = await openDrawerFor("Zulu Root");
    const subChip = (label: string) => within(panel).getByText(label).closest(".MuiChip-root");
    expect(subChip("Bravo (0)")?.nextElementSibling).toBe(subChip("Yankee (0)"));
  });

  it("draws a process whose parent is missing from the payload as a root", async () => {
    reply([...ITEMS, proc({ id: "orphan", name: "Orphan", parent_id: "ghost" })]);
    renderMap();
    expect(await within(document.body).findByText("Orphan")).toBeInTheDocument();
    expect(titles()).toEqual(["Hire to Retire", "Order to Cash", "Collections", "Invoicing", "Orphan"]);
  });

  it("survives a cyclic parent chain above a filtered process", async () => {
    reply([
      proc({ id: "x", name: "Standalone", org_ids: ["org-1"] }),
      proc({ id: "la", name: "Loop A", parent_id: "lb", org_ids: ["org-1"] }),
      proc({ id: "lb", name: "Loop B", parent_id: "lc" }),
      proc({ id: "lc", name: "Loop C", parent_id: "lb" }),
    ]);
    saved.config = { filterOrgs: ["org-1"] };
    renderMap();
    expect(await within(document.body).findByText("Standalone")).toBeInTheDocument();
  });

  it("nests each level's grid one step deeper than its parent's", async () => {
    saved.config = { columns: 1, displayLevel: 3 };
    renderMap();
    await within(document.body).findByText("Send Invoice");
    const colsAround = (name: string) =>
      within(chart())
        .getByText(name)
        .closest("[data-nested-cols]")
        ?.getAttribute("data-nested-cols");
    // Depth 2 (Invoicing) gets three tracks, depth 3 (Send Invoice) two.
    expect(colsAround("Invoicing")).toBe("3");
    expect(colsAround("Send Invoice")).toBe("2");
  });
});

describe("ProcessMapReport related chips", () => {
  it("rolls a collapsed branch's apps up into its leaf in alphabetical order", async () => {
    saved.config = { showRelated: "apps", displayLevel: 1 };
    renderMap();
    await within(document.body).findByText("Order to Cash");
    expect(relatedChips("Order to Cash")).toEqual(["Alpha App", "Beta App", "Gamma App"]);
  });

  it("rolls a collapsed branch's data objects up into its leaf", async () => {
    saved.config = { showRelated: "data_objects", displayLevel: 1 };
    renderMap();
    await within(document.body).findByText("Order to Cash");
    expect(relatedChips("Order to Cash")).toEqual(["Invoice", "Ledger"]);
  });

  it("lists a card shared with a child only on the child", async () => {
    reply([
      proc({
        id: "p",
        name: "Parent",
        apps: [
          { id: "shared", name: "Shared App" },
          { id: "own", name: "Own App" },
        ],
        data_objects: [
          { id: "shared-do", name: "Shared Data" },
          { id: "own-do", name: "Own Data" },
        ],
      }),
      proc({
        id: "c",
        name: "Child",
        parent_id: "p",
        apps: [{ id: "shared", name: "Shared App" }],
        data_objects: [{ id: "shared-do", name: "Shared Data" }],
      }),
    ]);
    saved.config = { showRelated: "apps" };
    renderMap();
    await within(document.body).findByText("Child");
    expect(relatedChips("Parent")).toEqual(["Own App"]);
    expect(relatedChips("Child")).toEqual(["Shared App"]);

    await pick(/show related/i, /^Data Objects$/);
    expect(relatedChips("Parent")).toEqual(["Own Data"]);
    expect(relatedChips("Child")).toEqual(["Shared Data"]);
  });

  it("adds and moves the chips when the controls change after load", async () => {
    renderMap();
    await within(document.body).findByText("Order to Cash");
    expect(relatedChips("Invoicing")).toEqual([]);

    await pick(/show related/i, /^Applications$/);
    expect(relatedChips("Invoicing")).toEqual(["Alpha App", "Beta App"]);
    expect(relatedChips("Order to Cash")).toEqual(["Gamma App"]);

    await pick(/display depth/i, /^Level 1$/);
    expect(relatedChips("Order to Cash")).toEqual(["Alpha App", "Beta App", "Gamma App"]);

    await pick(/show related/i, /^Data Objects$/);
    expect(relatedChips("Order to Cash")).toEqual(["Invoice", "Ledger"]);
  });

  it("carries no related chips when none are shown", async () => {
    renderMap();
    await within(document.body).findByText("Hire to Retire");
    const card = header("Hire to Retire").parentElement as HTMLElement;
    expect(card.querySelectorAll(".MuiChip-root")).toHaveLength(1);
  });

  it("colours related chips with their card type's metamodel colour", async () => {
    saved.config = { showRelated: "apps" };
    renderMap();
    await within(document.body).findByText("Gamma App");
    expect(getComputedStyle(relatedChip("Gamma App")).backgroundColor).toBe("rgb(170, 85, 0)");
    await pick(/show related/i, /^Data Objects$/);
    expect(getComputedStyle(relatedChip("Ledger")).backgroundColor).toBe("rgb(85, 0, 170)");
  });

  it("falls back to the static type colours when the metamodel lacks the types", async () => {
    withMetamodel([BP_TYPE]);
    saved.config = { showRelated: "apps" };
    renderMap();
    await within(document.body).findByText("Gamma App");
    expect(getComputedStyle(relatedChip("Gamma App")).backgroundColor).toBe("rgb(15, 126, 181)");
    await pick(/show related/i, /^Data Objects$/);
    expect(getComputedStyle(relatedChip("Ledger")).backgroundColor).toBe("rgb(119, 79, 204)");
  });
});

describe("ProcessMapReport print parameters", () => {
  it("summarises the defaults", async () => {
    renderMap();
    await within(document.body).findByText("Order to Cash");
    expect(printParams()).toEqual(["Metric: Maturity (CMMI)", "Depth: Level 2", "Columns: 3"]);
  });

  it("adds scope, related cards and the named filters", async () => {
    saved.config = {
      scopeIds: ["otc"],
      showRelated: "apps",
      displayLevel: 99,
      filterOrgs: ["org-2", "org-unknown"],
      filterCtxs: ["ctx-1", "ctx-unknown"],
    };
    renderMap();
    // No process matches both filters; the summary still names them.
    await screen.findByText("No processes match the current filters.");
    expect(printParams()).toEqual([
      "Metric: Maturity (CMMI)",
      "Depth: All levels",
      "Columns: 3",
      "Scope: 1 process",
      "Show Related: Applications",
      "Organization: Finance, org-unknown",
      "Business Context: Retail, ctx-unknown",
    ]);
    // "All levels" is a sentinel, never clamped to the deepest level.
    expect(screen.getByRole("combobox", { name: /display depth/i })).toHaveTextContent("All levels");
  });

  it("names data objects, and follows the controls as they change", async () => {
    saved.config = { showRelated: "data_objects" };
    renderMap();
    await within(document.body).findByText("Order to Cash");
    expect(printParams()).toContain("Show Related: Data Objects");

    await pick(/heatmap metric/i, /Risk Level/);
    expect(printParams()).toContain("Metric: Risk Level");
  });

  it("omits a stored depth that matches no level", async () => {
    saved.config = { displayLevel: 0 };
    renderMap();
    await within(document.body).findByText("Order to Cash");
    expect(printParams()).toEqual(["Metric: Maturity (CMMI)", "Columns: 3"]);
  });
});

describe("ProcessMapReport saved config", () => {
  it("registers as the process-map report and persists the defaults", async () => {
    renderMap();
    await within(document.body).findByText("Order to Cash");
    expect(new Set(saved.reportTypes)).toEqual(new Set(["process-map"]));
    expect(saved.persistConfig).toHaveBeenLastCalledWith({
      metric: "maturity",
      displayLevel: 2,
      columns: 3,
      showRelated: "none",
      filterOrgs: [],
      filterCtxs: [],
      scopeIds: [],
    });
  });

  it("keeps the default metric and related cards when the config omits them", async () => {
    saved.config = { displayLevel: 3 };
    renderMap();
    await within(document.body).findByText("Send Invoice");
    expect(printParams()).toEqual(["Metric: Maturity (CMMI)", "Depth: Level 3", "Columns: 3"]);
    expect(screen.getByRole("combobox", { name: /show related/i })).toHaveTextContent("None");
  });

  it("drops non-string scope ids before persisting them", async () => {
    saved.config = { scopeIds: [42, "otc", null] };
    renderMap();
    await within(document.body).findByText("Order to Cash");
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ scopeIds: ["otc"] }),
      ),
    );
  });

  it("persists every control change", async () => {
    renderMap();
    await within(document.body).findByText("Order to Cash");
    await pick(/heatmap metric/i, /Risk Level/);
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ metric: "risk" }),
      ),
    );
  });

  it("applies a saved report loaded after the page opened", async () => {
    const view = renderMap();
    await within(document.body).findByText("Order to Cash");
    saved.config = { metric: "risk" };
    saved.loaded = { metric: "risk" };
    view.rerender(ui());
    await waitFor(() => expect(printParams()).toContain("Metric: Risk Level"));
  });

  it("resets the column count and the zoom", async () => {
    saved.config = { columns: 1, displayLevel: 99 };
    renderMap();
    await within(document.body).findByText("Order to Cash");
    const panel = await openDrawerFor("Order to Cash");
    fireEvent.click(within(panel).getByText("Drill Down"));
    await waitFor(() => expect(screen.getByRole("navigation")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await waitFor(() => expect(screen.queryByRole("navigation")).not.toBeInTheDocument());
    expect(within(chart()).getByText("Hire to Retire")).toBeInTheDocument();
    expect(saved.persistConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ columns: 3, displayLevel: 2 }),
    );
  });

  it("resets through the current saved-report handle", async () => {
    const view = renderMap();
    await within(document.body).findByText("Order to Cash");
    const first = saved.resetAll;
    const current = vi.fn();
    saved.resetAll = current;
    view.rerender(ui());
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(current).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

describe("ProcessMapReport toolbar", () => {
  it("shows the title, the scope caption and both related filters", async () => {
    renderMap();
    await within(document.body).findByText("Order to Cash");
    expect(screen.getByText("Process Landscape Map")).toBeInTheDocument();
    expect(within(toolbar()).getByText("Scope:")).toBeInTheDocument();
    expect(within(toolbar()).getByRole("combobox", { name: "Organization" })).toBeInTheDocument();
    expect(within(toolbar()).getByRole("combobox", { name: "Business Context" })).toBeInTheDocument();
  });

  it("offers none, applications and data objects as related cards", async () => {
    renderMap();
    fireEvent.mouseDown(await screen.findByRole("combobox", { name: /show related/i }));
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["None", "Applications", "Data Objects"]);
  });

  it("explains the scope picker and labels the current scope from the payload", async () => {
    // The picker's own search never answers, so the chip's label can only come
    // from the processes the map already holds.
    mockApi.on("get", "/cards*", () => new Promise(() => {}));
    saved.config = { scopeIds: ["otc"] };
    renderMap();
    await within(document.body).findByText("Order to Cash");

    const chip = within(toolbar()).getByText("1 process");
    await userEvent.hover(chip);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Show only the selected processes and everything beneath them",
    );

    fireEvent.click(chip);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Scope to processes")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Sub-processes of a selected process are included automatically."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Order to Cash", { selector: ".MuiChip-label" })).toBeInTheDocument();
  });

  it("offers clear-all and explains the empty map for an organization filter alone", async () => {
    saved.config = { filterOrgs: ["org-9"] };
    renderMap();
    expect(await screen.findByText("No processes match the current filters.")).toBeInTheDocument();
    expect(screen.getByText("Clear all")).toBeInTheDocument();
  });

  it("offers clear-all and explains the empty map for a context filter alone", async () => {
    saved.config = { filterCtxs: ["ctx-9"] };
    renderMap();
    expect(await screen.findByText("No processes match the current filters.")).toBeInTheDocument();
    expect(screen.getByText("Clear all")).toBeInTheDocument();
  });
});

describe("ProcessMapReport zoom", () => {
  const crumbs = () =>
    within(screen.getByRole("navigation"))
      .getAllByRole("listitem")
      .map((li) => li.textContent);

  it("shows the zoomed branch's children, not the branch itself", async () => {
    saved.config = { displayLevel: 99 };
    renderMap();
    await within(document.body).findByText("Order to Cash");
    const panel = await openDrawerFor("Order to Cash");
    fireEvent.click(within(panel).getByText("Drill Down"));
    await waitFor(() => expect(crumbs()).toEqual(["All Processes", "Order to Cash"]));
    // Only the breadcrumb names it now; the current crumb is not a link.
    expect(within(chart()).getAllByText("Order to Cash")).toHaveLength(1);
    expect(
      within(screen.getByRole("navigation")).queryByRole("button", { name: "Order to Cash" }),
    ).not.toBeInTheDocument();
    expect(titles()).toEqual(["Collections", "Invoicing", "Send Invoice"]);
  });

  it("shows a zoomed process on its own once a filter strips its children", async () => {
    saved.config = { displayLevel: 99 };
    renderMap();
    await within(document.body).findByText("Invoicing");
    const panel = await openDrawerFor("Invoicing");
    fireEvent.click(within(panel).getByText("Drill Down"));
    await waitFor(() => expect(crumbs()).toEqual(["All Processes", "Order to Cash", "Invoicing"]));

    await userEvent.click(within(toolbar()).getByRole("combobox", { name: "Organization" }));
    await userEvent.click(await screen.findByRole("option", { name: "Sales" }));

    await waitFor(() => expect(within(chart()).getByText("5 - Optimized")).toBeInTheDocument());
    expect(within(chart()).getAllByText("Invoicing")).toHaveLength(2);
    expect(within(chart()).queryByText("Send Invoice")).not.toBeInTheDocument();
  });

  it("falls back to the whole map, without a breadcrumb, when a filter hides the zoom", async () => {
    saved.config = { displayLevel: 99 };
    renderMap();
    await within(document.body).findByText("Invoicing");
    const panel = await openDrawerFor("Invoicing");
    fireEvent.click(within(panel).getByText("Drill Down"));
    await waitFor(() => expect(crumbs()).toEqual(["All Processes", "Order to Cash", "Invoicing"]));
    // "All levels" is a sentinel, never clamped to the deepest level.
    expect(screen.getByRole("combobox", { name: /display depth/i })).toHaveTextContent("All levels");

    // Only Order to Cash carries the Retail context, so Invoicing drops out.
    await userEvent.click(within(toolbar()).getByRole("combobox", { name: "Business Context" }));
    await userEvent.click(await screen.findByRole("option", { name: "Retail" }));

    await waitFor(() => expect(titles()).toEqual(["Order to Cash"]));
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("drops a zoom the new scope excludes, so clearing the scope shows everything", async () => {
    saved.config = { displayLevel: 99 };
    const view = renderMap();
    await within(document.body).findByText("Order to Cash");
    const panel = await openDrawerFor("Order to Cash");
    fireEvent.click(within(panel).getByText("Drill Down"));
    await waitFor(() => expect(screen.getByRole("navigation")).toBeInTheDocument());

    saved.config = { scopeIds: ["hire"] };
    saved.loaded = { scopeIds: ["hire"] };
    view.rerender(ui());
    await waitFor(() => expect(within(toolbar()).getByText("1 process")).toBeInTheDocument());
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(titles()).toEqual(["Hire to Retire"]);

    const chip = within(toolbar()).getByText("1 process").closest(".MuiChip-root") as HTMLElement;
    fireEvent.click(within(chip).getByTestId("CancelIcon"));
    await waitFor(() => expect(within(chart()).getByText("Hire to Retire")).toBeInTheDocument());
    expect(within(chart()).getByText("Order to Cash")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});

describe("ProcessMapReport drawer contents", () => {
  it("lists a branch's roll-up sorted, with its counts and cost", async () => {
    renderMap();
    await within(document.body).findByText("Order to Cash");
    const panel = await openDrawerFor("Order to Cash");
    expect(drawerLists(panel)).toEqual([
      ["Alpha App", "Beta App", "Gamma App"],
      ["Invoice", "Ledger"],
    ]);
    expect(drawerMetric(panel, "Applications")).toBe("3");
    expect(drawerMetric(panel, "Data Objects")).toBe("2");
    expect(drawerMetric(panel, "Cost")).toBe("$150");

    // Only the end-of-life app carries the warning glyph.
    const row = (name: string) => within(panel).getByText(name).closest("[role='button']") as HTMLElement;
    expect(within(row("Alpha App")).getByText("warning")).toBeInTheDocument();
    expect(within(row("Beta App")).queryByText("warning")).not.toBeInTheDocument();
  });

  it("links a leaf to its inventory slice and omits the branch-only sections", async () => {
    saved.config = { displayLevel: 3 };
    renderMap();
    await within(document.body).findByText("Send Invoice");
    const panel = await openDrawerFor("Send Invoice");
    expect(within(panel).getByRole("link", { name: /view in inventory/i })).toHaveAttribute(
      "href",
      "/inventory?type=Application&rel_BusinessProcess=Send+Invoice",
    );
    expect(within(panel).queryByText(/^Sub-Processes/)).not.toBeInTheDocument();
    expect(within(panel).queryByText(/^Data Objects \(/)).not.toBeInTheDocument();
    expect(drawerMetric(panel, "Data Objects")).toBe("0");
    expect(drawerMetric(panel, "Cost")).toBe("$100");
  });

  it("shows no subtype chip for an unknown subtype", async () => {
    renderMap();
    await within(document.body).findByText("Hire to Retire");
    const panel = await openDrawerFor("Hire to Retire");
    // Only the "Open Card" action.
    expect(panel.querySelectorAll(".MuiChip-root")).toHaveLength(1);
  });

  it("opens a process that carries no attributes at all", async () => {
    const bare: Record<string, unknown> = proc({ id: "bare", name: "Bare Process" });
    delete bare.attributes;
    reply([bare]);
    renderMap();
    await within(document.body).findByText("Bare Process");
    const panel = await openDrawerFor("Bare Process");
    expect(within(panel).getByRole("heading", { name: "Bare Process" })).toBeInTheDocument();
    expect(within(panel).getByText("Process")).toBeInTheDocument();
  });
});
