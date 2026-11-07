/**
 * The hook's tree layer ("Parent" in the Group by menu) against a fake grid
 * api: row order, collapse, the forced cell refresh, filter interplay and
 * group selection. The real-grid timing is covered by
 * rowGroupingTree.integration.test.tsx.
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import type { AgGridReact } from "ag-grid-react";
import type { IRowNode } from "ag-grid-community";
import { useRowGrouping, type UseRowGroupingOptions } from "./useRowGrouping";
import type { GroupAxis, GroupedRow, TreeAccess } from "./rowGrouping";

interface Row {
  id: string;
  name: string;
  parent?: string | null;
  tier?: string;
}

const r = (id: string, parent?: string | null, tier?: string): Row => ({
  id,
  name: id.toUpperCase(),
  parent,
  tier,
});

const ROWS: Row[] = [r("c1", "p1", "gold"), r("p1", null, "gold"), r("c2", "p1", "gold"), r("q", null, "silver")];

const AXIS: GroupAxis<Row> = {
  key: "tier",
  label: "Tier",
  groupKeyOf: (x) => x.tier,
  vocab: [
    { key: "gold", label: "Gold" },
    { key: "silver", label: "Silver" },
  ],
};

function accessOver(rows: Row[]): TreeAccess<Row> & { refreshColumns: string[] } {
  const byId = new Map(rows.map((x) => [x.id, x]));
  return {
    parentIdOf: (x) => x.parent,
    lookup: (id) => {
      const x = byId.get(id);
      return x ? { name: x.name, parentId: x.parent } : undefined;
    },
    refreshColumns: ["name"],
  };
}

/**
 * A fake grid api over whatever row list the hook last produced. `filter`
 * decides which rows pass the column filters; `model` is the row list the
 * grid currently holds (it lags the hook's rowData until `sync()` is called,
 * as a real grid does until it processes the new rowData).
 */
function fakeGrid() {
  const state = {
    model: [] as GroupedRow<Row>[],
    filter: null as ((row: Row) => boolean) | null,
  };
  const node = (d: GroupedRow<Row>) =>
    ({ data: d, isSelected: () => false }) as unknown as IRowNode;
  const api = {
    forEachNode: vi.fn((cb: (n: IRowNode) => void) => state.model.forEach((d) => cb(node(d)))),
    forEachNodeAfterFilter: vi.fn((cb: (n: IRowNode) => void) =>
      state.model
        .filter((d) => d.__group || !state.filter || state.filter(d))
        .forEach((d) => cb(node(d))),
    ),
    isAnyFilterPresent: vi.fn(() => state.filter !== null),
    setNodesSelected: vi.fn(),
    refreshCells: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getRowNode: vi.fn(() => undefined),
  };
  const ref = { current: { api } } as unknown as RefObject<AgGridReact<Row> | null>;
  return { api, ref, state };
}

type Props = Partial<UseRowGroupingOptions<Row>>;

function setup(initial: Props) {
  const grid = fakeGrid();
  const hook = renderHook((p: Props) =>
    useRowGrouping<Row>(grid.ref, {
      rows: ROWS,
      axes: [AXIS],
      groupBy: null,
      ...p,
    }),
    { initialProps: initial },
  );
  /** Let the "grid" take the hook's current rowData. */
  const sync = () => {
    grid.state.model = hook.result.current.rowData;
  };
  sync();
  return { ...grid, hook, sync };
}

const order = (rows: GroupedRow<Row>[]) =>
  rows.map((x) => (x.__group ? `H:${x.__group.key}` : x.id));

describe("useRowGrouping — tree layer", () => {
  it("leaves rows untouched without a tree or axis", () => {
    const { hook } = setup({ tree: null });
    expect(hook.result.current.rowData).toBe(ROWS);
    expect(hook.result.current.treeActive).toBe(false);
    expect(hook.result.current.getTreeInfo("c1")).toBeUndefined();
  });

  it("orders rows as a tree without an axis", () => {
    const tree = accessOver(ROWS);
    const { hook } = setup({ tree });
    expect(order(hook.result.current.rowData)).toEqual(["p1", "c1", "c2", "q"]);
    expect(hook.result.current.treeActive).toBe(true);
    expect(hook.result.current.getTreeInfo("c1")!.depth).toBe(1);
    expect(hook.result.current.stickyHeader).toBeNull();
  });

  it("lays out each group as a tree with an axis", () => {
    const tree = accessOver(ROWS);
    const { hook } = setup({ tree, groupBy: "tier" });
    expect(order(hook.result.current.rowData)).toEqual(["H:gold", "p1", "c1", "c2", "H:silver", "q"]);
    const gold = hook.result.current.rowData[0].__group!;
    expect(gold.treeHidden).toBe(0);
  });

  it("toggleParentCollapse hides descendants and getTreeInfo reports them; context is stable", () => {
    const tree = accessOver(ROWS);
    const { hook } = setup({ tree, groupBy: "tier" });
    const ctx = hook.result.current.gridProps.context;
    act(() => ctx.toggleParentCollapse!("p1"));
    expect(order(hook.result.current.rowData)).toEqual(["H:gold", "p1", "H:silver", "q"]);
    expect(hook.result.current.getTreeInfo("p1")).toMatchObject({
      collapsed: true,
      hiddenDescendants: 2,
    });
    expect(ctx.getTreeInfo!("p1")!.collapsed).toBe(true);
    expect(hook.result.current.rowData[0].__group!.treeHidden).toBe(2);
    expect(hook.result.current.gridProps.context).toBe(ctx);
    act(() => ctx.toggleParentCollapse!("p1"));
    expect(order(hook.result.current.rowData)).toEqual(["H:gold", "p1", "c1", "c2", "H:silver", "q"]);
  });

  it("refreshes the tree cells once per tree-info change", () => {
    const tree = accessOver(ROWS);
    const { hook, api } = setup({ tree });
    // The mount effect already refreshed for the first layout.
    expect(api.refreshCells).toHaveBeenCalledTimes(1);
    expect(api.refreshCells).toHaveBeenLastCalledWith({ columns: ["name"], force: true });
    act(() => hook.result.current.handleModelUpdated());
    expect(api.refreshCells).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.gridProps.context.toggleParentCollapse!("p1"));
    expect(api.refreshCells).toHaveBeenCalledTimes(2);
    act(() => hook.result.current.handleModelUpdated());
    expect(api.refreshCells).toHaveBeenCalledTimes(2);
  });

  it("handleModelUpdated refreshes when it sees a new tree map before the effect does", () => {
    const tree = accessOver(ROWS);
    const { hook, api } = setup({ tree: null });
    expect(api.refreshCells).not.toHaveBeenCalled();
    // Turning the tree on: the render's tree map is new.
    hook.rerender({ tree });
    expect(api.refreshCells).toHaveBeenCalledTimes(1);
    // Turning it off repaints the same columns (the indentation must go).
    hook.rerender({ tree: null });
    expect(api.refreshCells).toHaveBeenCalledTimes(2);
    expect(api.refreshCells).toHaveBeenLastCalledWith({ columns: ["name"], force: true });
  });

  it("a filter that hides a parent re-roots its children", () => {
    const tree = accessOver(ROWS);
    const { hook, state } = setup({ tree });
    state.filter = (x) => x.id !== "p1";
    act(() => hook.result.current.handleFilterChanged());
    expect(hook.result.current.getTreeInfo("c1")).toMatchObject({ depth: 0, crumbIds: ["p1"] });
    state.filter = null;
    act(() => hook.result.current.handleFilterChanged());
    expect(hook.result.current.getTreeInfo("c1")).toMatchObject({ depth: 1, crumbIds: [] });
  });

  it("a filter clears collapsed parents and settles the re-expanded rows on the next model update", () => {
    const tree = accessOver(ROWS);
    const { hook, state, sync } = setup({ tree });
    act(() => hook.result.current.gridProps.context.toggleParentCollapse!("p1"));
    sync(); // grid holds p1, q only — c1, c2 are hidden under p1
    state.filter = (x) => x.id !== "c2";
    act(() => hook.result.current.handleFilterChanged());
    // Collapse cleared: the branch is back in the row list.
    expect(hook.result.current.getTreeInfo("p1")!.collapsed).toBe(false);
    expect(order(hook.result.current.rowData)).toEqual(["p1", "c1", "c2", "q"]);
    // Rows the filter has not seen yet keep their unfiltered membership, so
    // the branch does not flash its children out as roots.
    expect(hook.result.current.getTreeInfo("c1")!.depth).toBe(1);
    expect(hook.result.current.getTreeInfo("c2")!.depth).toBe(1);
    // The grid takes the new row list and reports it: c2 fails the filter.
    sync();
    act(() => hook.result.current.handleModelUpdated());
    expect(hook.result.current.getTreeInfo("c1")!.depth).toBe(1);
    expect(hook.result.current.getTreeInfo("p1")!.hasChildren).toBe(true);
    // Collapsing now counts only the visible descendant.
    act(() => hook.result.current.gridProps.context.toggleParentCollapse!("p1"));
    expect(hook.result.current.getTreeInfo("p1")).toMatchObject({
      collapsed: true,
      hiddenDescendants: 1,
    });
  });

  it("rows hidden under a collapsed parent keep their filter membership", () => {
    const rows = [r("p"), r("c", "p"), r("g", "c")];
    const tree = accessOver(rows);
    const { hook, state, sync } = setup({ tree, rows });
    state.filter = () => true;
    act(() => hook.result.current.handleFilterChanged());
    sync();
    act(() => hook.result.current.handleModelUpdated());
    act(() => hook.result.current.gridProps.context.toggleParentCollapse!("p"));
    sync(); // c and g leave the grid
    act(() => hook.result.current.handleModelUpdated());
    // g did not pop out as a root: it is still hidden under p.
    expect(order(hook.result.current.rowData)).toEqual(["p"]);
    expect(hook.result.current.getTreeInfo("p")!.hiddenDescendants).toBe(2);
  });

  it("does not touch filters or rows without an axis or a tree", () => {
    const { hook, api, state } = setup({ tree: null });
    state.filter = () => true;
    act(() => hook.result.current.handleFilterChanged());
    expect(api.isAnyFilterPresent).not.toHaveBeenCalled();
    expect(hook.result.current.rowData).toBe(ROWS);
  });

  it("selectGroup expands collapsed parents in the group, then selects on model update", () => {
    const tree = accessOver(ROWS);
    const { hook, api, sync } = setup({ tree, groupBy: "tier" });
    act(() => hook.result.current.gridProps.context.toggleParentCollapse!("p1"));
    act(() => hook.result.current.gridProps.context.selectGroup("gold", true));
    expect(api.setNodesSelected).not.toHaveBeenCalled();
    expect(hook.result.current.getTreeInfo("p1")!.collapsed).toBe(false);
    sync();
    act(() => hook.result.current.handleModelUpdated());
    expect(api.setNodesSelected).toHaveBeenCalledTimes(1);
    const { nodes, newValue } = api.setNodesSelected.mock.calls[0][0] as {
      nodes: IRowNode[];
      newValue: boolean;
    };
    expect(newValue).toBe(true);
    expect(nodes.map((n) => (n.data as Row).id).sort()).toEqual(["c1", "c2", "p1"]);
  });

  it("selectGroup leaves another group's collapsed parents alone", () => {
    const rows = [r("p1", null, "gold"), r("c1", "p1", "gold"), r("s", null, "silver"), r("sc", "s", "silver")];
    const tree = accessOver(rows);
    const { hook, api } = setup({ tree, rows, groupBy: "tier" });
    act(() => hook.result.current.gridProps.context.toggleParentCollapse!("s"));
    act(() => hook.result.current.gridProps.context.selectGroup("gold", true));
    // Nothing to expand in gold → selected straight away; silver stays collapsed.
    expect(api.setNodesSelected).toHaveBeenCalledTimes(1);
    expect(hook.result.current.getTreeInfo("s")!.collapsed).toBe(true);
  });

  it("selectGroup on a collapsed group still expands it first", () => {
    const tree = accessOver(ROWS);
    const { hook, api, sync } = setup({ tree, groupBy: "tier" });
    act(() => hook.result.current.gridProps.context.toggleGroupCollapse("gold"));
    expect(hook.result.current.rowData[0].__group!.collapsed).toBe(true);
    act(() => hook.result.current.gridProps.context.selectGroup("gold", true));
    expect(api.setNodesSelected).not.toHaveBeenCalled();
    expect(hook.result.current.rowData[0].__group!.collapsed).toBe(false);
    sync();
    act(() => hook.result.current.handleModelUpdated());
    expect(api.setNodesSelected).toHaveBeenCalledTimes(1);
  });

  it("deselecting never expands", () => {
    const tree = accessOver(ROWS);
    const { hook, api } = setup({ tree, groupBy: "tier" });
    act(() => hook.result.current.gridProps.context.toggleParentCollapse!("p1"));
    act(() => hook.result.current.gridProps.context.selectGroup("gold", false));
    expect(api.setNodesSelected).toHaveBeenCalledWith(expect.objectContaining({ newValue: false }));
    expect(hook.result.current.getTreeInfo("p1")!.collapsed).toBe(true);
  });

  it("changing the axis or switching the tree off resets collapsed parents", () => {
    const tree = accessOver(ROWS);
    const { hook } = setup({ tree, groupBy: "tier" });
    act(() => hook.result.current.gridProps.context.toggleParentCollapse!("p1"));
    hook.rerender({ tree, groupBy: null });
    expect(hook.result.current.getTreeInfo("p1")!.collapsed).toBe(false);
    act(() => hook.result.current.gridProps.context.toggleParentCollapse!("p1"));
    expect(hook.result.current.getTreeInfo("p1")!.collapsed).toBe(true);
    hook.rerender({ tree: null, groupBy: null });
    hook.rerender({ tree, groupBy: null });
    expect(hook.result.current.getTreeInfo("p1")!.collapsed).toBe(false);
  });

  it("postSortRows reorders as a forest without an axis, and is a no-op with neither", () => {
    const tree = accessOver(ROWS);
    const { hook } = setup({ tree });
    // A name sort would interleave: C1, C2, P1, Q.
    const nodes = [r("c1", "p1"), r("c2", "p1"), r("p1"), r("q")].map((d) => ({ data: d }));
    hook.result.current.gridProps.postSortRows({ nodes: nodes as unknown as IRowNode[] });
    expect(nodes.map((n) => n.data.id)).toEqual(["p1", "c1", "c2", "q"]);

    const plain = setup({ tree: null });
    const flat = [r("c1", "p1"), r("p1")].map((d) => ({ data: d }));
    plain.hook.result.current.gridProps.postSortRows({ nodes: flat as unknown as IRowNode[] });
    expect(flat.map((n) => n.data.id)).toEqual(["c1", "p1"]);
  });
});

describe("useRowGrouping — tree level", () => {
  // p > c > g, p > c2, q: three levels.
  const DEEP = [r("p"), r("c", "p"), r("g", "c"), r("c2", "p"), r("q")];
  const withLevel = (rows: Row[], level: number | null) => ({ ...accessOver(rows), level });

  it("treeLevel is null with the tree off", () => {
    const { hook } = setup({ tree: null });
    expect(hook.result.current.treeLevel).toBeNull();
  });

  it("treeLevel follows toggleParentCollapse", () => {
    const tree = accessOver(DEEP);
    const { hook } = setup({ tree, rows: DEEP });
    expect(hook.result.current.treeLevel).toEqual({ current: 3, max: 3 });
    act(() => hook.result.current.gridProps.context.toggleParentCollapse!("c"));
    expect(hook.result.current.treeLevel).toEqual({ current: 2, max: 3 });
    act(() => hook.result.current.gridProps.context.toggleParentCollapse!("p"));
    expect(hook.result.current.treeLevel).toEqual({ current: 1, max: 3 });
  });

  it("level 1 hides every child; null restores all; a level change re-applies", () => {
    const { hook } = setup({ tree: withLevel(DEEP, 1), rows: DEEP });
    expect(order(hook.result.current.rowData)).toEqual(["p", "q"]);
    expect(hook.result.current.treeLevel).toEqual({ current: 1, max: 3 });
    hook.rerender({ tree: withLevel(DEEP, 2), rows: DEEP });
    expect(order(hook.result.current.rowData)).toEqual(["p", "c", "c2", "q"]);
    expect(hook.result.current.treeLevel!.current).toBe(2);
    hook.rerender({ tree: withLevel(DEEP, null), rows: DEEP });
    expect(order(hook.result.current.rowData)).toEqual(["p", "c", "g", "c2", "q"]);
    expect(hook.result.current.treeLevel!.current).toBe(3);
  });

  it("a new rows array re-applies the level, dropping a manual expansion", () => {
    const tree = withLevel(DEEP, 1);
    const { hook } = setup({ tree, rows: DEEP });
    act(() => hook.result.current.gridProps.context.toggleParentCollapse!("p"));
    expect(order(hook.result.current.rowData)).toEqual(["p", "c", "c2", "q"]);
    // Same rows identity: the manual expansion survives a re-render.
    hook.rerender({ tree, rows: DEEP });
    expect(order(hook.result.current.rowData)).toEqual(["p", "c", "c2", "q"]);
    hook.rerender({ tree, rows: [...DEEP] });
    expect(order(hook.result.current.rowData)).toEqual(["p", "q"]);
  });

  it("an active filter keeps branches open; clearing it re-applies the level", () => {
    const tree = withLevel(DEEP, 1);
    const { hook, state, sync } = setup({ tree, rows: DEEP });
    sync();
    state.filter = () => true;
    act(() => hook.result.current.handleFilterChanged());
    expect(order(hook.result.current.rowData)).toEqual(["p", "c", "g", "c2", "q"]);
    // A reload under the filter does not collapse again.
    hook.rerender({ tree, rows: [...DEEP] });
    expect(order(hook.result.current.rowData)).toEqual(["p", "c", "g", "c2", "q"]);
    state.filter = null;
    act(() => hook.result.current.handleFilterChanged());
    expect(order(hook.result.current.rowData)).toEqual(["p", "q"]);
  });

  it("switching the tree on applies the level", () => {
    const { hook } = setup({ tree: null, rows: DEEP });
    expect(hook.result.current.rowData).toHaveLength(5);
    hook.rerender({ tree: withLevel(DEEP, 2), rows: DEEP });
    expect(order(hook.result.current.rowData)).toEqual(["p", "c", "c2", "q"]);
  });
});
