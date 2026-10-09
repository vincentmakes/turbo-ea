/**
 * Mutation-hardening for the second half of MatrixReport.tsx: the print
 * summary, the legend, the two-sheet export, the loading gate, the toolbar,
 * the grid's headers, cells and totals, and the cell popover. Each test pins
 * an observable outcome — rendered text, a table attribute, an exported value
 * — that a plausible slip in that code would change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

const saved = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  savedReportName: null as string | null,
  exportXlsx: (() => Promise.resolve()) as (d: unknown) => Promise<void>,
}));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: () => ({
    savedReport: null,
    savedReportName: saved.savedReportName,
    saveDialogOpen: false,
    setSaveDialogOpen: () => {},
    loadedConfig: null,
    consumeConfig: () => saved.config,
    resetSavedReport: () => {},
    persistConfig: () => {},
    resetAll: () => {},
    reportType: "matrix",
  }),
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({ chartRef: createRef(), thumbnail: undefined, captureAndSave: () => {} }),
}));
vi.mock("@/features/reports/reportExport", async () => ({
  ...(await vi.importActual<typeof import("@/features/reports/reportExport")>(
    "@/features/reports/reportExport",
  )),
  exportReportToXlsx: (d: unknown) => saved.exportXlsx(d),
}));
vi.mock("@/features/reports/SaveReportDialog", () => ({ default: () => null }));
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
import { installResizeObserver } from "@/test/dom";
import { makeCardType, makeField, makeOption, makeRelationType } from "@/test/fixtures/metamodel";
import type { ReportExportData } from "./reportExport";
import MatrixReport from "./MatrixReport";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HIER_TYPES = [
  makeCardType({ key: "Application", label: "Application", has_hierarchy: true }),
  makeCardType({
    key: "BusinessCapability",
    label: "Business Capability",
    icon: "account_tree",
    has_hierarchy: true,
  }),
];
const FLAT_TYPES = [
  makeCardType({ key: "Application", label: "Application", has_hierarchy: false }),
  makeCardType({ key: "BusinessCapability", label: "Business Capability", has_hierarchy: false }),
];

const CRUD = makeRelationType({
  key: "relAppToBc",
  label: "uses",
  reverse_label: "is used by",
  source_type_key: "Application",
  target_type_key: "BusinessCapability",
  attributes_schema: [
    makeField({ key: "c", label: "Create", type: "boolean" }),
    makeField({ key: "r", label: "Read", type: "boolean" }),
    makeField({ key: "u", label: "Update", type: "boolean" }),
    makeField({ key: "d", label: "Delete", type: "boolean" }),
    makeField({ key: "x", label: "Execute", type: "boolean" }),
    makeField({
      key: "mode",
      label: "Mode",
      type: "single_select",
      options: [makeOption({ key: "sync", label: "Synchronous", color: "#123456" })],
    }),
    makeField({ key: "note", label: "Note", type: "text" }),
  ],
});
const REVERSE = makeRelationType({
  key: "relBcToApp",
  label: "enables",
  reverse_label: "is enabled by",
  source_type_key: "BusinessCapability",
  target_type_key: "Application",
});
const BARE = makeRelationType({
  key: "relAppToBcBare",
  label: "touches",
  reverse_label: "is touched by",
  source_type_key: "Application",
  target_type_key: "BusinessCapability",
});

/** Both axes one level deep; Cap One carries a relation of its own. */
const PAYLOAD = {
  rows: [
    { id: "app-1", name: "App One", parent_id: null },
    { id: "app-1a", name: "App One Child", parent_id: "app-1" },
    { id: "app-2", name: "App Two", parent_id: null },
  ],
  columns: [
    { id: "bc-1", name: "Cap One", parent_id: null },
    { id: "bc-1a", name: "Cap One Child", parent_id: "bc-1" },
    { id: "bc-2", name: "Cap Two", parent_id: null },
  ],
  relation_types: ["relAppToBc", "relBcToApp"],
  attr_sets: [
    {},
    { c: true, r: true, u: true, d: true, x: true, mode: "sync", note: "hello" },
    { c: false, mode: "weird", note: "" },
  ],
  intersections: [
    { row_id: "app-1a", col_id: "bc-1a", e: [[0, "f", 1], [1, "r", 0]] },
    { row_id: "app-2", col_id: "bc-2", e: [[0, "f", 2]] },
    { row_id: "app-2", col_id: "bc-1a", e: [[1, "r", 0]] },
    { row_id: "app-2", col_id: "bc-1", e: [[0, "f", 0]] },
  ],
  truncated: false,
};

let restoreRO: () => void;

function renderMatrix() {
  return render(
    <MemoryRouter>
      <MatrixReport />
    </MemoryRouter>,
  );
}

const table = () => document.querySelector("table") as HTMLElement;
const loaded = (name = "App One Child") => screen.findByText(name, undefined, { timeout: 5000 });

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(HIER_TYPES, [CRUD, REVERSE]);
  restoreRO = installResizeObserver();
  saved.config = null;
  saved.savedReportName = null;
  saved.exportXlsx = vi.fn(() => Promise.resolve());
  mockApi.on("get", "/reports/matrix*", PAYLOAD);
});

afterEach(() => restoreRO());


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Open the shell's menu and export to Excel; resolves the data handed over. */
async function exportData(): Promise<ReportExportData> {
  const exportMock = vi.mocked(saved.exportXlsx);
  const before = exportMock.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Export to Excel/ }));
  await waitFor(() => expect(exportMock.mock.calls.length).toBe(before + 1));
  return exportMock.mock.calls[before][0] as ReportExportData;
}

/** Pick an option from one of the toolbar's select fields. */
async function pick(label: RegExp, option: RegExp) {
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }, { timeout: 5000 }));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
}

/** Option names a toolbar select offers. */
async function optionsOf(label: RegExp): Promise<string[]> {
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }, { timeout: 5000 }));
  const listbox = await screen.findByRole("listbox");
  const names = within(listbox).getAllByRole("option").map((o) => o.textContent ?? "");
  fireEvent.keyDown(listbox, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  return names;
}

/** The figure on the MetricCard tile carrying a given label. */
function metricValue(label: string): string | null {
  const caption = screen
    .queryAllByText(label)
    .find((el) => el.closest(".MuiPaper-root")?.querySelector("h5"));
  return caption?.closest(".MuiPaper-root")?.querySelector("h5")?.textContent ?? null;
}

/** The icon glyph on the MetricCard tile carrying a given label. */
function metricIcon(label: string): string | null {
  const caption = screen
    .queryAllByText(label)
    .find((el) => el.closest(".MuiPaper-root")?.querySelector("h5"));
  return (
    caption?.closest(".MuiPaper-root")?.querySelector(".material-symbols-outlined")?.textContent ??
    null
  );
}

/** The body row whose row-header cells include one reading exactly `name`. */
function bodyRow(name: string): HTMLTableRowElement {
  const row = Array.from(table().querySelectorAll("tbody tr")).find((tr) =>
    Array.from(tr.querySelectorAll("td[rowspan]")).some((td) => td.textContent === name),
  );
  if (!row) throw new Error(`no body row for ${name}`);
  return row as HTMLTableRowElement;
}

/** A row's row-header cell reading exactly `name`. */
function rowHeader(name: string): HTMLTableCellElement {
  return Array.from(table().querySelectorAll("tbody td[rowspan]")).find(
    (td) => td.textContent === name,
  ) as HTMLTableCellElement;
}

/** Intersection cells of a body row, followed by its total. */
function dataCells(name: string): HTMLTableCellElement[] {
  return Array.from(bodyRow(name).querySelectorAll("td")).filter(
    (td) => !td.hasAttribute("rowspan"),
  ) as HTMLTableCellElement[];
}

/** The column header cell whose text reads exactly `text`. */
function colHeader(text: string): HTMLTableCellElement {
  const th = Array.from(table().querySelectorAll("thead th")).find((h) => h.textContent === text);
  if (!th) throw new Error(`no column header ${text}`);
  return th as HTMLTableCellElement;
}

// ---------------------------------------------------------------------------
// Print summary
// ---------------------------------------------------------------------------

describe("MatrixReport print summary", () => {
  it("summarises the default view, without the optional entries", async () => {
    renderMatrix();
    await loaded();
    const data = await exportData();
    expect(data.title).toBe("Matrix");
    expect(data.filterSummary).toEqual([
      { label: "Rows", value: "Application" },
      { label: "Columns", value: "Business Capability" },
      { label: "Cell", value: "Exists (dot)" },
      { label: "Sort Rows", value: "Hierarchy" },
      { label: "Sort Columns", value: "Hierarchy" },
    ]);
    expect(data.sheets!.map((s) => s.name)).toEqual(["Grid", "Relations"]);
  });

  it("names every scope, toggle and filter a view carries", async () => {
    saved.config = {
      cellMode: "codes",
      hideEmpty: true,
      showOnlyGaps: true,
      rowScopeIds: ["app-1"],
      colScopeIds: ["bc-1", "bc-2"],
      filters: {
        relationTypes: ["relBcToApp", "gone"],
        attrValues: {
          "relAppToBc.mode": ["sync", "async-gone"],
          "relAppToBc.c": ["true"],
          "ghost.dim": ["v"],
        },
        direction: "forward",
      },
    };
    renderMatrix();
    await loaded();
    await pick(/sort rows/i, /By count/);
    await pick(/sort columns/i, /A → Z/);

    // The scope chips count what is scoped, in the axis's own noun.
    const toolbar = document.querySelector(".report-toolbar") as HTMLElement;
    expect(within(toolbar).getByText("1 row")).toBeInTheDocument();
    expect(within(toolbar).getByText("2 columns")).toBeInTheDocument();
    // With a filter active the toggle hides the non-matching cards.
    expect(screen.getByRole("checkbox", { name: "Hide non-matching cards" })).toBeInTheDocument();

    const data = await exportData();
    expect(data.filterSummary).toEqual([
      { label: "Rows", value: "Application" },
      { label: "Columns", value: "Business Capability" },
      { label: "Row scope", value: "1 row" },
      { label: "Column scope", value: "2 columns" },
      { label: "Cell", value: "Values (codes)" },
      { label: "Sort Rows", value: "By count" },
      { label: "Sort Columns", value: "A → Z" },
      { label: "Hide unrelated cards", value: "On" },
      { label: "Show only gaps", value: "On" },
      { label: "Relation type", value: "enables, gone" },
      // A known option reads by its label, an unknown one raw.
      { label: "Mode", value: "Synchronous, async-gone" },
      // A flag reads as the filter bar's Yes / No, not the raw "true".
      { label: "Create", value: "Yes" },
      // A dimension no relation type declares falls back to its id.
      { label: "ghost.dim", value: "v" },
      { label: "Direction", value: "Row is the source" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

describe("MatrixReport legend", () => {
  it("lists each coded value under its relation type in the codes mode", async () => {
    saved.config = { cellMode: "codes" };
    renderMatrix();
    await loaded();
    expect(screen.getByText("uses")).toBeInTheDocument();
    for (const item of [
      "C — Create",
      "R — Read",
      "U — Update",
      "D — Delete",
      "E — Execute",
      "S — Synchronous",
    ]) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
    // A relation type with no values contributes no legend group.
    expect(screen.queryByText("enables")).not.toBeInTheDocument();
  });

  it("lists the bare labels in the labels mode", async () => {
    saved.config = { cellMode: "labels" };
    renderMatrix();
    await loaded();
    expect(screen.getByText("uses")).toBeInTheDocument();
    // Once in the cell, once in the legend.
    expect(screen.getAllByText("Execute").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("E — Execute")).not.toBeInTheDocument();
    expect(screen.queryByText("enables")).not.toBeInTheDocument();
  });

  it("shows no legend in the dot mode", async () => {
    renderMatrix();
    await loaded();
    expect(screen.queryByText("uses")).not.toBeInTheDocument();
    expect(screen.queryByText("C — Create")).not.toBeInTheDocument();
    expect(screen.queryByText("Execute")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

describe("MatrixReport export: grid sheet", () => {
  const COLUMNS = [
    { key: "row", label: "Application" },
    { key: "c0", label: "Cap One" },
    { key: "c1", label: "Cap One Child" },
    { key: "c2", label: "Cap Two" },
    { key: "total", label: "Total", type: "number" },
  ];

  const gridIn = async (cellMode: string) => {
    saved.config = { cellMode };
    renderMatrix();
    await loaded();
    return (await exportData()).sheets![0];
  };

  it("writes counts in the count mode, leaving empty cells blank", async () => {
    const grid = await gridIn("count");
    expect(grid.columns).toEqual(COLUMNS);
    expect(grid.rows).toEqual([
      { row: "App One Child", c0: "", c1: 2, c2: "", total: 2 },
      { row: "App Two", c0: 1, c1: 1, c2: 1, total: 3 },
    ]);
  });

  it("writes codes in the codes mode, the count where a cell has none", async () => {
    const grid = await gridIn("codes");
    expect(grid.rows).toEqual([
      { row: "App One Child", c0: "", c1: "C R U D E S", c2: "", total: 2 },
      { row: "App Two", c0: "1", c1: "1", c2: "1", total: 3 },
    ]);
  });

  it("writes labels in the labels mode", async () => {
    const grid = await gridIn("labels");
    expect(grid.rows).toEqual([
      {
        row: "App One Child",
        c0: "",
        c1: "Create, Read, Update, Delete, Execute, Synchronous",
        c2: "",
        total: 2,
      },
      { row: "App Two", c0: "1", c1: "1", c2: "1", total: 3 },
    ]);
  });

  it("writes a dot in the dot mode", async () => {
    const grid = await gridIn("exists");
    expect(grid.rows).toEqual([
      { row: "App One Child", c0: "", c1: "●", c2: "", total: 2 },
      { row: "App Two", c0: "●", c1: "●", c2: "●", total: 3 },
    ]);
  });
});

describe("MatrixReport export: relations sheet", () => {
  const DIMENSION_LABELS = ["Create", "Read", "Update", "Delete", "Execute", "Mode", "Note"];
  const DIMENSION_KEYS = ["c", "r", "u", "d", "x", "mode", "note"].map((k) => `relAppToBc.${k}`);

  it("spreads each relation's values into the columns its own type declares", async () => {
    // The reverse type is listed first in the metamodel, so a dimension's verb
    // must come from its own relation type, not the first one in the list.
    withMetamodel(HIER_TYPES, [REVERSE, CRUD]);
    mockApi.on("get", "/reports/matrix*", {
      ...PAYLOAD,
      attr_sets: [
        {},
        { c: true, r: true, u: true, d: true, x: true, mode: "sync", note: "hello" },
        { c: false, r: null, mode: "weird", note: "" },
      ],
      intersections: [
        { row_id: "app-1a", col_id: "bc-1a", e: [[0, "f", 1], [1, "r", 0]] },
        { row_id: "app-2", col_id: "bc-2", e: [[0, "f", 2]] },
        // The reverse type declares none of these keys, so none export.
        { row_id: "app-2", col_id: "bc-1a", e: [[1, "r", 1]] },
        { row_id: "app-2", col_id: "bc-1", e: [[0, "f", 0]] },
      ],
    });
    renderMatrix();
    await loaded();
    const edges = (await exportData()).sheets![1];

    expect(edges.columns).toEqual([
      { key: "rowCard", label: "Application" },
      { key: "colCard", label: "Business Capability" },
      { key: "relationType", label: "Relation type" },
      { key: "direction", label: "Direction" },
      ...DIMENSION_KEYS.map((key, i) => ({ key, label: `uses · ${DIMENSION_LABELS[i]}` })),
    ]);
    const forward = { relationType: "uses", direction: "Row is the source" };
    const reverse = { relationType: "is enabled by", direction: "Row is the target" };
    expect(edges.rows).toEqual([
      {
        rowCard: "App One Child",
        colCard: "Cap One Child",
        ...forward,
        "relAppToBc.c": "Yes",
        "relAppToBc.r": "Yes",
        "relAppToBc.u": "Yes",
        "relAppToBc.d": "Yes",
        "relAppToBc.x": "Yes",
        "relAppToBc.mode": "Synchronous",
        "relAppToBc.note": "hello",
      },
      { rowCard: "App One Child", colCard: "Cap One Child", ...reverse },
      // Unset, null and empty values export nothing; an unknown option raw.
      {
        rowCard: "App Two",
        colCard: "Cap Two",
        ...forward,
        "relAppToBc.c": "No",
        "relAppToBc.mode": "weird",
      },
      { rowCard: "App Two", colCard: "Cap One Child", ...reverse },
      { rowCard: "App Two", colCard: "Cap One", ...forward },
    ]);
  });

  it("drops the verb prefix with one relation type, and skips hidden columns", async () => {
    // Only the forward type is in the metamodel: the payload's second type
    // is unknown here and exports under its raw key.
    withMetamodel(HIER_TYPES, [CRUD]);
    saved.config = { colScopeIds: ["bc-1"] };
    renderMatrix();
    await loaded();
    await waitFor(() => expect(within(table()).queryByText("Cap Two")).not.toBeInTheDocument());
    const edges = (await exportData()).sheets![1];

    expect(edges.columns.slice(4).map((c) => c.label)).toEqual(DIMENSION_LABELS);
    expect(
      edges.rows.map((r) => [r.rowCard, r.colCard, r.relationType, r.direction]),
    ).toEqual([
      ["App One Child", "Cap One Child", "uses", "Row is the source"],
      ["App One Child", "Cap One Child", "relBcToApp", "Row is the target"],
      // App Two × Cap Two is outside the column scope.
      ["App Two", "Cap One Child", "relBcToApp", "Row is the target"],
      ["App Two", "Cap One", "uses", "Row is the source"],
    ]);
  });

  it("tolerates a payload without relation types, attribute sets or edges", async () => {
    mockApi.on("get", "/reports/matrix*", {
      rows: PAYLOAD.rows,
      columns: PAYLOAD.columns,
      intersections: [
        { row_id: "app-2", col_id: "bc-2", e: [[0, "f", 0]] },
        { row_id: "app-2", col_id: "bc-1a" },
      ],
    });
    renderMatrix();
    await loaded();
    const edges = (await exportData()).sheets![1];
    expect(edges.rows).toEqual([
      { rowCard: "App Two", colCard: "Cap Two", relationType: "", direction: "Row is the source" },
    ]);
  });

  it("exports an empty workbook while the grid is still loading", async () => {
    mockApi.on("get", "/reports/matrix*", () => new Promise(() => {}));
    renderMatrix();
    await waitFor(() => expect(mockApi.calls.length).toBeGreaterThan(0));
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    const data = await exportData();
    expect(data.sheets![0].columns).toEqual([
      { key: "row", label: "Application" },
      { key: "total", label: "Total", type: "number" },
    ]);
    expect(data.sheets![0].rows).toEqual([]);
    expect(data.sheets![1].rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Loading gate and empty states
// ---------------------------------------------------------------------------

/** Let a settled request's state updates land. */
const flush = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
});

describe("MatrixReport loading gate", () => {
  it("keeps the spinner while the metamodel is still loading, even with data", async () => {
    hookState.metamodel.loading = true;
    const view = renderMatrix();
    await waitFor(() => expect(mockApi.calls.length).toBeGreaterThan(0));
    await flush();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("App One Child")).not.toBeInTheDocument();

    // The data was there all along: it renders the moment the metamodel lands.
    hookState.metamodel.loading = false;
    view.rerender(
      <MemoryRouter>
        <MatrixReport />
      </MemoryRouter>,
    );
    expect(await loaded()).toBeInTheDocument();
  });

  it("never draws an empty grid for a request that failed", async () => {
    mockApi.fail("get", "/reports/matrix*", 500);
    renderMatrix();
    await waitFor(() => expect(mockApi.calls.length).toBeGreaterThan(0));
    await flush();
    // What replaces the grid is an endless spinner today (the page ignores the
    // query error) — not asserted, so the eventual error state can land.
    expect(screen.queryByText("No data found for this combination.")).not.toBeInTheDocument();
    expect(screen.queryByText("Relation filter")).not.toBeInTheDocument();
  });
});

describe("MatrixReport empty states", () => {
  it("says there is no data when the column axis is empty", async () => {
    mockApi.on("get", "/reports/matrix*", { ...PAYLOAD, columns: [], intersections: [] });
    renderMatrix();
    expect(
      await screen.findByText("No data found for this combination.", undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(document.querySelector("table")).toBeNull();
  });

  it("says there is no data when the row axis is empty", async () => {
    mockApi.on("get", "/reports/matrix*", { ...PAYLOAD, rows: [], intersections: [] });
    renderMatrix();
    expect(
      await screen.findByText("No data found for this combination.", undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(document.querySelector("table")).toBeNull();
  });

  it("names both axes when no relation type connects them", async () => {
    withMetamodel(HIER_TYPES, []);
    mockApi.on("get", "/reports/matrix*", { ...PAYLOAD, rows: [], columns: [], intersections: [] });
    renderMatrix();
    expect(
      await screen.findByText(
        "No relation type connects Application and Business Capability.",
        undefined,
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
  });

  it("warns when the payload was truncated", async () => {
    mockApi.on("get", "/reports/matrix*", { ...PAYLOAD, truncated: true });
    renderMatrix();
    await loaded();
    expect(
      screen.getByText("Too many relations to show them all. Narrow the filter to see the rest."),
    ).toBeInTheDocument();
  });

  it("warns about neither truncation nor size otherwise", async () => {
    renderMatrix();
    await loaded();
    expect(screen.queryByText(/Too many relations/)).not.toBeInTheDocument();
    // Nor about size: a 2 x 3 grid is nowhere near the threshold.
    expect(screen.queryByText(/This grid has/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Shell and toolbar
// ---------------------------------------------------------------------------

describe("MatrixReport shell and toolbar", () => {
  it("titles the report and offers both export formats", async () => {
    renderMatrix();
    await loaded();
    expect(screen.getByRole("heading", { name: "Matrix" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(await screen.findByRole("menuitem", { name: /Export to PowerPoint/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Export to Excel/ })).toBeInTheDocument();
  });

  it("names the saved report being viewed", async () => {
    saved.savedReportName = "Quarterly view";
    renderMatrix();
    await loaded();
    expect(screen.getByText("Quarterly view")).toBeInTheDocument();
  });

  it("offers no hidden card type on either axis", async () => {
    withMetamodel(
      [...HIER_TYPES, makeCardType({ key: "Secret", label: "Secret Type", is_hidden: true })],
      [CRUD, REVERSE],
    );
    renderMatrix();
    await loaded();
    expect(await optionsOf(/^rows$/i)).toEqual(["Application", "Business Capability"]);
    expect(await optionsOf(/^columns$/i)).toEqual(["Application", "Business Capability"]);
  });

  it("explains each scope chip and opens its dialog with the axis's wording", async () => {
    mockApi.on("get", "/cards?*", { items: [], total: 0, page: 1, page_size: 500 });
    renderMatrix();
    await loaded();
    expect(
      screen.getByLabelText("Show only the selected rows and everything beneath them"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Show only the selected columns and everything beneath them"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("All rows"));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Scope rows")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Cards beneath a selected card are included automatically."),
    ).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByText("All columns"));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Scope columns")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Cards beneath a selected card are included automatically."),
    ).toBeInTheDocument();
  });

  it("names the dot and count cell modes", async () => {
    renderMatrix();
    await loaded();
    expect(await optionsOf(/cell display/i)).toEqual([
      "Exists (dot)",
      "Count (heatmap)",
      "Values (codes)",
      "Values (labels)",
    ]);
  });

  it("explains why the value modes are unavailable", async () => {
    withMetamodel(HIER_TYPES, [BARE]);
    renderMatrix();
    await loaded();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /cell display/i }));
    const listbox = await screen.findByRole("listbox");
    expect(
      within(listbox).getAllByLabelText(
        "The relations between these two types carry no values to show.",
      ),
    ).toHaveLength(2);
  });

  it("offers the hierarchy sort only for a hierarchical type", async () => {
    renderMatrix();
    await loaded();
    expect(await optionsOf(/sort rows/i)).toEqual(["A → Z", "By count", "Hierarchy"]);
    expect(await optionsOf(/sort columns/i)).toEqual(["A → Z", "By count", "Hierarchy"]);
  });

  it("offers no hierarchy sort for a flat type", async () => {
    withMetamodel(FLAT_TYPES, [CRUD, REVERSE]);
    renderMatrix();
    await loaded();
    expect(await optionsOf(/sort rows/i)).toEqual(["A → Z", "By count"]);
    expect(await optionsOf(/sort columns/i)).toEqual(["A → Z", "By count"]);
  });

  it("switching Hide unrelated on turns gaps off, but switching it off leaves gaps alone", async () => {
    saved.config = { hideEmpty: true, showOnlyGaps: true };
    renderMatrix();
    await screen.findByRole("checkbox", { name: "Hide unrelated cards" }, { timeout: 5000 });
    const hide = () => screen.getByRole("checkbox", { name: "Hide unrelated cards" });
    const gaps = () => screen.getByRole("checkbox", { name: "Show only gaps" });
    await waitFor(() => expect(hide()).toBeChecked());

    fireEvent.click(hide());
    await waitFor(() => expect(hide()).not.toBeChecked());
    expect(gaps()).toBeChecked();

    fireEvent.click(hide());
    await waitFor(() => expect(hide()).toBeChecked());
    expect(gaps()).not.toBeChecked();
  });

  it("switching Show only gaps off leaves Hide unrelated alone", async () => {
    saved.config = { hideEmpty: true, showOnlyGaps: true };
    renderMatrix();
    const gaps = await screen.findByRole("checkbox", { name: "Show only gaps" }, { timeout: 5000 });
    await waitFor(() => expect(gaps).toBeChecked());
    fireEvent.click(gaps);
    await waitFor(() => expect(gaps).not.toBeChecked());
    expect(screen.getByRole("checkbox", { name: "Hide unrelated cards" })).toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// Summary strip
// ---------------------------------------------------------------------------

describe("MatrixReport summary strip", () => {
  it("reports coverage as a percentage and names the uncovered column type", async () => {
    renderMatrix();
    await loaded();
    // Four populated cells of a 3 x 3 grid.
    expect(metricValue("Coverage")).toBe("44.4%");
    // Each axis tile wears its card type's own icon.
    expect(metricIcon("Application")).toBe("apps");
    expect(metricIcon("Business Capability")).toBe("account_tree");
    // Every capability carries a relation; the label names the type.
    expect(metricValue("Business Capability with no relation")).toBe("0");
  });

  it("falls back to the raw key for an axis type the metamodel does not know", async () => {
    saved.config = { rowType: "Ghost", colType: "Phantom" };
    renderMatrix();
    await waitFor(() => expect(mockApi.calls.at(-1)?.path).toContain("row_type=Ghost"));
    await waitFor(() => expect(metricValue("Ghost")).toBe("3"), { timeout: 5000 });
    expect(metricValue("Phantom")).toBe("3");
    // With no type to borrow from, the tiles fall back to generic icons.
    expect(metricIcon("Ghost")).toBe("table_rows");
    expect(metricIcon("Phantom")).toBe("view_column");
  });
});

// ---------------------------------------------------------------------------
// Grid: headers, totals and cells
// ---------------------------------------------------------------------------

describe("MatrixReport grid structure", () => {
  it("totals every row and column, and the grand total", async () => {
    renderMatrix();
    await loaded();
    expect(dataCells("App One Child").at(-1)!.textContent).toBe("2");
    expect(dataCells("App Two").at(-1)!.textContent).toBe("3");
    const totals = table().querySelector("tbody tr:last-child") as HTMLElement;
    expect(Array.from(totals.querySelectorAll("td")).map((td) => td.textContent)).toEqual([
      "Σ Total",
      "1",
      "3",
      "1",
      "5",
    ]);
  });

  it("lays the headers out as a tree: one sigma, spanned leaves, a self column", async () => {
    renderMatrix();
    await loaded();
    // Two header rows, one Σ cell spanning both.
    expect(table().querySelectorAll("thead tr")).toHaveLength(2);
    const sigmas = Array.from(table().querySelectorAll("thead th")).filter((th) => th.textContent === "Σ");
    expect(sigmas).toHaveLength(1);
    expect(sigmas[0].parentElement).toBe(table().querySelector("thead tr"));
    expect(sigmas[0].getAttribute("rowspan")).toBe("2");
    // A root column with no children spans both header rows.
    expect(colHeader("Cap Two").getAttribute("rowspan")).toBe("2");
    expect(colHeader("Cap One").getAttribute("rowspan")).toBe("1");
    // A group header spans several columns, so its name lies flat.
    expect(colHeader("Cap One").style.writingMode).toBe("initial");
    expect(colHeader("Cap Two").style.writingMode).toBe("vertical-lr");
    // Cap One carries a relation of its own, so it gets a column of its own.
    expect(colHeader("(itself)")).toBeInTheDocument();
    // A root row with no children spans both row-header columns; a group does not.
    expect(rowHeader("App Two").colSpan).toBe(2);
    expect(rowHeader("App One").colSpan).toBe(1);
    expect(rowHeader("App One Child").colSpan).toBe(1);
    // Each spanned header is exactly as wide as the columns it covers, which
    // is what keeps the sticky row headers aligned (#846).
    expect(rowHeader("App Two").style.width).toBe("280px");
    expect(rowHeader("App One Child").style.width).toBe("140px");
    // ...and pinned at its own column's offset.
    expect(rowHeader("App One").style.left).toBe("0px");
    expect(rowHeader("App One Child").style.left).toBe("140px");
    // The corner spans every row-header column, so it is as wide as all of them.
    const corner = table().querySelector("thead th") as HTMLElement;
    expect(corner.textContent).toContain("Application / Business Capability");
    expect([corner.style.width, corner.style.minWidth, corner.style.maxWidth]).toEqual([
      "280px",
      "280px",
      "280px",
    ]);
  });

  it("keys its row headers uniquely", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      renderMatrix();
      await loaded();
      const keyWarnings = error.mock.calls.filter((c) => String(c[0]).includes("same key"));
      expect(keyWarnings).toEqual([]);
    } finally {
      error.mockRestore();
    }
  });

  it("draws a dot for a related cell and nothing for an empty one", async () => {
    renderMatrix();
    await loaded();
    const [empty, related] = dataCells("App One Child");
    expect(empty).toBeEmptyDOMElement();
    expect(related.textContent).toBe("");
    expect(related.childElementCount).toBe(1);
    // Only a related cell opens a popover, so only it offers the pointer.
    expect(related.style.cursor).toBe("pointer");
    expect(empty.style.cursor).toBe("default");
  });

  it("writes the count in the count mode, and nothing in an empty cell", async () => {
    saved.config = { cellMode: "count" };
    renderMatrix();
    await loaded();
    await waitFor(() => expect(dataCells("App One Child")[1].textContent).toBe("2"));
    expect(dataCells("App One Child")[0]).toBeEmptyDOMElement();
    expect(dataCells("App Two")[0].textContent).toBe("1");
  });

  it("writes codes in the codes mode, and nothing in an empty cell", async () => {
    saved.config = { cellMode: "codes" };
    renderMatrix();
    await loaded();
    await waitFor(() => expect(dataCells("App One Child")[1].textContent).toBe("CRUD+2"));
    expect(dataCells("App One Child")[0]).toBeEmptyDOMElement();
  });

  it("writes labels in the labels mode", async () => {
    saved.config = { cellMode: "labels" };
    renderMatrix();
    await loaded();
    await waitFor(() =>
      expect(dataCells("App One Child")[1].textContent).toBe(
        "CreateReadUpdateDeleteExecuteSynchronous",
      ),
    );
    expect(dataCells("App One Child")[0]).toBeEmptyDOMElement();
  });
});

describe("MatrixReport column header names", () => {
  const LONG = "Customer_Relationship_Management_Suite"; // 38 characters
  const EXACT = "ABCDEFGHIJKLMNOPQRSTUVWX"; // 24 characters
  const LONGER = "Enterprise_Resource_Planning_Platform_Core"; // 42 characters

  beforeEach(() => {
    withMetamodel(FLAT_TYPES, [CRUD]);
    mockApi.on("get", "/reports/matrix*", {
      ...PAYLOAD,
      rows: [{ id: "app-2", name: "App Two", parent_id: null }],
      columns: [
        { id: "c-long", name: LONG, parent_id: null },
        { id: "c-exact", name: EXACT, parent_id: null },
        { id: "c-longer", name: LONGER, parent_id: null },
      ],
      intersections: [],
    });
  });

  const header = (name: string) => table().querySelector(`th[title="${name}"]`) as HTMLElement;
  const headerText = (name: string) => header(name).textContent;

  it("cuts a dense column's name at 24 characters", async () => {
    renderMatrix();
    await loaded("App Two");
    expect(headerText(LONG)).toBe("Customer_Relationship_M…");
    expect(headerText(EXACT)).toBe(EXACT);
    // A dense column is too narrow for its name lying flat, so it stands on end.
    expect(header(LONG).style.writingMode).toBe("vertical-lr");
    expect(header(LONG).style.textOrientation).toBe("mixed");
  });

  it("cuts a wide column's name at 40 characters", async () => {
    saved.config = { cellMode: "labels" };
    renderMatrix();
    await loaded("App Two");
    await waitFor(() => expect(headerText(LONG)).toBe(LONG));
    expect(headerText(LONGER)).toBe("Enterprise_Resource_Planning_Platform_C…");
    // A wide column fits its name lying flat.
    expect(header(LONG).style.writingMode).toBe("initial");
    expect(header(LONG).style.textOrientation).toBe("initial");
  });
});

// ---------------------------------------------------------------------------
// Hierarchy: depth controls, collapsed groups, spans
// ---------------------------------------------------------------------------

/** Two levels deep on both axes, with a leaf at every level. */
const DEEP = {
  rows: [
    { id: "r-a", name: "Root A", parent_id: null },
    { id: "r-a1", name: "Mid A1", parent_id: "r-a" },
    { id: "r-a1x", name: "Leaf A1x", parent_id: "r-a1" },
    { id: "r-a2", name: "Mid A2", parent_id: "r-a" },
    { id: "r-b", name: "Root B", parent_id: null },
  ],
  columns: [
    { id: "c-a", name: "Col A", parent_id: null },
    { id: "c-a1", name: "Col A1", parent_id: "c-a" },
    { id: "c-a1x", name: "Col A1x", parent_id: "c-a1" },
    { id: "c-a2", name: "Col A2", parent_id: "c-a" },
    { id: "c-b", name: "Col B", parent_id: null },
  ],
  relation_types: ["relAppToBc"],
  attr_sets: [{}],
  intersections: [
    { row_id: "r-a1x", col_id: "c-a1x", e: [[0, "f", 0]] },
    { row_id: "r-b", col_id: "c-b", e: [[0, "f", 0]] },
  ],
  truncated: false,
};

/** The "depth/max" counter beside a collapse control. */
const depthCounter = (collapseLabel: string) =>
  screen.getByLabelText(collapseLabel).nextElementSibling?.textContent;

/** A depth control at its limit drops the pointer cursor: there is nowhere to go. */
const atLimit = (label: string) => screen.getByLabelText(label).style.cursor === "default";

describe("MatrixReport hierarchy", () => {
  beforeEach(() => {
    mockApi.on("get", "/reports/matrix*", DEEP);
  });

  it("steps the row depth one level at a time, both ways", async () => {
    renderMatrix();
    await loaded("Leaf A1x");
    expect(depthCounter("Collapse rows")).toBe("2/2");
    expect(atLimit("Expand rows")).toBe(true);
    expect(atLimit("Collapse rows")).toBe(false);
    fireEvent.click(screen.getByLabelText("Collapse rows"));
    await waitFor(() => expect(depthCounter("Collapse rows")).toBe("1/2"));
    expect(atLimit("Expand rows")).toBe(false);
    expect(atLimit("Collapse rows")).toBe(false);
    fireEvent.click(screen.getByLabelText("Collapse rows"));
    await waitFor(() => expect(depthCounter("Collapse rows")).toBe("0/2"));
    expect(atLimit("Collapse rows")).toBe(true);
    expect(atLimit("Expand rows")).toBe(false);
    fireEvent.click(screen.getByLabelText("Expand rows"));
    await waitFor(() => expect(depthCounter("Collapse rows")).toBe("1/2"));
    fireEvent.click(screen.getByLabelText("Expand rows"));
    await waitFor(() => expect(depthCounter("Collapse rows")).toBe("2/2"));
  });

  it("steps the column depth one level at a time, both ways", async () => {
    renderMatrix();
    await loaded("Leaf A1x");
    expect(depthCounter("Collapse columns")).toBe("2/2");
    expect(atLimit("Expand columns")).toBe(true);
    expect(atLimit("Collapse columns")).toBe(false);
    fireEvent.click(screen.getByLabelText("Collapse columns"));
    await waitFor(() => expect(depthCounter("Collapse columns")).toBe("1/2"));
    expect(atLimit("Expand columns")).toBe(false);
    expect(atLimit("Collapse columns")).toBe(false);
    fireEvent.click(screen.getByLabelText("Collapse columns"));
    await waitFor(() => expect(depthCounter("Collapse columns")).toBe("0/2"));
    expect(atLimit("Collapse columns")).toBe(true);
    expect(atLimit("Expand columns")).toBe(false);
    fireEvent.click(screen.getByLabelText("Expand columns"));
    await waitFor(() => expect(depthCounter("Collapse columns")).toBe("1/2"));
    fireEvent.click(screen.getByLabelText("Expand columns"));
    await waitFor(() => expect(depthCounter("Collapse columns")).toBe("2/2"));
  });

  it("marks a collapsed row group with its leaf count, and only then", async () => {
    renderMatrix();
    await loaded("Leaf A1x");
    expect(rowHeader("Root A")).toBeTruthy();
    expect(rowHeader("Mid A1")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Collapse rows"));
    await waitFor(() => expect(rowHeader("Mid A1(1)")).toBeTruthy());
    expect(rowHeader("Root A")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Collapse rows"));
    await waitFor(() => expect(rowHeader("Root A(2)")).toBeTruthy());
  });

  it("marks a collapsed column group with its leaf count, and only then", async () => {
    renderMatrix();
    await loaded("Leaf A1x");
    expect(colHeader("Col A")).toBeTruthy();
    expect(colHeader("Col A1")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Collapse columns"));
    await waitFor(() => expect(colHeader("Col A1(1)")).toBeTruthy());
    expect(colHeader("Col A")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Collapse columns"));
    await waitFor(() => expect(colHeader("Col A(2)")).toBeTruthy());
  });

  it("spans a shallow leaf across the levels below it", async () => {
    renderMatrix();
    await loaded("Leaf A1x");
    // Three row-header columns: a level-1 leaf spans two, a root leaf three.
    expect(rowHeader("Mid A2").colSpan).toBe(2);
    expect(rowHeader("Root B").colSpan).toBe(3);
    expect(rowHeader("Root A").colSpan).toBe(1);
    expect(rowHeader("Leaf A1x").colSpan).toBe(1);
    // Three header rows: a level-1 leaf spans two, a root leaf three.
    expect(colHeader("Col A2").getAttribute("rowspan")).toBe("2");
    expect(colHeader("Col B").getAttribute("rowspan")).toBe("3");
    expect(colHeader("Col A1x").getAttribute("rowspan")).toBe("1");
  });

  it("offers no depth controls for a hierarchical type whose cards are flat", async () => {
    mockApi.on("get", "/reports/matrix*", {
      ...DEEP,
      rows: DEEP.rows.map((r) => ({ ...r, parent_id: null })),
      columns: DEEP.columns.map((c) => ({ ...c, parent_id: null })),
    });
    renderMatrix();
    await loaded("Leaf A1x");
    expect(screen.queryByLabelText("Collapse rows")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Collapse columns")).not.toBeInTheDocument();
  });

  it("drops an axis's depth controls once it is sorted by name", async () => {
    renderMatrix();
    await loaded("Leaf A1x");
    await pick(/sort rows/i, /A → Z/);
    await waitFor(() => expect(screen.queryByLabelText("Collapse rows")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Collapse columns")).toBeInTheDocument();
    await pick(/sort columns/i, /A → Z/);
    await waitFor(() =>
      expect(screen.queryByLabelText("Collapse columns")).not.toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// Cell popover
// ---------------------------------------------------------------------------

/** Flat axes, so the cell index is simply the alphabetical order. */
const FLAT = {
  rows: [
    { id: "ra", name: "Row A", parent_id: null },
    { id: "rb", name: "Row B", parent_id: null },
  ],
  columns: [
    { id: "c0", name: "Alpha", parent_id: null },
    { id: "c1", name: "Beta Line", parent_id: null },
    { id: "c2", name: "Gamma Line", parent_id: null },
  ],
  relation_types: ["relAppToBc", "relBcToApp"],
  attr_sets: [{}],
  intersections: [
    { row_id: "ra", col_id: "c1", e: [[0, "f", 0], [1, "r", 0]] },
    { row_id: "ra", col_id: "c2", e: [[0, "f", 0], [0, "f", 0]] },
    { row_id: "rb", col_id: "c0", e: [[0, "f", 0]] },
    { row_id: "rb", col_id: "c1", e: [[1, "r", 0]] },
  ],
  truncated: false,
};

describe("MatrixReport cell popover", () => {
  beforeEach(() => {
    withMetamodel(FLAT_TYPES, [CRUD, REVERSE]);
    mockApi.on("get", "/reports/matrix*", FLAT);
  });

  const openPopover = async (title: RegExp) => {
    fireEvent.click(within(table()).getByTitle(title));
    return screen.findByRole("presentation");
  };
  const closePopover = async (pop: HTMLElement) => {
    fireEvent.keyDown(pop, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("presentation")).not.toBeInTheDocument());
  };

  it("describes a cell in the first column with its own relations", async () => {
    renderMatrix();
    await loaded("Row B");
    const pop = await openPopover(/^Row B × Alpha/);
    expect(within(pop).getByText("Row B × Alpha")).toBeInTheDocument();
    expect(within(pop).getByText("1 relation")).toBeInTheDocument();
    // The cell's one relation type, by its own verb.
    expect(within(pop).getByText("uses")).toBeInTheDocument();
    expect(within(pop).queryByText("enables")).not.toBeInTheDocument();
    expect(within(pop).getByText("Row is the source")).toBeInTheDocument();
    expect(within(pop).getByText("arrow_forward")).toBeInTheDocument();
  });

  it("marks each direction with its own arrow", async () => {
    renderMatrix();
    await loaded("Row B");
    let pop = await openPopover(/^Row B × Beta Line/);
    expect(within(pop).getByText("Row is the target")).toBeInTheDocument();
    expect(within(pop).getByText("arrow_back")).toBeInTheDocument();
    await closePopover(pop);

    pop = await openPopover(/^Row A × Beta Line/);
    expect(within(pop).getByText("Both directions")).toBeInTheDocument();
    expect(within(pop).getByText("sync_alt")).toBeInTheDocument();
  });

  it("falls back to an empty cell once its column is filtered away", async () => {
    renderMatrix();
    await loaded("Row B");
    const pop = await openPopover(/^Row B × Alpha/);
    expect(within(pop).getByText("1 relation")).toBeInTheDocument();

    // Alpha drops out of the grid while the popover is still open.
    fireEvent.change(screen.getByLabelText("Find column"), { target: { value: "Line" } });
    await waitFor(() => expect(within(pop).getByText("0 relations")).toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(within(pop).getByText("Row B × Alpha")).toBeInTheDocument();
    expect(within(pop).queryByText("uses")).not.toBeInTheDocument();
    expect(within(pop).queryByText("Row is the source")).not.toBeInTheDocument();
    expect(within(pop).queryByText("Stryker was here")).not.toBeInTheDocument();
  });

  it("closes on a walk to the row's card, and the side panel closes too", async () => {
    renderMatrix();
    await loaded("Row B");
    const pop = await openPopover(/^Row B × Alpha/);
    fireEvent.click(within(pop).getByText("Row B"));
    await waitFor(() => expect(screen.queryByRole("presentation")).not.toBeInTheDocument());
    expect(screen.getByTestId("side-panel")).toHaveTextContent("rb");

    fireEvent.click(screen.getByRole("button", { name: "close-panel" }));
    await waitFor(() => expect(screen.queryByTestId("side-panel")).not.toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Cell shading: related cells, the hover crosshair, the heatmap, the diagonal
// ---------------------------------------------------------------------------

// The light theme's surfaces as jsdom reports them. The shading is the only
// thing that tells a related cell, the hovered crosshair and the diagonal
// apart, so it is asserted directly.
const PAPER = "rgb(255, 255, 255)";
const RELATED = "rgb(227, 242, 253)";
const RELATED_HOVERED = "rgb(187, 222, 251)";
const TINT = "rgba(0, 0, 0, 0.04)";

const shades = (name: string) =>
  dataCells(name)
    .slice(0, -1)
    .map((td) => td.style.backgroundColor);

describe("MatrixReport cell shading", () => {
  it("shades related cells, and the hovered row and column more strongly", async () => {
    renderMatrix();
    await loaded();
    expect(shades("App One Child")).toEqual([PAPER, RELATED, PAPER]);
    expect(shades("App Two")).toEqual([RELATED, RELATED, RELATED]);

    fireEvent.mouseEnter(dataCells("App One Child")[1]);
    await waitFor(() =>
      expect(shades("App One Child")).toEqual([TINT, RELATED_HOVERED, TINT]),
    );
    expect(shades("App Two")).toEqual([RELATED, RELATED_HOVERED, RELATED]);

    fireEvent.mouseLeave(dataCells("App One Child")[1]);
    await waitFor(() => expect(shades("App One Child")).toEqual([PAPER, RELATED, PAPER]));
    expect(shades("App Two")).toEqual([RELATED, RELATED, RELATED]);
  });

  it("lights a column from its header and a row from its header", async () => {
    renderMatrix();
    await loaded();
    fireEvent.mouseEnter(colHeader("Cap Two"));
    await waitFor(() => expect(shades("App One Child")).toEqual([PAPER, RELATED, TINT]));
    expect(shades("App Two")).toEqual([RELATED, RELATED, RELATED_HOVERED]);
    fireEvent.mouseLeave(colHeader("Cap Two"));
    await waitFor(() => expect(shades("App One Child")).toEqual([PAPER, RELATED, PAPER]));

    fireEvent.mouseEnter(rowHeader("App Two"));
    await waitFor(() =>
      expect(shades("App Two")).toEqual([RELATED_HOVERED, RELATED_HOVERED, RELATED_HOVERED]),
    );
    expect(shades("App One Child")).toEqual([PAPER, RELATED, PAPER]);
    fireEvent.mouseLeave(rowHeader("App Two"));
    await waitFor(() => expect(shades("App Two")).toEqual([RELATED, RELATED, RELATED]));
  });

  it("shades counts by how many relations they hold in the count mode", async () => {
    saved.config = { cellMode: "count" };
    renderMatrix();
    await loaded();
    await waitFor(() => expect(dataCells("App One Child")[1].textContent).toBe("2"));
    const [empty, two] = shades("App One Child");
    const [one] = shades("App Two");
    expect(empty).toBe(PAPER);
    expect([PAPER, RELATED, TINT]).not.toContain(two);
    expect([PAPER, RELATED, TINT]).not.toContain(one);
    expect(two).not.toBe(one);
  });

  it("tints only the diagonal of a matrix of one type against itself", async () => {
    saved.config = { rowType: "Application", colType: "Application" };
    mockApi.on("get", "/reports/matrix*", {
      ...PAYLOAD,
      columns: PAYLOAD.rows,
      intersections: [{ row_id: "app-2", col_id: "app-1a", e: [[0, "f", 0]] }],
    });
    renderMatrix();
    await waitFor(() => expect(mockApi.calls.at(-1)?.path).toContain("col_type=Application"));
    await waitFor(() => expect(shades("App Two")).toEqual([RELATED, TINT]), { timeout: 5000 });
    expect(shades("App One Child")).toEqual([TINT, PAPER]);
  });
});
