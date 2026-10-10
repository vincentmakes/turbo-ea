/**
 * The Process Navigator's state rules, one by one. The component suites
 * (ProcessNavigator*.test.tsx) cover the same behaviour end to end; these pin
 * each rule where it lives.
 */
import { describe, expect, it, vi } from "vitest";

import type { ProcessTypeOption } from "./useProcessTypeOptions";
import {
  ATTR_COLORS,
  DEFAULT_LEVEL,
  STORAGE_KEY,
  UNSET_COLOR,
  buildTree,
  compareBySortOrder,
  filterTreeByOrgs,
  findNode,
  flatCollect,
  getAncestors,
  getCardColor,
  getMaxLevel,
  groupByLane,
  groupHouseRows,
  legendItems,
  loadOpeningConfig,
  matchingIds,
  matrixCell,
  moveRow,
  nameMatches,
  nameOrId,
  orderRows,
  readOpeningState,
  reorderSiblings,
  rowKeyOf,
  stateToParams,
  zoomInto,
  type NavigatorState,
  type ProcItem,
  type ProcNode,
} from "./processNavigatorState";

function item(id: string, over: Partial<ProcItem> = {}): ProcItem {
  return {
    id,
    name: id,
    parent_id: null,
    app_count: 0,
    total_cost: 0,
    apps: [],
    data_objects: [],
    org_ids: [],
    ctx_ids: [],
    ...over,
  };
}

const sorted = (order: number) => ({ attributes: { sortOrder: order } });

/** id → [child ids] of a tree, for compact shape assertions. */
function shape(nodes: ProcNode[]): unknown[] {
  return nodes.map((n) => (n.children.length ? { [n.id]: shape(n.children) } : n.id));
}

/*
 *   A (management)
 *   ├── A1
 *   │   └── A1a
 *   └── A2
 *   B (core)
 *   └── B1
 */
const ITEMS: ProcItem[] = [
  item("A1a", { parent_id: "A1", org_ids: ["org-x"] }),
  item("B1", { parent_id: "B" }),
  item("A2", { parent_id: "A", ...sorted(1) }),
  item("A", { attributes: { processType: "management" } }),
  item("B", { attributes: { processType: "core" }, org_ids: ["org-y"] }),
  item("A1", { parent_id: "A", ...sorted(0) }),
];

describe("compareBySortOrder", () => {
  it("orders by sortOrder, then by name", () => {
    const list = [
      { name: "b", ...sorted(1) },
      { name: "c" },
      { name: "a" },
      { name: "z", ...sorted(0) },
      { name: "y", ...sorted(1) },
    ];
    expect(list.sort(compareBySortOrder).map((x) => x.name)).toEqual(["z", "b", "y", "a", "c"]);
  });

  it("sorts an unset order after any order below 999", () => {
    expect(compareBySortOrder({ name: "a" }, { name: "b", ...sorted(998) })).toBe(1);
    expect(compareBySortOrder({ name: "a" }, { name: "b", ...sorted(999) })).toBeLessThan(0);
  });
});

describe("buildTree", () => {
  it("nests, sorts and levels the payload", () => {
    const tree = buildTree(ITEMS);
    expect(shape(tree)).toEqual([{ A: [{ A1: ["A1a"] }, "A2"] }, { B: ["B1"] }]);
    const levels = Object.fromEntries(flatCollect(tree).map((n) => [n.id, n.level]));
    expect(levels).toEqual({ A: 1, A1: 2, A1a: 3, A2: 2, B: 1, B1: 2 });
  });

  it("sorts the roots too", () => {
    expect(shape(buildTree([item("b"), item("c", sorted(0)), item("a")]))).toEqual(["c", "a", "b"]);
  });

  it("makes a process whose parent is missing a root", () => {
    const tree = buildTree([item("orphan", { parent_id: "gone" }), item("root")]);
    expect(shape(tree)).toEqual(["orphan", "root"]);
    expect(tree.map((n) => n.level)).toEqual([1, 1]);
  });

  it("rolls applications and data objects up the subtree, once each", () => {
    const erp = { id: "app-erp", name: "ERP" };
    const crm = { id: "app-crm", name: "CRM" };
    const orders = { id: "do-1", name: "Orders" };
    const tree = buildTree([
      item("P", { apps: [erp], data_objects: [orders] }),
      item("C1", { parent_id: "P", apps: [erp, crm] }),
      item("C2", { parent_id: "P", data_objects: [orders, { id: "do-2", name: "Invoices" }] }),
    ]);
    const p = tree[0];
    expect([...p.deepUniqueApps.keys()]).toEqual(["app-erp", "app-crm"]);
    expect(p.deepAppCount).toBe(2);
    expect([...p.deepDataObjects.keys()]).toEqual(["do-1", "do-2"]);
    const c1 = p.children[0];
    expect(c1.deepAppCount).toBe(2);
    expect(c1.deepDataObjects.size).toBe(0);
    expect(p.children[1].deepAppCount).toBe(0);
  });

  it("copies the items rather than changing them", () => {
    const items = [item("P")];
    buildTree(items);
    expect(items[0]).not.toHaveProperty("children");
  });
});

describe("tree lookups", () => {
  const tree = buildTree(ITEMS);

  it("collects every node, parents before children", () => {
    expect(flatCollect(tree).map((n) => n.id)).toEqual(["A", "A1", "A1a", "A2", "B", "B1"]);
    expect(flatCollect([])).toEqual([]);
  });

  it("finds the deepest level", () => {
    expect(getMaxLevel(tree)).toBe(3);
    expect(getMaxLevel(buildTree([item("only")]))).toBe(1);
    expect(getMaxLevel([])).toBe(0);
  });

  it("finds a node anywhere, or nothing", () => {
    expect(findNode(tree, "A1a")?.name).toBe("A1a");
    expect(findNode(tree, "B")?.id).toBe("B");
    expect(findNode(tree, "nope")).toBeNull();
  });

  it("gives the path from the root to a node", () => {
    expect(getAncestors(tree, "A1a").map((n) => n.id)).toEqual(["A", "A1", "A1a"]);
    expect(getAncestors(tree, "B1").map((n) => n.id)).toEqual(["B", "B1"]);
    expect(getAncestors(tree, "A").map((n) => n.id)).toEqual(["A"]);
    expect(getAncestors(tree, "nope")).toEqual([]);
  });
});

describe("filterTreeByOrgs", () => {
  const tree = buildTree(ITEMS);

  it("keeps the whole tree when no organisation is picked", () => {
    expect(filterTreeByOrgs(tree, new Set())).toBe(tree);
  });

  it("keeps a linked process with its ancestors, and drops the rest", () => {
    expect(shape(filterTreeByOrgs(tree, new Set(["org-x"])))).toEqual([{ A: [{ A1: ["A1a"] }] }]);
  });

  it("keeps a linked process's own subtree only where it is linked too", () => {
    expect(shape(filterTreeByOrgs(tree, new Set(["org-y"])))).toEqual(["B"]);
  });

  it("keeps everything any picked organisation reaches", () => {
    expect(shape(filterTreeByOrgs(tree, new Set(["org-x", "org-y"])))).toEqual([
      { A: [{ A1: ["A1a"] }] },
      "B",
    ]);
  });

  it("drops everything when nothing is linked", () => {
    expect(filterTreeByOrgs(tree, new Set(["org-z"]))).toEqual([]);
  });

  it("leaves the tree it filtered untouched", () => {
    filterTreeByOrgs(tree, new Set(["org-x"]));
    expect(shape(tree)).toEqual([{ A: [{ A1: ["A1a"] }, "A2"] }, { B: ["B1"] }]);
  });
});

describe("zoomInto", () => {
  const tree = buildTree(ITEMS);

  it("shows the whole tree without a zoom", () => {
    expect(zoomInto(tree, null)).toEqual({ displayTree: tree, breadcrumbs: [] });
  });

  it("shows the zoomed process's children under its path", () => {
    const { displayTree, breadcrumbs } = zoomInto(tree, "A1");
    expect(displayTree.map((n) => n.id)).toEqual(["A1a"]);
    expect(breadcrumbs.map((n) => n.id)).toEqual(["A", "A1"]);
  });

  it("shows a childless process itself", () => {
    const { displayTree, breadcrumbs } = zoomInto(tree, "A2");
    expect(displayTree.map((n) => n.id)).toEqual(["A2"]);
    expect(breadcrumbs.map((n) => n.id)).toEqual(["A", "A2"]);
  });

  it("falls back to the whole tree for a process it no longer has", () => {
    expect(zoomInto(tree, "gone")).toEqual({ displayTree: tree, breadcrumbs: [] });
  });
});

describe("colours", () => {
  const resolve = vi.fn(
    (key: string | null | undefined) =>
      ({ key: key ?? "", label: "x", color: `#type-${key}` }) as ProcessTypeOption,
  );

  it("pins the fixed overlays' option keys and colours", () => {
    expect(ATTR_COLORS).toEqual({
      maturity: {
        initial: { label: "1-Initial", color: "#d32f2f" },
        managed: { label: "2-Managed", color: "#f57c00" },
        defined: { label: "3-Defined", color: "#fbc02d" },
        measured: { label: "4-Measured", color: "#66bb6a" },
        optimized: { label: "5-Optimized", color: "#2e7d32" },
      },
      automationLevel: {
        manual: { label: "Manual", color: "#d32f2f" },
        partiallyAutomated: { label: "Partial", color: "#f57c00" },
        fullyAutomated: { label: "Fully Auto", color: "#2e7d32" },
      },
      riskLevel: {
        low: { label: "Low", color: "#66bb6a" },
        medium: { label: "Medium", color: "#fbc02d" },
        high: { label: "High", color: "#f57c00" },
        critical: { label: "Critical", color: "#d32f2f" },
      },
    });
    expect(UNSET_COLOR).toBe("#bdbdbd");
  });

  it("colours a card by its overlay value", () => {
    expect(getCardColor({ attributes: { maturity: "defined" } }, "maturity", resolve)).toBe(
      "#fbc02d",
    );
    expect(getCardColor({ attributes: { riskLevel: "critical" } }, "riskLevel", resolve)).toBe(
      "#d32f2f",
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it("resolves a process type through the metamodel", () => {
    expect(getCardColor({ attributes: { processType: "core" } }, "processType", resolve)).toBe(
      "#type-core",
    );
    expect(resolve).toHaveBeenCalledWith("core");
  });

  it("greys out a card with no value or an unknown one", () => {
    expect(getCardColor({}, "maturity", resolve)).toBe("#bdbdbd");
    expect(getCardColor({ attributes: { maturity: "" } }, "maturity", resolve)).toBe("#bdbdbd");
    expect(getCardColor({ attributes: { maturity: "wild" } }, "maturity", resolve)).toBe("#bdbdbd");
    expect(getCardColor({ attributes: {} }, "processType", resolve)).toBe("#bdbdbd");
    // An overlay typed into the URL by hand is not one of the four.
    expect(getCardColor({ attributes: { bogus: "x" } }, "bogus" as never, resolve)).toBe("#bdbdbd");
  });

  it("builds the legend from the process types or the fixed colours", () => {
    const types = [{ key: "core", label: "Core", color: "#111", extra: 1 }];
    expect(legendItems("processType", types)).toEqual([{ label: "Core", color: "#111" }]);
    expect(legendItems("automationLevel", types)).toEqual([
      { label: "Manual", color: "#d32f2f" },
      { label: "Partial", color: "#f57c00" },
      { label: "Fully Auto", color: "#2e7d32" },
    ]);
    expect(legendItems("nope" as never, types)).toEqual([]);
  });
});

describe("loadOpeningConfig", () => {
  const storage = (raw: string | null) => () => ({ getItem: vi.fn(() => raw) });

  it("reads what the user last left", () => {
    const get = storage(JSON.stringify({ displayLevel: 3, viewMode: "matrix" }));
    expect(loadOpeningConfig({ persistPreferences: true }, get)).toEqual({
      displayLevel: 3,
      viewMode: "matrix",
    });
  });

  it("reads the navigator's own key", () => {
    const getItem = vi.fn(() => null);
    loadOpeningConfig({ persistPreferences: true }, () => ({ getItem }));
    expect(getItem).toHaveBeenCalledWith("turboea-report:process-navigator");
    expect(STORAGE_KEY).toBe("turboea-report:process-navigator");
  });

  it("opens with the defaults when nothing is stored, or it is unreadable", () => {
    expect(loadOpeningConfig({ persistPreferences: true }, storage(null))).toBeNull();
    expect(loadOpeningConfig({ persistPreferences: true }, storage(""))).toBeNull();
    expect(loadOpeningConfig({ persistPreferences: true }, storage("{not json"))).toBeNull();
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    expect(loadOpeningConfig({ persistPreferences: true }, blocked)).toBeNull();
  });

  it("uses localStorage by default", () => {
    localStorage.setItem(
      "turboea-report:process-navigator",
      JSON.stringify({ overlay: "maturity" }),
    );
    try {
      expect(loadOpeningConfig({ persistPreferences: true })).toEqual({ overlay: "maturity" });
    } finally {
      localStorage.clear();
    }
  });

  it("gives a portal its configured opening state, mapped to the stored key names", () => {
    const get = vi.fn(storage(JSON.stringify({ displayLevel: 9 })));
    expect(
      loadOpeningConfig(
        { persistPreferences: false, initial: { level: 3, overlay: "riskLevel", columns: 1 } },
        get,
      ),
    ).toEqual({ displayLevel: 3, overlay: "riskLevel", columns: 1 });
    expect(loadOpeningConfig({ persistPreferences: false }, get)).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});

describe("readOpeningState", () => {
  const read = (query: string, stored: Record<string, unknown> | null = null) =>
    readOpeningState(new URLSearchParams(query), stored);

  it("opens on the defaults", () => {
    expect(read("")).toEqual({
      viewMode: "house",
      search: "",
      displayLevel: 2,
      overlay: "processType",
      columns: 3,
      zoomNodeId: null,
      openId: null,
    });
    expect(DEFAULT_LEVEL).toBe(2);
  });

  it("reads every parameter from the URL", () => {
    expect(read("view=matrix&search=pay&level=4&overlay=maturity&cols=1&zoom=z1&open=o1")).toEqual({
      viewMode: "matrix",
      search: "pay",
      displayLevel: 4,
      overlay: "maturity",
      columns: 1,
      zoomNodeId: "z1",
      openId: "o1",
    });
  });

  it("falls back to the stored preferences on a bare URL", () => {
    expect(
      read("", { viewMode: "dependencies", displayLevel: 1, overlay: "riskLevel", columns: 2 }),
    ).toMatchObject({
      viewMode: "dependencies",
      displayLevel: 1,
      overlay: "riskLevel",
      columns: 2,
    });
  });

  it("takes a stored level of zero as a level", () => {
    expect(read("", { displayLevel: 0 }).displayLevel).toBe(0);
  });

  it("ignores the stored preferences once the URL carries anything", () => {
    const stored = { viewMode: "matrix", displayLevel: 4, overlay: "maturity", columns: 1 };
    expect(read("search=x", stored)).toMatchObject({
      viewMode: "house",
      displayLevel: 2,
      overlay: "processType",
      columns: 3,
    });
  });

  it("lets a URL parameter win over a stored one", () => {
    expect(read("level=5", { displayLevel: 1 }).displayLevel).toBe(5);
  });

  it("treats empty parameters as absent", () => {
    expect(read("view=&level=&overlay=&zoom=&open=&search=")).toMatchObject({
      viewMode: "house",
      displayLevel: 2,
      overlay: "processType",
      zoomNodeId: null,
      openId: null,
      search: "",
    });
  });

  it("falls back to the default column count for anything that is not one", () => {
    expect(read("cols=7").columns).toBe(3);
    expect(read("cols=two").columns).toBe(3);
    expect(read("", { columns: "1" }).columns).toBe(1);
    expect(read("", { columns: 9 }).columns).toBe(3);
  });
});

describe("stateToParams", () => {
  const DEFAULTS: NavigatorState = {
    viewMode: "house",
    search: "",
    displayLevel: 2,
    overlay: "processType",
    columns: 3,
    zoomNodeId: null,
    openId: null,
  };

  it("writes nothing for the defaults", () => {
    expect(stateToParams(DEFAULTS)).toEqual({});
  });

  it("writes everything that differs", () => {
    expect(
      stateToParams({
        viewMode: "matrix",
        search: "pay",
        displayLevel: 1,
        overlay: "riskLevel",
        columns: 2,
        zoomNodeId: "z1",
        openId: "o1",
      }),
    ).toEqual({
      view: "matrix",
      search: "pay",
      level: "1",
      overlay: "riskLevel",
      cols: "2",
      zoom: "z1",
      open: "o1",
    });
  });

  it("round-trips through readOpeningState", () => {
    const state: NavigatorState = { ...DEFAULTS, viewMode: "dependencies", displayLevel: 3 };
    const params = new URLSearchParams(stateToParams(state));
    expect(readOpeningState(params, null)).toEqual(state);
  });
});

describe("house rows", () => {
  const nodes = buildTree([
    item("m", { attributes: { processType: "management" } }),
    item("c1", { attributes: { processType: "core" } }),
    item("none"),
    item("odd", { attributes: { processType: "legacy" } }),
    item("c2", { attributes: { processType: "core" } }),
  ]);

  it("reads a process's row from its type, else the default", () => {
    expect(rowKeyOf({ attributes: { processType: "core" } }, "support")).toBe("core");
    expect(rowKeyOf({ attributes: { processType: "" } }, "support")).toBe("support");
    expect(rowKeyOf({}, "support")).toBe("support");
  });

  it("groups processes into one row per option, plus one per unknown type", () => {
    const rows = groupHouseRows(nodes, ["management", "core", "support"], "support");
    expect(
      Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.map((n) => n.id)])),
    ).toEqual({
      management: ["m"],
      core: ["c1", "c2"],
      support: ["none"],
      legacy: ["odd"],
    });
  });

  it("keeps an option's row even when it is empty", () => {
    expect(groupHouseRows([], ["management"], "management")).toEqual({ management: [] });
  });

  it("orders rows: persisted first, then options, then data rows", () => {
    expect(
      orderRows(
        ["support", "gone", "core"],
        ["management", "core", "support"],
        ["management", "core", "support", "legacy"],
      ),
    ).toEqual(["support", "core", "management", "legacy"]);
  });

  it("drops an option that has no row", () => {
    expect(orderRows([], ["management", "core"], ["core"])).toEqual(["core"]);
  });
});

describe("reorderSiblings", () => {
  const data = [
    item("r1", { attributes: { processType: "core", sortOrder: 1 } }),
    item("r0", { attributes: { processType: "core", sortOrder: 0 } }),
    item("r2", { attributes: { processType: "core", sortOrder: 2 } }),
    item("s", { attributes: { processType: "support" } }),
    item("d", {}), // default row
    item("k1", { parent_id: "r0", ...sorted(0) }),
    item("k2", { parent_id: "r0", ...sorted(1) }),
    item("nested-core", { parent_id: "r1", attributes: { processType: "core" } }),
  ];
  const ids = (list: ProcItem[] | null) => list?.map((x) => x.id) ?? null;

  it("moves a top-level card down within its process-type row", () => {
    expect(ids(reorderSiblings(data, "r0", "r2", "core", true, "support"))).toEqual([
      "r1",
      "r2",
      "r0",
    ]);
  });

  it("moves a top-level card up", () => {
    expect(ids(reorderSiblings(data, "r2", "r0", "core", true, "support"))).toEqual([
      "r2",
      "r0",
      "r1",
    ]);
  });

  it("counts a card with no type in the default row", () => {
    expect(ids(reorderSiblings(data, "d", "s", "support", true, "support"))).toEqual(["s", "d"]);
  });

  it("reorders the children of a container", () => {
    expect(ids(reorderSiblings(data, "k2", "k1", "r0", false, "support"))).toEqual(["k2", "k1"]);
  });

  it("changes nothing for a drop on itself or outside the siblings", () => {
    expect(reorderSiblings(data, "r0", "r0", "core", true, "support")).toBeNull();
    expect(reorderSiblings(data, "r0", "s", "core", true, "support")).toBeNull();
    expect(reorderSiblings(data, "gone", "r0", "core", true, "support")).toBeNull();
    expect(reorderSiblings(data, "nested-core", "r0", "core", true, "support")).toBeNull();
  });

  it("leaves the data in its order", () => {
    reorderSiblings(data, "r0", "r2", "core", true, "support");
    expect(data.slice(0, 3).map((x) => x.id)).toEqual(["r1", "r0", "r2"]);
  });
});

describe("moveRow", () => {
  const order = ["management", "core", "support"];

  it("swaps a row with its neighbour", () => {
    expect(moveRow(order, "core", "up")).toEqual(["core", "management", "support"]);
    expect(moveRow(order, "core", "down")).toEqual(["management", "support", "core"]);
    expect(moveRow(order, "management", "down")).toEqual(["core", "management", "support"]);
    expect(moveRow(order, "support", "up")).toEqual(["management", "support", "core"]);
    expect(order).toEqual(["management", "core", "support"]);
  });

  it("refuses to move past either end or an unknown row", () => {
    expect(moveRow(order, "management", "up")).toBeNull();
    expect(moveRow(order, "support", "down")).toBeNull();
    expect(moveRow(order, "gone", "down")).toBeNull();
    expect(moveRow(order, "gone", "up")).toBeNull();
  });
});

describe("search", () => {
  it("matches names case-insensitively", () => {
    expect(nameMatches("Order to Cash", "CASH")).toBe(true);
    expect(nameMatches("ORDER", "order")).toBe(true);
    expect(nameMatches("Order", "")).toBe(true);
    expect(nameMatches("Order", "bill")).toBe(false);
  });

  it("keeps the matches and every ancestor visible", () => {
    const flat = flatCollect(buildTree(ITEMS));
    expect([...(matchingIds(flat, "a1A") ?? [])].sort()).toEqual(["A", "A1", "A1a"]);
    expect([...(matchingIds(flat, "b") ?? [])].sort()).toEqual(["B", "B1"]);
  });

  it("matches nothing for a name nobody has, and everything for no search", () => {
    const flat = flatCollect(buildTree(ITEMS));
    expect(matchingIds(flat, "zzz")).toEqual(new Set());
    expect(matchingIds(flat, "")).toBeNull();
  });

  it("stops at a parent it does not have", () => {
    const flat = [item("child", { parent_id: "elsewhere" })];
    expect(matchingIds(flat, "child")).toEqual(new Set(["child"]));
  });
});

describe("drawer and view lookups", () => {
  it("groups steps by lane in the order the lanes appear", () => {
    const steps = [
      { id: "1", lane_name: "Sales" },
      { id: "2", lane_name: null },
      { id: "3", lane_name: "Sales" },
      { id: "4" },
      { id: "5", lane_name: "Billing" },
    ];
    const lanes = groupByLane(steps, "Process");
    expect([...lanes.keys()]).toEqual(["Sales", "Process", "Billing"]);
    expect(lanes.get("Sales")!.map((s) => s.id)).toEqual(["1", "3"]);
    expect(lanes.get("Process")!.map((s) => s.id)).toEqual(["2", "4"]);
  });

  it("finds a matrix cell's links and whether an element made any", () => {
    const cells = [
      { process_id: "p1", application_id: "a1", source: "relation" },
      { process_id: "p1", application_id: "a1", source: "element", element_name: "Bill" },
      { process_id: "p1", application_id: "a2", source: "relation" },
      { process_id: "p2", application_id: "a1", source: "element" },
    ];
    expect(matrixCell(cells, "p1", "a1")).toEqual({ links: cells.slice(0, 2), viaElement: true });
    expect(matrixCell(cells, "p1", "a2")).toEqual({ links: [cells[2]], viaElement: false });
    expect(matrixCell(cells, "p2", "a2")).toEqual({ links: [], viaElement: false });
  });

  it("names a node, or falls back to its id", () => {
    const nodes = [
      { id: "n1", name: "Order" },
      { id: "n2", name: "" },
    ];
    expect(nameOrId(nodes, "n1")).toBe("Order");
    expect(nameOrId(nodes, "n2")).toBe("n2");
    expect(nameOrId(nodes, "gone")).toBe("gone");
  });
});
