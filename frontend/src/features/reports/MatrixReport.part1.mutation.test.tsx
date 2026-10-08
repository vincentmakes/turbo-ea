/**
 * Mutation-hardening for the first half of MatrixReport.tsx: state defaults,
 * the saved-config load and reset, the request path, the axis-type effects,
 * search, scope, sorting, header measurement, hover, cell titles/borders/
 * glyphs, the KPI strip and the print parameters.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createRef } from "react";
import { ThemeProvider, createTheme } from "@mui/material/styles";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

const saved = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  loadedConfig: null as unknown,
  saveDialogOpen: false,
  reportTypes: [] as string[],
  setSaveDialogOpen: (() => {}) as (open: boolean) => void,
  resetAll: (() => {}) as () => void,
  persistConfig: (() => {}) as (cfg: unknown) => void,
  captureAndSave: (() => {}) as () => void,
  onCaptureReady: null as null | (() => void),
  dialogConfig: undefined as unknown,
  exportXlsx: (() => Promise.resolve()) as (d: unknown) => Promise<void>,
}));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: (reportType: string) => {
    saved.reportTypes.push(reportType);
    return {
      savedReport: null,
      savedReportName: null,
      saveDialogOpen: saved.saveDialogOpen,
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
  useThumbnailCapture: (onReady: () => void) => {
    saved.onCaptureReady = onReady;
    return { chartRef: createRef(), thumbnail: undefined, captureAndSave: () => saved.captureAndSave() };
  },
}));
vi.mock("@/features/reports/reportExport", async () => ({
  ...(await vi.importActual<typeof import("@/features/reports/reportExport")>(
    "@/features/reports/reportExport",
  )),
  exportReportToXlsx: (d: unknown) => saved.exportXlsx(d),
}));
vi.mock("@/features/reports/SaveReportDialog", () => ({
  default: (props: { config: unknown }) => {
    saved.dialogConfig = props.config;
    return null;
  },
}));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: (props: { cardId: string | null; open: boolean }) =>
    props.open ? <div data-testid="side-panel">{props.cardId}</div> : null,
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { userWith, wrapWithProviders } from "@/test/render";
import { makeCardType, makeField, makeOption, makeRelationType } from "@/test/fixtures/metamodel";
import type { CardType, RelationType } from "@/types";
import type { ReportExportData } from "./reportExport";
import MatrixReport from "./MatrixReport";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const APP = (hier = false) =>
  makeCardType({ key: "Application", label: "Application", has_hierarchy: hier });
const BC = (hier = true) =>
  makeCardType({ key: "BusinessCapability", label: "Business Capability", has_hierarchy: hier });
const PROVIDER = makeCardType({ key: "Provider", label: "Provider", has_hierarchy: false });
const ITC = makeCardType({ key: "ITComponent", label: "IT Component", has_hierarchy: true });

const CRUD = makeRelationType({
  key: "relAppToBc",
  label: "uses",
  reverse_label: "is used by",
  source_type_key: "Application",
  target_type_key: "BusinessCapability",
  attributes_schema: [
    makeField({ key: "c", label: "Create", type: "boolean" }),
    makeField({ key: "r", label: "Read", type: "boolean" }),
    makeField({
      key: "mode",
      label: "Mode",
      type: "single_select",
      options: [makeOption({ key: "sync", label: "Synchronous", color: "#123456" })],
    }),
  ],
});

type Row = { id: string; name: string; parent_id: string | null };
type Edge = [number, string, number];

interface Payload {
  rows: Row[];
  columns: Row[];
  relation_types: string[];
  attr_sets: Record<string, unknown>[];
  intersections: { row_id: string; col_id: string; e?: Edge[] }[];
  truncated: boolean;
}

const r = (id: string, name: string, parent_id: string | null = null): Row => ({ id, name, parent_id });

/** A flat 2 x 2 grid with one value-less forward relation. */
const FLAT: Payload = {
  rows: [r("app-1", "App One"), r("app-2", "App Two")],
  columns: [r("bc-1", "Cap One"), r("bc-2", "Cap Two")],
  relation_types: ["relAppToBc"],
  attr_sets: [{}, { c: true }],
  intersections: [{ row_id: "app-1", col_id: "bc-1", e: [[0, "f", 0]] }],
  truncated: false,
};

/** Both axes one level deep. */
const HIER: Payload = {
  rows: [r("app-1", "App One"), r("app-1a", "App One Child", "app-1"), r("app-2", "App Two")],
  columns: [r("bc-1", "Cap One"), r("bc-1a", "Cap One Child", "bc-1"), r("bc-2", "Cap Two")],
  relation_types: ["relAppToBc"],
  attr_sets: [{}, { c: true }],
  intersections: [
    { row_id: "app-1a", col_id: "bc-1a", e: [[0, "f", 1]] },
    { row_id: "app-2", col_id: "bc-2", e: [[0, "f", 0]] },
  ],
  truncated: false,
};

const DEFAULT_PATH = "/reports/matrix?row_type=Application&col_type=BusinessCapability";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(types: CardType[], relationTypes: RelationType[] = [CRUD]) {
  withMetamodel(types, relationTypes);
}

function renderMatrix(opts: { dark?: boolean } = {}) {
  const ui = opts.dark ? (
    <ThemeProvider theme={createTheme({ palette: { mode: "dark" } })}>
      <MatrixReport />
    </ThemeProvider>
  ) : (
    <MatrixReport />
  );
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const table = () => document.querySelector("table") as HTMLElement;

/** The visible value of a toolbar select. */
const selectValue = (name: RegExp) => screen.getByRole("combobox", { name }).textContent;

async function pick(label: RegExp, option: RegExp) {
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }, { timeout: 5000 }));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
}

/** The option labels a toolbar select offers. */
async function optionsOf(label: RegExp): Promise<string[]> {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: label }));
  const listbox = await screen.findByRole("listbox");
  const names = within(listbox).getAllByRole("option").map((o) => o.textContent ?? "");
  fireEvent.keyDown(listbox, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  return names;
}

/** Value of the KPI tile carrying `label`. */
function metric(label: string): string {
  const paper = screen.getByText(label, { selector: ".MuiPaper-root .MuiTypography-caption" }).closest(".MuiPaper-root")!;
  return paper.querySelector("h5")!.textContent ?? "";
}

/** The data cells of the row whose header reads `name`. */
function rowCells(name: string): HTMLElement[] {
  const header = within(table())
    .getAllByText(name)
    .find((el) => el.closest("td"))!;
  const tr = header.closest("tr")!;
  return Array.from(tr.querySelectorAll("td")).filter((td) => td.style.height === "26px");
}

/** Leaf column headers in order (the ones that carry a title). */
const leafHeaders = () =>
  Array.from(table().querySelectorAll("thead th[title]")).map((th) => th.getAttribute("title"));

/** Row header names in order. */
const rowHeaders = () =>
  Array.from(table().querySelectorAll("tbody tr"))
    .slice(0, -1)
    .map((tr) => (tr.querySelector("td") as HTMLElement).textContent);

/** The print-only parameter summary, one "Label: value" per entry. */
const printParams = () =>
  Array.from(document.querySelectorAll(".report-print-params > *")).map((el) =>
    (el.textContent ?? "").replace(/\|$/, ""),
  );

const lastPath = () => mockApi.callsOf("get", "/reports/matrix*").at(-1)?.path;
const lastPersisted = () =>
  vi.mocked(saved.persistConfig).mock.calls.at(-1)?.[0] as Record<string, unknown>;

/** Text of the depth counter beside a collapse control. */
const depthCounter = (collapseLabel: string) =>
  screen.getByLabelText(collapseLabel).nextElementSibling?.textContent;

/** Strict like a browser: observing anything but an Element throws. */
const ro = { disconnects: 0 };
class StrictResizeObserver {
  observe(el: unknown) {
    if (!(el instanceof Element)) throw new TypeError("parameter 1 is not of type 'Element'");
  }
  unobserve() {}
  disconnect() {
    ro.disconnects += 1;
  }
}
let prevRO: unknown;

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  setup([APP(), BC()]);
  saved.config = null;
  saved.loadedConfig = null;
  saved.saveDialogOpen = false;
  saved.reportTypes = [];
  saved.setSaveDialogOpen = vi.fn();
  saved.resetAll = vi.fn();
  saved.persistConfig = vi.fn();
  saved.captureAndSave = vi.fn();
  saved.onCaptureReady = null;
  saved.dialogConfig = undefined;
  saved.exportXlsx = vi.fn(() => Promise.resolve());
  mockApi.on("get", "/reports/matrix*", FLAT);
  ro.disconnects = 0;
  prevRO = (globalThis as Record<string, unknown>).ResizeObserver;
  (globalThis as Record<string, unknown>).ResizeObserver = StrictResizeObserver;
});

afterEach(() => {
  (globalThis as Record<string, unknown>).ResizeObserver = prevRO;
  vi.restoreAllMocks();
});

const rerenderMatrix = (view: ReturnType<typeof render>) =>
  view.rerender(
    <MemoryRouter>
      <MatrixReport />
    </MemoryRouter>,
  );

// ---------------------------------------------------------------------------
// Defaults and the axis-type effects
// ---------------------------------------------------------------------------

describe("MatrixReport defaults", () => {
  it("names itself, asks for the matrix saved-report slot and starts on dots, flat axes A → Z", async () => {
    setup([APP(false), BC(false)]);
    renderMatrix();
    await screen.findByText("App One");

    expect(screen.getByRole("heading", { name: "Matrix" })).toBeInTheDocument();
    expect(saved.reportTypes.length).toBeGreaterThan(0);
    expect(new Set(saved.reportTypes)).toEqual(new Set(["matrix"]));
    expect(selectValue(/cell display/i)).toBe("Exists (dot)");
    expect(selectValue(/sort rows/i)).toBe("A → Z");
    expect(selectValue(/sort columns/i)).toBe("A → Z");
    expect(lastPath()).toBe(DEFAULT_PATH);
    expect(new Set(mockApi.callsOf("get", "/reports/matrix*").map((c) => c.path))).toEqual(
      new Set([DEFAULT_PATH]),
    );
  });

  it("keeps the hierarchy sort for a hierarchical axis, taking the metamodel's word over the data", async () => {
    setup([APP(false), BC(true)]);
    // Nested rows of a flat type, flat columns of a hierarchical one.
    mockApi.on("get", "/reports/matrix*", { ...HIER, columns: FLAT.columns, intersections: [] });
    renderMatrix();
    await screen.findByText("App One Child");
    expect(selectValue(/sort rows/i)).toBe("A → Z");
    expect(selectValue(/sort columns/i)).toBe("Hierarchy");
    expect(await optionsOf(/sort rows/i)).toEqual(["A → Z", "By count"]);
    expect(await optionsOf(/sort columns/i)).toEqual(["A → Z", "By count", "Hierarchy"]);
  });

  it("re-picks the sort and resets the depth when an axis changes type", async () => {
    setup([APP(false), BC(true), ITC, PROVIDER]);
    mockApi.on("get", "/reports/matrix*", HIER);
    renderMatrix();
    await screen.findByText("App One Child");

    // A hierarchical row type gets the hierarchy sort.
    await pick(/^rows$/i, /^Business Capability$/);
    await waitFor(() => expect(selectValue(/sort rows/i)).toBe("Hierarchy"));
    await screen.findByText("App One Child");

    fireEvent.click(screen.getByLabelText("Collapse rows"));
    await waitFor(() => expect(depthCounter("Collapse rows")).toBe("0/1"));
    await pick(/^rows$/i, /^IT Component$/);
    await waitFor(() => expect(lastPath()).toContain("row_type=ITComponent"));
    await screen.findByText("App One Child");
    expect(depthCounter("Collapse rows")).toBe("1/1");

    fireEvent.click(screen.getByLabelText("Collapse columns"));
    await waitFor(() => expect(depthCounter("Collapse columns")).toBe("0/1"));
    await pick(/^columns$/i, /^IT Component$/);
    await waitFor(() => expect(lastPath()).toContain("col_type=ITComponent"));
    await screen.findByText("App One Child");
    expect(depthCounter("Collapse columns")).toBe("1/1");

    // A flat column type drops the hierarchy sort it can no longer offer.
    await pick(/^columns$/i, /^Provider$/);
    await waitFor(() => expect(selectValue(/sort columns/i)).toBe("A → Z"));
  });

  it("keeps a flat axis's own sort across a change to another flat type", async () => {
    setup([APP(false), BC(false), PROVIDER]);
    renderMatrix();
    await screen.findByText("App One");

    await pick(/sort rows/i, /By count/);
    await pick(/^rows$/i, /^Provider$/);
    await waitFor(() => expect(lastPath()).toContain("row_type=Provider"));
    await screen.findByText("App One");
    expect(selectValue(/sort rows/i)).toBe("By count");

    await pick(/sort columns/i, /By count/);
    await pick(/^columns$/i, /^Application$/);
    await waitFor(() => expect(lastPath()).toContain("col_type=Application"));
    await screen.findByText("App One");
    expect(selectValue(/sort columns/i)).toBe("By count");
  });

  it("offers only the types a reports reader may see, not those an inventory reader may", async () => {
    // A role with no inventory.view still reads every type on a report.
    render(wrapWithProviders(<MatrixReport />, { user: userWith("reports.ea_dashboard") }));
    await screen.findByText("App One");
    expect(await optionsOf(/^rows$/i)).toEqual(["Application", "Business Capability"]);
  });

  it("opens the save dialog once the thumbnail is captured", async () => {
    renderMatrix();
    await screen.findByText("App One");
    expect(saved.onCaptureReady).toBeTypeOf("function");
    act(() => saved.onCaptureReady!());
    expect(saved.setSaveDialogOpen).toHaveBeenCalledWith(true);
  });

  it("disconnects its header resize observer on unmount", async () => {
    const view = renderMatrix();
    await screen.findByText("App One");
    view.unmount();
    expect(ro.disconnects).toBeGreaterThan(0);
  });
});

describe("MatrixReport axis types the metamodel does not know", () => {
  it("falls back to the type key, and to the data for whether an axis is hierarchical", async () => {
    saved.config = { rowType: "Ghost", colType: "Phantom" };
    mockApi.on("get", "/reports/matrix*", {
      ...FLAT,
      rows: [r("g-1", "Ghost One"), r("g-1a", "Ghost Child", "g-1")],
      columns: [r("p-1", "Phantom One"), r("p-2", "Phantom Two")],
      intersections: [],
    });
    renderMatrix();
    await screen.findByText("Ghost Child");

    expect(table().querySelector("thead th")).toHaveTextContent("Ghost / Phantom");
    expect(await optionsOf(/sort rows/i)).toEqual(["A → Z", "By count", "Hierarchy"]);
    expect(await optionsOf(/sort columns/i)).toEqual(["A → Z", "By count"]);
  });

  it("reads a flat row axis and a nested column axis off the data the same way", async () => {
    saved.config = { rowType: "Ghost", colType: "Phantom" };
    mockApi.on("get", "/reports/matrix*", {
      ...FLAT,
      rows: [r("g-1", "Ghost One"), r("g-2", "Ghost Two")],
      columns: [r("p-1", "Phantom One"), r("p-1a", "Phantom Child", "p-1")],
      intersections: [],
    });
    renderMatrix();
    await screen.findByText("Ghost Two");
    expect(await optionsOf(/sort rows/i)).toEqual(["A → Z", "By count"]);
    expect(await optionsOf(/sort columns/i)).toEqual(["A → Z", "By count", "Hierarchy"]);
  });

  it("offers no hierarchy while the data is still loading", async () => {
    saved.config = { rowType: "Ghost", colType: "Phantom" };
    mockApi.on("get", "/reports/matrix*", () => new Promise(() => {}));
    renderMatrix();
    await screen.findByRole("progressbar");
    expect(await optionsOf(/sort rows/i)).toEqual(["A → Z", "By count"]);
    expect(await optionsOf(/sort columns/i)).toEqual(["A → Z", "By count"]);
  });
});

// ---------------------------------------------------------------------------
// Saved config: load, persist, reset
// ---------------------------------------------------------------------------

describe("MatrixReport saved config", () => {
  it("restores the axis types, cell mode and hide toggle, and labels the axes from the metamodel", async () => {
    saved.config = {
      rowType: "BusinessCapability",
      colType: "Application",
      cellMode: "count",
      hideEmpty: true,
    };
    renderMatrix();
    await waitFor(() =>
      expect(lastPath()).toBe("/reports/matrix?row_type=BusinessCapability&col_type=Application"),
    );
    await screen.findByText("Cap One");
    expect(selectValue(/cell display/i)).toBe("Count (heatmap)");
    expect(screen.getByRole("checkbox", { name: /Hide unrelated cards/ })).toBeChecked();
    expect(table().querySelector("thead th")).toHaveTextContent("Business Capability / Application");
    expect(screen.getByText("Business Capability with no relation")).toBeInTheDocument();
  });

  it("ignores a cell mode it does not know", async () => {
    saved.config = { cellMode: "bogus" };
    renderMatrix();
    await screen.findByText("App One");
    expect(selectValue(/cell display/i)).toBe("Exists (dot)");
  });

  it("restores gaps-only from a real boolean", async () => {
    saved.config = { showOnlyGaps: true };
    renderMatrix();
    await screen.findByText("App Two");
    expect(screen.getByRole("checkbox", { name: /Show only gaps/ })).toBeChecked();
  });

  it("ignores a gaps-only flag that is not a boolean", async () => {
    saved.config = { showOnlyGaps: "yes" };
    renderMatrix();
    await screen.findByText("App One");
    expect(screen.getByRole("checkbox", { name: /Show only gaps/ })).not.toBeChecked();
    expect(lastPersisted().showOnlyGaps).toBe(false);
  });

  it("persists the whole config, hands the same one to the save dialog, and keeps persisting", async () => {
    saved.config = {};
    renderMatrix();
    await screen.findByText("App One");

    const expected = {
      rowType: "Application",
      colType: "BusinessCapability",
      cellMode: "exists",
      hideEmpty: false,
      showOnlyGaps: false,
      sortRows: "alpha",
      sortCols: "hierarchy",
      rowExpandedDepth: 0,
      colExpandedDepth: 0,
      filters: { relationTypes: [], attrValues: {}, direction: "any" },
      rowScopeIds: [],
      colScopeIds: [],
    };
    await waitFor(() => expect(lastPersisted()).toEqual(expected));
    expect(saved.dialogConfig).toEqual(expected);

    fireEvent.click(screen.getByRole("checkbox", { name: /Hide unrelated cards/ }));
    await waitFor(() => expect(lastPersisted()).toEqual({ ...expected, hideEmpty: true }));
  });

  it("keeps only string scope ids", async () => {
    saved.config = { rowScopeIds: ["app-1", 7], colScopeIds: ["bc-1", null] };
    renderMatrix();
    await screen.findByText("App One");
    await waitFor(() => expect(lastPersisted().rowScopeIds).toEqual(["app-1"]));
    expect(lastPersisted().colScopeIds).toEqual(["bc-1"]);
    expect(screen.getByText("1 row", { selector: ".MuiChip-label" })).toBeInTheDocument();
    expect(screen.getByText("1 column", { selector: ".MuiChip-label" })).toBeInTheDocument();
  });

  describe("a saved report that arrives after mount", () => {
    beforeEach(() => {
      setup([APP(true), BC(true)]);
      mockApi.on("get", "/reports/matrix*", HIER);
    });

    async function loadLater(config: Record<string, unknown>) {
      const view = renderMatrix();
      await screen.findByText("App One Child");
      saved.config = config;
      saved.loadedConfig = { ...config };
      rerenderMatrix(view);
    }

    it("restores the column sort and leaves the rows alone", async () => {
      await loadLater({ sortCols: "alpha" });
      await waitFor(() => expect(selectValue(/sort columns/i)).toBe("A → Z"));
      expect(selectValue(/sort rows/i)).toBe("Hierarchy");
      expect(depthCounter("Collapse rows")).toBe("1/1");
    });

    it("restores the row sort and leaves the columns alone", async () => {
      await loadLater({ sortRows: "count" });
      await waitFor(() => expect(selectValue(/sort rows/i)).toBe("By count"));
      expect(selectValue(/sort columns/i)).toBe("Hierarchy");
      expect(depthCounter("Collapse columns")).toBe("1/1");
    });

    it("restores both collapsed depths", async () => {
      await loadLater({ rowExpandedDepth: 0, colExpandedDepth: 0 });
      await waitFor(() => expect(depthCounter("Collapse rows")).toBe("0/1"));
      expect(depthCounter("Collapse columns")).toBe("0/1");
    });
  });

  it("resets the axes, the cell mode and the hide toggle to their defaults", async () => {
    saved.config = {
      rowType: "BusinessCapability",
      colType: "Application",
      cellMode: "count",
      hideEmpty: true,
    };
    renderMatrix();
    await waitFor(() => expect(lastPath()).toContain("row_type=BusinessCapability"));
    await screen.findByText("Cap One");

    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await waitFor(() => expect(lastPath()).toBe(DEFAULT_PATH));
    expect(selectValue(/cell display/i)).toBe("Exists (dot)");
    expect(screen.getByRole("checkbox", { name: /Hide unrelated cards/ })).not.toBeChecked();
    expect(saved.resetAll).toHaveBeenCalled();
  });

  it("resets sorts, depths, searches, gaps and scopes without an axis change", async () => {
    const user = userEvent.setup();
    setup([APP(true), BC(true)]);
    mockApi.on("get", "/reports/matrix*", HIER);
    saved.config = { rowScopeIds: ["app-1"], colScopeIds: ["bc-1"] };
    renderMatrix();
    await screen.findByText("App One Child");
    // The reset must use the saved-report handle of the current render.
    const resetAll = vi.fn();
    saved.resetAll = resetAll;

    fireEvent.click(screen.getByLabelText("Collapse rows"));
    fireEvent.click(screen.getByLabelText("Collapse columns"));
    await waitFor(() => expect(depthCounter("Collapse rows")).toBe("0/1"));
    await pick(/sort rows/i, /By count/);
    await pick(/sort columns/i, /By count/);
    await user.type(screen.getByLabelText("Find row"), "One");
    await user.type(screen.getByLabelText("Find column"), "One");
    await user.click(screen.getByRole("checkbox", { name: /Show only gaps/ }));
    expect(screen.getByText("1 row", { selector: ".MuiChip-label" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));

    await waitFor(() => expect(selectValue(/sort rows/i)).toBe("Hierarchy"));
    expect(resetAll).toHaveBeenCalled();
    expect(selectValue(/sort columns/i)).toBe("Hierarchy");
    expect(screen.getByLabelText("Find row")).toHaveValue("");
    expect(screen.getByLabelText("Find column")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: /Show only gaps/ })).not.toBeChecked();
    expect(screen.getByText("All rows", { selector: ".MuiChip-label" })).toBeInTheDocument();
    expect(screen.getByText("All columns", { selector: ".MuiChip-label" })).toBeInTheDocument();
    await screen.findByText("App Two");
    expect(depthCounter("Collapse rows")).toBe("1/1");
    expect(depthCounter("Collapse columns")).toBe("1/1");
  });
});

// ---------------------------------------------------------------------------
// Filters and the request path
// ---------------------------------------------------------------------------

describe("MatrixReport filters and request path", () => {
  it("sorts relation types, attribute keys and values into one canonical path", async () => {
    saved.config = {
      filters: {
        relationTypes: ["zzz", "relAppToBc"],
        attrValues: {
          "relAppToBc.r": ["true"],
          "relAppToBc.c": ["true", "false", 5],
          "relAppToBc.mode": [],
        },
      },
    };
    renderMatrix();
    await waitFor(() =>
      expect(lastPath()).toBe(
        `${DEFAULT_PATH}&relation_types=relAppToBc%2Czzz` +
          "&attr=relAppToBc.c%3Afalse&attr=relAppToBc.c%3Atrue&attr=relAppToBc.r%3Atrue",
      ),
    );
    await waitFor(() =>
      expect(lastPersisted().filters).toEqual({
        relationTypes: ["zzz", "relAppToBc"],
        attrValues: { "relAppToBc.r": ["true"], "relAppToBc.c": ["true", "false"] },
        direction: "any",
      }),
    );
  });

  it("drops malformed relation types and attribute values but keeps the direction", async () => {
    saved.config = { filters: { relationTypes: "relAppToBc", attrValues: null, direction: "forward" } };
    renderMatrix();
    await waitFor(() => expect(lastPath()).toBe(`${DEFAULT_PATH}&direction=forward`));
    await screen.findByText("App One");
  });

  it("loads a saved report whose filters are null", async () => {
    saved.config = { filters: null };
    renderMatrix();
    expect(await screen.findByText("App One")).toBeInTheDocument();
    expect(lastPath()).toBe(DEFAULT_PATH);
  });

  it("clears the filters when an axis changes type, but not on load", async () => {
    setup([APP(), BC(), PROVIDER]);
    saved.config = { filters: { direction: "reverse" } };
    renderMatrix();
    await waitFor(() => expect(lastPath()).toBe(`${DEFAULT_PATH}&direction=reverse`));
    await screen.findByText("App One");

    await pick(/^columns$/i, /^Provider$/);
    await waitFor(() =>
      expect(lastPath()).toBe("/reports/matrix?row_type=Application&col_type=Provider"),
    );
  });

  it("counts every kind of active filter", async () => {
    saved.config = {
      filters: {
        relationTypes: ["relAppToBc"],
        attrValues: { "relAppToBc.c": ["true"] },
        direction: "forward",
      },
    };
    renderMatrix();
    expect(await screen.findByText("3 filters active")).toBeInTheDocument();
  });

  it("counts a lone attribute filter, and a lone direction", async () => {
    saved.config = { filters: { attrValues: { "relAppToBc.c": ["true"] } } };
    const view = renderMatrix();
    expect(await screen.findByText("1 filter active")).toBeInTheDocument();
    view.unmount();

    saved.config = { filters: { direction: "reverse" } };
    renderMatrix();
    expect(await screen.findByText("1 filter active")).toBeInTheDocument();
  });

  it("keeps the request path when a saved filter is malformed only in its values", async () => {
    saved.config = { filters: { relationTypes: [], attrValues: { "relAppToBc.c": [3] } } };
    renderMatrix();
    await screen.findByText("App One");
    expect(lastPath()).toBe(DEFAULT_PATH);
  });
});

describe("MatrixReport relation types between the axes", () => {
  const PAIR = makeRelationType({
    key: "relPair",
    label: "pairs with",
    source_type_key: "Application",
    target_type_key: "BusinessCapability",
    attributes_schema: [makeField({ key: "p", label: "Pair flag", type: "boolean" })],
  });
  const BACK = makeRelationType({
    key: "relBack",
    label: "backs",
    source_type_key: "BusinessCapability",
    target_type_key: "Application",
    attributes_schema: [makeField({ key: "b", label: "Back flag", type: "boolean" })],
  });
  const stray = (key: string, label: string, source: string, target: string) =>
    makeRelationType({
      key,
      label,
      source_type_key: source,
      target_type_key: target,
      attributes_schema: [makeField({ key: `${key}f`, label: `${label} flag`, type: "boolean" })],
    });
  const STRAYS = [
    stray("relA", "strays from app", "Application", "ITComponent"),
    stray("relB", "strays into cap", "ITComponent", "BusinessCapability"),
    stray("relC", "strays from cap", "BusinessCapability", "ITComponent"),
    stray("relD", "strays into app", "ITComponent", "Application"),
  ];

  it("lists only the relation types joining the two axes, and follows an axis change", async () => {
    setup([APP(), BC(), ITC], [PAIR, BACK, ...STRAYS]);
    saved.config = { cellMode: "codes" };
    renderMatrix();
    await screen.findByText("App One");

    // The codes legend has one group per relation type in play.
    expect(screen.getByText("pairs with")).toBeInTheDocument();
    expect(screen.getByText("backs")).toBeInTheDocument();
    for (const name of ["strays from app", "strays into cap", "strays from cap", "strays into app"]) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }

    await pick(/^columns$/i, /^IT Component$/);
    await waitFor(() => expect(lastPath()).toContain("col_type=ITComponent"));
    expect(await screen.findByText("strays from app")).toBeInTheDocument();
    expect(screen.getByText("strays into app")).toBeInTheDocument();
    expect(screen.queryByText("pairs with")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Search, coverage toggles and scope
// ---------------------------------------------------------------------------

const FLAT3: Payload = {
  rows: [r("app-1", "App One"), r("app-2", "App Two"), r("app-3", "App Three")],
  columns: [r("bc-1", "Cap One"), r("bc-2", "Cap Two")],
  relation_types: ["relAppToBc"],
  attr_sets: [{}],
  intersections: [
    { row_id: "app-1", col_id: "bc-1", e: [[0, "f", 0]] },
    { row_id: "app-3", col_id: "bc-1", e: [[0, "f", 0]] },
  ],
  truncated: false,
};

describe("MatrixReport search and coverage toggles", () => {
  beforeEach(() => setup([APP(false), BC(false)]));

  it("treats a blank row search as no search", async () => {
    const user = userEvent.setup();
    renderMatrix();
    await screen.findByText("App One");
    await user.type(screen.getByLabelText("Find row"), "   ");
    await user.type(screen.getByLabelText("Find column"), "Two");
    // The column search lands after the row one, so both have applied here.
    await waitFor(() => expect(within(table()).queryByText("Cap One")).not.toBeInTheDocument());
    expect(within(table()).getByText("App One")).toBeInTheDocument();
    expect(within(table()).getByText("App Two")).toBeInTheDocument();
  });

  it("treats a blank column search as no search", async () => {
    const user = userEvent.setup();
    renderMatrix();
    await screen.findByText("App One");
    await user.type(screen.getByLabelText("Find column"), "   ");
    await user.type(screen.getByLabelText("Find row"), "Two");
    await waitFor(() => expect(within(table()).queryByText("App One")).not.toBeInTheDocument());
    expect(within(table()).getByText("Cap One")).toBeInTheDocument();
    expect(within(table()).getByText("Cap Two")).toBeInTheDocument();
  });

  it("keeps a search across an axis change without tripping over the missing data", async () => {
    const user = userEvent.setup();
    renderMatrix();
    await screen.findByText("App One");
    await user.type(screen.getByLabelText("Find row"), "One");
    await user.type(screen.getByLabelText("Find column"), "One");
    await waitFor(() => expect(within(table()).queryByText("Cap Two")).not.toBeInTheDocument());
    await waitFor(() => expect(within(table()).queryByText("App Two")).not.toBeInTheDocument());

    mockApi.on("get", /row_type=BusinessCapability/, () => new Promise(() => {}));
    await pick(/^rows$/i, /^Business Capability$/);
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();
    expect(selectValue(/^rows$/i)).toBe("Business Capability");
  });

  it("searches within the related cards when unrelated ones are hidden, on both flat axes", async () => {
    const user = userEvent.setup();
    mockApi.on("get", "/reports/matrix*", FLAT3);
    renderMatrix();
    await screen.findByText("App Two");

    await user.click(screen.getByRole("checkbox", { name: /Hide unrelated cards/ }));
    await waitFor(() => expect(within(table()).queryByText("App Two")).not.toBeInTheDocument());
    expect(rowHeaders()).toEqual(["App One", "App Three"]);
    expect(leafHeaders()).toEqual(["Cap One"]);

    await user.type(screen.getByLabelText("Find row"), "App T");
    await waitFor(() => expect(within(table()).queryByText("App One")).not.toBeInTheDocument());
    expect(rowHeaders()).toEqual(["App Three"]);
  });

  it("shows only the uncovered cards on both flat axes in gaps-only mode", async () => {
    const user = userEvent.setup();
    mockApi.on("get", "/reports/matrix*", {
      ...FLAT3,
      columns: [...FLAT3.columns, r("bc-3", "Cap Three")],
    });
    renderMatrix();
    await screen.findByText("App Two");

    await user.click(screen.getByRole("checkbox", { name: /Show only gaps/ }));
    await waitFor(() => expect(within(table()).queryByText("App One")).not.toBeInTheDocument());
    expect(rowHeaders()).toEqual(["App Two"]);
    expect(leafHeaders()).toEqual(["Cap Three", "Cap Two"]);
  });

  it("labels the scoped cards in the scope dialogs from the data it already holds", async () => {
    mockApi.on("get", "/cards*", () => new Promise(() => {}));
    saved.config = { rowScopeIds: ["app-1"], colScopeIds: ["bc-1"] };
    renderMatrix();
    await screen.findByText("App One");

    fireEvent.click(screen.getByText("1 row", { selector: ".MuiChip-label" }));
    const rowsDialog = await screen.findByRole("dialog");
    expect(within(rowsDialog).getByText("App One")).toBeInTheDocument();
    fireEvent.keyDown(rowsDialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByText("1 column", { selector: ".MuiChip-label" }));
    const colsDialog = await screen.findByRole("dialog");
    expect(within(colsDialog).getByText("Cap One")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Sorting by count and name, and the KPI strip
// ---------------------------------------------------------------------------

describe("MatrixReport sorting", () => {
  it("orders flat rows and columns by name and by relation count", async () => {
    setup([APP(false), BC(true)]);
    mockApi.on("get", "/reports/matrix*", {
      rows: [r("app-b", "App B"), r("app-a", "App A"), r("app-c", "App C")],
      columns: [r("bc-1a", "Cap One Child", "bc-1"), r("bc-2", "Cap Two"), r("bc-1", "Cap One")],
      relation_types: ["relAppToBc"],
      attr_sets: [{}],
      intersections: [
        { row_id: "app-a", col_id: "bc-2", e: [[0, "f", 0]] },
        { row_id: "app-c", col_id: "bc-2", e: [[0, "f", 0]] },
        { row_id: "app-c", col_id: "bc-1a", e: [[0, "f", 0]] },
        // A structural pair with no relation behind it counts for nothing.
        { row_id: "app-b", col_id: "bc-1" },
      ],
      truncated: false,
    });
    renderMatrix();
    await screen.findByText("App B");

    expect(rowHeaders()).toEqual(["App A", "App B", "App C"]);
    expect(metric("Relations")).toBe("3");

    await pick(/sort rows/i, /By count/);
    await waitFor(() => expect(rowHeaders()).toEqual(["App C", "App A", "App B"]));

    await pick(/sort columns/i, /By count/);
    await waitFor(() => expect(leafHeaders()).toEqual(["Cap Two", "Cap One Child", "Cap One"]));

    await pick(/sort columns/i, /A → Z/);
    await waitFor(() => expect(leafHeaders()).toEqual(["Cap One", "Cap One Child", "Cap Two"]));
  });
});

describe("MatrixReport KPI strip", () => {
  beforeEach(() => setup([APP(false), BC(false)]));

  it("reports counts, coverage and the uncovered cards on each axis", async () => {
    mockApi.on("get", "/reports/matrix*", {
      ...FLAT,
      rows: [r("app-1", "App One"), r("app-2", "App Two"), r("app-3", "App Three")],
      columns: [r("bc-1", "Cap One"), r("bc-2", "Cap Two"), r("bc-3", "Cap Three")],
    });
    renderMatrix();
    await screen.findByText("App Three");
    expect(metric("Application")).toBe("3");
    expect(metric("Business Capability")).toBe("3");
    expect(metric("Relations")).toBe("1");
    expect(metric("Coverage")).toBe("11.1%");
    expect(metric("Application with no relation")).toBe("2");
    expect(metric("Business Capability with no relation")).toBe("2");
  });

  it("reports zero coverage and no oversized-grid warning for an axis with no cards", async () => {
    mockApi.on("get", "/reports/matrix*", { ...FLAT, columns: [], intersections: [] });
    renderMatrix();
    expect(await screen.findByText("No data found for this combination.")).toBeInTheDocument();
    expect(metric("Coverage")).toBe("0%");
    expect(screen.queryByText(/This grid has/)).not.toBeInTheDocument();
  });

  it("counts only the relations inside a row scope, and inside a column scope", async () => {
    const data = {
      ...FLAT,
      intersections: [
        { row_id: "app-1", col_id: "bc-1", e: [[0, "f", 0], [0, "r", 0]] },
        { row_id: "app-2", col_id: "bc-2", e: [[0, "f", 0]] },
      ],
    };
    mockApi.on("get", "/reports/matrix*", data);
    saved.config = { rowScopeIds: ["app-1"] };
    const view = renderMatrix();
    await screen.findByText("App One");
    await waitFor(() => expect(metric("Relations")).toBe("2"));
    view.unmount();

    saved.config = { colScopeIds: ["bc-1"] };
    renderMatrix();
    await screen.findByText("App One");
    await waitFor(() => expect(metric("Relations")).toBe("2"));
  });
});

// ---------------------------------------------------------------------------
// The grid: headers, hover, cells
// ---------------------------------------------------------------------------

describe("MatrixReport grid structure", () => {
  it("stacks nested column headers, widens the corner over nested row headers, and gives a related parent its own column", async () => {
    setup([APP(true), BC(true)]);
    mockApi.on("get", "/reports/matrix*", {
      ...HIER,
      intersections: [...HIER.intersections, { row_id: "app-2", col_id: "bc-1", e: [[0, "f", 0]] }],
    });
    renderMatrix();
    await screen.findByText("App One Child");

    expect(table().querySelectorAll("thead tr")).toHaveLength(2);
    expect(within(table().querySelector("thead") as HTMLElement).getByText("(itself)")).toBeInTheDocument();
    expect((table().querySelector("thead th") as HTMLTableCellElement).colSpan).toBe(2);
  });

  it("measures the header rows so each sticks below the one above it", async () => {
    let height = 20;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const h = this.tagName === "TR" ? height : 0;
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: h, width: 0, height: h, toJSON: () => ({}) } as DOMRect;
    });
    setup([APP(false), BC(true)]);
    mockApi.on("get", "/reports/matrix*", HIER);
    renderMatrix();
    await screen.findByText("App One Child");

    const child = () => within(table()).getByText("Cap One Child").closest("th") as HTMLElement;
    const group = () => within(table()).getAllByText("Cap One").find((el) => el.closest("th"))!.closest("th") as HTMLElement;
    await waitFor(() => expect(child().style.top).toBe("20px"));
    expect(group().style.top).toBe("0px");

    // A half-pixel change is still a change worth re-rendering for.
    height = 20.5;
    fireEvent.mouseEnter(rowCells("App Two")[0]);
    await waitFor(() => expect(child().style.top).toBe("20.5px"));
  });
});

describe("MatrixReport hover", () => {
  const PAPER = "rgb(255, 255, 255)";
  const HOVER = "rgba(0, 0, 0, 0.04)";
  const RELATED = "rgb(227, 242, 253)";
  const RELATED_HOVER = "rgb(187, 222, 251)";

  it("highlights a flat row and a flat column from their headers", async () => {
    setup([APP(false), BC(false)]);
    renderMatrix();
    await screen.findByText("App One");

    expect(rowCells("App Two").map((c) => c.style.backgroundColor)).toEqual([PAPER, PAPER]);
    expect(rowCells("App One")[0].style.backgroundColor).toBe(RELATED);

    const rowHeader = within(table()).getByText("App Two").closest("td") as HTMLElement;
    fireEvent.mouseEnter(rowHeader);
    await waitFor(() =>
      expect(rowCells("App Two").map((c) => c.style.backgroundColor)).toEqual([HOVER, HOVER]),
    );
    expect(rowCells("App One")[1].style.backgroundColor).toBe(PAPER);
    fireEvent.mouseLeave(rowHeader);
    await waitFor(() =>
      expect(rowCells("App Two").map((c) => c.style.backgroundColor)).toEqual([PAPER, PAPER]),
    );

    const colHeader = within(table()).getByText("Cap Two").closest("th") as HTMLElement;
    fireEvent.mouseEnter(colHeader);
    await waitFor(() => expect(rowCells("App One")[1].style.backgroundColor).toBe(HOVER));
    expect(rowCells("App Two")[1].style.backgroundColor).toBe(HOVER);
    expect(rowCells("App Two")[0].style.backgroundColor).toBe(PAPER);

    fireEvent.mouseLeave(colHeader);
    fireEvent.mouseEnter(within(table()).getByText("App One").closest("td") as HTMLElement);
    await waitFor(() => expect(rowCells("App One")[0].style.backgroundColor).toBe(RELATED_HOVER));
  });

  it("highlights every descendant's cells from a group header", async () => {
    setup([APP(true), BC(true)]);
    mockApi.on("get", "/reports/matrix*", HIER);
    renderMatrix();
    await screen.findByText("App One Child");
    const cell = () => within(table()).getByTitle(/^App One Child × Cap One Child/);
    expect(cell().style.backgroundColor).toBe(RELATED);

    const rowGroup = within(table()).getAllByText("App One").find((el) => el.closest("td"))!.closest("td")!;
    fireEvent.mouseEnter(rowGroup);
    await waitFor(() => expect(cell().style.backgroundColor).toBe(RELATED_HOVER));
    fireEvent.mouseLeave(rowGroup);
    await waitFor(() => expect(cell().style.backgroundColor).toBe(RELATED));

    const colGroup = within(table()).getAllByText("Cap One").find((el) => el.closest("th"))!.closest("th")!;
    fireEvent.mouseEnter(colGroup);
    await waitFor(() => expect(cell().style.backgroundColor).toBe(RELATED_HOVER));
  });

  it("uses the dark palette for related and hovered cells", async () => {
    setup([APP(false), BC(false)]);
    renderMatrix({ dark: true });
    await screen.findByText("App One");
    const cell = () => rowCells("App One")[0];
    expect(cell().style.backgroundColor).toBe("rgba(25, 118, 210, 0.18)");
    fireEvent.mouseEnter(within(table()).getByText("App One").closest("td") as HTMLElement);
    await waitFor(() => expect(cell().style.backgroundColor).toBe("rgba(25, 118, 210, 0.28)"));
  });
});

/** Application against itself: a diagonal with a relation, and a 2-relation max. */
const SELF: Payload = {
  rows: [r("app-1", "App One"), r("app-2", "App Two"), r("app-3", "App Three")],
  columns: [r("app-1", "App One"), r("app-2", "App Two"), r("app-3", "App Three")],
  relation_types: ["relAppToBc"],
  attr_sets: [{}],
  intersections: [
    { row_id: "app-1", col_id: "app-1", e: [[0, "f", 0]] },
    { row_id: "app-1", col_id: "app-2", e: [[0, "f", 0], [0, "f", 0]] },
    { row_id: "app-2", col_id: "app-1", e: [[0, "r", 0]] },
  ],
  truncated: false,
};

describe("MatrixReport colours", () => {
  beforeEach(() => {
    setup([APP(false), BC(false)]);
    mockApi.on("get", "/reports/matrix*", SELF);
  });

  const color = (el: Element) => getComputedStyle(el).color;
  const bg = (el: Element) => getComputedStyle(el).backgroundColor;

  it("shades the count heatmap by each cell's share of the busiest cell", async () => {
    saved.config = { rowType: "Application", colType: "Application", cellMode: "count" };
    renderMatrix();
    await screen.findAllByText("App Three");
    const cell = (pair: RegExp) => within(table()).getByTitle(pair);
    const diag = cell(/^App One × App One/);
    const busiest = cell(/^App One × App Two/);
    const single = cell(/^App Two × App One/);
    expect(busiest.style.backgroundColor).toBe("rgb(13, 71, 161)");
    expect(single.style.backgroundColor).toBe("rgb(66, 165, 245)");
    expect(color(busiest.firstElementChild!)).toBe("rgb(255, 255, 255)");
    expect(color(single.firstElementChild!)).toBe("rgb(51, 51, 51)");
    expect(color(diag.firstElementChild!)).toBe("rgb(102, 102, 102)");
  });

  it("uses the dark text colours in the dark heatmap", async () => {
    saved.config = { rowType: "Application", colType: "Application", cellMode: "count" };
    renderMatrix({ dark: true });
    await screen.findAllByText("App Three");
    const diag = within(table()).getByTitle(/^App One × App One/);
    const single = within(table()).getByTitle(/^App Two × App One/);
    expect(color(single.firstElementChild!)).toBe("rgb(204, 204, 204)");
    expect(color(diag.firstElementChild!)).toBe("rgb(170, 170, 170)");
  });

  it("marks a related diagonal cell with a grey dot, and tints the hovered diagonal in the dark", async () => {
    saved.config = { rowType: "Application", colType: "Application" };
    const view = renderMatrix();
    await screen.findAllByText("App Three");
    expect(bg(rowCells("App One")[0].firstElementChild!)).toBe("rgb(158, 158, 158)");
    view.unmount();

    renderMatrix({ dark: true });
    await screen.findAllByText("App Three");
    expect(bg(rowCells("App One")[0].firstElementChild!)).toBe("rgb(120, 144, 156)");
    const diag = within(table()).getByTitle(/^App One × App One/);
    fireEvent.mouseEnter(diag);
    await waitFor(() => expect(diag.style.backgroundColor).toBe("rgba(69, 39, 160, 0.18)"));
  });

  it("draws the depth controls in the theme's icon colour", async () => {
    setup([APP(true), BC(true)]);
    mockApi.on("get", "/reports/matrix*", HIER);
    const view = renderMatrix();
    await screen.findByText("App One Child");
    const icon = () => screen.getByLabelText("Collapse rows").firstElementChild as HTMLElement;
    expect(icon().style.color).toBe("rgb(85, 85, 85)");
    view.unmount();

    renderMatrix({ dark: true });
    await screen.findByText("App One Child");
    expect(icon().style.color).toBe("rgb(170, 170, 170)");
  });
});

describe("MatrixReport cells", () => {
  beforeEach(() => setup([APP(false), BC(false)]));

  it("titles a cell with its pair, count and direction, and marks the source side", async () => {
    mockApi.on("get", "/reports/matrix*", {
      ...FLAT,
      intersections: [...FLAT.intersections, { row_id: "app-2", col_id: "bc-2", e: [[0, "r", 0]] }],
    });
    renderMatrix();
    await screen.findByText("App One");
    const [forward, empty] = rowCells("App One");
    const reverse = rowCells("App Two")[1];
    expect(forward.title).toBe("App One × Cap One\n1 relation\nRow is the source");
    expect(reverse.title).toBe("App Two × Cap Two\n1 relation\nRow is the target");
    expect(forward.style.borderLeft).toBe("2px solid rgb(25, 118, 210)");
    expect(reverse.style.borderLeft).toBe("");
    expect(empty.style.borderLeft).toBe("");
  });

  it("draws a dot for a related cell without values, and no overflow marker under four values", async () => {
    mockApi.on("get", "/reports/matrix*", {
      ...FLAT,
      intersections: [
        { row_id: "app-1", col_id: "bc-1", e: [[0, "f", 0]] },
        { row_id: "app-2", col_id: "bc-2", e: [[0, "f", 1]] },
      ],
    });
    saved.config = { cellMode: "codes" };
    renderMatrix();
    await screen.findByText("App One");
    const dot = rowCells("App One")[0].firstElementChild as HTMLElement;
    expect(getComputedStyle(dot).width).toBe("10px");
    expect(dot.childElementCount).toBe(0);
    expect(within(rowCells("App Two")[1]).getByText("C")).toBeInTheDocument();
    expect(within(table()).queryByText(/^\+/)).not.toBeInTheDocument();
  });

  it("writes the value labels into the cells in the labels mode", async () => {
    mockApi.on("get", "/reports/matrix*", {
      ...FLAT,
      intersections: [{ row_id: "app-2", col_id: "bc-2", e: [[0, "f", 1]] }],
    });
    saved.config = { cellMode: "labels" };
    renderMatrix();
    await screen.findByText("App One");
    expect(within(rowCells("App Two")[1]).getByText("Create")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Transpose, request lifecycle, print parameters
// ---------------------------------------------------------------------------

describe("MatrixReport transpose", () => {
  it("carries each flat axis's sort and search across", async () => {
    const user = userEvent.setup();
    setup([APP(false), PROVIDER]);
    saved.config = { colType: "Provider" };
    renderMatrix();
    await screen.findByText("App One");
    await pick(/sort columns/i, /By count/);
    await user.type(screen.getByLabelText("Find row"), "One");

    fireEvent.click(screen.getByRole("button", { name: "Swap rows and columns" }));
    await waitFor(() =>
      expect(lastPath()).toBe("/reports/matrix?row_type=Provider&col_type=Application"),
    );
    expect(selectValue(/sort rows/i)).toBe("By count");
    expect(selectValue(/sort columns/i)).toBe("A → Z");
    expect(screen.getByLabelText("Find column")).toHaveValue("One");
    expect(screen.getByLabelText("Find row")).toHaveValue("");
  });
});

describe("MatrixReport request lifecycle", () => {
  it("says why a new query failed, in place of the previous query's grid", async () => {
    let fail: (e: Error) => void = () => {};
    renderMatrix();
    await screen.findByText("App One");
    mockApi.on(
      "get",
      /row_type=BusinessCapability/,
      () => new Promise((_, reject) => { fail = reject; }),
    );
    await pick(/^rows$/i, /^Business Capability$/);
    await screen.findByRole("progressbar");
    await act(async () => {
      fail(new Error("boom"));
      await new Promise((res) => setTimeout(res, 0));
    });
    // The failure is said, in place of the stale grid and of the spinner.
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("App One")).not.toBeInTheDocument();
  });
});

describe("MatrixReport print parameters", () => {
  it("summarises the axes, cell mode and sorts", async () => {
    setup([APP(false), BC(true)]);
    renderMatrix();
    await screen.findByText("App One");
    expect(printParams()).toEqual([
      "Rows: Application",
      "Columns: Business Capability",
      "Cell: Exists (dot)",
      "Sort Rows: A → Z",
      "Sort Columns: Hierarchy",
    ]);
    await pick(/sort rows/i, /By count/);
    await waitFor(() => expect(printParams()).toContain("Sort Rows: By count"));
    await pick(/cell display/i, /Values \(labels\)/);
    await waitFor(() => expect(printParams()).toContain("Cell: Values (labels)"));
  });

  it("adds the row scope, the heatmap and a forward direction", async () => {
    saved.config = { cellMode: "count", rowScopeIds: ["app-1"], filters: { direction: "forward" } };
    renderMatrix();
    await screen.findByText("App One");
    await waitFor(() => expect(printParams()).toContain("Row scope: 1 row"));
    expect(printParams()).toContain("Cell: Count (heatmap)");
    expect(printParams()).toContain("Direction: Row is the source");
  });

  it("names the codes mode and a reverse direction", async () => {
    saved.config = { cellMode: "codes", filters: { direction: "reverse" } };
    renderMatrix();
    await screen.findByText("App One");
    expect(printParams()).toContain("Cell: Values (codes)");
    expect(printParams()).toContain("Direction: Row is the target");
  });

  it("hands the export the same summary and only the visible relations of flat axes", async () => {
    const user = userEvent.setup();
    setup([APP(false), BC(false)]);
    renderMatrix();
    await screen.findByText("App One");
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Export to Excel/ }));
    await waitFor(() => expect(saved.exportXlsx).toHaveBeenCalled());
    const data = vi.mocked(saved.exportXlsx).mock.calls[0][0] as ReportExportData;
    expect(data.filterSummary).toEqual([
      { label: "Rows", value: "Application" },
      { label: "Columns", value: "Business Capability" },
      { label: "Cell", value: "Exists (dot)" },
      { label: "Sort Rows", value: "A → Z" },
      { label: "Sort Columns", value: "A → Z" },
    ]);
    expect(data.sheets![1].rows).toHaveLength(1);
  });
});
