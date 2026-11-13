/**
 * PpmRiskGrid — the initiative's risks on AG Grid, with its sidebar and
 * toolbar. The grid is the shared stub, so what is asserted is what the
 * component hands it: the columns, what each cell renders (full text, never
 * cut), the rows the sidebar keeps, grouping, the default sort, the
 * preferences, and what the toolbar and row buttons do. What only the real
 * grid can show (a freeze surviving a reload, the action header without
 * pins) is in `PpmRiskGrid.persistence.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

vi.mock("ag-grid-react", () => import("@/test/agGridStub").then((m) => m.agGridReactModule()));
vi.mock("@/hooks/useThemeMode", () => import("@/test/hooks").then((m) => m.useThemeModeModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));
const exportPpmRisks = vi.hoisted(() => vi.fn());
vi.mock("./ppmRiskSpreadsheet", () => ({ exportPpmRisks }));

import { createTheme } from "@mui/material/styles";
import i18n from "@/i18n";
import { gridStub } from "@/test/agGridStub";
import { hookState } from "@/test/hooks";
import { setViewportWidth } from "@/test/matchMedia";
import { gridThemeDark, gridThemeLight } from "@/lib/agGridSetup";
import { RAG_COLORS } from "@/theme/tokens";
import type { PpmRisk } from "@/types";
import PpmRiskGrid from "./PpmRiskGrid";
import { RISK_GRID_PREFS_KEY } from "./ppmRiskModel";

function risk(over: Partial<PpmRisk> & { id: string; title: string }): PpmRisk {
  return {
    initiative_id: "i1",
    description: null,
    probability: 3,
    impact: 3,
    risk_score: 9,
    mitigation: null,
    owner_id: null,
    owner_name: null,
    status: "open",
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    ...over,
  };
}

const LONG = `${"Supplier exposure ".repeat(17)}tail`.slice(0, 299) + "!";
const MULTI = "Dual-source the platform.\nReview quarterly.\nEscalate to the board.";

const VENDOR = risk({
  id: "r1",
  title: "Vendor lock-in",
  description: "Runbook at https://wiki.example.com/lockin",
  probability: 5,
  impact: 4,
  risk_score: 20,
  mitigation: MULTI,
  owner_id: "u1",
  owner_name: "Ada Lovelace",
  status: "open",
});
const BUDGET = risk({
  id: "r2",
  title: "Budget overrun",
  description: LONG,
  risk_score: 9,
  status: "mitigating",
  owner_id: "u2",
  owner_name: "Grace Hopper",
});
const LATE = risk({ id: "r3", title: "Late delivery", probability: 1, impact: 2, risk_score: 5, status: "accepted" });
const RISKS = [VENDOR, BUDGET, LATE];

const COLUMNS = [
  "risk",
  "probability",
  "impact",
  "risk_score",
  "status",
  "owner_name",
  "mitigation",
  "actions",
];

function renderGrid(risks: PpmRisk[] = RISKS) {
  const props = {
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onImport: vi.fn(),
  };
  const user = userEvent.setup();
  const result = render(<PpmRiskGrid risks={risks} initiativeName="ERP move" {...props} />);
  return { ...result, ...props, user };
}

/** Render one column's cell for one row, as AG Grid would. */
function cell(colId: string, data: PpmRisk) {
  const def = gridStub.colDef(colId);
  const value = gridStub.cellValue(colId, data);
  return render(def.cellRenderer({ data, value }) as ReactElement);
}

/** Right-click one cell, as AG Grid reports it, and wait for the menu if one opens. */
async function rightClick(colId: string, data: PpmRisk) {
  const props = gridStub.lastProps();
  const def = { ...props.defaultColDef, ...gridStub.colDef(colId) };
  const column = { getColId: () => colId, getColDef: () => def };
  await act(async () => {
    props.onCellContextMenu({ column, node: { data }, event: { clientX: 10, clientY: 10 } });
  });
}

/**
 * jsdom reports a zero rect for everything, so dnd-kit's keyboard drag never
 * finds a neighbour. Hand each element a distinct, stacked rect (the trick
 * `ColumnOrderSection.test.tsx` uses).
 */
function stubLayout() {
  let next = 0;
  const rects = new WeakMap<Element, number>();
  return vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      if (!rects.has(this)) rects.set(this, (next += 40));
      const top = rects.get(this)!;
      return {
        top,
        left: 0,
        bottom: top + 36,
        right: 200,
        width: 200,
        height: 36,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    });
}

const rowIds = () => (gridStub.rows() as PpmRisk[]).map((r) => r.id);
const stored = () => JSON.parse(localStorage.getItem(RISK_GRID_PREFS_KEY) ?? "null");
const sidebar = () => within(screen.getByTestId("risk-filter-sidebar"));

beforeEach(() => {
  localStorage.clear();
  gridStub.reset();
  exportPpmRisks.mockReset();
  hookState.isRtl = false;
  hookState.themeMode = "light";
  setViewportWidth(1280);
});

describe("columns", () => {
  it("shows every column with its header, in order", () => {
    renderGrid();
    expect(gridStub.colDefs().map((d) => d.colId)).toEqual(COLUMNS);
    expect(gridStub.colDefs().map((d) => d.headerName)).toEqual([
      "Risk",
      "Probability",
      "Impact",
      "Risk Score",
      "Status",
      "Owner",
      "Mitigation",
      "",
    ]);
    expect(gridStub.colDefs().map((d) => d.field ?? null)).toEqual([
      null,
      "probability",
      "impact",
      "risk_score",
      "status",
      "owner_name",
      "mitigation",
      null,
    ]);
    // Probability and impact are real columns, hidden until asked for.
    expect(gridStub.colDefs().filter((d) => d.hide).map((d) => d.colId)).toEqual([
      "probability",
      "impact",
    ]);
  });

  it("shows probability and impact when a stored choice asks for them", () => {
    localStorage.setItem(
      RISK_GRID_PREFS_KEY,
      JSON.stringify({ visibleColumns: ["probability", "risk_score", "status"] }),
    );
    renderGrid();
    expect(gridStub.colDefs().filter((d) => !d.hide).map((d) => d.colId)).toEqual([
      "risk",
      "probability",
      "risk_score",
      "status",
      "actions",
    ]);
  });

  it("lets the two long-text columns take the flexible width, Risk the larger share", () => {
    renderGrid();
    expect(gridStub.colDef("risk")).toMatchObject({
      flex: 3,
      minWidth: 200,
      wrapText: true,
      autoHeight: true,
    });
    expect(gridStub.colDef("mitigation")).toMatchObject({
      flex: 2,
      minWidth: 160,
      wrapText: true,
      autoHeight: true,
    });
    expect(
      ["probability", "impact", "risk_score", "status", "owner_name", "actions"].map(
        (id) => [gridStub.colDef(id).width, gridStub.colDef(id).flex],
      ),
    ).toEqual([
      [130, undefined],
      [105, undefined],
      [135, undefined],
      [120, undefined],
      [120, undefined],
      [84, undefined],
    ]);
    expect(gridStub.colDef("owner_name")).toMatchObject({ wrapText: true, autoHeight: true });
    for (const id of ["probability", "impact", "risk_score"]) {
      expect(gridStub.colDef(id).filter).toBe("agNumberColumnFilter");
    }
  });

  it("keeps the action column out of sort, filter, move, resize and freeze, with no pins", () => {
    renderGrid();
    const d = gridStub.colDef("actions");
    expect(d).toMatchObject({
      sortable: false,
      filter: false,
      resizable: false,
      suppressMovable: true,
      lockPinned: true,
    });
    expect(d.headerComponentParams.template).not.toContain("push_pin");
    expect(d.headerComponentParams.template).toContain('data-ref="eText"');
  });

  it("sorts, filters and resizes every other column, wraps headers and offers freeze pins", () => {
    renderGrid();
    const d = gridStub.lastProps().defaultColDef;
    expect([
      d.sortable,
      d.resizable,
      d.filter,
      d.filterParams,
      d.cellDataType,
      d.wrapHeaderText,
      d.autoHeaderHeight,
    ]).toEqual([true, true, true, { buttons: ["reset"] }, false, true, true]);
    expect(d.headerComponentParams.template).toContain("push_pin");
  });
});

describe("cells", () => {
  it("shows the title in bold and the full description beneath it", () => {
    expect(LONG).toHaveLength(300);
    renderGrid();
    const { container } = cell("risk", BUDGET);
    const [title, description] = container.querySelectorAll("p");
    expect(title.textContent).toBe("Budget overrun");
    expect(title).toHaveStyle({ fontWeight: 600, whiteSpace: "pre-wrap" });
    expect(description.textContent).toBe(LONG);
    expect(description).toHaveStyle({ whiteSpace: "pre-wrap" });
    expect(description).not.toHaveStyle({ fontWeight: 600 });
  });

  it("sorts and filters the Risk column on the title, then the description", () => {
    renderGrid();
    expect(gridStub.cellValue("risk", BUDGET)).toBe(`Budget overrun\n${LONG}`);
    expect(gridStub.cellValue("risk", LATE)).toBe("Late delivery");
  });

  it("shows a title alone when there is no description", () => {
    renderGrid();
    const { container } = cell("risk", LATE);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.textContent).toBe("Late delivery");
  });

  it("shows a multi-line mitigation in full, keeping its line breaks", () => {
    renderGrid();
    const { container } = cell("mitigation", VENDOR);
    expect(container.textContent).toBe(MULTI);
    expect(container.querySelector("p")).toHaveStyle({ whiteSpace: "pre-wrap" });
  });

  it("turns web addresses in the description and the mitigation into new-tab links", () => {
    renderGrid();
    cell("risk", VENDOR);
    const link = screen.getByRole("link", { name: "https://wiki.example.com/lockin" });
    expect(link).toHaveAttribute("href", "https://wiki.example.com/lockin");
    expect(link).toHaveAttribute("target", "_blank");
    cell("mitigation", risk({ id: "x", title: "X", mitigation: "See https://example.com/plan" }));
    expect(screen.getByRole("link", { name: "https://example.com/plan" })).toBeInTheDocument();
  });

  it("colours the score chip by band", () => {
    renderGrid();
    const chip = (r: PpmRisk) =>
      cell("risk_score", r).container.querySelector(".MuiChip-root") as HTMLElement;
    const high = chip(VENDOR);
    expect(high).toHaveTextContent("20");
    expect(high).toHaveStyle({ backgroundColor: RAG_COLORS.red });
    expect(chip(BUDGET)).toHaveStyle({ backgroundColor: RAG_COLORS.amber });
    expect(chip(LATE)).toHaveStyle({ backgroundColor: RAG_COLORS.green });
    expect(chip(risk({ id: "s", title: "S", risk_score: 15 }))).toHaveStyle({
      backgroundColor: RAG_COLORS.red,
    });
    expect(chip(risk({ id: "m", title: "M", risk_score: 6 }))).toHaveStyle({
      backgroundColor: RAG_COLORS.amber,
    });
  });

  it("shows the score's factors beside its chip, and sorts and filters on the score", () => {
    renderGrid();
    const { container } = cell("risk_score", VENDOR);
    expect(container.querySelector(".MuiChip-root")).toHaveTextContent("20");
    expect(container.querySelector(".MuiTypography-caption")).toHaveTextContent(/^5 \u00d7 4$/);
    expect(cell("risk_score", LATE).container.textContent).toBe("51 \u00d7 2");
    // Inline in the cell's line box, like the Status chip, so both sit at the
    // same height; a block or flex wrapper would start at the cell's top edge.
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.tagName).toBe("SPAN");
    expect(wrapper).toHaveStyle({ whiteSpace: "nowrap" });
    expect(wrapper).not.toHaveStyle({ display: "flex" });
    expect(container.querySelector(".MuiTypography-caption")!.tagName).toBe("SPAN");
    expect(gridStub.cellValue("risk_score", VENDOR)).toBe(20);
    expect(gridStub.colDef("risk_score").field).toBe("risk_score");
    expect(gridStub.colDef("risk_score").filter).toBe("agNumberColumnFilter");
  });

  it("labels the status, and sorts and filters on that label", () => {
    renderGrid();
    expect(RISKS.map((r) => gridStub.cellValue("status", r))).toEqual([
      "Open",
      "Mitigating",
      "Accepted",
    ]);
    const chip = cell("status", BUDGET).container.querySelector(".MuiChip-root") as HTMLElement;
    expect(chip).toHaveTextContent("Mitigating");
    expect(chip).toHaveClass("MuiChip-outlined", "MuiChip-colorWarning");
    const open = cell("status", VENDOR).container.querySelector(".MuiChip-root") as HTMLElement;
    expect(open).toHaveClass("MuiChip-colorError");
  });

  it("shows a dash for a missing owner or mitigation", () => {
    renderGrid();
    expect(gridStub.cellValue("owner_name", LATE)).toBe("");
    expect(gridStub.cellValue("owner_name", LATE, { formatted: true })).toBe("—");
    expect(gridStub.cellValue("owner_name", VENDOR, { formatted: true })).toBe("Ada Lovelace");
    expect(cell("mitigation", LATE).container.textContent).toBe("—");
    expect(gridStub.cellValue("mitigation", LATE)).toBe("");
  });

  it("renders nothing for a row without data", () => {
    renderGrid();
    for (const id of ["risk", "risk_score", "status", "actions"]) {
      expect(render(gridStub.colDef(id).cellRenderer({}) ?? <></>).container).toBeEmptyDOMElement();
    }
    expect(gridStub.colDef("status").valueGetter({})).toBe("");
    expect(gridStub.colDef("owner_name").valueGetter({})).toBe("");
    expect(gridStub.colDef("mitigation").valueGetter({})).toBe("");
    expect(render(gridStub.colDef("mitigation").cellRenderer({})).container.textContent).toBe("—");
    expect(gridStub.colDef("risk").valueGetter({})).toBe("");
  });
});

describe("row buttons", () => {
  it("edits and deletes the row's risk", async () => {
    const { onEdit, onDelete, user } = renderGrid();
    cell("actions", LATE);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(LATE);
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("r3");
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("calls the latest callbacks a parent passes", async () => {
    const { rerender, user } = renderGrid();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    rerender(
      <PpmRiskGrid risks={RISKS} onAdd={vi.fn()} onEdit={onEdit} onDelete={onDelete} onImport={vi.fn()} />,
    );
    cell("actions", VENDOR);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onEdit).toHaveBeenCalledWith(VENDOR);
    expect(onDelete).toHaveBeenCalledWith("r1");
  });
});

describe("grid", () => {
  it("hands over the rows by id, grows with them and says when there are none", () => {
    renderGrid();
    const p = gridStub.lastProps();
    expect(rowIds()).toEqual(["r1", "r2", "r3"]);
    expect(p.getRowId({ data: BUDGET })).toBe("r2");
    expect(p.domLayout).toBe("autoHeight");
    expect(p.overlayNoRowsTemplate).toBe("<span>No risks yet</span>");
    expect(p.theme).toBe(gridThemeLight);
    expect(p.enableRtl).toBe(false);
  });

  it("follows the dark theme and right-to-left layout", () => {
    hookState.themeMode = "dark";
    hookState.isRtl = true;
    renderGrid();
    expect(gridStub.lastProps().theme).toBe(gridThemeDark);
    expect(gridStub.lastProps().enableRtl).toBe(true);
  });

  it("sorts by score, highest first, until the user picks a sort, without resetting other columns", () => {
    renderGrid();
    expect(gridStub.lastProps().initialState).toEqual({
      sort: { sortModel: [{ colId: "risk_score", sort: "desc" }] },
      partialColumnState: true,
    });
  });

  it("freezes nothing by default and no column is hard-pinned", () => {
    renderGrid();
    for (const d of gridStub.colDefs()) expect(d.pinned).toBeFalsy();
  });

  it("restores saved columns, freeze, order and sort", () => {
    localStorage.setItem(
      RISK_GRID_PREFS_KEY,
      JSON.stringify({
        visibleColumns: ["risk", "status", "mitigation"],
        frozenColumns: ["status"],
        columnOrder: ["mitigation", "risk", "status"],
        sortModel: [{ colId: "status", sort: "asc" }],
      }),
    );
    renderGrid();
    expect(gridStub.colDef("status").pinned).toBe("left");
    expect(gridStub.colDef("risk").pinned).toBeFalsy();
    expect(gridStub.colDefs().slice(-1)[0].colId).toBe("actions");
    expect(gridStub.colDefs().filter((d) => !d.hide).map((d) => d.colId)).toEqual([
      "mitigation",
      "risk",
      "status",
      "actions",
    ]);
    expect(gridStub.lastProps().initialState.sort).toEqual({
      sortModel: [{ colId: "status", sort: "asc" }],
    });
  });

  it("saves the sort the user picks, keeping the other prefs", () => {
    localStorage.setItem(RISK_GRID_PREFS_KEY, JSON.stringify({ frozenColumns: ["risk"] }));
    renderGrid();
    gridStub.api().applyColumnState({
      state: [
        { colId: "risk", sort: null },
        { colId: "impact", sort: "asc" },
        { colId: "owner_name", sort: "desc" },
      ],
    });
    act(() => {
      gridStub.fire("sortChanged");
    });
    expect(stored()).toMatchObject({
      frozenColumns: ["risk"],
      columnOrder: COLUMNS.slice(0, 7),
      sortModel: [
        { colId: "impact", sort: "asc" },
        { colId: "owner_name", sort: "desc" },
      ],
    });
  });

  it("saves a header drag's new order and freeze", () => {
    renderGrid();
    const api = gridStub.api();
    const cols = api.getAllGridColumns();
    api.getAllGridColumns = () => [cols[1], cols[0], ...cols.slice(2)];
    api.getColumnState = () =>
      COLUMNS.map((colId) => ({ colId, pinned: colId === "probability" ? "left" : null }));
    act(() => {
      gridStub.fire("dragStopped");
    });
    expect(stored().columnOrder.slice(0, 2)).toEqual(["probability", "risk"]);
    expect(stored().frozenColumns).toEqual(["probability"]);
    expect(gridStub.colDef("probability").pinned).toBe("left");
  });

  it("positions the sticky group bar against the grid's wrapper", () => {
    renderGrid();
    const wrapper = screen.getByTestId("ag-grid").parentElement as HTMLElement;
    // `position: relative` is the grouping hook's; the wrapper must carry it.
    expect(wrapper).toHaveStyle({ position: "relative", width: "100%" });
  });

  it("ignores a sort event once the grid is gone", () => {
    renderGrid();
    const before = localStorage.getItem(RISK_GRID_PREFS_KEY);
    gridStub.lastProps().ref.current = null;
    expect(() => gridStub.lastProps().onSortChanged()).not.toThrow();
    expect(localStorage.getItem(RISK_GRID_PREFS_KEY)).toBe(before);
  });

  it("relabels the columns and the freeze pins when the language changes", async () => {
    renderGrid();
    const de = (key: string, ns: string) => i18n.getFixedT("de", ns)(key);
    expect(de("probability", "ppm")).not.toBe("Probability");
    expect(de("grid.freezeColumn", "common")).not.toBe("Freeze column");
    try {
      await act(async () => {
        await i18n.changeLanguage("de");
      });
      expect(gridStub.colDef("probability").headerName).toBe(de("probability", "ppm"));
      expect(gridStub.lastProps().defaultColDef.headerComponentParams.template).toContain(
        de("grid.freezeColumn", "common"),
      );
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("draws group headers without a select-all box: the risk grid selects nothing", () => {
    localStorage.setItem(RISK_GRID_PREFS_KEY, JSON.stringify({ groupBy: "status" }));
    renderGrid();
    const p = gridStub.lastProps();
    const header = (gridStub.rows() as (PpmRisk & { __group?: unknown })[]).find((r) => r.__group);
    const Renderer = p.fullWidthCellRenderer;
    const { container } = render(<Renderer data={header} api={gridStub.api()} context={p.context} />);
    expect(container).toHaveTextContent("Open");
    expect(within(container).queryByRole("checkbox")).toBeNull();
  });

  it("wires the cell menu and grouping into the grid", () => {
    renderGrid();
    const p = gridStub.lastProps();
    expect(typeof p.onCellContextMenu).toBe("function");
    expect(p.preventDefaultOnContextMenu).toBe(true);
    expect(typeof p.postSortRows).toBe("function");
    expect(typeof p.isFullWidthRow).toBe("function");
    expect(typeof p.onModelUpdated).toBe("function");
    expect(typeof p.onFilterChanged).toBe("function");
  });
});

describe("cell menu", () => {
  it("mirrors Show matching on a status into the sidebar, and clears it from there too", async () => {
    const { user } = renderGrid();
    await rightClick("status", BUDGET);
    await user.click(within(await screen.findByRole("menu")).getByText("Show matching"));
    expect(rowIds()).toEqual(["r2"]);
    expect(sidebar().getByRole("button", { name: "Mitigating" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await rightClick("status", BUDGET);
    await user.click(within(await screen.findByRole("menu")).getByText("Clear column filter"));
    expect(rowIds()).toEqual(["r1", "r2", "r3"]);
    expect(sidebar().getByRole("button", { name: "Mitigating" })).toHaveAttribute("aria-pressed", "false");
  });

  it("mirrors Show matching on an owner into the sidebar's owner list", async () => {
    const { user } = renderGrid();
    await rightClick("owner_name", VENDOR);
    await user.click(within(await screen.findByRole("menu")).getByText("Show matching"));
    expect(rowIds()).toEqual(["r1"]);
    expect(sidebar().getByRole("checkbox", { name: "Ada Lovelace" })).toBeChecked();
    expect(sidebar().getByRole("checkbox", { name: "Grace Hopper" })).not.toBeChecked();
  });

  it("opens on a data cell but never on the action buttons", async () => {
    renderGrid();
    await rightClick("actions", VENDOR);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await rightClick("risk", VENDOR);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });
});

describe("sidebar", () => {
  it("narrows the rows by search over title, description, mitigation and owner", async () => {
    const { user } = renderGrid();
    const search = sidebar().getByRole("textbox", { name: "Search" });
    await user.type(search, "wiki.example");
    expect(rowIds()).toEqual(["r1"]);
    await user.clear(search);
    await user.type(search, "hopper");
    expect(rowIds()).toEqual(["r2"]);
    await user.clear(search);
    await user.type(search, "QUARTERLY");
    expect(rowIds()).toEqual(["r1"]);
    expect(screen.getByText("1 risk")).toBeInTheDocument();
    await user.click(sidebar().getByRole("button", { name: "Clear search" }));
    expect(rowIds()).toEqual(["r1", "r2", "r3"]);
    expect(screen.getByText("3 risks")).toBeInTheDocument();
  });

  it("narrows by status, score band and owner", async () => {
    const { user } = renderGrid();
    await user.click(sidebar().getByRole("button", { name: "Mitigating" }));
    expect(rowIds()).toEqual(["r2"]);
    await user.click(sidebar().getByRole("button", { name: "Mitigating" }));
    await user.click(sidebar().getByRole("button", { name: "Low" }));
    expect(rowIds()).toEqual(["r3"]);
    await user.click(sidebar().getByRole("button", { name: "Low" }));
    await user.click(sidebar().getByRole("checkbox", { name: "No owner" }));
    expect(rowIds()).toEqual(["r3"]);
    await user.click(sidebar().getByRole("checkbox", { name: "Ada Lovelace" }));
    expect(rowIds()).toEqual(["r1", "r3"]);
    // The summary the tab shows is not the grid's business: the count chip is.
    expect(screen.getByText("2 risks")).toBeInTheDocument();
  });

  it("lists the owners present in the risks", () => {
    renderGrid();
    const owners = sidebar()
      .getAllByRole("checkbox")
      .map((c) => c.getAttribute("aria-label"));
    expect(owners).toEqual(["Ada Lovelace", "Grace Hopper", "No owner"]);
  });

  it("lists an owner who arrives with new risks, and groups by them", async () => {
    const { rerender, user } = renderGrid();
    const turing = risk({ id: "r9", title: "Key person", owner_id: "u9", owner_name: "Alan Turing" });
    rerender(
      <PpmRiskGrid risks={[...RISKS, turing]} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onImport={vi.fn()} />,
    );
    expect(sidebar().getByRole("checkbox", { name: "Alan Turing" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Group by/ }));
    await user.click(screen.getByRole("menuitem", { name: "Owner" }));
    const labels = (gridStub.rows() as (PpmRisk & { __group?: { label: string } })[])
      .filter((r) => r.__group)
      .map((r) => r.__group!.label);
    expect(labels).toContain("Alan Turing");
  });

  it("saves the width the sidebar is dragged to", () => {
    renderGrid();
    fireEvent.mouseDown(screen.getByTestId("resize-handle"), { clientX: 500 });
    fireEvent.mouseMove(document, { clientX: 540 });
    fireEvent.mouseUp(document);
    expect(stored().sidebarWidth).toBe(300);
    expect(screen.getByTestId("risk-filter-sidebar").firstElementChild).toHaveStyle({ width: "300px" });
  });

  it("collapses to the rail and remembers it", async () => {
    const { user } = renderGrid();
    await user.click(screen.getByRole("button", { name: "Hide filters" }));
    expect(screen.getByTestId("risk-filter-rail")).toBeInTheDocument();
    expect(stored().filtersCollapsed).toBe(true);
    await user.click(screen.getByRole("button", { name: "Show filters" }));
    expect(screen.getByTestId("risk-filter-sidebar")).toBeInTheDocument();
    expect(stored().filtersCollapsed).toBe(false);
  });

  it("opens collapsed and at the saved width", () => {
    localStorage.setItem(RISK_GRID_PREFS_KEY, JSON.stringify({ filtersCollapsed: true }));
    renderGrid();
    expect(screen.getByTestId("risk-filter-rail")).toBeInTheDocument();
    expect(screen.queryByTestId("risk-filter-sidebar")).not.toBeInTheDocument();
  });

  it("hides and shows columns from the Columns tab, and saves the set", async () => {
    const { user } = renderGrid();
    await user.click(sidebar().getByRole("tab", { name: "Columns" }));
    await user.click(sidebar().getByRole("checkbox", { name: "Impact" }));
    expect(gridStub.colDef("impact").hide).toBe(false);
    expect(gridStub.colDef("probability").hide).toBe(true);
    expect(stored().visibleColumns).toEqual([
      "risk",
      "impact",
      "risk_score",
      "status",
      "owner_name",
      "mitigation",
      "actions",
    ]);
    await user.click(sidebar().getByRole("checkbox", { name: "Owner" }));
    expect(gridStub.colDef("owner_name").hide).toBe(true);
    // Reset brings back the default set.
    await user.click(sidebar().getByRole("button", { name: /Reset/ }));
    expect(stored().visibleColumns).toEqual([
      "risk",
      "risk_score",
      "status",
      "owner_name",
      "mitigation",
      "actions",
    ]);
    expect(gridStub.colDef("impact").hide).toBe(true);
    expect(gridStub.colDef("owner_name").hide).toBe(false);
  });

  it("freezes a column from the Columns tab", async () => {
    const { user } = renderGrid();
    await user.click(sidebar().getByRole("tab", { name: "Columns" }));
    // The stub grid does not pin; make it, so the hook reads the freeze back.
    const api = gridStub.api();
    api.setColumnsPinned = (ids: string[], pin: string | null) => {
      for (const id of ids) api.getColumn(id).def.pinned = pin;
    };
    const row = screen.getByTestId("risk-filter-sidebar").querySelector('[data-column-row="status"]') as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Freeze column" }));
    expect(stored().frozenColumns).toEqual(["status"]);
    expect(gridStub.colDef("status").pinned).toBe("left");
  });

  it("feeds the column-order list from the visible, orderable columns", async () => {
    localStorage.setItem(
      RISK_GRID_PREFS_KEY,
      JSON.stringify({ visibleColumns: ["risk", "status", "mitigation"] }),
    );
    const { user } = renderGrid();
    await user.click(sidebar().getByRole("tab", { name: "Columns" }));
    await user.click(sidebar().getByText("Column order"));
    // Visible, orderable columns only: no hidden ones, no action column.
    expect(
      (await sidebar().findAllByRole("button", { name: /^Reorder / })).map((b) =>
        b.getAttribute("aria-label"),
      ),
    ).toEqual(["Reorder Risk", "Reorder Status", "Reorder Mitigation"]);
    // Hiding a column takes it off the list at once.
    await user.click(sidebar().getByRole("checkbox", { name: "Status" }));
    expect(
      sidebar()
        .getAllByRole("button", { name: /^Reorder / })
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Reorder Risk", "Reorder Mitigation"]);
  });

  it("saves the order a keyboard drag in the Columns tab gives", async () => {
    const layout = stubLayout();
    try {
      const { user } = renderGrid();
      await user.click(sidebar().getByRole("tab", { name: "Columns" }));
      await user.click(sidebar().getByText("Column order"));
      const handle = await sidebar().findByRole("button", { name: "Reorder Risk" });
      handle.focus();
      await user.keyboard("{ }");
      await user.keyboard("{ArrowDown}");
      await user.keyboard("{ }");
      await waitFor(() => expect(stored()?.columnOrder?.indexOf("risk")).toBeGreaterThan(stored().columnOrder.indexOf("risk_score")));
      const visible = gridStub.colDefs().filter((d) => !d.hide).map((d) => d.colId);
      expect(visible.slice(0, 2)).toEqual(["risk_score", "risk"]);
    } finally {
      layout.mockRestore();
    }
  });
});

describe("toolbar", () => {
  it("adds and imports", async () => {
    const { onAdd, onImport, user } = renderGrid();
    await user.click(screen.getByRole("button", { name: /Add Risk/ }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onImport).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Import/ }));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it("exports the rows the grid shows, in its order, named after the initiative", async () => {
    const { user } = renderGrid();
    await user.click(sidebar().getByRole("button", { name: "Open" }));
    await user.click(sidebar().getByRole("button", { name: "Accepted" }));
    // The grid's own sort puts Late delivery first.
    gridStub.api().forEachNodeAfterFilterAndSort = (fn: (n: { data: PpmRisk }) => void) =>
      [LATE, VENDOR].forEach((data) => fn({ data }));
    await user.click(screen.getByRole("button", { name: /Export/ }));
    expect(exportPpmRisks).toHaveBeenCalledWith([LATE, VENDOR], "ERP move");
  });

  it("exports the members of a collapsed group in its place", async () => {
    const { user } = renderGrid();
    const header = { ...BUDGET, __group: { collapsed: true, memberIds: ["r2", "gone"] } };
    const open = { ...VENDOR, __group: { collapsed: false, memberIds: ["r1"] } };
    gridStub.api().forEachNodeAfterFilterAndSort = (fn: (n: { data?: unknown }) => void) =>
      [{ data: open }, { data: VENDOR }, { data: header }, {}, { data: LATE }].forEach(fn);
    await user.click(screen.getByRole("button", { name: /Export/ }));
    expect(exportPpmRisks).toHaveBeenCalledWith([VENDOR, BUDGET, LATE], "ERP move");
  });

  it("exports the sidebar's rows when the grid cannot be asked", async () => {
    const { user } = renderGrid();
    await user.click(sidebar().getByRole("button", { name: "Open" }));
    gridStub.lastProps().ref.current = null;
    fireEvent.click(screen.getByRole("button", { name: /Export/ }));
    expect(exportPpmRisks).toHaveBeenCalledWith([VENDOR], "ERP move");
  });

  it("cannot export an empty view, and names the file without an initiative", async () => {
    const { user, rerender } = renderGrid([]);
    expect(screen.getByRole("button", { name: /Export/ })).toBeDisabled();
    rerender(
      <PpmRiskGrid risks={[LATE]} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onImport={vi.fn()} />,
    );
    gridStub.api().forEachNodeAfterFilterAndSort = (fn: (n: { data: PpmRisk }) => void) =>
      fn({ data: LATE });
    await user.click(screen.getByRole("button", { name: /Export/ }));
    expect(exportPpmRisks).toHaveBeenCalledWith([LATE], "");
  });

  it("groups by status, owner or score band, and remembers it", async () => {
    const { user } = renderGrid();
    await user.click(screen.getByRole("button", { name: /Group by/ }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "No grouping",
      "Status",
      "Owner",
      "Score band",
    ]);
    await user.click(screen.getByRole("menuitem", { name: "Score band" }));
    expect(stored().groupBy).toBe("band");
    const rows = gridStub.rows() as (PpmRisk & { __group?: { label: string; count: number; color?: string } })[];
    const headers = rows.filter((r) => r.__group).map((r) => [r.__group!.label, r.__group!.count, r.__group!.color]);
    expect(headers).toEqual([
      ["High", 1, RAG_COLORS.red],
      ["Medium", 1, RAG_COLORS.amber],
      ["Low", 1, RAG_COLORS.green],
    ]);
  });

  it("colours each status group with its chip's colour", () => {
    localStorage.setItem(RISK_GRID_PREFS_KEY, JSON.stringify({ groupBy: "status" }));
    renderGrid([...RISKS, risk({ id: "r4", title: "Old", status: "closed" })]);
    const palette = createTheme().palette;
    const colours = (gridStub.rows() as (PpmRisk & { __group?: { label: string; color?: string } })[])
      .filter((r) => r.__group)
      .map((r) => [r.__group!.label, r.__group!.color]);
    expect(colours).toEqual([
      ["Open", palette.error.main],
      ["Mitigating", palette.warning.main],
      ["Closed", palette.grey[600]],
      ["Accepted", palette.info.main],
    ]);
  });

  it("groups by status and by owner with their own labels", () => {
    const labels = (axis: string) => {
      gridStub.reset();
      localStorage.setItem(RISK_GRID_PREFS_KEY, JSON.stringify({ groupBy: axis }));
      const r = renderGrid();
      const out = (gridStub.rows() as (PpmRisk & { __group?: { label: string } })[])
        .filter((row) => row.__group)
        .map((row) => row.__group!.label);
      r.unmount();
      return out;
    };
    expect(labels("status")).toEqual(["Open", "Mitigating", "Accepted"]);
    expect(labels("owner")).toEqual(["Not set", "Ada Lovelace", "Grace Hopper"]);
  });
});

describe("phones", () => {
  it("puts the sidebar in a drawer opened from the toolbar", async () => {
    setViewportWidth(390);
    const { user } = renderGrid();
    expect(screen.queryByTestId("risk-filter-sidebar")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show filters" }));
    const drawer = await screen.findByTestId("risk-filter-sidebar");
    expect(drawer).toBeInTheDocument();
    await user.click(within(drawer).getByRole("button", { name: "Hide filters" }));
    expect(stored()?.filtersCollapsed ?? false).toBe(false);
    await waitFor(() => expect(screen.queryByTestId("risk-filter-sidebar")).not.toBeInTheDocument());
  });

  it("closes the drawer with Escape", async () => {
    setViewportWidth(390);
    const { user } = renderGrid();
    await user.click(screen.getByRole("button", { name: "Show filters" }));
    await screen.findByTestId("risk-filter-sidebar");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("risk-filter-sidebar")).not.toBeInTheDocument());
  });

  it("names the filter button in a tooltip", async () => {
    setViewportWidth(390);
    const { user } = renderGrid();
    await user.hover(screen.getByRole("button", { name: "Show filters" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Show filters");
  });
});
