import { describe, it, expect } from "vitest";
import { CATEGORICAL_COLORS } from "@/theme/tokens";
import {
  NOT_SET_KEY,
  buildGroupedRows,
  buildTreeLayout,
  forestOrder,
  collapsedSetForFocus,
  glueGroups,
  groupKeyOn,
  resolveVocabColor,
  type GroupAxis,
  type GroupedRow,
  type TreeAccess,
} from "./rowGrouping";

interface Row {
  id: string;
  name: string;
  criticality?: string;
}

function row(id: string, name: string, criticality?: string): Row {
  return { id, name, criticality };
}

const AXIS: GroupAxis<Row> = {
  key: "attr_businessCriticality",
  label: "Business Criticality",
  groupKeyOf: (r) => r.criticality,
  vocab: [
    { key: "missionCritical", label: "Mission Critical" },
    { key: "businessCritical", label: "Business Critical" },
    { key: "administrative", label: "Administrative" },
  ],
};

describe("groupKeyOn", () => {
  it("maps empty axis values to NOT_SET_KEY", () => {
    expect(groupKeyOn(row("a", "A"), AXIS)).toBe(NOT_SET_KEY);
    expect(groupKeyOn(row("a", "A", ""), AXIS)).toBe(NOT_SET_KEY);
    expect(groupKeyOn(row("a", "A", "administrative"), AXIS)).toBe("administrative");
  });
});

describe("buildGroupedRows", () => {
  const notSet = row("n1", "N");
  const mission1 = row("m1", "M1", "missionCritical");
  const mission2 = row("m2", "M2", "missionCritical");
  const admin1 = row("a1", "A1", "administrative");

  it("emits Not set first, then vocabulary order, skipping empty groups", () => {
    const rows = buildGroupedRows(
      [admin1, mission1, notSet, mission2],
      AXIS,
      new Set(),
      null,
      "Not set",
    );
    const headers = rows.filter((r) => r.__group).map((r) => r.__group!);
    expect(headers.map((h) => h.key)).toEqual([NOT_SET_KEY, "missionCritical", "administrative"]);
    expect(headers.map((h) => h.label)).toEqual(["Not set", "Mission Critical", "Administrative"]);
    expect(headers.map((h) => h.index)).toEqual([0, 1, 2]);
    // Members directly follow their header.
    expect(rows.map((r) => (r.__group ? `H:${r.__group.key}` : r.id))).toEqual([
      `H:${NOT_SET_KEY}`,
      "n1",
      "H:missionCritical",
      "m1",
      "m2",
      "H:administrative",
      "a1",
    ]);
  });

  it("carries counts, member ids, and the axis id on the header", () => {
    const rows = buildGroupedRows([mission1, mission2], AXIS, new Set(), null, "Not set");
    const header = rows[0].__group!;
    expect(header.count).toBe(2);
    expect(header.memberIds).toEqual(["m1", "m2"]);
    expect(header.axis).toBe("attr_businessCriticality");
  });

  it("carries the vocabulary color onto the header (none for Not set)", () => {
    const colored: GroupAxis<Row> = {
      ...AXIS,
      vocab: [{ key: "missionCritical", label: "Mission Critical", color: "#d32f2f" }],
    };
    const rows = buildGroupedRows([mission1, notSet], colored, new Set(), null, "Not set");
    expect(rows.find((r) => r.__group?.key === "missionCritical")!.__group!.color).toBe("#d32f2f");
    expect(rows.find((r) => r.__group?.key === NOT_SET_KEY)!.__group!.color).toBeUndefined();
  });

  it("falls back to a categorical color on an axis whose vocabulary has none", () => {
    // AXIS carries no colors at all — the subtype / owner / category case.
    const rows = buildGroupedRows([mission1, admin1], AXIS, new Set(), null, "Not set");
    const mission = rows.find((r) => r.__group?.key === "missionCritical")!.__group!;
    const admin = rows.find((r) => r.__group?.key === "administrative")!.__group!;
    expect(mission.color).toBe(CATEGORICAL_COLORS[0]);
    expect(admin.color).toBe(CATEGORICAL_COLORS[2]);
    // Neighbours must be told apart — that is the whole point of the palette.
    expect(mission.color).not.toBe(admin.color);
  });

  it("keeps a group's fallback color when an earlier group empties out", () => {
    const all = buildGroupedRows([mission1, admin1], AXIS, new Set(), null, "Not set");
    const withoutMission = buildGroupedRows([admin1], AXIS, new Set(), null, "Not set");
    // Colors index the axis vocabulary, not the surviving groups, so filtering
    // one group away must not re-hue everything below it.
    expect(withoutMission.find((r) => r.__group?.key === "administrative")!.__group!.color).toBe(
      all.find((r) => r.__group?.key === "administrative")!.__group!.color,
    );
  });

  it("leaves stray keys uncolored", () => {
    // A value whose metamodel option was deleted: it renders as the raw key,
    // and coloring it would dress a data-quality problem up as intentional.
    const rows = buildGroupedRows([row("x", "X", "retired")], AXIS, new Set(), null, "Not set");
    expect(rows.find((r) => r.__group?.key === "retired")!.__group!.color).toBeUndefined();
  });

  it("collapsed groups emit the header only", () => {
    const rows = buildGroupedRows(
      [mission1, mission2, admin1],
      AXIS,
      new Set(["missionCritical"]),
      null,
      "Not set",
    );
    expect(rows.map((r) => (r.__group ? `H:${r.__group.key}` : r.id))).toEqual([
      "H:missionCritical",
      "H:administrative",
      "a1",
    ]);
    expect(rows[0].__group!.collapsed).toBe(true);
    expect(rows[0].__group!.count).toBe(2);
  });

  it("headers clone the representative member so grid filters see real values", () => {
    const rows = buildGroupedRows(
      [mission1, mission2],
      AXIS,
      new Set(),
      new Map([["missionCritical", mission2]]),
      "Not set",
    );
    expect(rows[0].id).toBe("m2");
    expect(rows[0].__group).toBeDefined();
    // Falls back to the first member without a representative map.
    const fallback = buildGroupedRows([mission1, mission2], AXIS, new Set(), null, "Not set");
    expect(fallback[0].id).toBe("m1");
  });

  it("keeps values whose vocab entry was deleted, after the vocabulary groups", () => {
    const stray = row("s1", "S", "legacyValue");
    const rows = buildGroupedRows([stray, admin1], AXIS, new Set(), null, "Not set");
    const headerKeys = rows.filter((r) => r.__group).map((r) => r.__group!.key);
    expect(headerKeys).toEqual(["administrative", "legacyValue"]);
    expect(rows.find((r) => r.__group?.key === "legacyValue")!.__group!.label).toBe("legacyValue");
  });
});

describe("collapsedSetForFocus", () => {
  it("collapses every present group except the focus, Not set and stray keys included", () => {
    const rows = [
      row("a", "A", "missionCritical"),
      row("b", "B", "administrative"),
      row("c", "C", "legacyValue"),
      row("d", "D"),
    ];
    const collapsed = collapsedSetForFocus(rows, AXIS, "missionCritical");
    expect(collapsed).toEqual(new Set(["administrative", "legacyValue", NOT_SET_KEY]));
  });

  it("focusing the Not set bucket keeps it expanded", () => {
    const rows = [row("a", "A", "missionCritical"), row("d", "D")];
    const collapsed = collapsedSetForFocus(rows, AXIS, NOT_SET_KEY);
    expect(collapsed).toEqual(new Set(["missionCritical"]));
  });
});

describe("glueGroups", () => {
  const node = (r: GroupedRow<Row>) => ({ data: r });

  it("re-glues headers above their sorted members in fixed group order", () => {
    const rows = buildGroupedRows(
      [
        row("b", "Beta", "missionCritical"),
        row("a", "Alpha", "missionCritical"),
        row("z", "Zulu", "administrative"),
      ],
      AXIS,
      new Set(),
      null,
      "Not set",
    );
    // Simulate AG Grid sorting by name: headers (member clones) sort among leaves.
    const sorted = rows.map(node).sort((x, y) => x.data.name.localeCompare(y.data.name));
    glueGroups(sorted, AXIS);
    expect(sorted.map((n) => (n.data.__group ? `H:${n.data.__group.key}` : n.data.id))).toEqual([
      "H:missionCritical",
      "a",
      "b",
      "H:administrative",
      "z",
    ]);
  });

  it("preserves the sort order the leaves arrived in", () => {
    const rows = buildGroupedRows(
      [row("1", "A", "administrative"), row("2", "B", "administrative")],
      AXIS,
      new Set(),
      null,
      "Not set",
    );
    const desc = rows.map(node).sort((x, y) => y.data.name.localeCompare(x.data.name));
    glueGroups(desc, AXIS);
    expect(desc.map((n) => (n.data.__group ? "H" : n.data.id))).toEqual(["H", "2", "1"]);
  });

  it("leaves an ungrouped node list untouched apart from group gluing", () => {
    const nodes = [node(row("x", "X"))];
    glueGroups(nodes, AXIS);
    expect(nodes.map((n) => n.data.id)).toEqual(["x"]);
  });
});

describe("resolveVocabColor", () => {
  it("prefers the entry's own color", () => {
    expect(resolveVocabColor({ key: "a", label: "A", color: "#d32f2f" }, 3)).toBe("#d32f2f");
  });

  it("falls back to the categorical palette by position", () => {
    expect(resolveVocabColor({ key: "a", label: "A" }, 0)).toBe(CATEGORICAL_COLORS[0]);
    expect(resolveVocabColor({ key: "b", label: "B" }, 4)).toBe(CATEGORICAL_COLORS[4]);
  });

  it("wraps around a vocabulary longer than the palette", () => {
    expect(resolveVocabColor({ key: "a", label: "A" }, CATEGORICAL_COLORS.length)).toBe(
      CATEGORICAL_COLORS[0],
    );
  });
});


// ---------------------------------------------------------------------------
// Tree layer ("Indent children under parents")
// ---------------------------------------------------------------------------

interface TRow {
  id: string;
  name: string;
  parent?: string | null;
  criticality?: string;
}

const tr = (id: string, parent?: string | null, criticality?: string): TRow => ({
  id,
  name: id.toUpperCase(),
  parent,
  criticality,
});

/** Access over a fixed "loaded cards" table — lookups may reach cards that
 * are not members of the group being laid out. */
function accessOver(all: TRow[]): TreeAccess<TRow> {
  const byId = new Map(all.map((r) => [r.id, r]));
  return {
    parentIdOf: (r) => r.parent,
    lookup: (id) => {
      const r = byId.get(id);
      return r ? { name: r.name, parentId: r.parent } : undefined;
    },
  };
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("buildTreeLayout", () => {
  it("nests same-group children under their parent in pre-order", () => {
    const rows = [tr("c1", "p"), tr("q"), tr("p"), tr("g", "c1"), tr("c2", "p")];
    const layout = buildTreeLayout(rows, accessOver(rows), null, new Set());
    expect(ids(layout.emitted)).toEqual(["q", "p", "c1", "g", "c2"]);
    expect(layout.info.get("p")).toEqual({
      depth: 0,
      crumbIds: [],
      crumbTruncated: false,
      hasChildren: true,
      collapsed: false,
      hiddenDescendants: 0,
    });
    expect(layout.info.get("c1")!.depth).toBe(1);
    expect(layout.info.get("g")!.depth).toBe(2);
    expect(layout.info.get("c2")!.depth).toBe(1);
    expect(layout.info.get("q")!.hasChildren).toBe(false);
    expect(layout.info.get("g")!.hasChildren).toBe(false);
    expect(layout.hidden).toBe(0);
  });

  it("keeps sibling input order", () => {
    const rows = [tr("p"), tr("b", "p"), tr("a", "p"), tr("c", "p")];
    const layout = buildTreeLayout(rows, accessOver(rows), null, new Set());
    expect(ids(layout.emitted)).toEqual(["p", "b", "a", "c"]);
  });

  it("roots a child whose parent is in another group and names the ancestors", () => {
    const all = [tr("gp"), tr("p", "gp"), tr("c", "p")];
    // Only `c` is in this group.
    const layout = buildTreeLayout([all[2]], accessOver(all), null, new Set());
    expect(ids(layout.emitted)).toEqual(["c"]);
    expect(layout.info.get("c")).toMatchObject({
      depth: 0,
      crumbIds: ["gp", "p"],
      crumbTruncated: false,
    });
  });

  it("roots a child whose parent fails the grid filters, nests it when no filter", () => {
    const rows = [tr("p"), tr("c", "p")];
    const filtered = buildTreeLayout(rows, accessOver(rows), new Set(["c"]), new Set());
    expect(filtered.info.get("c")).toMatchObject({ depth: 0, crumbIds: ["p"] });
    expect(filtered.info.get("p")!.hasChildren).toBe(false);
    const open = buildTreeLayout(rows, accessOver(rows), null, new Set());
    expect(open.info.get("c")).toMatchObject({ depth: 1, crumbIds: [] });
    // A visible parent still nests when a filter is active.
    const both = buildTreeLayout(rows, accessOver(rows), new Set(["p", "c"]), new Set());
    expect(both.info.get("c")!.depth).toBe(1);
  });

  it("marks the crumb truncated when an ancestor is not loaded", () => {
    const loaded = [tr("p", "unloaded"), tr("c", "p")];
    const layout = buildTreeLayout([loaded[1]], accessOver(loaded), null, new Set());
    expect(layout.info.get("c")).toMatchObject({ crumbIds: ["p"], crumbTruncated: true });
    // Directly missing parent: empty chain, still truncated.
    const orphan = buildTreeLayout([tr("x", "gone")], accessOver([]), null, new Set());
    expect(orphan.info.get("x")).toMatchObject({ crumbIds: [], crumbTruncated: true });
  });

  it("a root without a parent has no crumb", () => {
    const layout = buildTreeLayout([tr("r", null)], accessOver([]), null, new Set());
    expect(layout.info.get("r")).toMatchObject({ crumbIds: [], crumbTruncated: false });
  });

  it("terminates on a two-node cycle and emits each node once", () => {
    const rows = [tr("a", "b"), tr("b", "a")];
    const layout = buildTreeLayout(rows, accessOver(rows), null, new Set());
    expect(ids(layout.emitted)).toEqual(["a", "b"]);
    expect(layout.info.get("a")!.depth).toBe(0);
    expect(layout.info.get("b")!.depth).toBe(1);
  });

  it("treats a self-parent as a root with no crumb", () => {
    const rows = [tr("s", "s")];
    const layout = buildTreeLayout(rows, accessOver(rows), null, new Set());
    expect(ids(layout.emitted)).toEqual(["s"]);
    expect(layout.info.get("s")).toMatchObject({
      depth: 0,
      crumbIds: [],
      crumbTruncated: false,
      hasChildren: false,
    });
  });

  it("hides the subtree of a collapsed parent and counts it", () => {
    const rows = [tr("p"), tr("c1", "p"), tr("g", "c1"), tr("c2", "p"), tr("q")];
    const layout = buildTreeLayout(rows, accessOver(rows), null, new Set(["p"]));
    expect(ids(layout.emitted)).toEqual(["p", "q"]);
    expect(layout.info.get("p")).toMatchObject({ collapsed: true, hiddenDescendants: 3 });
    expect(layout.hidden).toBe(3);
  });

  it("counts only visible descendants under a collapsed parent", () => {
    const rows = [tr("p"), tr("c1", "p"), tr("c2", "p")];
    const layout = buildTreeLayout(rows, accessOver(rows), new Set(["p", "c1"]), new Set(["p"]));
    expect(layout.info.get("p")).toMatchObject({ collapsed: true, hiddenDescendants: 1 });
    expect(layout.hidden).toBe(1);
    expect(ids(layout.emitted)).toEqual(["p"]);
  });

  it("a nested collapsed parent under a collapsed one is counted once", () => {
    const rows = [tr("p"), tr("c", "p"), tr("g", "c")];
    const layout = buildTreeLayout(rows, accessOver(rows), null, new Set(["p", "c"]));
    expect(ids(layout.emitted)).toEqual(["p"]);
    expect(layout.hidden).toBe(2);
    expect(layout.info.get("c")!.collapsed).toBe(false);
  });

  it("collapsing a leaf has no effect", () => {
    const rows = [tr("p"), tr("c", "p")];
    const layout = buildTreeLayout(rows, accessOver(rows), null, new Set(["c"]));
    expect(ids(layout.emitted)).toEqual(["p", "c"]);
    expect(layout.info.get("c")).toMatchObject({ collapsed: false, hiddenDescendants: 0 });
    expect(layout.hidden).toBe(0);
  });
});

describe("buildGroupedRows with a tree layout", () => {
  const TAXIS: GroupAxis<TRow> = {
    key: "crit",
    label: "Crit",
    groupKeyOf: (r) => r.criticality,
    vocab: [
      { key: "high", label: "High" },
      { key: "low", label: "Low" },
    ],
  };
  const rows = [tr("c", "p", "high"), tr("p", null, "high"), tr("x", "p", "low")];
  const access = accessOver(rows);

  it("lays out each expanded group and reports what collapse hid", () => {
    const calls: string[][] = [];
    const out = buildGroupedRows(rows, TAXIS, new Set(), null, "Not set", (members) => {
      calls.push(ids(members));
      return buildTreeLayout(members, access, null, new Set(["p"]));
    });
    expect(out.map((r) => (r.__group ? `H:${r.__group.key}` : r.id))).toEqual([
      "H:high",
      "p",
      "H:low",
      "x",
    ]);
    const high = out[0].__group!;
    // Header count and member ids stay all members.
    expect(high.count).toBe(2);
    expect(high.memberIds).toEqual(["c", "p"]);
    expect(high.treeHidden).toBe(1);
    expect(out[2].__group!.treeHidden).toBe(0);
    expect(calls).toEqual([["c", "p"], ["x"]]);
  });

  it("never lays out a collapsed group", () => {
    const calls: string[][] = [];
    const out = buildGroupedRows(rows, TAXIS, new Set(["high"]), null, "Not set", (members) => {
      calls.push(ids(members));
      return { emitted: members, hidden: 0 };
    });
    expect(calls).toEqual([["x"]]);
    expect(out[0].__group).toMatchObject({ key: "high", collapsed: true, treeHidden: 0 });
  });

  it("carries no treeHidden without a layout", () => {
    const out = buildGroupedRows(rows, TAXIS, new Set(), null, "Not set");
    expect("treeHidden" in out[0].__group!).toBe(false);
  });
});

describe("forestOrder", () => {
  const order = (leaves: TRow[]) =>
    ids(
      forestOrder(
        leaves,
        (l) => l.id,
        (l) => l.parent,
      ),
    );

  it("keeps a parent before its children and siblings in arrival order", () => {
    // Arrival = a sort by name ascending: c1 < c2 < p1 < p2 < z.
    expect(order([tr("c1", "p2"), tr("c2", "p1"), tr("p1"), tr("p2"), tr("z", "p1")])).toEqual([
      "p1",
      "c2",
      "z",
      "p2",
      "c1",
    ]);
    // Descending arrival reverses roots and siblings, still parent-first.
    expect(order([tr("z", "p1"), tr("p2"), tr("p1"), tr("c2", "p1"), tr("c1", "p2")])).toEqual([
      "p2",
      "c1",
      "p1",
      "z",
      "c2",
    ]);
  });

  it("a child whose parent is not among the leaves is a root in sort position", () => {
    expect(order([tr("a"), tr("b", "missing"), tr("c")])).toEqual(["a", "b", "c"]);
  });

  it("keeps every node of a cycle exactly once", () => {
    expect(order([tr("a", "b"), tr("b", "a"), tr("r")])).toEqual(["r", "a", "b"]);
  });

  it("handles a deep chain without recursion", () => {
    const chain: TRow[] = [];
    for (let i = 0; i < 20000; i++) chain.push(tr(`n${i}`, i === 0 ? null : `n${i - 1}`));
    const out = order([...chain].reverse());
    expect(out[0]).toBe("n0");
    expect(out[19999]).toBe("n19999");
  });
});

describe("glueGroups with a tree", () => {
  const TAXIS: GroupAxis<TRow> = {
    key: "crit",
    label: "Crit",
    groupKeyOf: (r) => r.criticality,
    vocab: [
      { key: "high", label: "High" },
      { key: "low", label: "Low" },
    ],
  };
  const node = (r: GroupedRow<TRow>) => ({ data: r });
  const label = (ns: { data: GroupedRow<TRow> }[]) =>
    ns.map((n) => (n.data.__group ? `H:${n.data.__group.key}` : n.data.id));

  it("without an axis reorders leaves as a forest and adds no headers", () => {
    const nodes = [tr("c1", "p1"), tr("p2"), tr("c2", "p2"), tr("p1")].map(node);
    glueGroups(nodes, null, (r) => r.parent);
    expect(label(nodes)).toEqual(["p2", "c2", "p1", "c1"]);
  });

  it("without an axis and without parentIdOf leaves the sort untouched", () => {
    const nodes = [tr("c1", "p1"), tr("p1")].map(node);
    glueGroups(nodes, null);
    expect(label(nodes)).toEqual(["c1", "p1"]);
  });

  it("with an axis keeps each forest inside its group; cross-group parents do not nest", () => {
    const grouped = buildGroupedRows(
      [tr("p", null, "high"), tr("c", "p", "high"), tr("x", "p", "low"), tr("a", null, "high")],
      TAXIS,
      new Set(),
      null,
      "Not set",
    );
    // Sorted by id ascending (headers sort as their representative member).
    const nodes = grouped.map(node).sort((l, r) => l.data.id.localeCompare(r.data.id));
    glueGroups(nodes, TAXIS, (r) => r.parent);
    expect(label(nodes)).toEqual(["H:high", "a", "p", "c", "H:low", "x"]);
  });

  it("keeps rows without data at the top", () => {
    const nodes: { data?: GroupedRow<TRow> }[] = [node(tr("c", "p")), {}, node(tr("p"))];
    glueGroups(nodes, null, (r) => r.parent);
    expect(nodes.map((n) => n.data?.id ?? "-")).toEqual(["-", "p", "c"]);
  });
});
