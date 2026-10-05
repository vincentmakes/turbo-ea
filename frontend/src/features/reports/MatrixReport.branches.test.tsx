/**
 * Branch coverage for the Matrix report beyond MatrixReport.test.tsx: dense
 * glyph overflow, the cell popover, header hover and clicks, hierarchy depth
 * controls, sorting, quick search, gaps-only, the diagonal of a same-type
 * matrix, the two-sheet Excel export, and the shell actions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

const saved = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  saveDialogOpen: false,
  setSaveDialogOpen: (() => {}) as (open: boolean) => void,
  resetAll: (() => {}) as () => void,
  persistConfig: (() => {}) as (cfg: unknown) => void,
  captureAndSave: (() => {}) as () => void,
  exportXlsx: (() => Promise.resolve()) as (d: unknown) => Promise<void>,
}));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: () => ({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: saved.saveDialogOpen,
    setSaveDialogOpen: saved.setSaveDialogOpen,
    loadedConfig: null,
    consumeConfig: () => saved.config,
    resetSavedReport: () => {},
    persistConfig: saved.persistConfig,
    resetAll: saved.resetAll,
    reportType: "matrix",
  }),
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: () => saved.captureAndSave(),
  }),
}));
vi.mock("./reportExport", async () => ({
  ...(await vi.importActual<typeof import("./reportExport")>("./reportExport")),
  exportReportToXlsx: (d: unknown) => saved.exportXlsx(d),
}));
vi.mock("./SaveReportDialog", () => ({
  default: (props: { open: boolean; onClose: () => void }) =>
    props.open ? <button onClick={props.onClose}>close-save</button> : null,
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
import { installResizeObserver } from "@/test/dom";
import { makeCardType, makeField, makeOption, makeRelationType } from "@/test/fixtures/metamodel";
import type { ReportExportData } from "./reportExport";
import MatrixReport from "./MatrixReport";

const TYPES = [
  makeCardType({ key: "Application", label: "Application", has_hierarchy: true }),
  makeCardType({ key: "BusinessCapability", label: "Business Capability", has_hierarchy: true }),
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
const loaded = () => screen.findByText("App One Child");

async function pick(label: RegExp, option: RegExp) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: label }));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(TYPES, [CRUD, REVERSE]);
  restoreRO = installResizeObserver();
  saved.config = null;
  saved.saveDialogOpen = false;
  saved.setSaveDialogOpen = vi.fn();
  saved.resetAll = vi.fn();
  saved.persistConfig = vi.fn();
  saved.captureAndSave = vi.fn();
  saved.exportXlsx = vi.fn(() => Promise.resolve());
  mockApi.on("get", "/reports/matrix*", PAYLOAD);
});

afterEach(() => restoreRO());

describe("MatrixReport cells", () => {
  it("collapses glyphs past four into a +n overflow", async () => {
    saved.config = { cellMode: "codes" };
    renderMatrix();
    await loaded();
    expect(within(table()).getByText("+2")).toBeInTheDocument();
  });

  it("titles a cell with its relations, values and direction", async () => {
    renderMatrix();
    await loaded();
    const both = within(table()).getByTitle(/^App One Child × Cap One Child/);
    expect(both.getAttribute("title")).toContain("2 relations");
    expect(both.getAttribute("title")).toContain("Create, Read, Update, Delete, Execute, Synchronous");
    expect(both.getAttribute("title")).toContain("Both directions");
    expect(within(table()).getByTitle(/^App Two × Cap Two/).getAttribute("title")).toContain(
      "Row is the source",
    );
    expect(within(table()).getByTitle(/^App Two × Cap One Child/).getAttribute("title")).toContain(
      "Row is the target",
    );
  });

  it("opens a popover on a related cell and walks to either card", async () => {
    renderMatrix();
    await loaded();
    fireEvent.click(within(table()).getByTitle(/^App One Child × Cap One Child/));
    const pop = await screen.findByRole("presentation");
    expect(within(pop).getByText("App One Child × Cap One Child")).toBeInTheDocument();
    expect(within(pop).getByText("2 relations")).toBeInTheDocument();
    expect(within(pop).getByText("uses")).toBeInTheDocument();
    expect(within(pop).getByText("enables")).toBeInTheDocument();
    expect(within(pop).getByText("Both directions")).toBeInTheDocument();
    expect(within(pop).getByText("Synchronous")).toBeInTheDocument();

    fireEvent.click(within(pop).getByText("Cap One Child"));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("bc-1a");
    fireEvent.click(screen.getByRole("button", { name: "close-panel" }));

    fireEvent.click(within(table()).getByTitle(/^App Two × Cap One Child/));
    const pop2 = await screen.findByRole("presentation");
    expect(within(pop2).getByText("Row is the target")).toBeInTheDocument();
    fireEvent.click(within(pop2).getByText("App Two"));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("app-2");
  });

  it("closes the popover on Escape and ignores empty cells", async () => {
    renderMatrix();
    await loaded();
    fireEvent.click(within(table()).getByTitle(/^App Two × Cap Two/));
    const pop = await screen.findByRole("presentation");
    expect(within(pop).getByText("Row is the source")).toBeInTheDocument();
    fireEvent.keyDown(pop, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("presentation")).not.toBeInTheDocument());

    const empty = table().querySelector("td:not([title])[style*='cursor: default']") as HTMLElement;
    fireEvent.click(empty);
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
  });

  it("highlights the hovered row and column and opens their cards", async () => {
    renderMatrix();
    await loaded();
    const cell = within(table()).getByTitle(/^App Two × Cap Two/);
    const before = cell.style.backgroundColor;
    fireEvent.mouseEnter(cell);
    await waitFor(() => expect(cell.style.backgroundColor).not.toBe(before));
    fireEvent.mouseLeave(cell);
    await waitFor(() => expect(cell.style.backgroundColor).toBe(before));

    const colHeader = within(table()).getByText("Cap Two").closest("th") as HTMLElement;
    fireEvent.mouseEnter(colHeader);
    fireEvent.mouseLeave(colHeader);
    fireEvent.click(colHeader);
    expect(screen.getByTestId("side-panel")).toHaveTextContent("bc-2");

    const rowHeader = within(table()).getByText("App Two").closest("td") as HTMLElement;
    fireEvent.mouseEnter(rowHeader);
    fireEvent.mouseLeave(rowHeader);
    fireEvent.click(rowHeader);
    expect(screen.getByTestId("side-panel")).toHaveTextContent("app-2");
  });

  it("shades the diagonal of a matrix of one type against itself", async () => {
    saved.config = { rowType: "Application", colType: "Application" };
    mockApi.on("get", "/reports/matrix*", {
      ...PAYLOAD,
      columns: PAYLOAD.rows,
      intersections: [{ row_id: "app-2", col_id: "app-1a", e: [[0, "f", 0]] }],
    });
    renderMatrix();
    // App Two's own column is its diagonal: no relation, so no title.
    const diagonal = () => {
      const row = Array.from(table().querySelectorAll("tbody tr")).find((tr) =>
        tr.textContent?.startsWith("App Two"),
      )!;
      return Array.from(row.querySelectorAll("td")).find(
        (td) => td.style.height === "26px" && !td.title,
      ) as HTMLElement;
    };
    // Shaded like a hovered cell even at rest, and tinted when hovered.
    await waitFor(() => expect(diagonal().style.backgroundColor).toBe("rgba(0, 0, 0, 0.04)"));
    fireEvent.mouseEnter(diagonal());
    await waitFor(() => expect(diagonal().style.backgroundColor).toBe("rgb(232, 234, 246)"));
  });
});

describe("MatrixReport hierarchy and sorting", () => {
  it("collapses and expands both axes level by level", async () => {
    renderMatrix();
    await loaded();
    fireEvent.click(screen.getByLabelText("Collapse rows"));
    await waitFor(() => expect(screen.queryByText("App One Child")).not.toBeInTheDocument());
    // Collapsed groups aggregate: the cell says so in its title.
    expect(within(table()).getByTitle(/^App One × Cap One Child/).getAttribute("title")).toContain(
      "Aggregated across the collapsed group",
    );
    fireEvent.click(screen.getByLabelText("Expand rows"));
    expect(await screen.findByText("App One Child")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Collapse columns"));
    await waitFor(() => expect(screen.queryByText("Cap One Child")).not.toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Expand columns"));
    expect(await screen.findByText("Cap One Child")).toBeInTheDocument();
  });

  it("sorts rows and columns by count and alphabetically", async () => {
    renderMatrix();
    await loaded();
    await pick(/sort rows/i, /By count/);
    const firstRow = () => (table().querySelector("tbody tr td") as HTMLElement).textContent;
    // App Two carries three relations, App One Child two.
    await waitFor(() => expect(firstRow()).toBe("App Two"));
    await pick(/sort rows/i, /A → Z/);
    await waitFor(() => expect(firstRow()).toBe("App One"));

    await pick(/sort columns/i, /By count/);
    const headers = () => Array.from(table().querySelectorAll("thead th")).map((th) => th.textContent);
    await waitFor(() => expect(headers().indexOf("Cap One Child")).toBeLessThan(headers().indexOf("Cap Two")));
    await pick(/sort columns/i, /A → Z/);
    await waitFor(() => expect(headers().indexOf("Cap One")).toBeLessThan(headers().indexOf("Cap Two")));
  });

  it("finds rows and columns by name, keeping ancestors, and clears the search", async () => {
    const user = userEvent.setup();
    renderMatrix();
    await loaded();
    await user.type(screen.getByLabelText("Find row"), "child");
    await waitFor(() => expect(within(table()).queryByText("App Two")).not.toBeInTheDocument());
    expect(within(table()).getByText("App One")).toBeInTheDocument();
    await user.click(within(screen.getByLabelText("Find row").closest(".MuiInputBase-root") as HTMLElement).getByRole("button"));
    expect(await within(table()).findByText("App Two")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Find column"), "two");
    await waitFor(() => expect(within(table()).queryByText("Cap One Child")).not.toBeInTheDocument());
    await user.click(within(screen.getByLabelText("Find column").closest(".MuiInputBase-root") as HTMLElement).getByRole("button"));
    expect(await within(table()).findByText("Cap One Child")).toBeInTheDocument();
  });

  it("shows only the gaps, switching off Hide unrelated", async () => {
    const user = userEvent.setup();
    saved.config = { hideEmpty: true };
    renderMatrix();
    await loaded();
    await user.click(screen.getByRole("checkbox", { name: /Show only gaps/ }));
    // Every column carries a relation, so a gaps-only grid has nothing left to show.
    await waitFor(() => expect(screen.queryByText("App Two")).not.toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: /Hide unrelated cards/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Show only gaps/ })).toBeChecked();
  });
});

describe("MatrixReport saved filters and axes", () => {
  it("keeps only well-formed saved filter values and re-queries for a picked axis type", async () => {
    saved.config = {
      filters: {
        relationTypes: ["relAppToBc", 7],
        attrValues: { "relAppToBc.c": ["true", 3], "relAppToBc.r": "yes", "relAppToBc.u": [] },
        direction: "sideways",
      },
    };
    renderMatrix();
    await loaded();
    const lastPath = () => mockApi.calls[mockApi.calls.length - 1].path;
    await waitFor(() => expect(lastPath()).toContain("relation_types=relAppToBc"));
    const path = lastPath();
    expect(path).toContain("attr=relAppToBc.c%3Atrue");
    expect(path).not.toContain("relAppToBc.r");
    expect(path).not.toContain("direction=");

    await pick(/^rows$/i, /Business Capability/);
    await waitFor(() =>
      expect(mockApi.calls[mockApi.calls.length - 1].path).toContain("row_type=BusinessCapability"),
    );
    await pick(/^columns$/i, /^Application$/);
    await waitFor(() =>
      expect(mockApi.calls[mockApi.calls.length - 1].path).toContain("col_type=Application"),
    );
  });
});

describe("MatrixReport export and shell", () => {
  it("exports the grid and one row per relation with its values spread out", async () => {
    const user = userEvent.setup();
    saved.config = { cellMode: "labels", filters: { relationTypes: ["relAppToBc", "gone"] } };
    // The restored filter changes the request path, so the grid is queried
    // twice; answer only the filtered query, so "loaded" means the final grid.
    mockApi.on("get", "/reports/matrix*", () => new Promise(() => {}));
    mockApi.on("get", /relation_types=/, PAYLOAD);
    renderMatrix();
    await loaded();
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Export to Excel/ }));
    await waitFor(() => expect(saved.exportXlsx).toHaveBeenCalled());

    const data = vi.mocked(saved.exportXlsx).mock.calls[0][0] as ReportExportData;
    expect(data.subtitle).toBe("Application × Business Capability");
    expect(data.filterSummary).toEqual(
      expect.arrayContaining([{ label: "Relation type", value: "uses, gone" }]),
    );
    const [grid, edges] = data.sheets!;
    const childRow = grid.rows.find((r) => r.row === "App One Child")!;
    expect(Object.values(childRow)).toContain("Create, Read, Update, Delete, Execute, Synchronous");
    expect(childRow.total).toBe(2);

    // Two relation types in play: dimension columns are prefixed with the verb.
    expect(edges.columns.map((c) => c.label)).toContain("uses · Create");
    const forward = edges.rows.find((r) => r.rowCard === "App One Child" && r.relationType === "uses")!;
    expect(forward).toMatchObject({
      colCard: "Cap One Child",
      direction: "Row is the source",
      "relAppToBc.c": "Yes",
      "relAppToBc.mode": "Synchronous",
      "relAppToBc.note": "hello",
    });
    const reverse = edges.rows.find((r) => r.relationType === "is enabled by" && r.rowCard === "App One Child")!;
    expect(reverse.direction).toBe("Row is the target");
    const flagged = edges.rows.find((r) => r.rowCard === "App Two" && r.colCard === "Cap Two")!;
    expect(flagged["relAppToBc.c"]).toBe("No");
    // An option key the field does not define exports raw; an empty value not at all.
    expect(flagged["relAppToBc.mode"]).toBe("weird");
    expect(flagged).not.toHaveProperty("relAppToBc.note");
  });

  it("writes counts, codes and dots into the grid sheet by cell mode", async () => {
    const user = userEvent.setup();
    const exportIn = async (mode: string) => {
      saved.config = { cellMode: mode };
      const view = renderMatrix();
      await loaded();
      await user.click(screen.getByRole("button", { name: /more actions/i }));
      await user.click(await screen.findByRole("menuitem", { name: /Export to Excel/ }));
      await waitFor(() => expect(saved.exportXlsx).toHaveBeenCalled());
      const data = vi.mocked(saved.exportXlsx).mock.calls[0][0] as ReportExportData;
      vi.mocked(saved.exportXlsx).mockClear();
      view.unmount();
      return Object.values(data.sheets![0].rows.find((r) => r.row === "App One Child")!);
    };
    expect(await exportIn("count")).toContain(2);
    expect(await exportIn("codes")).toContain("C R U D E S");
    expect(await exportIn("exists")).toContain("●");
  });

  it("resets every control to its default", async () => {
    saved.config = { cellMode: "count", hideEmpty: true, sortRows: "alpha", filters: { direction: "reverse" } };
    renderMatrix();
    await waitFor(() =>
      expect(mockApi.calls[mockApi.calls.length - 1].path).toContain("direction=reverse"),
    );
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(saved.resetAll).toHaveBeenCalled();
    await waitFor(() =>
      expect(mockApi.calls[mockApi.calls.length - 1].path).not.toContain("direction=reverse"),
    );
  });

  it("saves through the thumbnail capture and closes the dialog", async () => {
    saved.saveDialogOpen = true;
    renderMatrix();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /save report/i }));
    expect(saved.captureAndSave).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "close-save" }));
    expect(saved.setSaveDialogOpen).toHaveBeenCalledWith(false);
  });
});
