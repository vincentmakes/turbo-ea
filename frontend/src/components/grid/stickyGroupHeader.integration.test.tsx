/**
 * Contract test against the *real* AG Grid for the sticky group bars.
 *
 * The bars exist because AG Grid Community has no `groupRowsSticky`. They are
 * portaled INTO the grid's own `.ag-full-width-container` — one absolute
 * wrapper per group spanning that group's rows, each holding a natively
 * `position: sticky` bar, so the browser compositor does the pinning,
 * hand-off, and rubber-band behaviour with no scroll listeners at all.
 *
 * jsdom has no layout and does not emulate sticky pinning, so these tests
 * assert the STRUCTURE the compositor consumes: the wrappers' offsets and
 * spans (straight from AG Grid's own row geometry, which it computes without
 * layout), the bar contents, and the controls. The pinning itself is
 * verified against real Chromium in development (see the harness referenced
 * in the hook's docblock history).
 */
import { describe, it, expect } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { AgGridReact } from "ag-grid-react";
import Box from "@mui/material/Box";
import type { GridApi } from "ag-grid-community";
import { gridThemeLight } from "@/lib/agGridSetup";
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
    // A Box carrying `grouping.sx`, exactly as the real pages wire it — the
    // sx is load-bearing (positioning context + hiding the real group rows).
    <Box sx={grouping.sx} style={{ height: 400, width: 600 }}>
      <AgGridReact<Row>
        theme={gridThemeLight}
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
    </Box>
  );
}

async function renderGrid(groupBy: string | null, selectable = true) {
  let api: GridApi | null = null;
  const { container, unmount } = render(
    <GroupedGrid groupBy={groupBy} selectable={selectable} onApi={(a) => (api = a)} />,
  );
  await waitFor(() => expect(api).not.toBeNull());
  const host = () => container.querySelector<HTMLElement>(".tea-group-sticky-host");
  const ranges = () =>
    Array.from(container.querySelectorAll<HTMLElement>(".tea-group-sticky-range"));
  const barFor = (label: string) =>
    ranges().find((r) => r.textContent?.includes(label))?.firstElementChild ?? null;
  return { container, unmount, host, ranges, barFor, api: api as unknown as GridApi };
}

describe("sticky group headers + AG Grid", () => {
  it("renders nothing at all when the grid is not grouped", async () => {
    const { container, ranges } = await renderGrid(null);
    expect(container.querySelector(".tea-group-sticky-probe")).not.toBeInTheDocument();
    expect(ranges()).toHaveLength(0);
  });

  it("portals one sticky range per group into the grid's full-width container", async () => {
    const { container, host, ranges } = await renderGrid("tier");
    await waitFor(() => expect(ranges()).toHaveLength(2));
    // Inside AG Grid's own full-width row layer — that is what puts the bars
    // in the scrolled content (compositor-pinned) AND inside the Theming API
    // variable scope.
    const h = host();
    expect(h).not.toBeNull();
    expect(h!.closest(".ag-full-width-container")).not.toBeNull();
    expect(container.querySelector(".ag-full-width-container")).toContainElement(h);
  });

  it("gives each range the group's own row geometry as its sticky bounds", async () => {
    const { ranges, api } = await renderGrid("tier");
    await waitFor(() => expect(ranges()).toHaveLength(2));

    // The grid's row model is the source of truth for where the group headers
    // sit and how far their groups extend.
    const headerTops: Record<string, { top: number; height: number }> = {};
    let contentEnd = 0;
    api.forEachNode((n) => {
      const g = (n.data as { __group?: { key: string } } | undefined)?.__group;
      if (g && n.rowTop != null) headerTops[g.key] = { top: n.rowTop, height: n.rowHeight ?? 0 };
      if (n.rowTop != null) contentEnd = Math.max(contentEnd, n.rowTop + (n.rowHeight ?? 0));
    });

    const [gold, silver] = ranges();
    expect(gold.style.top).toBe(`${headerTops.gold.top}px`);
    expect(silver.style.top).toBe(`${headerTops.silver.top}px`);
    // Each wrapper spans exactly to the next group (or the content end): that
    // bound is what makes the next group push the pinned bar out natively.
    expect(gold.style.height).toBe(`${headerTops.silver.top - headerTops.gold.top}px`);
    expect(silver.style.height).toBe(`${contentEnd - headerTops.silver.top}px`);
    // And the bar inside pins with native sticky at the group's row height.
    const bar = gold.firstElementChild as HTMLElement;
    expect(bar.style.position).toBe("sticky");
    expect(bar.style.top).toBe("0px");
    expect(bar.style.height).toBe(`${headerTops.gold.height}px`);
  });

  it("names each group and carries its member count, like the real header row", async () => {
    const { barFor, ranges } = await renderGrid("tier");
    await waitFor(() => expect(ranges()).toHaveLength(2));
    await waitFor(() => expect(barFor("SilverTier")?.textContent).toContain("12"));
    expect(barFor("GoldTier")?.textContent).toContain("12");
    expect(barFor("GoldTier")?.textContent).not.toContain("SilverTier");
  });

  it("carries the select-all tick box, so a deep group can be selected in place", async () => {
    const { barFor, ranges, api } = await renderGrid("tier");
    await waitFor(() => expect(ranges()).toHaveLength(2));

    const box = barFor("SilverTier")?.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(box).not.toBeNull();
    expect(box!.checked).toBe(false);

    // Ticking it selects that whole group — the point of the header checkbox,
    // now reachable without scrolling back up to the real header.
    fireEvent.click(box!);
    await waitFor(() => expect(api.getSelectedNodes().length).toBe(12));
    expect(api.getSelectedNodes().every((n) => n.data?.tier === "silver")).toBe(true);
  });

  it("stays in the accessibility tree, since it holds a real control", async () => {
    const { barFor, ranges } = await renderGrid("tier");
    await waitFor(() => expect(ranges()).toHaveLength(2));
    // A focusable control inside aria-hidden is reachable by keyboard but
    // invisible to assistive tech — worse than the duplication it would avoid
    // (the real header row is often virtualised out of the DOM entirely).
    const bar = barFor("SilverTier");
    expect(bar?.getAttribute("aria-hidden")).toBeNull();
    expect(bar?.closest("[aria-hidden='true']")).toBeNull();
  });

  it("shows no checkbox on a grid that has no row selection", async () => {
    // The Risk Register passes `selectable: false` — there grouping is purely
    // a reading aid, and the bar must not offer a selection it cannot make.
    const { barFor, ranges } = await renderGrid("tier", false);
    await waitFor(() => expect(ranges()).toHaveLength(2));
    expect(barFor("SilverTier")?.querySelector("input[type='checkbox']")).toBeNull();
  });

  it("hides the real group header rows while bars render — no duplicate is possible", async () => {
    // WebKit repositions non-composited sticky elements a beat late on
    // scroll direction changes; with the real rows visible, that lag showed
    // the header twice for a few px. The wrapper hides `.ag-full-width-row`
    // whenever bar wrappers exist (and only then — autoHeight grids render
    // no bars and keep their rows), restoring them for print. jsdom has no
    // stylesheet cascade, so assert the emitted emotion CSS carries the rule.
    const { container, ranges } = await renderGrid("tier");
    await waitFor(() => expect(ranges()).toHaveLength(2));

    const wrapper = container.firstElementChild as HTMLElement;
    const emotionClasses = Array.from(wrapper.classList).filter((c) => c.startsWith("css-"));
    expect(emotionClasses.length).toBeGreaterThan(0);
    const css = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .join("\n");
    const flat = css.replace(/\s+/g, "");
    const hasRule = emotionClasses.some((c) =>
      flat.includes(`.${c}:has(.tea-group-sticky-range).ag-full-width-row{visibility:hidden`),
    );
    expect(hasRule).toBe(true);
  });

  it("removes its host from the grid DOM on unmount", async () => {
    const { host, ranges, unmount } = await renderGrid("tier");
    await waitFor(() => expect(ranges()).toHaveLength(2));
    expect(host()).not.toBeNull();
    unmount();
    expect(document.querySelector(".tea-group-sticky-host")).toBeNull();
  });
});
