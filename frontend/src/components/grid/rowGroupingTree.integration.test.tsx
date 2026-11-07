/**
 * Contract test against the *real* AG Grid for the grouping tree layer
 * ("Parent" in the Group by menu): the sort keeps children under their
 * parent, an axis keeps each forest under its group header, a column filter
 * that hides a parent re-roots its children AND repaints their cells (AG Grid
 * does not re-render a row whose object is unchanged, so the hook has to force
 * it), and collapsing a parent removes its branch from the displayed rows.
 */
import { describe, it, expect } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { useMemo, useRef } from "react";
import { AgGridReact } from "ag-grid-react";
import Box from "@mui/material/Box";
import type { GridApi } from "ag-grid-community";
import { gridThemeLight } from "@/lib/agGridSetup";
import { useRowGrouping, type GroupRowContext } from "./useRowGrouping";
import type { GroupAxis, GroupedRow, TreeAccess } from "./rowGrouping";

interface Row {
  id: string;
  name: string;
  parent: string | null;
  tier: string;
}

// Names a flat sort would interleave: Alpha child, Bravo parent, Charlie
// child, Delta parent, Echo child.
const ROWS: Row[] = [
  { id: "p1", name: "Bravo", parent: null, tier: "gold" },
  { id: "c1", name: "Alpha", parent: "p1", tier: "gold" },
  { id: "c2", name: "Echo", parent: "p1", tier: "gold" },
  { id: "p2", name: "Delta", parent: null, tier: "silver" },
  { id: "c3", name: "Charlie", parent: "p2", tier: "silver" },
];

const AXIS: GroupAxis<Row> = {
  key: "tier",
  label: "Tier",
  vocab: [
    { key: "gold", label: "Gold" },
    { key: "silver", label: "Silver" },
  ],
  groupKeyOf: (r) => r.tier,
};

function DepthCell(p: { data?: GroupedRow<Row>; value: string; context?: GroupRowContext }) {
  const ti = p.data ? p.context?.getTreeInfo?.(p.data.id) : undefined;
  const mark = ti ? `${ti.depth}${ti.collapsed ? "+" : ""}` : "-";
  return <span data-testid={`cell-${p.data?.id}`}>{`${mark}:${p.value}`}</span>;
}

function TreeGrid({ groupBy, onApi }: { groupBy: string | null; onApi: (a: GridApi) => void }) {
  const gridRef = useRef<AgGridReact<Row>>(null);
  const tree = useMemo<TreeAccess<Row> & { refreshColumns: string[] }>(() => {
    const byId = new Map(ROWS.map((r) => [r.id, r]));
    return {
      parentIdOf: (r) => r.parent,
      lookup: (id) => {
        const r = byId.get(id);
        return r ? { name: r.name, parentId: r.parent } : undefined;
      },
      refreshColumns: ["name"],
    };
  }, []);
  const grouping = useRowGrouping<Row>(gridRef, { rows: ROWS, axes: [AXIS], groupBy, tree });
  return (
    <Box sx={grouping.sx} style={{ height: 400, width: 600 }}>
      <AgGridReact<Row>
        theme={gridThemeLight}
        ref={gridRef}
        rowData={grouping.rowData}
        columnDefs={[
          { field: "name", colId: "name", headerName: "Name", filter: true, cellRenderer: DepthCell },
        ]}
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

async function renderGrid(groupBy: string | null) {
  let api: GridApi | null = null;
  const view = render(<TreeGrid groupBy={groupBy} onApi={(a) => (api = a)} />);
  await waitFor(() => expect(api).not.toBeNull());
  return { ...view, api: api as unknown as GridApi };
}

function displayed(api: GridApi): string[] {
  const out: string[] = [];
  api.forEachNodeAfterFilterAndSort((n) => {
    const d = n.data as GroupedRow<Row> | undefined;
    if (d) out.push(d.__group ? `H:${d.__group.key}` : d.id);
  });
  return out;
}

function sortName(api: GridApi, sort: "asc" | "desc") {
  act(() => {
    api.applyColumnState({ state: [{ colId: "name", sort }], defaultState: { sort: null } });
  });
}

describe("grouping tree layer + AG Grid", () => {
  it("keeps children under their parent in both sort directions without an axis", async () => {
    const { api } = await renderGrid(null);
    await waitFor(() => expect(displayed(api)).toEqual(["p1", "c1", "c2", "p2", "c3"]));
    sortName(api, "asc");
    expect(displayed(api)).toEqual(["p1", "c1", "c2", "p2", "c3"]);
    sortName(api, "desc");
    // Roots and siblings reversed; children still follow their parent.
    expect(displayed(api)).toEqual(["p2", "c3", "p1", "c2", "c1"]);
  });

  it("keeps each forest under its group header in both sort directions", async () => {
    const { api } = await renderGrid("tier");
    sortName(api, "asc");
    expect(displayed(api)).toEqual(["H:gold", "p1", "c1", "c2", "H:silver", "p2", "c3"]);
    sortName(api, "desc");
    expect(displayed(api)).toEqual(["H:gold", "p1", "c2", "c1", "H:silver", "p2", "c3"]);
  });

  it("re-roots and repaints the children of a parent hidden by a column filter", async () => {
    const { api, findByTestId } = await renderGrid(null);
    expect((await findByTestId("cell-c1")).textContent).toBe("1:Alpha");
    await act(async () => {
      await api.setColumnFilterModel("name", { type: "notEqual", filter: "Bravo" });
      api.onFilterChanged();
    });
    await waitFor(() => expect(displayed(api)).toEqual(["c1", "c2", "p2", "c3"]));
    // The row objects did not change, so only the hook's forced refresh can
    // have repainted these cells with their new depth.
    await waitFor(async () => {
      expect((await findByTestId("cell-c1")).textContent).toBe("0:Alpha");
      expect((await findByTestId("cell-c2")).textContent).toBe("0:Echo");
    });
    expect((await findByTestId("cell-c3")).textContent).toBe("1:Charlie");
  });

  it("drops a collapsed parent's branch from the displayed rows", async () => {
    const { api, findByTestId } = await renderGrid("tier");
    await waitFor(() => expect(displayed(api)).toContain("c1"));
    const ctx = api.getGridOption("context") as GroupRowContext;
    act(() => ctx.toggleParentCollapse!("p1"));
    await waitFor(() =>
      expect(displayed(api)).toEqual(["H:gold", "p1", "H:silver", "p2", "c3"]),
    );
    expect(ctx.getTreeInfo!("p1")).toMatchObject({ collapsed: true, hiddenDescendants: 2 });
    // p1's row object is unchanged: only the forced refresh repaints its cell.
    await waitFor(async () => expect((await findByTestId("cell-p1")).textContent).toBe("0+:Bravo"));
    act(() => ctx.toggleParentCollapse!("p1"));
    await waitFor(() =>
      expect(displayed(api)).toEqual(["H:gold", "p1", "c1", "c2", "H:silver", "p2", "c3"]),
    );
    await waitFor(async () => expect((await findByTestId("cell-p1")).textContent).toBe("0:Bravo"));
  });
});
