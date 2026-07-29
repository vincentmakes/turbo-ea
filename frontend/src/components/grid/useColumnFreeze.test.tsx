import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import type { ColDef, GridApi } from "ag-grid-community";
import {
  buildFreezeHeaderTemplate,
  useColumnFreeze,
  type ColumnFreeze,
} from "./useColumnFreeze";

// ---------------------------------------------------------------------------
// Fake grid — a header row built from the real template, driven by a stub API
// ---------------------------------------------------------------------------

interface FakeColumn {
  colId: string;
  pinned: "left" | "right" | null;
  lockPinned?: boolean;
}

function makeApi(columns: FakeColumn[]) {
  const setColumnsPinned = vi.fn((keys: string[], pinned: "left" | null) => {
    for (const key of keys) {
      const col = columns.find((c) => c.colId === key);
      if (col) col.pinned = pinned;
    }
  });
  const api = {
    setColumnsPinned,
    getColumn: (id: string) => {
      const col = columns.find((c) => c.colId === id);
      if (!col) return null;
      return {
        getPinned: () => col.pinned,
        getColDef: () => ({ lockPinned: col.lockPinned }),
      };
    },
    getColumnState: () => columns.map((c) => ({ colId: c.colId, pinned: c.pinned })),
  };
  return { api: api as unknown as GridApi, setColumnsPinned };
}

/**
 * Renders a stand-in for AG Grid's header: the pinned container holds the
 * frozen columns, the centre container the rest, and each header cell's
 * innerHTML is the very template the hook feeds the grid.
 */
function Harness({
  api,
  columns,
  onFrozenChange,
  onCellClick,
  freezeRef,
}: {
  api: GridApi;
  columns: FakeColumn[];
  onFrozenChange?: (frozen: string[]) => void;
  onCellClick?: (colId: string) => void;
  freezeRef?: { current: ColumnFreeze | null };
}) {
  const gridRef = useRef<GridApi | null>(api);
  const freeze = useColumnFreeze(gridRef, {
    frozen: onFrozenChange ? columns.filter((c) => c.pinned === "left").map((c) => c.colId) : undefined,
    onFrozenChange,
  });
  if (freezeRef) freezeRef.current = freeze;
  const template = freeze.headerComponentParams.template;
  const cells = (pinned: boolean) =>
    columns
      .filter((c) => (c.pinned === "left") === pinned)
      .map((c) => (
        <div
          key={c.colId}
          className="ag-header-cell"
          col-id={c.colId}
          data-testid={`cell-${c.colId}`}
          onClick={() => onCellClick?.(c.colId)}
          dangerouslySetInnerHTML={{ __html: template }}
        />
      ));
  return (
    <div ref={freeze.containerRef}>
      <div className="ag-pinned-left-header">{cells(true)}</div>
      <div className="ag-header-viewport">{cells(false)}</div>
    </div>
  );
}

function clickPin(container: HTMLElement, colId: string) {
  const cell = container.querySelector(`[col-id="${colId}"]`)!;
  const pin = cell.querySelector(".tea-freeze")!;
  pin.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  pin.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

// ---------------------------------------------------------------------------

describe("buildFreezeHeaderTemplate", () => {
  it("keeps every AG Grid ref the stock header component wires up", () => {
    const tpl = buildFreezeHeaderTemplate("Freeze", "Unfreeze");
    for (const ref of ["eMenu", "eFilterButton", "eLabel", "eText", "eFilter", "eSortIndicator"]) {
      expect(tpl).toContain(`data-ref="${ref}"`);
    }
    expect(tpl).toContain("<ag-sort-indicator");
  });

  it("escapes the translated labels so a quote cannot break out of the attribute", () => {
    const tpl = buildFreezeHeaderTemplate('Fix "column"', "Libérer <col>");
    expect(tpl).toContain("&quot;column&quot;");
    expect(tpl).toContain("&lt;col&gt;");
    expect(tpl).not.toContain('title="Fix "');
  });
});

describe("useColumnFreeze", () => {
  it("freezes an unfrozen column and reports the new frozen set", () => {
    const columns: FakeColumn[] = [
      { colId: "name", pinned: null },
      { colId: "type", pinned: null },
    ];
    const { api, setColumnsPinned } = makeApi(columns);
    const onFrozenChange = vi.fn();
    const { container } = render(
      <Harness api={api} columns={columns} onFrozenChange={onFrozenChange} />,
    );

    clickPin(container, "name");

    expect(setColumnsPinned).toHaveBeenCalledWith(["name"], "left");
    expect(onFrozenChange).toHaveBeenCalledWith(["name"]);
  });

  it("unfreezes a column that is already frozen", () => {
    const columns: FakeColumn[] = [
      { colId: "name", pinned: "left" },
      { colId: "type", pinned: null },
    ];
    const { api, setColumnsPinned } = makeApi(columns);
    const onFrozenChange = vi.fn();
    const { container } = render(
      <Harness api={api} columns={columns} onFrozenChange={onFrozenChange} />,
    );

    clickPin(container, "name");

    expect(setColumnsPinned).toHaveBeenCalledWith(["name"], null);
    expect(onFrozenChange).toHaveBeenCalledWith([]);
  });

  it("does not let the click reach the header cell (which would sort it)", () => {
    const columns: FakeColumn[] = [{ colId: "name", pinned: null }];
    const { api } = makeApi(columns);
    const onCellClick = vi.fn();
    const { container } = render(
      <Harness api={api} columns={columns} onCellClick={onCellClick} onFrozenChange={vi.fn()} />,
    );

    clickPin(container, "name");
    expect(onCellClick).not.toHaveBeenCalled();

    // A click anywhere else in the header still sorts as usual.
    container.querySelector('[col-id="name"] .ag-header-cell-text')!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(onCellClick).toHaveBeenCalledTimes(1);
  });

  it("ignores columns the grid marks as lockPinned", () => {
    const columns: FakeColumn[] = [{ colId: "actions", pinned: null, lockPinned: true }];
    const { api, setColumnsPinned } = makeApi(columns);
    const onFrozenChange = vi.fn();
    const { container } = render(
      <Harness api={api} columns={columns} onFrozenChange={onFrozenChange} />,
    );

    clickPin(container, "actions");

    expect(setColumnsPinned).not.toHaveBeenCalled();
    expect(onFrozenChange).not.toHaveBeenCalled();
  });

  it("applyFrozen stamps pinned onto the frozen columns and clears the rest", () => {
    const columns: FakeColumn[] = [
      { colId: "name", pinned: "left" },
      { colId: "type", pinned: null },
    ];
    const { api } = makeApi(columns);
    const freezeRef = { current: null as ColumnFreeze | null };
    render(
      <Harness
        api={api}
        columns={columns}
        onFrozenChange={vi.fn()}
        freezeRef={freezeRef}
      />,
    );

    const cols: ColDef[] = [{ colId: "name" }, { field: "type" }, { colId: "cost" }];
    const applied = freezeRef.current!.applyFrozen(cols);
    expect(applied.map((c) => c.pinned)).toEqual(["left", null, null]);
    // The originals are untouched — the grids memoise on them.
    expect(cols.every((c) => c.pinned === undefined)).toBe(true);
  });

  it("exposes the frozen set and a toggle for the sidebar's Columns tab", () => {
    const columns: FakeColumn[] = [
      { colId: "name", pinned: "left" },
      { colId: "type", pinned: null },
    ];
    const { api, setColumnsPinned } = makeApi(columns);
    const onFrozenChange = vi.fn();
    const freezeRef = { current: null as ColumnFreeze | null };
    render(
      <Harness
        api={api}
        columns={columns}
        onFrozenChange={onFrozenChange}
        freezeRef={freezeRef}
      />,
    );

    expect([...freezeRef.current!.frozenColumns]).toEqual(["name"]);

    // The sidebar pin runs the exact code path the header pin does.
    freezeRef.current!.toggleFrozen("type");
    expect(setColumnsPinned).toHaveBeenCalledWith(["type"], "left");
    expect(onFrozenChange).toHaveBeenCalledWith(["name", "type"]);
  });

  it("leaves column defs alone when the grid persists AG Grid's own state", () => {
    const columns: FakeColumn[] = [{ colId: "name", pinned: null }];
    const { api } = makeApi(columns);
    const freezeRef = { current: null as ColumnFreeze | null };
    // No `onFrozenChange` → uncontrolled mode (Inventory / ADR).
    render(<Harness api={api} columns={columns} freezeRef={freezeRef} />);

    const cols: ColDef[] = [{ colId: "name", pinned: "left" }];
    expect(freezeRef.current!.applyFrozen(cols)).toBe(cols);
  });
});
