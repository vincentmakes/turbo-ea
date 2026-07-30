/**
 * Contract test against the *real* AG Grid: the freeze template is fed to the
 * stock header component, so it has to keep rendering the label, the sort
 * indicator and the filter button while adding our two pins. If an AG Grid
 * upgrade changes the header's internals, this is what catches it.
 */
import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { AgGridReact } from "ag-grid-react";
import { buildFreezeHeaderTemplate, useColumnFreeze } from "./useColumnFreeze";

interface Row {
  name: string;
}

/** A grid wired exactly the way the pages wire it. */
function FreezableGrid() {
  const gridRef = useRef<AgGridReact<Row>>(null);
  const freeze = useColumnFreeze<Row>(gridRef);
  return (
    <div
      ref={freeze.containerRef}
      className="ag-theme-quartz"
      style={{ height: 400, width: 600 }}
    >
      <AgGridReact<Row>
        ref={gridRef}
        rowData={[{ name: "NexaCore ERP" }]}
        rowSelection={{ mode: "multiRow", headerCheckbox: true }}
        selectionColumnDef={freeze.selectionColumnDef}
        columnDefs={[
          { field: "name", headerName: "Name" },
          { field: "owner", headerName: "Owner" },
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

describe("freeze header template + AG Grid", () => {
  it("renders the stock header plus both pins", async () => {
    const { container } = render(
      <div className="ag-theme-quartz" style={{ height: 400, width: 600 }}>
        <AgGridReact<Row>
          rowData={[{ name: "NexaCore ERP" }]}
          columnDefs={[{ field: "name", headerName: "Name" }]}
          defaultColDef={{
            sortable: true,
            filter: true,
            resizable: true,
            headerComponentParams: {
              template: buildFreezeHeaderTemplate("Freeze column", "Unfreeze column"),
            },
          }}
        />
      </div>,
    );

    const header = await waitFor(() => {
      const el = container.querySelector('.ag-header-cell[col-id="name"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // The stock header still works: label text and the sort indicator.
    expect(header.querySelector(".ag-header-cell-text")?.textContent).toBe("Name");
    expect(header.querySelector(".ag-sort-indicator-container")).not.toBeNull();

    // …and our two pins are there, with translated tooltips.
    const pins = header.querySelectorAll(".tea-freeze");
    expect(pins).toHaveLength(2);
    expect(header.querySelector(".tea-freeze-do")?.getAttribute("title")).toBe("Freeze column");
    expect(header.querySelector(".tea-freeze-undo")?.getAttribute("title")).toBe(
      "Unfreeze column",
    );
  });

  it("leaves the auto-generated selection column alone", async () => {
    const { container } = render(<FreezableGrid />);

    await waitFor(() =>
      expect(container.querySelector('.ag-header-cell[col-id="name"]')).not.toBeNull(),
    );
    const selectionHeader = container.querySelector(
      '.ag-header-cell[col-id^="ag-Grid-ControlsColumn"]',
    );
    expect(selectionHeader).not.toBeNull();
    expect(selectionHeader!.querySelector(".tea-freeze")).toBeNull();
  });

  it("clicking the pin moves the column into the pinned region without sorting it", async () => {
    const { container } = render(<FreezableGrid />);

    const header = await waitFor(() => {
      const el = container.querySelector('.ag-header-cell[col-id="name"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    const pin = header.querySelector(".tea-freeze-do") as HTMLElement;
    pin.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    pin.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    const pinnedHeader = await waitFor(() => {
      const el = container.querySelector('.ag-pinned-left-header [col-id="name"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    // The click was swallowed before AG Grid's own header handler saw it.
    expect(pinnedHeader.classList.contains("ag-header-cell-sorted-asc")).toBe(false);

    // And clicking again releases it back into the scrolling region.
    const unpin = pinnedHeader.querySelector(".tea-freeze-undo") as HTMLElement;
    unpin.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    unpin.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() =>
      expect(container.querySelector('.ag-pinned-left-header [col-id="name"]')).toBeNull(),
    );
  });

  it("keeps the row-selection checkboxes ahead of a frozen column", async () => {
    const { container } = render(<FreezableGrid />);

    const header = await waitFor(() => {
      const el = container.querySelector('.ag-header-cell[col-id="name"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // The selection column is pinned from the start, so it is already the
    // only thing in the pinned region.
    const pinnedIds = () =>
      [...container.querySelectorAll(".ag-pinned-left-header .ag-header-cell")].map((el) =>
        el.getAttribute("col-id"),
      );
    expect(pinnedIds()).toEqual([expect.stringContaining("ag-Grid-ControlsColumn")]);

    const pin = header.querySelector(".tea-freeze-do") as HTMLElement;
    pin.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    pin.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // Freezing a column must not push the checkboxes to its right.
    await waitFor(() => expect(pinnedIds()).toHaveLength(2));
    expect(pinnedIds()[0]).toContain("ag-Grid-ControlsColumn");
    expect(pinnedIds()[1]).toBe("name");
  });
});
