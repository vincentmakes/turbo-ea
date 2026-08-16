/**
 * Contract test against the *real* AG Grid for the sticky group bar.
 *
 * The bar exists because AG Grid Community has no `groupRowsSticky` and its
 * rows are absolutely positioned, so it is an overlay that reads the scroll
 * offset and the grid's own row geometry. Both are things a mocked grid cannot
 * give us, which is why this drives a real one.
 *
 * jsdom has no layout, so `getVerticalPixelRange` is stubbed — everything else
 * (row tops, row ids, virtualisation) is AG Grid for real. Note that it
 * virtualises aggressively in a zero-height jsdom viewport, so a group's own
 * header row is usually NOT in the DOM: assertions target the bar itself,
 * which always renders immediately after the overlay's probe element.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { AgGridReact } from "ag-grid-react";
import type { GridApi } from "ag-grid-community";
import { useRowGrouping } from "./useRowGrouping";
import type { GroupAxis } from "./rowGrouping";

interface Row {
  id: string;
  name: string;
  tier?: string;
}

const AXIS: GroupAxis<Row> = {
  key: "tier",
  label: "Tier",
  // No colors: this is also the uncolored-axis case, so the bar has to fall
  // back to the categorical palette to render a pill at all.
  vocab: [
    { key: "gold", label: "GoldTier" },
    { key: "silver", label: "SilverTier" },
  ],
  groupKeyOf: (r) => r.tier,
};

const ROWS: Row[] = [
  ...Array.from({ length: 12 }, (_, i) => ({ id: `g${i}`, name: `Alpha ${i}`, tier: "gold" })),
  ...Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, name: `Beta ${i}`, tier: "silver" })),
];

function GroupedGrid({
  groupBy,
  onApi,
  selectable = true,
}: {
  groupBy: string | null;
  onApi: (a: GridApi) => void;
  selectable?: boolean;
}) {
  const gridRef = useRef<AgGridReact<Row>>(null);
  const grouping = useRowGrouping<Row>(gridRef, { rows: ROWS, axes: [AXIS], groupBy, selectable });
  return (
    <div
      className="ag-theme-quartz"
      // What `grouping.sx` contributes on the real pages.
      style={{ position: "relative", height: 400, width: 600 }}
    >
      <AgGridReact<Row>
        ref={gridRef}
        rowData={grouping.rowData}
        columnDefs={[{ field: "name", headerName: "Name" }]}
        rowSelection={selectable ? { mode: "multiRow", headerCheckbox: true } : undefined}
        getRowId={(p) => grouping.groupRowId(p.data)}
        onGridReady={(e) => onApi(e.api)}
        onFilterChanged={grouping.handleFilterChanged}
        onModelUpdated={grouping.handleModelUpdated}
        {...grouping.gridProps}
      />
      {grouping.stickyHeader}
    </div>
  );
}

async function renderGrid(groupBy: string | null, selectable = true) {
  let api: GridApi | null = null;
  const { container } = render(
    <GroupedGrid groupBy={groupBy} selectable={selectable} onApi={(a) => (api = a)} />,
  );
  await waitFor(() => expect(api).not.toBeNull());
  /** The bar, when one is showing — it follows the overlay's probe element. */
  const bar = () =>
    container.querySelector(".tea-group-sticky-probe")?.nextElementSibling ?? null;
  /** Pretend the user scrolled to `top` and let the overlay's frame run. */
  const scrollTo = (top: number) => {
    vi.spyOn(api as unknown as GridApi, "getVerticalPixelRange").mockReturnValue({
      top,
      bottom: top + 400,
    });
    // The overlay listens for resize as well as bodyScroll, and resize is the
    // one an outsider can fire.
    window.dispatchEvent(new Event("resize"));
  };
  return { container, bar, scrollTo, api: api as unknown as GridApi };
}

describe("sticky group header + AG Grid", () => {
  it("renders nothing at all when the grid is not grouped", async () => {
    const { container, scrollTo } = await renderGrid(null);
    scrollTo(99999);
    await waitFor(() =>
      expect(container.querySelector(".tea-group-sticky-probe")).not.toBeInTheDocument(),
    );
  });

  it("names the group the viewport is scrolled into", async () => {
    const { bar, scrollTo } = await renderGrid("tier");
    // Scrolled past every header, the last group owns the viewport top.
    scrollTo(99999);
    await waitFor(() => expect(bar()?.textContent).toContain("SilverTier"));
    // …and it names that group, not the one above it.
    expect(bar()?.textContent).not.toContain("GoldTier");
  });

  it("carries the group's member count, like the real header row", async () => {
    const { bar, scrollTo } = await renderGrid("tier");
    scrollTo(99999);
    await waitFor(() => expect(bar()?.textContent).toContain("SilverTier"));
    expect(bar()?.textContent).toContain("12");
  });

  it("hides the bar when the real header row is flush with the top", async () => {
    const { bar, scrollTo } = await renderGrid("tier");
    scrollTo(99999);
    await waitFor(() => expect(bar()).not.toBeNull());

    // Flush with the very top: the first group's own header is on screen, so a
    // bar would just duplicate a row already visible.
    scrollTo(0);
    await waitFor(() => expect(bar()).toBeNull());
  });

  it("carries the select-all tick box, so a deep group can be selected in place", async () => {
    const { bar, scrollTo, api } = await renderGrid("tier");
    scrollTo(99999);
    await waitFor(() => expect(bar()).not.toBeNull());

    const box = bar()?.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(box).not.toBeNull();
    expect(box!.checked).toBe(false);

    // Ticking it selects that whole group — the point of the header checkbox,
    // now reachable without scrolling back up to the real header.
    fireEvent.click(box!);
    await waitFor(() => expect(api.getSelectedNodes().length).toBe(12));
    expect(api.getSelectedNodes().every((n) => n.data?.tier === "silver")).toBe(true);
  });

  it("stays in the accessibility tree, since it holds a real control", async () => {
    const { bar, scrollTo } = await renderGrid("tier");
    scrollTo(99999);
    await waitFor(() => expect(bar()).not.toBeNull());
    // A focusable control inside aria-hidden is reachable by keyboard but
    // invisible to assistive tech — worse than the duplication it would avoid.
    expect(bar()?.getAttribute("aria-hidden")).toBeNull();
  });

  it("shows no checkbox on a grid that has no row selection", async () => {
    // The Risk Register passes `selectable: false` — there grouping is purely
    // a reading aid, and the bar must not offer a selection it cannot make.
    const { bar, scrollTo } = await renderGrid("tier", false);
    scrollTo(99999);
    await waitFor(() => expect(bar()?.textContent).toContain("SilverTier"));
    expect(bar()?.querySelector("input[type='checkbox']")).toBeNull();
  });
});
