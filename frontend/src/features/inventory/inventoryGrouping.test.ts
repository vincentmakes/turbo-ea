import { describe, it, expect } from "vitest";
import {
  NOT_SET_KEY,
  buildGroupedRows,
  glueGroups,
  groupKeyOf,
  parseGroupBy,
  serializeGroupBy,
  type GroupBySpec,
  type InventoryRow,
} from "./inventoryGrouping";
import type { Card } from "@/types";

function card(overrides: Partial<Card>): Card {
  return {
    id: Math.random().toString(36).slice(2),
    type: "Application",
    name: "App",
    status: "ACTIVE",
    approval_status: "DRAFT",
    data_quality: 0,
    tags: [],
    stakeholders: [],
    ...overrides,
  };
}

const CRITICALITY: GroupBySpec = { kind: "attribute", fieldKey: "businessCriticality" };
const VOCAB = [
  { key: "missionCritical", label: "Mission Critical" },
  { key: "businessCritical", label: "Business Critical" },
  { key: "administrative", label: "Administrative" },
];

describe("parseGroupBy / serializeGroupBy", () => {
  it("round-trips every axis", () => {
    for (const raw of ["subtype", "lifecycle", "approval_status", "attr_businessCriticality"]) {
      expect(serializeGroupBy(parseGroupBy(raw))).toBe(raw);
    }
  });

  it("rejects unknown or empty values", () => {
    expect(parseGroupBy(null)).toBeNull();
    expect(parseGroupBy("")).toBeNull();
    expect(parseGroupBy("nonsense")).toBeNull();
    expect(parseGroupBy("attr_")).toBeNull();
    expect(serializeGroupBy(null)).toBeNull();
  });
});

describe("groupKeyOf", () => {
  it("maps empty values to NOT_SET_KEY on every axis", () => {
    const empty = card({ attributes: {} });
    expect(groupKeyOf(empty, { kind: "subtype" })).toBe(NOT_SET_KEY);
    expect(groupKeyOf(empty, { kind: "lifecycle" })).toBe(NOT_SET_KEY);
    expect(groupKeyOf(card({ approval_status: "" }), { kind: "approval" })).toBe(NOT_SET_KEY);
    expect(groupKeyOf(empty, CRITICALITY)).toBe(NOT_SET_KEY);
    expect(groupKeyOf(card({ attributes: { businessCriticality: "" } }), CRITICALITY)).toBe(
      NOT_SET_KEY,
    );
  });

  it("reads the raw stored value per axis", () => {
    expect(groupKeyOf(card({ subtype: "microservice" }), { kind: "subtype" })).toBe("microservice");
    expect(groupKeyOf(card({ approval_status: "APPROVED" }), { kind: "approval" })).toBe("APPROVED");
    expect(
      groupKeyOf(card({ attributes: { businessCriticality: "missionCritical" } }), CRITICALITY),
    ).toBe("missionCritical");
    // A lifecycle date in the past puts the card in that phase.
    expect(groupKeyOf(card({ lifecycle: { active: "2000-01-01" } }), { kind: "lifecycle" })).toBe(
      "active",
    );
  });
});

describe("buildGroupedRows", () => {
  const notSet = card({ id: "n1", attributes: {} });
  const mission1 = card({ id: "m1", attributes: { businessCriticality: "missionCritical" } });
  const mission2 = card({ id: "m2", attributes: { businessCriticality: "missionCritical" } });
  const admin1 = card({ id: "a1", attributes: { businessCriticality: "administrative" } });

  it("emits Not set first, then vocabulary order, skipping empty groups", () => {
    const rows = buildGroupedRows(
      [admin1, mission1, notSet, mission2],
      CRITICALITY,
      VOCAB,
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

  it("carries counts and member ids on the header", () => {
    const rows = buildGroupedRows([mission1, mission2], CRITICALITY, VOCAB, new Set(), null, "Not set");
    const header = rows[0].__group!;
    expect(header.count).toBe(2);
    expect(header.memberIds).toEqual(["m1", "m2"]);
    expect(header.axis).toBe("attr_businessCriticality");
  });

  it("collapsed groups emit the header only", () => {
    const rows = buildGroupedRows(
      [mission1, mission2, admin1],
      CRITICALITY,
      VOCAB,
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

  it("headers clone the representative member so column filters see real values", () => {
    const rows = buildGroupedRows(
      [mission1, mission2],
      CRITICALITY,
      VOCAB,
      new Set(),
      new Map([["missionCritical", mission2]]),
      "Not set",
    );
    expect(rows[0].id).toBe("m2");
    expect(rows[0].__group).toBeDefined();
    // Falls back to the first member without a representative map.
    const fallback = buildGroupedRows([mission1, mission2], CRITICALITY, VOCAB, new Set(), null, "Not set");
    expect(fallback[0].id).toBe("m1");
  });

  it("keeps values whose option was deleted, after the vocabulary groups", () => {
    const stray = card({ id: "s1", attributes: { businessCriticality: "legacyValue" } });
    const rows = buildGroupedRows([stray, admin1], CRITICALITY, VOCAB, new Set(), null, "Not set");
    const headerKeys = rows.filter((r) => r.__group).map((r) => r.__group!.key);
    expect(headerKeys).toEqual(["administrative", "legacyValue"]);
    expect(rows.find((r) => r.__group?.key === "legacyValue")!.__group!.label).toBe("legacyValue");
  });
});

describe("glueGroups", () => {
  const node = (row: InventoryRow) => ({ data: row });

  it("re-glues headers above their sorted members in fixed group order", () => {
    const rows = buildGroupedRows(
      [
        card({ id: "b", name: "Beta", attributes: { businessCriticality: "missionCritical" } }),
        card({ id: "a", name: "Alpha", attributes: { businessCriticality: "missionCritical" } }),
        card({ id: "z", name: "Zulu", attributes: { businessCriticality: "administrative" } }),
      ],
      CRITICALITY,
      VOCAB,
      new Set(),
      null,
      "Not set",
    );
    // Simulate AG Grid sorting by name: headers (member clones) sort among leaves.
    const sorted = rows.map(node).sort((x, y) => x.data.name.localeCompare(y.data.name));
    glueGroups(sorted, CRITICALITY);
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
      [
        card({ id: "1", name: "A", attributes: { businessCriticality: "administrative" } }),
        card({ id: "2", name: "B", attributes: { businessCriticality: "administrative" } }),
      ],
      CRITICALITY,
      VOCAB,
      new Set(),
      null,
      "Not set",
    );
    const desc = rows.map(node).sort((x, y) => y.data.name.localeCompare(x.data.name));
    glueGroups(desc, CRITICALITY);
    expect(desc.map((n) => (n.data.__group ? "H" : n.data.id))).toEqual(["H", "2", "1"]);
  });

  it("leaves an ungrouped node list untouched apart from group gluing", () => {
    const nodes = [node(card({ id: "x" }) as InventoryRow)];
    glueGroups(nodes, CRITICALITY);
    expect(nodes.map((n) => n.data.id)).toEqual(["x"]);
  });
});
