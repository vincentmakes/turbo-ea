/**
 * Contract tests against the *real* AG Grid: right-click / long-press a cell
 * and drive the resulting menu, then assert on the grid's actual filter model
 * and displayed rows — the same wiring every page uses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { useRef } from "react";
import { AgGridReact } from "ag-grid-react";
import type { GridApi } from "ag-grid-community";
import { dateColumnFilterDef } from "@/lib/dateColumnFilter";
import { useCellContextMenu, LONG_PRESS_MS } from "./useCellContextMenu";
import type { UseCellContextMenuOptions } from "./useCellContextMenu";

interface Row {
  name: string;
  count: number | null;
  created: string;
  tags: string;
  actions?: string;
}

const ROWS: Row[] = [
  { name: "Alpha", count: 3, created: "2026-01-15", tags: "One; Two" },
  { name: "Beta", count: null, created: "2026-02-20", tags: "Two" },
  { name: "Gamma", count: 7, created: "2026-03-25", tags: "" },
];

let gridApi: GridApi<Row> | null = null;
const onRowClicked = vi.fn();

function TestGrid(props: { options?: UseCellContextMenuOptions<Row> }) {
  const gridRef = useRef<AgGridReact<Row>>(null);
  const cellMenu = useCellContextMenu<Row>(gridRef, props.options);
  return (
    <div>
      <div
        {...cellMenu.containerProps}
        className="ag-theme-quartz"
        style={{ height: 400, width: 800 }}
      >
        <AgGridReact<Row>
          ref={gridRef}
          rowData={ROWS}
          onGridReady={(e) => {
            gridApi = e.api;
          }}
          onRowClicked={onRowClicked}
          columnDefs={[
            { field: "name" },
            { field: "count", filter: "agNumberColumnFilter" },
            { field: "created", ...dateColumnFilterDef },
            { field: "tags" },
            { field: "actions", filter: false },
          ]}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          {...cellMenu.gridProps}
        />
      </div>
      {cellMenu.menu}
    </div>
  );
}

async function renderGrid(options?: UseCellContextMenuOptions<Row>) {
  const utils = render(<TestGrid options={options} />);
  await waitFor(() => {
    expect(utils.container.querySelector('.ag-cell[col-id="name"]')).not.toBeNull();
  });
  return utils;
}

function cellOf(container: HTMLElement, colId: string, rowIndex = 0): HTMLElement {
  const row = container.querySelector(`.ag-row[row-index="${rowIndex}"]`);
  const cell = row?.querySelector(`.ag-cell[col-id="${colId}"]`);
  expect(cell).not.toBeNull();
  return cell as HTMLElement;
}

/** The open context menu (MUI portals it to document.body). */
async function findMenu(): Promise<HTMLElement> {
  return await screen.findByRole("menu");
}

async function closeMenu(): Promise<void> {
  fireEvent.keyDown(await findMenu(), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
}

/**
 * jsdom has no PointerEvent constructor — build a MouseEvent with the pointer
 * type stamped on as an expando, which React's synthetic event passes through.
 */
function firePointer(
  el: HTMLElement,
  type: "pointerdown" | "pointermove",
  init: { pointerType: string; clientX: number; clientY: number },
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
  });
  Object.assign(event, { pointerType: init.pointerType });
  fireEvent(el, event);
}

beforeEach(() => {
  gridApi = null;
  onRowClicked.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCellContextMenu — right-click", () => {
  it("opens the menu with filter + copy items and applies an equals filter", async () => {
    const { container } = await renderGrid();
    fireEvent.contextMenu(cellOf(container, "name"));

    expect(await screen.findByText("Show matching")).toBeInTheDocument();
    expect(screen.getByText("Filter out")).toBeInTheDocument();
    expect(screen.getByText("Copy value")).toBeInTheDocument();
    // No active filter on the column yet.
    expect(screen.queryByText("Clear column filter")).toBeNull();

    fireEvent.click(screen.getByText("Show matching"));
    await waitFor(() => {
      expect(gridApi!.getFilterModel()).toEqual({
        name: { filterType: "text", type: "equals", filter: "Alpha" },
      });
    });
    await waitFor(() => expect(gridApi!.getDisplayedRowCount()).toBe(1));
  });

  it("merges into the existing filter model instead of replacing it", async () => {
    const { container } = await renderGrid();
    gridApi!.setFilterModel({ count: { filterType: "number", type: "equals", filter: 3 } });

    fireEvent.contextMenu(cellOf(container, "name"));
    fireEvent.click(await screen.findByText("Show matching"));

    await waitFor(() => {
      expect(gridApi!.getFilterModel()).toEqual({
        count: { filterType: "number", type: "equals", filter: 3 },
        name: { filterType: "text", type: "equals", filter: "Alpha" },
      });
    });
  });

  it("applies notEqual for Filter out", async () => {
    const { container } = await renderGrid();
    fireEvent.contextMenu(cellOf(container, "name"));
    fireEvent.click(await screen.findByText("Filter out"));

    await waitFor(() => {
      expect(gridApi!.getFilterModel()).toEqual({
        name: { filterType: "text", type: "notEqual", filter: "Alpha" },
      });
    });
    await waitFor(() => expect(gridApi!.getDisplayedRowCount()).toBe(2));
  });

  it("builds number and date filter model shapes from typed columns", async () => {
    const { container } = await renderGrid();
    fireEvent.contextMenu(cellOf(container, "count"));
    fireEvent.click(await screen.findByText("Show matching"));
    await waitFor(() => {
      expect(gridApi!.getFilterModel().count).toEqual({
        filterType: "number",
        type: "equals",
        filter: 3,
      });
    });

    fireEvent.contextMenu(cellOf(container, "created"));
    fireEvent.click(await screen.findByText("Show matching"));
    await waitFor(() => {
      expect(gridApi!.getFilterModel().created).toMatchObject({
        filterType: "date",
        type: "equals",
        dateFrom: "2026-01-15 00:00:00",
      });
    });
    // The date filter actually narrows the rows (custom comparator engaged).
    await waitFor(() => expect(gridApi!.getDisplayedRowCount()).toBe(1));
  });

  it("maps a blank cell to a blank filter", async () => {
    const { container } = await renderGrid();
    fireEvent.contextMenu(cellOf(container, "count", 1)); // Beta's count is null
    fireEvent.click(await screen.findByText("Show matching"));
    await waitFor(() => {
      expect(gridApi!.getFilterModel().count).toEqual({ filterType: "number", type: "blank" });
    });
  });

  it("shows Clear column filter only for a filtered column, and removes just that entry", async () => {
    const { container } = await renderGrid();
    gridApi!.setFilterModel({
      name: { filterType: "text", type: "equals", filter: "Alpha" },
      count: { filterType: "number", type: "equals", filter: 3 },
    });

    fireEvent.contextMenu(cellOf(container, "name"));
    fireEvent.click(await screen.findByText("Clear column filter"));

    await waitFor(() => {
      expect(gridApi!.getFilterModel()).toEqual({
        count: { filterType: "number", type: "equals", filter: 3 },
      });
    });
  });

  it("offers no filter items on a filterless column, and no menu on excluded columns or rows", async () => {
    const { container } = await renderGrid({
      excludeColumns: (colId) => colId === "tags",
      suppressForRow: (data) => data.name === "Beta",
    });

    // `filter: false` column → Copy only.
    fireEvent.contextMenu(cellOf(container, "actions"));
    const menu = await findMenu();
    expect(within(menu).getByText("Copy value")).toBeInTheDocument();
    expect(within(menu).queryByText("Show matching")).toBeNull();
    await closeMenu();

    // Excluded column → nothing.
    fireEvent.contextMenu(cellOf(container, "tags"));
    expect(screen.queryByRole("menu")).toBeNull();

    // Suppressed row → nothing.
    fireEvent.contextMenu(cellOf(container, "name", 1));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("suppresses the menu entirely while disabled()", async () => {
    const { container } = await renderGrid({ disabled: () => true });
    fireEvent.contextMenu(cellOf(container, "name"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers Copy only when filter items are disabled (server-side grids)", async () => {
    const { container } = await renderGrid({ enableFilterItems: false });
    fireEvent.contextMenu(cellOf(container, "name"));
    const menu = await findMenu();
    expect(within(menu).getByText("Copy value")).toBeInTheDocument();
    expect(within(menu).queryByText("Show matching")).toBeNull();
    expect(within(menu).queryByText("Filter out")).toBeNull();
  });

  it("renders extraItems above the filter items", async () => {
    const { container } = await renderGrid({
      extraItems: (ctx, close) => [
        <li key="x" role="menuitem" onClick={close} data-testid="extra-item">
          Open {ctx.data.name}
        </li>,
      ],
    });
    fireEvent.contextMenu(cellOf(container, "name"));
    expect(await screen.findByTestId("extra-item")).toHaveTextContent("Open Alpha");
    expect(screen.getByText("Show matching")).toBeInTheDocument();
  });

  it("copies the display value to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const { container } = await renderGrid();
    fireEvent.contextMenu(cellOf(container, "name"));
    fireEvent.click(await screen.findByText("Copy value"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Alpha"));
    expect(await screen.findByText("Value copied to clipboard")).toBeInTheDocument();
  });
});

describe("useCellContextMenu — multi-valued cells", () => {
  const options: UseCellContextMenuOptions<Row> = {
    splitValues: (ctx) =>
      ctx.colId === "tags" && ctx.displayValue !== ""
        ? ctx.displayValue
            .split("; ")
            .filter(Boolean)
            .map((v) => ({ label: v, filter: v }))
        : null,
  };

  it("filters one value with contains via the second stage", async () => {
    const { container } = await renderGrid(options);
    fireEvent.contextMenu(cellOf(container, "tags")); // "One; Two"
    fireEvent.click(await screen.findByText("Show matching"));

    // Second stage: one item per value + Entire cell. Scope the query to the
    // menu — the grid itself also displays the value text.
    fireEvent.click(within(await findMenu()).getByText("Two"));
    await waitFor(() => {
      expect(gridApi!.getFilterModel().tags).toEqual({
        filterType: "text",
        type: "contains",
        filter: "Two",
      });
    });
    // "Two" appears in both Alpha's and Beta's tags.
    await waitFor(() => expect(gridApi!.getDisplayedRowCount()).toBe(2));
  });

  it("filters the whole joined value via Entire cell", async () => {
    const { container } = await renderGrid(options);
    fireEvent.contextMenu(cellOf(container, "tags"));
    fireEvent.click(await screen.findByText("Filter out"));

    fireEvent.click(await screen.findByText("Entire cell"));
    await waitFor(() => {
      expect(gridApi!.getFilterModel().tags).toEqual({
        filterType: "text",
        type: "notEqual",
        filter: "One; Two",
      });
    });
  });

  it("skips the second stage for a single-valued cell and uses contains", async () => {
    const { container } = await renderGrid(options);
    fireEvent.contextMenu(cellOf(container, "tags", 1)); // Beta: "Two"
    fireEvent.click(await screen.findByText("Show matching"));
    await waitFor(() => {
      expect(gridApi!.getFilterModel().tags).toEqual({
        filterType: "text",
        type: "contains",
        filter: "Two",
      });
    });
  });
});

describe("useCellContextMenu — long-press", () => {
  it("opens the menu after the press delay and swallows the follow-up click", async () => {
    const { container } = await renderGrid();
    const cell = cellOf(container, "name");

    vi.useFakeTimers();
    firePointer(cell, "pointerdown", { pointerType: "touch", clientX: 40, clientY: 60 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    vi.useRealTimers();

    const menu = await findMenu();
    expect(within(menu).getByText("Show matching")).toBeInTheDocument();

    // The click browsers synthesize on finger-lift must not reach the grid's
    // row handlers or close the menu.
    fireEvent.click(cell);
    expect(onRowClicked).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("does not fire when the finger moves (scrolling)", async () => {
    const { container } = await renderGrid();
    const cell = cellOf(container, "name");

    vi.useFakeTimers();
    firePointer(cell, "pointerdown", { pointerType: "touch", clientX: 40, clientY: 60 });
    firePointer(cell, "pointermove", { pointerType: "touch", clientX: 40, clientY: 90 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    });
    vi.useRealTimers();

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("ignores mouse pointer-downs", async () => {
    const { container } = await renderGrid();
    const cell = cellOf(container, "name");

    vi.useFakeTimers();
    firePointer(cell, "pointerdown", { pointerType: "mouse", clientX: 40, clientY: 60 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    });
    vi.useRealTimers();

    expect(screen.queryByRole("menu")).toBeNull();
  });
});
