/**
 * "Does a reordered column survive a refresh?" — exercised against the real AG
 * Grid, the same shape as `columnFreezePersistence.test.tsx`.
 *
 * A real header drag is not simulatable in jsdom (AG Grid's drag service needs
 * layout), so the tests move the column through the grid API and then call
 * `syncFromGrid()` — which is exactly what a page's `onDragStopped` handler
 * does once the drag ends.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GridApi } from "ag-grid-community";
import { useColumnOrder } from "./useColumnOrder";
import { useColumnFreeze } from "./useColumnFreeze";

interface Row {
  name: string;
  owner: string;
  cost: number;
}

const ROWS: Row[] = [{ name: "NexaCore ERP", owner: "Dana", cost: 12 }];
const KEY = "test.grid.order";

const COLS: ColDef[] = [
  { colId: "name", field: "name" },
  { colId: "owner", field: "owner" },
  { colId: "cost", field: "cost" },
];

function readOrder(): string[] {
  return JSON.parse(localStorage.getItem(KEY) ?? "[]");
}
function writeOrder(order: string[]) {
  localStorage.setItem(KEY, JSON.stringify(order));
}

/** Handles the test drives the grid through, captured on mount. */
interface Handle {
  api: GridApi<Row>;
  /** What the page wires to `onDragStopped`. */
  syncFromGrid: () => void;
}

function Grid({
  cols,
  frozen,
  onReady,
}: {
  cols: ColDef[];
  frozen?: string[];
  onReady?: (handle: Handle) => void;
}) {
  const gridRef = useRef<AgGridReact<Row>>(null);
  const [order, setOrder] = useState<string[]>(() => readOrder());
  const columnOrder = useColumnOrder<Row>(gridRef, {
    order,
    onOrderChange: (next) => {
      setOrder(next);
      writeOrder(next);
    },
  });
  const columnFreeze = useColumnFreeze<Row>(gridRef, { frozen: frozen ?? [] });

  return (
    <div ref={columnFreeze.containerRef} className="ag-theme-quartz" style={{ height: 300 }}>
      <AgGridReact<Row>
        ref={gridRef}
        rowData={ROWS}
        columnDefs={columnOrder.applyOrder(columnFreeze.applyFrozen(cols))}
        defaultColDef={{ headerComponentParams: columnFreeze.headerComponentParams }}
        onGridReady={({ api }) => onReady?.({ api, syncFromGrid: columnOrder.syncFromGrid })}
        onDragStopped={() => columnOrder.syncFromGrid()}
        getRowId={(p) => p.data.name}
      />
    </div>
  );
}

/** colIds in the order AG Grid is actually rendering them. */
function renderedOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".ag-header-cell[col-id]")).map(
    (el) => el.getAttribute("col-id") as string,
  );
}

async function waitForHeaders(container: HTMLElement, count: number) {
  await waitFor(() => expect(renderedOrder(container).length).toBe(count));
}

function mount(cols: ColDef[] = COLS, frozen?: string[]) {
  let handle: Handle | null = null;
  const result = render(<Grid cols={cols} frozen={frozen} onReady={(h) => (handle = h)} />);
  return { ...result, getHandle: () => handle as Handle | null };
}

describe("column order persistence", () => {
  beforeEach(() => localStorage.clear());

  it("renders the natural order when nothing is stored", async () => {
    const { container } = mount();
    await waitForHeaders(container, 3);
    expect(renderedOrder(container)).toEqual(["name", "owner", "cost"]);
  });

  it("a header drag is captured and re-applied on the next mount", async () => {
    const first = mount();
    await waitForHeaders(first.container, 3);

    // Move "name" to the end and end the drag, exactly as AG Grid would.
    await act(async () => {
      first.getHandle()!.api.moveColumnByIndex(0, 2);
      first.getHandle()!.syncFromGrid();
    });

    await waitFor(() => expect(readOrder()).toEqual(["owner", "cost", "name"]));

    first.unmount();

    const second = mount();
    await waitForHeaders(second.container, 3);
    expect(renderedOrder(second.container)).toEqual(["owner", "cost", "name"]);
  });

  it("a resize-only drag does not rewrite the preference", async () => {
    writeOrder(["cost", "name", "owner"]);
    const { container, getHandle } = mount();
    await waitForHeaders(container, 3);

    // `onDragStopped` fires for resizes too — nothing moved, so nothing to write.
    localStorage.setItem(KEY, JSON.stringify(["cost", "name", "owner"]));
    await act(async () => {
      getHandle()!.api.setColumnWidths([{ key: "name", newWidth: 320 }]);
      getHandle()!.syncFromGrid();
    });

    expect(readOrder()).toEqual(["cost", "name", "owner"]);
  });

  it("a stored order is applied on mount and survives a remount", async () => {
    writeOrder(["cost", "name", "owner"]);

    const first = mount();
    await waitForHeaders(first.container, 3);
    expect(renderedOrder(first.container)).toEqual(["cost", "name", "owner"]);

    first.unmount();

    const second = mount();
    await waitForHeaders(second.container, 3);
    expect(renderedOrder(second.container)).toEqual(["cost", "name", "owner"]);
  });

  it("a hidden column keeps its slot and returns to it when unhidden", async () => {
    writeOrder(["name", "owner", "cost"]);
    const hidden = COLS.map((c) => (c.colId === "owner" ? { ...c, hide: true } : c));

    const first = mount(hidden);
    await waitForHeaders(first.container, 2);
    expect(renderedOrder(first.container)).toEqual(["name", "cost"]);

    // Drag the visible pair around; "owner" stays attached to "name".
    await act(async () => {
      first.getHandle()!.api.moveColumns(["cost"], 0);
      first.getHandle()!.syncFromGrid();
    });
    await waitFor(() => expect(readOrder()).toEqual(["cost", "name", "owner"]));

    first.unmount();

    const second = mount(COLS);
    await waitForHeaders(second.container, 3);
    expect(renderedOrder(second.container)).toEqual(["cost", "name", "owner"]);
  });

  it("late-arriving columns land in their natural neighbourhood", async () => {
    // The inventory shape: the grid first renders with a subset of its columns,
    // and the rest arrive once the metamodel has loaded.
    writeOrder(["owner", "name"]);

    const { container } = mount(COLS);
    await waitForHeaders(container, 3);
    // "cost" was never stored. It lands after "owner" — its predecessor in the
    // *natural* order — rather than being appended at the tail, which is what
    // keeps a block of late-arriving attribute columns in its neighbourhood.
    expect(renderedOrder(container)).toEqual(["owner", "cost", "name"]);
    await waitFor(() => expect(readOrder()).toEqual(["owner", "cost", "name"]));
  });

  it("keeps ids for columns that are not currently present", async () => {
    // "extra" belongs to a card type the user is not looking at right now.
    writeOrder(["cost", "extra", "owner", "name"]);

    const { container, getHandle } = mount(COLS);
    await waitForHeaders(container, 3);

    await act(async () => {
      getHandle()!.api.moveColumnByIndex(0, 2);
      getHandle()!.syncFromGrid();
    });

    await waitFor(() => expect(readOrder()).toContain("extra"));
  });

  it("composes with applyFrozen — a frozen column keeps its logical slot", async () => {
    writeOrder(["cost", "owner", "name"]);

    const { container } = mount(COLS, ["owner"]);
    await waitFor(() =>
      expect(container.querySelector('.ag-pinned-left-header [col-id="owner"]')).not.toBeNull(),
    );
    // The pinned region renders ahead of everything else, so the unpinned
    // columns keep the stored relative order with "owner" lifted out of them.
    const centre = Array.from(container.querySelectorAll(".ag-header-cell[col-id]"))
      .filter((el) => !el.closest(".ag-pinned-left-header"))
      .map((el) => el.getAttribute("col-id"));
    expect(centre).toEqual(["cost", "name"]);
    expect(readOrder()).toEqual(["cost", "owner", "name"]);
  });
});
