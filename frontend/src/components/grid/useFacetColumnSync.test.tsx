/**
 * Facet mirroring against the *real* AG Grid, driven through the cell
 * context menu exactly as the pages wire it: right-click a cell, click
 * "Show matching", then assert on BOTH the grid's filter model and the
 * page's facet state — and on what a subsequent panel edit does to them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within, act } from "@testing-library/react";
import { useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { GridApi } from "ag-grid-community";
import { useCellContextMenu } from "./useCellContextMenu";
import { useFacetColumnSync } from "./useFacetColumnSync";
import type { FacetBinding } from "./facetColumnSync";

interface Row {
  name: string;
  status: string;
}

const ROWS: Row[] = [
  { name: "Alpha", status: "BROKEN" },
  { name: "Beta", status: "APPROVED" },
  { name: "Gamma", status: "BROKEN" },
];

let gridApi: GridApi<Row> | null = null;
/** The page's facet state, exposed so tests can read/drive it. */
let facets: { statuses: string[] } = { statuses: [] };
let setFacets: (next: { statuses: string[] }) => void = () => {};
let resetRegistry: () => void = () => {};

function TestGrid({ columnFilter = true }: { columnFilter?: boolean }) {
  const gridRef = useRef<AgGridReact<Row>>(null);
  const [filters, setFilters] = useState<{ statuses: string[] }>({ statuses: [] });
  facets = filters;
  setFacets = setFilters;

  const bindings = useMemo<Record<string, FacetBinding<Row>>>(
    () => ({
      status: {
        toFacetValue: (ctx) => (ctx.filterValue ? String(ctx.filterValue) : null),
        getValues: () => filters.statuses,
        setValues: (values) => setFilters({ statuses: values }),
        columnFilter,
      },
    }),
    [filters, columnFilter],
  );

  const facetSync = useFacetColumnSync<Row>(gridRef, { bindings, facetState: filters });
  resetRegistry = facetSync.resetRegistry;

  const cellMenu = useCellContextMenu<Row>(gridRef, {
    // Mirrors the server-side-grid case when columnFilter is false.
    enableFilterItems: columnFilter,
    facetSync: facetSync.cellMenu,
  });

  // Rows narrowed by the facet, as a page's own memo would do.
  const rowData = useMemo(
    () =>
      filters.statuses.length
        ? ROWS.filter((r) => filters.statuses.includes(r.status))
        : ROWS,
    [filters],
  );

  return (
    <div>
      <div {...cellMenu.containerProps} className="ag-theme-quartz" style={{ height: 400, width: 700 }}>
        <AgGridReact<Row>
          ref={gridRef}
          rowData={rowData}
          onGridReady={(e) => {
            gridApi = e.api;
          }}
          columnDefs={[{ field: "name" }, { field: "status" }]}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          {...cellMenu.gridProps}
        />
      </div>
      {cellMenu.menu}
    </div>
  );
}

async function renderGrid(props: { columnFilter?: boolean } = {}) {
  const utils = render(<TestGrid {...props} />);
  await waitFor(() =>
    expect(utils.container.querySelector('.ag-cell[col-id="status"]')).not.toBeNull(),
  );
  return utils;
}

function cellOf(container: HTMLElement, colId: string, rowIndex = 0): HTMLElement {
  const cell = container
    .querySelector(`.ag-row[row-index="${rowIndex}"]`)
    ?.querySelector(`.ag-cell[col-id="${colId}"]`);
  expect(cell).not.toBeNull();
  return cell as HTMLElement;
}

async function showMatching(container: HTMLElement, colId: string, rowIndex = 0) {
  fireEvent.contextMenu(cellOf(container, colId, rowIndex));
  fireEvent.click(within(await screen.findByRole("menu")).getByText("Show matching"));
}

beforeEach(() => {
  gridApi = null;
  facets = { statuses: [] };
});

describe("facet mirroring — Show matching", () => {
  it("sets the facet AND writes the column filter", async () => {
    const { container } = await renderGrid();
    await showMatching(container, "status");

    await waitFor(() => expect(facets.statuses).toEqual(["BROKEN"]));
    expect(gridApi!.getFilterModel()).toEqual({
      status: { filterType: "text", type: "equals", filter: "BROKEN" },
    });
  });

  it("falls back to a plain column filter on an unbound column", async () => {
    const { container } = await renderGrid();
    await showMatching(container, "name");

    await waitFor(() =>
      expect(gridApi!.getFilterModel()).toEqual({
        name: { filterType: "text", type: "equals", filter: "Alpha" },
      }),
    );
    expect(facets.statuses).toEqual([]);
  });

  it("writes no column filter for a facet-only binding, and still offers the item", async () => {
    const { container } = await renderGrid({ columnFilter: false });

    fireEvent.contextMenu(cellOf(container, "status"));
    const menu = await screen.findByRole("menu");
    // enableFilterItems is false, so only the mirrored Show matching shows.
    expect(within(menu).getByText("Show matching")).toBeInTheDocument();
    expect(within(menu).queryByText("Filter out")).toBeNull();

    fireEvent.click(within(menu).getByText("Show matching"));
    await waitFor(() => expect(facets.statuses).toEqual(["BROKEN"]));
    expect(gridApi!.getFilterModel()).toEqual({});
  });
});

describe("facet mirroring — panel edits win", () => {
  it("drops the mirrored column filter when the facet gains another value", async () => {
    const { container } = await renderGrid();
    await showMatching(container, "status");
    await waitFor(() => expect(gridApi!.getFilterModel().status).toBeDefined());

    act(() => setFacets({ statuses: ["BROKEN", "APPROVED"] }));

    await waitFor(() => expect(gridApi!.getFilterModel()).toEqual({}));
    expect(facets.statuses).toEqual(["BROKEN", "APPROVED"]);
  });

  it("drops the mirrored column filter when the facet is cleared", async () => {
    const { container } = await renderGrid();
    await showMatching(container, "status");
    await waitFor(() => expect(gridApi!.getFilterModel().status).toBeDefined());

    act(() => setFacets({ statuses: [] }));

    await waitFor(() => expect(gridApi!.getFilterModel()).toEqual({}));
  });

  it("leaves other columns' filters untouched when pruning", async () => {
    const { container } = await renderGrid();
    await showMatching(container, "status");
    await showMatching(container, "name");
    await waitFor(() => expect(Object.keys(gridApi!.getFilterModel())).toHaveLength(2));

    act(() => setFacets({ statuses: [] }));

    await waitFor(() =>
      expect(gridApi!.getFilterModel()).toEqual({
        name: { filterType: "text", type: "equals", filter: "Alpha" },
      }),
    );
  });

  it("never destroys a filter the user re-authored through the column popup", async () => {
    const { container } = await renderGrid();
    await showMatching(container, "status");
    await waitFor(() => expect(gridApi!.getFilterModel().status).toBeDefined());

    // Simulate editing that column's filter in the header popup.
    const popupModel = { filterType: "text", type: "contains", filter: "BRO" };
    act(() => {
      gridApi!.setFilterModel({ status: popupModel });
    });
    // The facet then changes — the popup-authored filter must survive.
    act(() => setFacets({ statuses: [] }));

    await waitFor(() => expect(facets.statuses).toEqual([]));
    expect(gridApi!.getFilterModel()).toEqual({ status: popupModel });
  });

  it("resetRegistry forgets provenance so a later facet edit prunes nothing", async () => {
    const { container } = await renderGrid();
    await showMatching(container, "status");
    await waitFor(() => expect(gridApi!.getFilterModel().status).toBeDefined());

    act(() => resetRegistry());
    act(() => setFacets({ statuses: ["APPROVED"] }));

    await waitFor(() => expect(facets.statuses).toEqual(["APPROVED"]));
    // The model survives — this is the saved-view-apply guarantee.
    expect(gridApi!.getFilterModel()).toEqual({
      status: { filterType: "text", type: "equals", filter: "BROKEN" },
    });
  });
});

describe("facet mirroring — Clear", () => {
  it("clears both the facet and the column filter", async () => {
    const { container } = await renderGrid();
    await showMatching(container, "status");
    await waitFor(() => expect(facets.statuses).toEqual(["BROKEN"]));

    fireEvent.contextMenu(cellOf(container, "status"));
    fireEvent.click(within(await screen.findByRole("menu")).getByText("Clear column filter"));

    await waitFor(() => expect(facets.statuses).toEqual([]));
    expect(gridApi!.getFilterModel()).toEqual({});
  });

  it("offers a neutral 'Clear filter' label and clears the facet on facet-only bindings", async () => {
    const { container } = await renderGrid({ columnFilter: false });
    await showMatching(container, "status");
    await waitFor(() => expect(facets.statuses).toEqual(["BROKEN"]));

    fireEvent.contextMenu(cellOf(container, "status"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText("Clear column filter")).toBeNull();
    fireEvent.click(within(menu).getByText("Clear filter"));

    await waitFor(() => expect(facets.statuses).toEqual([]));
  });

  it("is hidden while neither a facet nor a column filter is active", async () => {
    const { container } = await renderGrid();
    fireEvent.contextMenu(cellOf(container, "status"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText("Clear column filter")).toBeNull();
    expect(within(menu).queryByText("Clear filter")).toBeNull();
  });
});

describe("facet mirroring — never applied to exclusions", () => {
  it("Filter out writes a plain notEqual and leaves the facet alone", async () => {
    const { container } = await renderGrid();
    fireEvent.contextMenu(cellOf(container, "status"));
    fireEvent.click(within(await screen.findByRole("menu")).getByText("Filter out"));

    await waitFor(() =>
      expect(gridApi!.getFilterModel()).toEqual({
        status: { filterType: "text", type: "notEqual", filter: "BROKEN" },
      }),
    );
    expect(facets.statuses).toEqual([]);
  });
});
