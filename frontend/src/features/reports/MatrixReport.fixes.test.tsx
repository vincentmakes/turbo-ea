/**
 * Regression tests for Matrix report bugs a mutation pass surfaced: a config
 * applied at mount losing its sorts and depths to the axis-type defaults, a
 * transpose dropping both scopes and resetting sorts and depths, the header
 * resize observer never observing the header, a failed load spinning forever,
 * and a boolean filter summarised raw.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

const saved = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  loaded: null as Record<string, unknown> | null,
  persistConfig: (() => {}) as (cfg: unknown) => void,
}));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: () => ({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: () => {},
    loadedConfig: saved.loaded,
    consumeConfig: () => saved.config,
    resetSavedReport: () => {},
    persistConfig: saved.persistConfig,
    resetAll: () => {},
    reportType: "matrix",
  }),
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({ chartRef: createRef(), thumbnail: undefined, captureAndSave: () => {} }),
}));
vi.mock("@/features/reports/SaveReportDialog", () => ({ default: () => null }));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { installResizeObserver } from "@/test/dom";
import { makeCardType, makeField, makeRelationType } from "@/test/fixtures/metamodel";
import MatrixReport from "./MatrixReport";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const APP = (hier: boolean) =>
  makeCardType({ key: "Application", label: "Application", has_hierarchy: hier });
const BC = (hier: boolean) =>
  makeCardType({ key: "BusinessCapability", label: "Business Capability", has_hierarchy: hier });

const CRUD = makeRelationType({
  key: "relAppToBc",
  label: "uses",
  reverse_label: "is used by",
  source_type_key: "Application",
  target_type_key: "BusinessCapability",
  attributes_schema: [makeField({ key: "c", label: "Create", type: "boolean" })],
});

type Row = { id: string; name: string; parent_id: string | null };
const r = (id: string, name: string, parent_id: string | null = null): Row => ({ id, name, parent_id });

const APPS = [r("app-1", "App One"), r("app-1a", "App One Child", "app-1"), r("app-2", "App Two")];
const CAPS = [r("bc-1", "Cap One"), r("bc-1a", "Cap One Child", "bc-1"), r("bc-2", "Cap Two")];

/** Applications down the side, capabilities across, both one level deep. */
const HIER = {
  rows: APPS,
  columns: CAPS,
  relation_types: ["relAppToBc"],
  attr_sets: [{}],
  intersections: [
    { row_id: "app-1a", col_id: "bc-1a", e: [[0, "f", 0]] },
    { row_id: "app-2", col_id: "bc-2", e: [[0, "f", 0]] },
  ],
  truncated: false,
};
/** The same matrix with the axes swapped, as the endpoint answers a transpose. */
const HIER_T = {
  ...HIER,
  rows: CAPS,
  columns: APPS,
  intersections: [
    { row_id: "bc-1a", col_id: "app-1a", e: [[0, "r", 0]] },
    { row_id: "bc-2", col_id: "app-2", e: [[0, "r", 0]] },
  ],
};

let restoreRO: ReturnType<typeof installResizeObserver>;

function renderMatrix() {
  return render(
    <MemoryRouter>
      <MatrixReport />
    </MemoryRouter>,
  );
}

const table = () => document.querySelector("table") as HTMLElement;
const selectValue = (name: RegExp) => screen.getByRole("combobox", { name }).textContent;
const depthCounter = (collapseLabel: string) =>
  screen.getByLabelText(collapseLabel).nextElementSibling?.textContent;
const printParams = () =>
  Array.from(document.querySelectorAll(".report-print-params > *")).map((el) =>
    (el.textContent ?? "").replace(/\|$/, ""),
  );
const last = <T,>(xs: T[]): T | undefined => xs[xs.length - 1];
const lastPath = () => last(mockApi.callsOf("get", "/reports/matrix*"))?.path;
const lastPersisted = () =>
  last(vi.mocked(saved.persistConfig).mock.calls)?.[0] as Record<string, unknown>;
const chip = (label: string) => screen.getByText(label, { selector: ".MuiChip-label" });

async function pick(label: RegExp, option: RegExp) {
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }, { timeout: 5000 }));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
}

const transpose = () =>
  fireEvent.click(screen.getByRole("button", { name: "Swap rows and columns" }));

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel([APP(true), BC(true)], [CRUD]);
  restoreRO = installResizeObserver();
  saved.config = null;
  saved.loaded = null;
  saved.persistConfig = vi.fn();
  mockApi.on("get", "/reports/matrix*", HIER);
  mockApi.on("get", /row_type=BusinessCapability&col_type=Application/, HIER_T);
});

afterEach(() => {
  restoreRO();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// A config applied at mount
// ---------------------------------------------------------------------------

describe("MatrixReport config applied at mount", () => {
  it("keeps its sorts on hierarchical axes", async () => {
    saved.config = { sortRows: "count", sortCols: "alpha" };
    renderMatrix();
    await screen.findByText("App One Child");
    expect(selectValue(/sort rows/i)).toBe("By count");
    expect(selectValue(/sort columns/i)).toBe("A → Z");
    expect(lastPersisted()).toMatchObject({ sortRows: "count", sortCols: "alpha" });
  });

  it("keeps its collapsed depths", async () => {
    saved.config = { rowExpandedDepth: 0, colExpandedDepth: 0 };
    renderMatrix();
    await screen.findByText("App Two");
    expect(depthCounter("Collapse rows")).toBe("0/1");
    expect(depthCounter("Collapse columns")).toBe("0/1");
    expect(lastPersisted()).toMatchObject({ rowExpandedDepth: 0, colExpandedDepth: 0 });
  });

  it("keeps its sort when it also restores the axis types", async () => {
    saved.config = { rowType: "BusinessCapability", colType: "Application", sortRows: "alpha" };
    renderMatrix();
    await screen.findByText("Cap One Child");
    expect(selectValue(/sort rows/i)).toBe("A → Z");
    expect(selectValue(/sort columns/i)).toBe("Hierarchy");
  });

  it("keeps its sort when the metamodel arrives after the report", async () => {
    hookState.metamodel = { types: [], relationTypes: [], loading: true };
    saved.config = { sortRows: "count" };
    const view = renderMatrix();
    await screen.findByRole("progressbar");
    withMetamodel([APP(true), BC(true)], [CRUD]);
    view.rerender(
      <MemoryRouter>
        <MatrixReport />
      </MemoryRouter>,
    );
    await screen.findByText("App One Child");
    expect(selectValue(/sort rows/i)).toBe("By count");
    expect(selectValue(/sort columns/i)).toBe("Hierarchy");
  });

  it("shows a stored hierarchy sort as A → Z on an axis with no hierarchy", async () => {
    withMetamodel([APP(false), BC(true)], [CRUD]);
    saved.config = { sortRows: "hierarchy" };
    renderMatrix();
    await screen.findByText("App One Child");
    expect(selectValue(/sort rows/i)).toBe("A → Z");
    expect(lastPersisted()).toMatchObject({ sortRows: "alpha", sortCols: "hierarchy" });
  });

  it("still re-picks the sort and resets the depth when the user changes an axis type", async () => {
    withMetamodel([APP(true), BC(true), makeCardType({ key: "Provider", label: "Provider" })], [CRUD]);
    saved.config = {
      sortRows: "count",
      sortCols: "count",
      rowExpandedDepth: 0,
      colExpandedDepth: 0,
      filters: { direction: "forward" },
    };
    renderMatrix();
    await screen.findByText("App One Child");
    expect(selectValue(/sort rows/i)).toBe("By count");
    expect(selectValue(/sort columns/i)).toBe("By count");
    expect(lastPath()).toContain("direction=forward");

    // A hierarchical type opens on its hierarchy, fully expanded, unfiltered.
    await pick(/^rows$/i, /^Business Capability$/);
    await waitFor(() =>
      expect(lastPath()).toBe("/reports/matrix?row_type=BusinessCapability&col_type=BusinessCapability"),
    );
    await screen.findByText("App One Child");
    expect(selectValue(/sort rows/i)).toBe("Hierarchy");
    expect(depthCounter("Collapse rows")).toBe("1/1");

    await pick(/^columns$/i, /^Application$/);
    await waitFor(() => expect(lastPath()).toContain("col_type=Application"));
    await screen.findByText("Cap One Child");
    expect(selectValue(/sort columns/i)).toBe("Hierarchy");
    expect(depthCounter("Collapse columns")).toBe("1/1");

    // A flat type cannot keep a hierarchy sort.
    await pick(/^columns$/i, /^Provider$/);
    await waitFor(() => expect(lastPath()).toContain("col_type=Provider"));
    await waitFor(() => expect(lastPersisted()).toMatchObject({ sortCols: "alpha" }));
  });

  it("keeps a count sort when the user picks a flat axis type", async () => {
    withMetamodel([APP(true), BC(true), makeCardType({ key: "Provider", label: "Provider" })], [CRUD]);
    renderMatrix();
    await screen.findByText("App One Child");
    await pick(/sort columns/i, /By count/);

    await pick(/^columns$/i, /^Provider$/);
    await waitFor(() => expect(lastPersisted()).toMatchObject({ colType: "Provider" }));
    // Only a hierarchical type re-picks the hierarchy sort.
    expect(lastPersisted()).toMatchObject({ sortCols: "count" });
    expect(selectValue(/sort columns/i)).toBe("By count");
  });

  it("gives both axis pickers room for a type's name", async () => {
    renderMatrix();
    await screen.findByText("App One Child");
    for (const name of [/^rows$/i, /^columns$/i]) {
      expect(screen.getByRole("combobox", { name }).closest(".MuiFormControl-root")).toHaveStyle({
        minWidth: "150px",
      });
    }
  });

  it("keeps the filters and scopes of a config whose axes differ from the defaults", async () => {
    saved.config = {
      rowType: "BusinessCapability",
      colType: "Application",
      rowScopeIds: ["bc-2"],
      filters: { direction: "forward" },
    };
    renderMatrix();
    await screen.findByText("Cap Two");
    expect(lastPath()).toBe(
      "/reports/matrix?row_type=BusinessCapability&col_type=Application&direction=forward",
    );
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({ rowScopeIds: ["bc-2"], colScopeIds: [] }),
    );
    expect(chip("1 row")).toBeInTheDocument();
    expect(within(table()).queryByText("Cap One")).not.toBeInTheDocument();
  });

  it("keeps the scope of a config that changes the row type only", async () => {
    mockApi.on("get", /row_type=BusinessCapability&col_type=BusinessCapability/, {
      ...HIER,
      rows: CAPS,
      intersections: [],
    });
    saved.config = { rowType: "BusinessCapability", rowScopeIds: ["bc-2"] };
    renderMatrix();
    await waitFor(() => expect(lastPath()).toContain("row_type=BusinessCapability"));
    await screen.findAllByText("Cap Two");
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({ rowScopeIds: ["bc-2"], colScopeIds: [] }),
    );
    expect(chip("1 row")).toBeInTheDocument();
  });

  it("keeps the scope of a config that changes the column type only", async () => {
    mockApi.on("get", /row_type=Application&col_type=Application/, {
      ...HIER,
      columns: APPS,
      intersections: [],
    });
    saved.config = { colType: "Application", colScopeIds: ["app-2"] };
    renderMatrix();
    await waitFor(() => expect(lastPath()).toContain("col_type=Application"));
    await screen.findAllByText("App One Child");
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({ rowScopeIds: [], colScopeIds: ["app-2"] }),
    );
    expect(chip("1 column")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// A saved report opened after the page mounted
// ---------------------------------------------------------------------------

describe("MatrixReport config applied after mount", () => {
  async function openSaved(cfg: Record<string, unknown>, view: ReturnType<typeof renderMatrix>) {
    saved.config = cfg;
    saved.loaded = cfg;
    view.rerender(
      <MemoryRouter>
        <MatrixReport />
      </MemoryRouter>,
    );
  }

  it("opens each axis on its type's default sort when the config names types but no sorts", async () => {
    const view = renderMatrix();
    await screen.findByText("App One Child");
    await pick(/sort rows/i, /By count/);
    await pick(/sort columns/i, /A → Z/);
    expect(selectValue(/sort rows/i)).toBe("By count");
    expect(selectValue(/sort columns/i)).toBe("A → Z");

    await openSaved({ rowType: "BusinessCapability", colType: "Application" }, view);
    await waitFor(() => expect(lastPath()).toContain("row_type=BusinessCapability"));
    await screen.findByText("Cap One Child");
    expect(selectValue(/sort rows/i)).toBe("Hierarchy");
    expect(selectValue(/sort columns/i)).toBe("Hierarchy");
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({ sortRows: "hierarchy", sortCols: "hierarchy" }),
    );
  });

  it("reads the default as A → Z on a flat axis type", async () => {
    withMetamodel([APP(true), BC(true), makeCardType({ key: "Provider", label: "Provider" })], [CRUD]);
    const view = renderMatrix();
    await screen.findByText("App One Child");
    await pick(/sort columns/i, /By count/);

    await openSaved({ rowType: "Application", colType: "Provider" }, view);
    await waitFor(() => expect(lastPath()).toContain("col_type=Provider"));
    await waitFor(() => expect(selectValue(/sort columns/i)).toBe("A → Z"));
    expect(selectValue(/sort rows/i)).toBe("Hierarchy");
  });

  it("leaves no scope behind to come back when it keeps the axis types", async () => {
    const view = renderMatrix();
    await screen.findByText("App One Child");

    await openSaved({ rowScopeIds: ["app-2"] }, view);
    await waitFor(() => expect(chip("1 row")).toBeInTheDocument());

    // Another row type clears the scope, as any type change does ...
    await pick(/^rows$/i, /^Business Capability$/);
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({ rowType: "BusinessCapability", rowScopeIds: [] }),
    );
    // ... and going back does not bring the reopened report's scope with it.
    await pick(/^rows$/i, /^Application$/);
    await waitFor(() =>
      expect(lastPath()).toBe("/reports/matrix?row_type=Application&col_type=BusinessCapability"),
    );
    await screen.findByText("App Two");
    expect(within(table()).getByText("App One")).toBeInTheDocument();
    expect(lastPersisted()).toMatchObject({ rowType: "Application", rowScopeIds: [] });
    expect(screen.queryByText("1 row", { selector: ".MuiChip-label" })).not.toBeInTheDocument();
  });

  it("still applies the sorts the config does carry", async () => {
    const view = renderMatrix();
    await screen.findByText("App One Child");
    await pick(/sort rows/i, /By count/);

    await openSaved(
      { rowType: "BusinessCapability", colType: "Application", sortRows: "alpha" },
      view,
    );
    await screen.findByText("Cap One Child");
    expect(selectValue(/sort rows/i)).toBe("A → Z");
    expect(selectValue(/sort columns/i)).toBe("Hierarchy");
  });
});

// ---------------------------------------------------------------------------
// Transpose
// ---------------------------------------------------------------------------

describe("MatrixReport transpose", () => {
  it("keeps both scopes, swapped onto their new axes", async () => {
    saved.config = { rowScopeIds: ["app-1"], colScopeIds: ["bc-2"] };
    renderMatrix();
    await screen.findByText("App One Child");
    expect(chip("1 row")).toBeInTheDocument();

    transpose();
    await waitFor(() =>
      expect(lastPath()).toBe("/reports/matrix?row_type=BusinessCapability&col_type=Application"),
    );
    await screen.findByText("Cap Two");
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({ rowScopeIds: ["bc-2"], colScopeIds: ["app-1"] }),
    );
    expect(chip("1 row")).toBeInTheDocument();
    expect(chip("1 column")).toBeInTheDocument();
    // The column scope (app-1) keeps only App One's branch.
    expect(within(table()).queryByText("App Two")).not.toBeInTheDocument();
  });

  it("swaps the scopes of two axes of one type, and a later type change still clears them", async () => {
    saved.config = {
      rowType: "Application",
      colType: "Application",
      rowScopeIds: ["app-1"],
      colScopeIds: ["app-2"],
      filters: { direction: "forward" },
    };
    mockApi.on("get", /row_type=Application&col_type=Application/, {
      ...HIER,
      columns: APPS,
      intersections: [],
    });
    renderMatrix();
    await screen.findAllByText("App Two");

    transpose();
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({ rowScopeIds: ["app-2"], colScopeIds: ["app-1"] }),
    );
    // The same pair of types: its filters still apply.
    expect(lastPersisted().filters).toMatchObject({ direction: "forward" });

    await pick(/^rows$/i, /^Business Capability$/);
    await waitFor(() => expect(lastPath()).toContain("row_type=BusinessCapability"));
    await waitFor(() =>
      expect(lastPersisted()).toMatchObject({ rowScopeIds: [], colScopeIds: ["app-1"] }),
    );
    // Back to the transposed pair: nothing left over from the swap comes back.
    await pick(/^rows$/i, /^Application$/);
    await waitFor(() =>
      expect(lastPath()).toBe("/reports/matrix?row_type=Application&col_type=Application"),
    );
    await screen.findAllByText("App Two");
    expect(lastPersisted()).toMatchObject({ rowScopeIds: [], colScopeIds: ["app-1"] });
  });

  it("starts the swapped pair unfiltered", async () => {
    saved.config = { filters: { direction: "forward" } };
    renderMatrix();
    await screen.findByText("App One Child");
    expect(lastPath()).toContain("direction=forward");

    transpose();
    await waitFor(() =>
      expect(lastPath()).toBe("/reports/matrix?row_type=BusinessCapability&col_type=Application"),
    );
  });

  it("carries each axis's sort and collapsed depth across", async () => {
    renderMatrix();
    await screen.findByText("App One Child");
    fireEvent.click(screen.getByLabelText("Collapse rows"));
    await waitFor(() => expect(depthCounter("Collapse rows")).toBe("0/1"));
    await pick(/sort columns/i, /By count/);

    transpose();
    await waitFor(() =>
      expect(lastPath()).toBe("/reports/matrix?row_type=BusinessCapability&col_type=Application"),
    );
    await screen.findByText("Cap Two");
    expect(selectValue(/sort rows/i)).toBe("By count");
    expect(selectValue(/sort columns/i)).toBe("Hierarchy");
    // The rows' collapsed depth now belongs to the columns.
    expect(depthCounter("Collapse columns")).toBe("0/1");
    expect(lastPersisted()).toMatchObject({ sortRows: "count", sortCols: "hierarchy", colExpandedDepth: 0 });
  });
});

// ---------------------------------------------------------------------------
// Header measurement
// ---------------------------------------------------------------------------

describe("MatrixReport header resize observer", () => {
  it("observes the header once the grid has rendered, and the new one after a reload", async () => {
    renderMatrix();
    await screen.findByText("App One Child");
    const first = table().querySelector("thead")!;
    expect(restoreRO.observed).toContain(first);

    await pick(/^rows$/i, /^Business Capability$/);
    await screen.findByText("Cap One Child");
    const second = table().querySelector("thead")!;
    expect(second).not.toBe(first);
    expect(restoreRO.observed).toContain(second);
  });

  it("re-measures the header rows when the observer reports a resize", async () => {
    restoreRO();
    const callbacks: ResizeObserverCallback[] = [];
    const prev = (globalThis as Record<string, unknown>).ResizeObserver;
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        callbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    let height = 20;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const h = this.tagName === "TR" ? height : 0;
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: h, width: 0, height: h, toJSON: () => ({}) } as DOMRect;
    });
    try {
      renderMatrix();
      await screen.findByText("Cap One Child");
      const child = () => within(table()).getByText("Cap One Child").closest("th") as HTMLElement;
      await waitFor(() => expect(child().style.top).toBe("20px"));
      expect(callbacks.length).toBeGreaterThan(0);

      // No re-render of its own: only the observer's report can move the row.
      height = 33;
      act(() => callbacks[callbacks.length - 1]([], {} as ResizeObserver));
      await waitFor(() => expect(child().style.top).toBe("33px"));
    } finally {
      (globalThis as Record<string, unknown>).ResizeObserver = prev;
      restoreRO = installResizeObserver();
    }
  });
});

// ---------------------------------------------------------------------------
// Failed load
// ---------------------------------------------------------------------------

describe("MatrixReport failed load", () => {
  it("says why instead of spinning forever", async () => {
    mockApi.fail("get", "/reports/matrix*", 500, "boom");
    renderMatrix();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/failed/);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("falls back to a generic message when the error carries none", async () => {
    mockApi.on("get", "/reports/matrix*", () => Promise.reject(new Error("")));
    renderMatrix();
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });
});

describe("MatrixReport aborted load", () => {
  it("stays on the spinner, neither failing nor drawing an empty grid", async () => {
    mockApi.abort("get", "/reports/matrix*");
    renderMatrix();
    await waitFor(() => expect(mockApi.callsOf("get", "/reports/matrix*")).toHaveLength(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Filter summary
// ---------------------------------------------------------------------------

describe("MatrixReport filter summary", () => {
  it("reads a boolean relation-attribute filter as Yes or No", async () => {
    saved.config = { filters: { attrValues: { "relAppToBc.c": ["true", "false"] } } };
    renderMatrix();
    await screen.findByText("App One Child");
    expect(printParams()).toContain("Create: Yes, No");
  });
});
