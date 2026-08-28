/**
 * The row-selection checkboxes must stay at the far left of a grid whatever
 * the user freezes.
 *
 * The threat is AG Grid's own viewport guard: since v33 it auto-unpins columns
 * once the pinned region would leave the centre viewport under 50px, and
 * `getPinnedColumnsOverflowingViewport` walks the pinned columns from index 0
 * — where the 50px selection column always sits. So the checkboxes are the
 * first thing it sacrifices, and once relieved they scroll away with the
 * content instead of staying beside the rows they select.
 *
 * **That guard cannot be driven from jsdom.** It runs behind
 * `centerContainerCtrl.isViewportInTheDOMTree()`, which is `!!el.offsetParent`
 * — and jsdom implements no layout, so `offsetParent` is always null and the
 * guard never executes however the viewport is resized. A test that squeezes
 * the grid and asserts the checkboxes survived therefore passes without
 * exercising anything, which is worse than no test at all.
 *
 * So these tests pin the two things that actually decide the outcome, against
 * a real grid: the live selection column carries `pinned: "left"` (which puts
 * it ahead of the pinned region) *and* `lockPinned` (which is what makes
 * `getPinnedColumnsOverflowingViewport` skip it outright, before the
 * `processUnpinnedColumns` veto is even consulted). The visual behaviour on a
 * narrow viewport still needs a manual pass — see the PR checklist.
 */
import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import type { GridApi } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { keepSelectionColumnPinned } from "@/lib/agGridSetup";
import { useColumnFreeze } from "./useColumnFreeze";

interface Row {
  name: string;
  owner: string;
}

let api: GridApi<Row> | null = null;

function FreezableGrid() {
  const gridRef = useRef<AgGridReact<Row>>(null);
  const freeze = useColumnFreeze<Row>(gridRef);
  return (
    <div ref={freeze.containerRef} className="ag-theme-quartz" style={{ height: 400, width: 600 }}>
      <AgGridReact<Row>
        ref={gridRef}
        onGridReady={(e) => {
          api = e.api;
        }}
        rowData={[{ name: "NexaCore ERP", owner: "Ada" }]}
        rowSelection={{ mode: "multiRow", headerCheckbox: true }}
        selectionColumnDef={freeze.selectionColumnDef}
        columnDefs={[
          { field: "name", headerName: "Name", width: 300 },
          { field: "owner", headerName: "Owner", width: 300 },
        ]}
        defaultColDef={{
          sortable: true,
          filter: true,
          resizable: true,
          headerComponentParams: freeze.headerComponentParams,
        }}
      />
    </div>
  );
}

function selectionColumn() {
  const col = api
    ?.getAllGridColumns()
    ?.find((c) => c.getColId().startsWith("ag-Grid-SelectionColumn"));
  expect(col).toBeDefined();
  return col!;
}

async function freezeNameColumn(container: HTMLElement) {
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

describe("the row-selection column cannot lose its pin", () => {
  it("is locked as well as pinned, so the viewport guard has to skip it", async () => {
    const { container } = render(<FreezableGrid />);
    await waitFor(() => expect(api).not.toBeNull());

    const col = selectionColumn();
    expect(col.getPinned()).toBe("left");
    // The load-bearing half: AG Grid's `getPinnedColumnsOverflowingViewport`
    // does `if (colDef.lockPinned) { hasLockedPinned = true; continue; }`, so a
    // locked column is never added to the list it unpins.
    expect(col.getColDef().lockPinned).toBe(true);
    expect(container.querySelector(".ag-pinned-left-header")).not.toBeNull();
  });

  it("stays first in the pinned region once a data column is frozen", async () => {
    const { container } = render(<FreezableGrid />);
    await freezeNameColumn(container);

    const pinnedIds = [
      ...container.querySelectorAll(".ag-pinned-left-header .ag-header-cell"),
    ].map((el) => el.getAttribute("col-id"));

    expect(pinnedIds[0]).toContain("ag-Grid-SelectionColumn");
    expect(pinnedIds[1]).toBe("name");
    expect(selectionColumn().getPinned()).toBe("left");
  });

  it("is exempt from the global unpin veto as well", () => {
    // Belt and braces: `lockPinned` stops the guard reaching for it, and the
    // veto removes it from the list should a future AG Grid ever get past that.
    const selection = { getColId: () => "ag-Grid-SelectionColumn" };
    const dataColumn = { getColId: () => "core_name" };

    expect(keepSelectionColumnPinned({ columns: [selection, dataColumn] })).toEqual([dataColumn]);
  });
});
