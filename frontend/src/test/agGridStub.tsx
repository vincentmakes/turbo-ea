/* eslint-disable react-refresh/only-export-components */
/**
 * A stand-in for `ag-grid-react` in page tests.
 *
 * AG Grid cannot lay out under jsdom, and a page test is about the page, not
 * the grid: what matters is the column definitions it builds, the row data it
 * hands over, and what it does when the grid reports a selection or an edit.
 * The stub renders a marker div, exposes the last props, and hands the page a
 * grid `api` faithful to the slice the pages call — including `getCellValue`,
 * which reproduces AG Grid's ValueService (valueGetter → valueFormatter → raw
 * value) because "Export current view" reads its values back out of the grid
 * (#887).
 *
 * ```ts
 * vi.mock("ag-grid-react", () => import("@/test/agGridStub").then((m) => m.agGridReactModule()));
 * import { gridStub } from "@/test/agGridStub";
 *
 * expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-row-count", "3");
 * expect(gridStub.cellValue("role", rows[0], { formatted: true })).toBe("Admin");
 * gridStub.editCell("role", rows[0], "viewer");          // fires onCellValueChanged
 * await user.click(screen.getByTestId("select-all-rows")); // fires onSelectionChanged
 * ```
 *
 * A test that needs the grid's own DOM (column freeze, drag fill) mounts the
 * real grid instead; see `components/grid/*.integration.test.tsx`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from "vitest";

type Fn = (...args: any[]) => any;

interface GridState {
  props: any;
  api: any;
  rows: any[];
  columnDefs: any[];
  selected: any[];
  filterModel: Record<string, unknown>;
  columnState: any[] | null;
  listeners: Map<string, Set<Fn>>;
}

const state: GridState = {
  props: null,
  api: null,
  rows: [],
  columnDefs: [],
  selected: [],
  filterModel: {},
  columnState: null,
  listeners: new Map(),
};

function colId(def: any): string {
  return def?.colId ?? def?.field;
}

function makeColumn(def: any) {
  return {
    def,
    colId: colId(def),
    getColId: () => colId(def),
    getColDef: () => def,
    getId: () => colId(def),
    isVisible: () => !def.hide,
    isPinned: () => Boolean(def.pinned),
    getPinned: () => def.pinned ?? null,
    getActualWidth: () => def.width ?? 150,
    getSort: () => def.sort ?? null,
    getUserProvidedColDef: () => def,
  };
}

function rowId(data: any): string {
  const getRowId = state.props?.getRowId;
  if (typeof getRowId === "function") return String(getRowId({ data }));
  return String(data?.id ?? state.rows.indexOf(data));
}

function makeNode(data: any, index: number) {
  return {
    data,
    rowIndex: index,
    id: rowId(data),
    isSelected: () => state.selected.includes(data),
    setSelected: (on: boolean) => {
      state.selected = on
        ? [...new Set([...state.selected, data])]
        : state.selected.filter((r) => r !== data);
    },
    setDataValue: vi.fn(),
    updateData: vi.fn(),
    group: false,
  };
}

/** The grid api the stub hands to `ref.current.api` and to every event. */
export function gridApiFor(columnDefs: any[] | undefined, rowData: any[] | undefined) {
  const cols = (columnDefs ?? []).map(makeColumn);
  const rows = rowData ?? [];
  const nodes = () => rows.map(makeNode);
  const findDef = (key: any) =>
    typeof key === "string" ? cols.find((c) => c.colId === key)?.def : (key?.def ?? key?.getColDef?.());
  const stubs: Record<string, any> = {
    // Rows
    getDisplayedRowCount: () => rows.length,
    getDisplayedRowAtIndex: (i: number) => nodes()[i],
    getRowNode: (id: string) => nodes().find((n) => n.id === String(id)),
    forEachNode: (fn: Fn) => nodes().forEach((n, i) => fn(n, i)),
    forEachNodeAfterFilter: (fn: Fn) => nodes().forEach((n, i) => fn(n, i)),
    forEachNodeAfterFilterAndSort: (fn: Fn) => nodes().forEach((n, i) => fn(n, i)),
    getRenderedNodes: () => nodes(),
    // Selection
    getSelectedRows: () => (state.selected.length ? state.selected : []),
    getSelectedNodes: () => nodes().filter((n) => state.selected.includes(n.data)),
    setNodesSelected: ({ nodes: ns, newValue }: { nodes: any[]; newValue: boolean }) => {
      for (const n of ns) n.setSelected(newValue);
    },
    selectAll: () => {
      state.selected = [...rows];
    },
    deselectAll: () => {
      state.selected = [];
    },
    // Columns
    getColumnDefs: () => columnDefs ?? [],
    getAllGridColumns: () => cols,
    getColumns: () => cols,
    getAllDisplayedColumns: () => cols.filter((c) => !c.def.hide),
    getDisplayedCenterColumns: () => cols.filter((c) => !c.def.hide && !c.def.pinned),
    getColumn: (key: any) => cols.find((c) => c.colId === (typeof key === "string" ? key : colId(key))),
    getDisplayNameForColumn: (c: any) => c?.def?.headerName ?? c?.getColDef?.()?.headerName,
    getColumnState: () =>
      state.columnState ??
      cols.map((c) => ({
        colId: c.colId,
        hide: Boolean(c.def.hide),
        pinned: c.def.pinned ?? null,
        width: c.def.width ?? 150,
        sort: c.def.sort ?? null,
      })),
    applyColumnState: (params: any) => {
      state.columnState = params?.state ?? null;
      return true;
    },
    resetColumnState: () => {
      state.columnState = null;
    },
    setColumnsVisible: () => {},
    setColumnsPinned: () => {},
    setColumnWidths: () => {},
    moveColumns: () => {},
    moveColumnByIndex: () => {},
    autoSizeColumns: () => {},
    autoSizeAllColumns: () => {},
    sizeColumnsToFit: () => {},
    // Values
    getCellValue: ({ rowNode, colKey, useFormatter }: any) => {
      const def = findDef(colKey);
      if (!def) return undefined;
      const value = def.valueGetter
        ? def.valueGetter({ data: rowNode.data, colDef: def, node: rowNode })
        : rowNode.data?.[def.field];
      if (!useFormatter) return value;
      const formatted = def.valueFormatter?.({ value, data: rowNode.data, colDef: def, node: rowNode });
      return formatted ?? (Array.isArray(value) ? value.join(", ") : value);
    },
    // Filtering / sorting
    getFilterModel: () => state.filterModel,
    setFilterModel: (m: Record<string, unknown> | null) => {
      state.filterModel = m ?? {};
    },
    isAnyFilterPresent: () => Object.keys(state.filterModel).length > 0,
    onFilterChanged: () => {},
    getQuickFilter: () => "",
    // Events
    addEventListener: (name: string, fn: Fn) => {
      if (!state.listeners.has(name)) state.listeners.set(name, new Set());
      state.listeners.get(name)!.add(fn);
    },
    removeEventListener: (name: string, fn: Fn) => {
      state.listeners.get(name)?.delete(fn);
    },
    // Lifecycle / misc
    isDestroyed: () => false,
    destroy: () => {},
    setGridOption: () => {},
    updateGridOptions: () => {},
    refreshCells: () => {},
    redrawRows: () => {},
    refreshHeader: () => {},
    ensureIndexVisible: () => {},
    ensureColumnVisible: () => {},
    showLoadingOverlay: () => {},
    hideOverlay: () => {},
    exportDataAsCsv: () => {},
    getDataAsCsv: () => "",
    stopEditing: () => {},
    startEditingCell: () => {},
    getFocusedCell: () => null,
    clearFocusedCell: () => {},
    getRowGroupColumns: () => [],
    setRowGroupColumns: () => {},
    getGridOption: (key: string) => state.props?.[key],
  };
  return new Proxy(stubs, {
    get: (target, prop: string) => target[prop] ?? (() => undefined),
  });
}

/** The stand-in component. `ref` arrives as a plain prop on React 19. */
export function AgGridReactStub(props: any) {
  const { rowData, columnDefs, onSelectionChanged, loading, ref } = props;
  state.props = props;
  if (rowData !== state.rows) {
    // AG Grid keeps a selection across a row-data swap only for rows still present.
    state.selected = state.selected.filter((r) => (rowData ?? []).includes(r));
  }
  state.rows = rowData ?? [];
  state.columnDefs = columnDefs ?? [];
  state.api = gridApiFor(columnDefs, rowData);
  if (ref && typeof ref === "object") ref.current = { api: state.api };
  return (
    <div
      data-testid="ag-grid"
      data-row-count={rowData?.length ?? 0}
      data-loading={String(Boolean(loading))}
    >
      <button
        type="button"
        data-testid="select-all-rows"
        onClick={() => {
          state.selected = [...state.rows];
          onSelectionChanged?.({ api: state.api, source: "api" });
        }}
      />
    </div>
  );
}

/** The module a `vi.mock("ag-grid-react", …)` factory returns. */
export function agGridReactModule() {
  return { AgGridReact: vi.fn(AgGridReactStub) };
}

/** Handles into the last rendered grid. */
export const gridStub = {
  /** Props of the most recent render. */
  lastProps: () => state.props,
  api: () => state.api,
  rows: () => state.rows,
  colDefs: () => state.columnDefs as any[],
  colDef: (id: string) => state.columnDefs.find((d) => colId(d) === id),
  /** Run a column's getter (and formatter) on one row the way the grid would. */
  cellValue: (id: string, row: any, opts: { formatted?: boolean } = {}) =>
    state.api?.getCellValue({ rowNode: makeNode(row, state.rows.indexOf(row)), colKey: id, useFormatter: opts.formatted }),
  /** Report an edit on one cell: fires the page's `onCellValueChanged`. */
  editCell: (id: string, row: any, newValue: unknown, oldValue?: unknown) => {
    const def = gridStub.colDef(id);
    const node = makeNode(row, state.rows.indexOf(row));
    const column = makeColumn(def);
    const event = {
      data: row,
      node,
      colDef: def,
      column,
      newValue,
      oldValue: oldValue ?? (def?.field ? row?.[def.field] : undefined),
      api: state.api,
      type: "cellValueChanged",
    };
    def?.onCellValueChanged?.(event);
    state.props?.onCellValueChanged?.(event);
    return event;
  },
  /** Select rows and fire `onSelectionChanged`. */
  selectRows: (rows: any[]) => {
    state.selected = rows;
    state.props?.onSelectionChanged?.({ api: state.api, source: "api" });
  },
  /** Fire a grid event registered through `api.addEventListener`, or a prop handler. */
  fire: (name: string, payload: Record<string, unknown> = {}) => {
    const event = { api: state.api, type: name, ...payload };
    state.listeners.get(name)?.forEach((fn) => fn(event));
    const prop = state.props?.[`on${name.charAt(0).toUpperCase()}${name.slice(1)}`];
    prop?.(event);
    return event;
  },
  reset: () => {
    state.props = null;
    state.api = null;
    state.rows = [];
    state.columnDefs = [];
    state.selected = [];
    state.filterModel = {};
    state.columnState = null;
    state.listeners = new Map();
  },
};
