/**
 * "Does a frozen column survive a refresh?" — exercised against the real AG
 * Grid for both persistence shapes the pages use.
 *
 *  - snapshot shape (Inventory): pinning is captured into a `getColumnState()`
 *    snapshot on `onColumnPinned`, stored, and re-applied on the next mount;
 *  - list shape (Risk, Compliance, Users, Resources, Audit log, ADR): the
 *    frozen colIds are stored and stamped back onto the column defs through
 *    `applyFrozen()`.
 *
 * Each test mounts, freezes, unmounts, and mounts again from what was stored —
 * the same sequence as a browser reload.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColumnState } from "ag-grid-community";
import { useColumnFreeze } from "./useColumnFreeze";

interface Row {
  name: string;
  owner: string;
}

const ROWS: Row[] = [{ name: "NexaCore ERP", owner: "Dana" }];
const COLS = [
  { field: "name", headerName: "Name" },
  { field: "owner", headerName: "Owner" },
];
const KEY = "test.grid.prefs";

function readPrefs(): { columnState?: ColumnState[]; frozenColumns?: string[] } {
  return JSON.parse(localStorage.getItem(KEY) ?? "{}");
}
function writePrefs(patch: Record<string, unknown>) {
  localStorage.setItem(KEY, JSON.stringify({ ...readPrefs(), ...patch }));
}

/** Inventory's shape: `pinned` rides along in the persisted column state. */
function SnapshotGrid() {
  const gridRef = useRef<AgGridReact<Row>>(null);
  const saved = useRef(readPrefs().columnState);
  const frozen = (saved.current ?? [])
    .filter((c) => c.pinned === "left" && c.colId)
    .map((c) => c.colId as string);
  const freeze = useColumnFreeze<Row>(gridRef, { frozen });

  const capture = () => {
    const state = gridRef.current?.api?.getColumnState();
    if (state) writePrefs({ columnState: state });
  };

  return (
    <div ref={freeze.containerRef} className="ag-theme-quartz" style={{ height: 300 }}>
      <AgGridReact<Row>
        ref={gridRef}
        rowData={ROWS}
        columnDefs={COLS}
        defaultColDef={{ sortable: true, headerComponentParams: freeze.headerComponentParams }}
        onGridReady={({ api }) => {
          const state = saved.current;
          if (state?.length) api.applyColumnState({ state, applyOrder: true });
        }}
        onColumnPinned={capture}
        onDragStopped={capture}
      />
    </div>
  );
}

/** The other six: a stored list of colIds, stamped on via `applyFrozen`. */
function ListGrid() {
  const gridRef = useRef<AgGridReact<Row>>(null);
  const saved = useRef(readPrefs().frozenColumns ?? []);
  const freeze = useColumnFreeze<Row>(gridRef, {
    frozen: saved.current,
    onFrozenChange: (next) => writePrefs({ frozenColumns: next }),
  });

  return (
    <div ref={freeze.containerRef} className="ag-theme-quartz" style={{ height: 300 }}>
      <AgGridReact<Row>
        ref={gridRef}
        rowData={ROWS}
        columnDefs={freeze.applyFrozen(COLS)}
        defaultColDef={{ sortable: true, headerComponentParams: freeze.headerComponentParams }}
      />
    </div>
  );
}

async function freezeName(container: HTMLElement) {
  const header = await waitFor(() => {
    const el = container.querySelector('.ag-header-cell[col-id="name"]');
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
  const pin = header.querySelector(".tea-freeze-do") as HTMLElement;
  pin.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  pin.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await waitFor(() =>
    expect(container.querySelector('.ag-pinned-left-header [col-id="name"]')).not.toBeNull(),
  );
}

describe("a frozen column survives a reload", () => {
  beforeEach(() => localStorage.clear());

  it("snapshot-persisted grids (Inventory)", async () => {
    const first = render(<SnapshotGrid />);
    await freezeName(first.container);

    expect(readPrefs().columnState?.find((c) => c.colId === "name")?.pinned).toBe("left");

    first.unmount();
    const second = render(<SnapshotGrid />);
    await waitFor(() =>
      expect(second.container.querySelector('.ag-pinned-left-header [col-id="name"]')).not.toBeNull(),
    );
  });

  it("list-persisted grids (Risk, Compliance, Users, Resources, Audit log, ADR)", async () => {
    const first = render(<ListGrid />);
    await freezeName(first.container);

    expect(readPrefs().frozenColumns).toEqual(["name"]);

    first.unmount();
    const second = render(<ListGrid />);
    await waitFor(() =>
      expect(second.container.querySelector('.ag-pinned-left-header [col-id="name"]')).not.toBeNull(),
    );
  });

  it("unfreezing is persisted too — a released column does not come back", async () => {
    const first = render(<ListGrid />);
    await freezeName(first.container);

    const pinned = first.container.querySelector(
      '.ag-pinned-left-header [col-id="name"] .tea-freeze-undo',
    ) as HTMLElement;
    pinned.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    pinned.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => expect(readPrefs().frozenColumns).toEqual([]));

    first.unmount();
    const second = render(<ListGrid />);
    await waitFor(() =>
      expect(second.container.querySelector('.ag-header-cell[col-id="name"]')).not.toBeNull(),
    );
    expect(second.container.querySelector('.ag-pinned-left-header [col-id="name"]')).toBeNull();
  });
});
