import { describe, it, expect } from "vitest";
import {
  NOT_SET_KEY,
  buildGroupedRows,
  glueGroups,
  groupKeyOn,
  type GroupAxis,
  type GroupedRow,
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
