/**
 * Contract tests against the *real* AG Grid: focus a cell, drag the fill
 * handle, and drive the confirmation — the same wiring every page uses.
 *
 * jsdom reports every rect as zero, so these assert on behaviour (which cells
 * are tinted, what the dialog says, what `onFill` receives) rather than on
 * pixel positions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { useRef } from "react";
import { AgGridReact } from "ag-grid-react";
import type { GridApi } from "ag-grid-community";
import { useDragFill } from "./useDragFill";
import type { FillOutcome, FillRequest, UseDragFillOptions } from "./useDragFill";
import { FILL_HANDLE_CLASS, FILL_PREVIEW_CLASS } from "./dragFill";

interface Row {
  id: string;
  name: string;
  value: string;
  locked: string;
  group?: boolean;
}

const ROWS: Row[] = [
  { id: "a", name: "Alpha", value: "one", locked: "x" },
  { id: "b", name: "Beta", value: "two", locked: "x" },
  { id: "c", name: "Gamma", value: "three", locked: "x" },
  { id: "d", name: "Delta", value: "four", locked: "x" },
  { id: "e", name: "Epsilon", value: "five", locked: "x" },
];

let gridApi: GridApi<Row> | null = null;
const wrapperPointerDown = vi.fn();

type Options = Omit<UseDragFillOptions<Row>, "containerRef">;

function TestGrid({ options, rows = ROWS }: { options: Options; rows?: Row[] }) {
  const gridRef = useRef<AgGridReact<Row>>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragFill = useDragFill<Row>(gridRef, { ...options, containerRef });
  return (
    <div>
      <div
        ref={containerRef}
        // Stands in for `useCellContextMenu.containerProps`: the handle must
        // never let a pointerdown reach the wrapper, or the cell menu's
        // long-press would arm underneath the drag.
        onPointerDown={wrapperPointerDown}
        className="ag-theme-quartz"
        style={{ height: 400, width: 800, position: "relative" }}
      >
        <AgGridReact<Row>
          ref={gridRef}
          rowData={rows}
          getRowId={(p) => p.data.id}
          onGridReady={(e) => {
            gridApi = e.api;
          }}
          columnDefs={[
            { field: "name", editable: true },
            { field: "value", editable: true },
            { field: "locked", editable: false },
          ]}
          defaultColDef={{ sortable: true, resizable: true }}
          {...dragFill.gridProps}
        />
        {dragFill.overlay}
      </div>
      {dragFill.dialog}
    </div>
  );
}

async function renderGrid(options: Partial<Options> = {}, rows?: Row[]) {
  const onFill = options.onFill ?? vi.fn(async () => ({ succeeded: 0, failures: [] }));
  const utils = render(<TestGrid options={{ onFill, ...options }} rows={rows} />);
  await waitFor(() => {
    expect(utils.container.querySelector('.ag-cell[col-id="value"]')).not.toBeNull();
  });
  return { ...utils, onFill };
}

/**
 * The handle element. Queried by class rather than by role because a hidden
 * handle is `display: none`, which puts it outside the accessibility tree —
 * `getByRole` cannot see it, and "it is hidden" is exactly what several of
 * these assert. Its accessible name is asserted separately once it is visible.
 */
function handleOf(): HTMLElement {
  const el = document.querySelector<HTMLElement>(`.${FILL_HANDLE_CLASS}`);
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

/** The dialog's primary action. Its name carries the MaterialSymbol glyph text. */
function fillButton(count: number): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`Fill ${count} rows?$`) });
}

/** Focus a cell the way a click does, then let the rAF reposition run. */
async function focusCell(rowIndex: number, colId: string) {
  await act(async () => {
    gridApi!.setFocusedCell(rowIndex, colId);
  });
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

/**
 * Point `document.elementFromPoint` at a given row, the way a real pointer
 * over the grid would. jsdom does not implement it at all, so it is installed
 * rather than spied.
 */
function pointAtRow(container: HTMLElement, rowIndex: number | null) {
  const target =
    rowIndex === null
      ? document.createElement("div")
      : container.querySelector(`.ag-row[row-index="${rowIndex}"] .ag-cell`);
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    writable: true,
    value: vi.fn(() => target ?? null),
  });
}

/** Full press → move → release over the handle. */
async function dragTo(container: HTMLElement, rowIndex: number) {
  const handle = handleOf();
  await act(async () => {
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
  });
  pointAtRow(container, rowIndex);
  await act(async () => {
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 100 });
  });
  await act(async () => {
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 100 });
  });
}

function previewedCells(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(`.${FILL_PREVIEW_CLASS}`)).map((el) => {
    const row = el.closest("[row-index]")?.getAttribute("row-index");
    return `${row}:${el.getAttribute("col-id")}`;
  });
}

beforeEach(() => {
  gridApi = null;
  wrapperPointerDown.mockClear();
});

afterEach(() => {
  delete (document as unknown as Record<string, unknown>).elementFromPoint;
});

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

describe("handle visibility", () => {
  it("is hidden until a cell is focused", async () => {
    await renderGrid();
    expect(handleOf().style.display).toBe("none");
  });

  it("appears on a fillable focused cell", async () => {
    await renderGrid();
    await focusCell(0, "value");
    expect(handleOf().style.display).toBe("block");
  });

  it("exposes a focusable, translated control once visible (§5)", async () => {
    await renderGrid();
    await focusCell(0, "value");
    const handle = screen.getByRole("button", { name: "Fill cells from here" });
    expect(handle).toBe(handleOf());
    expect(handle.getAttribute("tabindex")).toBe("0");
  });

  it("stays hidden while `enabled` is false", async () => {
    await renderGrid({ enabled: () => false });
    await focusCell(0, "value");
    expect(handleOf().style.display).toBe("none");
  });

  it("stays hidden on a non-editable column", async () => {
    await renderGrid();
    await focusCell(0, "locked");
    expect(handleOf().style.display).toBe("none");
  });

  it("stays hidden on a column the page vetoes", async () => {
    await renderGrid({ isFillable: (colId) => colId !== "name" });
    await focusCell(0, "name");
    expect(handleOf().style.display).toBe("none");
    await focusCell(0, "value");
    expect(handleOf().style.display).toBe("block");
  });

  it("stays hidden on a suppressed row", async () => {
    const rows = [{ ...ROWS[0], group: true }, ...ROWS.slice(1)];
    await renderGrid({ suppressForRow: (row) => !!row.group }, rows);
    await focusCell(0, "value");
    expect(handleOf().style.display).toBe("none");
    await focusCell(1, "value");
    expect(handleOf().style.display).toBe("block");
  });
});

// ---------------------------------------------------------------------------
// Composition with the wrapper's other pointer consumers
// ---------------------------------------------------------------------------

describe("composition", () => {
  it("does not let a pointerdown on the handle reach the wrapper", async () => {
    await renderGrid();
    await focusCell(0, "value");
    await act(async () => {
      fireEvent.pointerDown(handleOf(), { pointerId: 1, clientX: 10, clientY: 10 });
    });
    expect(wrapperPointerDown).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Dragging
// ---------------------------------------------------------------------------

describe("drag", () => {
  it("tints the covered cells of the anchor column only, never the anchor", async () => {
    const { container } = await renderGrid();
    await focusCell(0, "value");
    const handle = handleOf();
    await act(async () => {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    });
    pointAtRow(container, 3);
    await act(async () => {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 100 });
    });

    expect(previewedCells(container).sort()).toEqual(["1:value", "2:value", "3:value"]);
  });

  it("clears the preview on release", async () => {
    const { container } = await renderGrid();
    await focusCell(0, "value");
    await dragTo(container, 2);
    expect(previewedCells(container)).toEqual([]);
  });

  it("opens the dialog with the covered row count", async () => {
    const { container } = await renderGrid();
    await focusCell(0, "value");
    await dragTo(container, 3);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Copy this value into 3 rows/)).toBeTruthy();
  });

  it("does nothing when the drag never leaves the anchor row", async () => {
    const { container, onFill } = await renderGrid();
    await focusCell(0, "value");
    await dragTo(container, 0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onFill).not.toHaveBeenCalled();
  });

  it("fills upward as well as downward", async () => {
    const { container } = await renderGrid();
    await focusCell(4, "value");
    await dragTo(container, 2);
    expect(screen.getByText(/Copy this value into 2 rows/)).toBeTruthy();
  });

  it("excludes suppressed rows from the range and from the count", async () => {
    const rows = [ROWS[0], { ...ROWS[1], group: true }, ROWS[2], ROWS[3]];
    const { container } = await renderGrid({ suppressForRow: (row) => !!row.group }, rows);
    await focusCell(0, "value");
    const handle = handleOf();
    await act(async () => {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    });
    pointAtRow(container, 3);
    await act(async () => {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 100 });
    });
    // Row 1 is a group header: never tinted, never counted.
    expect(previewedCells(container).sort()).toEqual(["2:value", "3:value"]);
    await act(async () => {
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 100 });
    });
    expect(screen.getByText(/Copy this value into 2 rows/)).toBeTruthy();
  });

  it("holds the last row when the pointer leaves the grid", async () => {
    const { container } = await renderGrid();
    await focusCell(0, "value");
    const handle = handleOf();
    await act(async () => {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    });
    pointAtRow(container, 2);
    await act(async () => {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 100 });
    });
    pointAtRow(container, null); // over the header / off-grid
    await act(async () => {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 900 });
    });
    expect(previewedCells(container).sort()).toEqual(["1:value", "2:value"]);
  });

  it("clamps a drag to maxRows", async () => {
    const { container } = await renderGrid({ maxRows: 2 });
    await focusCell(0, "value");
    await dragTo(container, 4);
    expect(screen.getByText(/Copy this value into 2 rows/)).toBeTruthy();
  });

  it("aborts without a dialog when the anchor row disappears mid-drag", async () => {
    const { container, onFill } = await renderGrid();
    await focusCell(1, "value");
    const handle = handleOf();
    await act(async () => {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
    });
    pointAtRow(container, 3);
    await act(async () => {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10, clientY: 100 });
    });
    // A background reload drops the anchor row.
    await act(async () => {
      gridApi!.setGridOption("rowData", ROWS.filter((r) => r.id !== "b"));
    });
    await act(async () => {
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10, clientY: 100 });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onFill).not.toHaveBeenCalled();
    expect(previewedCells(container)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

describe("confirmation", () => {
  it("Cancel writes nothing", async () => {
    const { container, onFill } = await renderGrid();
    await focusCell(0, "value");
    await dragTo(container, 2);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onFill).not.toHaveBeenCalled();
  });

  it("Fill hands onFill the anchor value and the targets in display order", async () => {
    let seen: FillRequest<Row> | null = null;
    const onFill = vi.fn(async (request: FillRequest<Row>): Promise<FillOutcome> => {
      seen = request;
      return { succeeded: request.targets.length, failures: [] };
    });
    const { container } = await renderGrid({ onFill });
    await focusCell(0, "value");
    await dragTo(container, 3);
    await act(async () => {
      fireEvent.click(fillButton(3));
    });

    expect(onFill).toHaveBeenCalledTimes(1);
    const request = seen as unknown as FillRequest<Row>;
    expect(request.colId).toBe("value");
    expect(request.field).toBe("value");
    expect(request.value).toBe("one");
    expect(request.source.rowId).toBe("a");
    expect(request.targets.map((target) => target.rowId)).toEqual(["b", "c", "d"]);
  });

  it("closes on a clean fill", async () => {
    const onFill = vi.fn(async () => ({ succeeded: 3, failures: [] }));
    const { container } = await renderGrid({ onFill });
    await focusCell(0, "value");
    await dragTo(container, 3);
    await act(async () => {
      fireEvent.click(fillButton(3));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("stays open and lists the failures on a partial fill", async () => {
    const onFill = vi.fn(async () => ({
      succeeded: 1,
      failures: [
        { rowId: "c", label: "Gamma", message: "Name already taken", href: "/cards/c" },
        { rowId: "d", label: "Delta", message: "Would create a loop" },
      ],
    }));
    const { container } = await renderGrid({ onFill });
    await focusCell(0, "value");
    await dragTo(container, 3);
    await act(async () => {
      fireEvent.click(fillButton(3));
    });

    expect(await screen.findByText("1 updated, 2 failed.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Gamma" });
    expect(link.getAttribute("href")).toBe("/cards/c");
    expect(screen.getByText(/Would create a loop/)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("reports a thrown onFill instead of freezing the progress bar", async () => {
    const onFill = vi.fn(async () => {
      throw new Error("network down");
    });
    const { container } = await renderGrid({ onFill });
    await focusCell(0, "value");
    await dragTo(container, 2);
    await act(async () => {
      fireEvent.click(fillButton(2));
    });
    expect(await screen.findByText("0 updated, 2 failed.")).toBeTruthy();
    expect(screen.getAllByText(/network down/).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

describe("keyboard", () => {
  it("extends with the arrow keys and confirms with Enter", async () => {
    const { container, onFill } = await renderGrid();
    await focusCell(0, "value");
    const handle = handleOf();
    await act(async () => {
      fireEvent.keyDown(handle, { key: "ArrowDown" });
      fireEvent.keyDown(handle, { key: "ArrowDown" });
    });
    expect(previewedCells(container).sort()).toEqual(["1:value", "2:value"]);

    await act(async () => {
      fireEvent.keyDown(handle, { key: "Enter" });
    });
    expect(screen.getByText(/Copy this value into 2 rows/)).toBeTruthy();
    expect(onFill).not.toHaveBeenCalled();
  });

  it("cancels with Escape", async () => {
    const { container } = await renderGrid();
    await focusCell(0, "value");
    const handle = handleOf();
    await act(async () => {
      fireEvent.keyDown(handle, { key: "ArrowDown" });
      fireEvent.keyDown(handle, { key: "Escape" });
    });
    expect(previewedCells(container)).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
