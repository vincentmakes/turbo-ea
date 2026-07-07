import { describe, expect, it } from "vitest";
import {
  ALL_LEVELS,
  buildColorSegmentsFor,
  buildGroupTree,
  getMaxGroupLevel,
  getVisibleGroupApps,
  isLeafAtDepth,
} from "./portfolioGrouping";
import type { GroupEntry, GroupMember, GroupNode } from "./portfolioGrouping";
import type { AppData, ColorResolution, RelSubtype } from "./portfolioHelpers";

const LABELS = { notSet: "Not set", multiple: "Multiple" };
const TYPE = "BusinessCapability";

function member(id: string, name: string, parentId?: string, ancestorOnly?: boolean): GroupMember {
  return { id, name, type: TYPE, parent_id: parentId ?? null, ancestor_only: ancestorOnly };
}

function app(id: string, relatedIds: string[], attributes?: Record<string, unknown>): AppData {
  return {
    id,
    name: `App ${id}`,
    attributes,
    relations: relatedIds.map((rid) => ({
      relation_type: "app_to_cap",
      related_id: rid,
      related_name: rid,
      related_type: TYPE,
      attributes: {},
    })),
    org_ids: [],
  };
}

function findNode(roots: GroupNode[], key: string): GroupNode | undefined {
  for (const r of roots) {
    if (r.key === key) return r;
    const hit = findNode(r.children, key);
    if (hit) return hit;
  }
  return undefined;
}

/** L1 root → L2 child → L3 grandchild, plus an L1 sibling. */
const HIER: GroupMember[] = [
  member("l1", "Finance"),
  member("l2", "Payments", "l1"),
  member("l3", "Card Processing", "l2"),
  member("s1", "Sales"),
];

describe("buildGroupTree", () => {
  it("builds a nested tree with 1-based levels", () => {
    const apps = [app("a", ["l3"]), app("b", ["s1"])];
    const roots = buildGroupTree(apps, TYPE, HIER);

    expect(roots.map((r) => r.key).sort()).toEqual(["l1", "s1"]);
    const l1 = findNode(roots, "l1")!;
    expect(l1.level).toBe(1);
    expect(l1.children.map((c) => c.key)).toEqual(["l2"]);
    expect(findNode(roots, "l2")!.level).toBe(2);
    expect(findNode(roots, "l3")!.level).toBe(3);
  });

  it("treats a child whose parent is absent as a root", () => {
    const members = [member("orphan", "Orphan", "missing-parent")];
    const roots = buildGroupTree([app("a", ["orphan"])], TYPE, members);
    expect(roots).toHaveLength(1);
    expect(roots[0].key).toBe("orphan");
    expect(roots[0].level).toBe(1);
  });

  it("dedups roll-up: an app related to two sibling leaves appears once in the parent", () => {
    const members = [member("p", "Parent"), member("c1", "C1", "p"), member("c2", "C2", "p")];
    const roots = buildGroupTree([app("a", ["c1", "c2"])], TYPE, members);
    const parent = findNode(roots, "p")!;
    expect(parent.deepCount).toBe(1);
    expect(parent.children).toHaveLength(2);
  });

  it("own-direct relation wins memberId attribution over a descendant entry", () => {
    // App related to BOTH the ancestor l1 and the descendant l3.
    const roots = buildGroupTree([app("a", ["l1", "l3"])], TYPE, HIER);
    const l1 = findNode(roots, "l1")!;
    expect(l1.deepCount).toBe(1);
    expect(l1.deepApps.get("a")!.memberId).toBe("l1");
    // The descendant keeps its own attribution.
    expect(findNode(roots, "l3")!.deepApps.get("a")!.memberId).toBe("l3");
  });

  it("prunes subtrees with no cards, keeping ancestors alive via deep descendants", () => {
    const apps = [app("a", ["l3"])];
    const roots = buildGroupTree(apps, TYPE, HIER);
    // "Sales" has no cards anywhere → dropped. l1/l2 are ancestor-only-ish
    // (no direct cards) but kept because l3 below them has one.
    expect(roots.map((r) => r.key)).toEqual(["l1"]);
    expect(findNode(roots, "l2")).toBeDefined();
    expect(findNode(roots, "l3")).toBeDefined();
  });

  it("sorts siblings by deep count desc, then name asc", () => {
    const members = [
      member("x", "Zeta"),
      member("y", "Alpha"),
      member("z", "Beta"),
    ];
    const apps = [
      app("a", ["x"]),
      app("b", ["x"]),
      app("c", ["y"]),
      app("d", ["z"]),
    ];
    const roots = buildGroupTree(apps, TYPE, members);
    expect(roots.map((r) => r.label)).toEqual(["Zeta", "Alpha", "Beta"]);
  });

  it("honours memberMatch (relation-subtype filters) per member", () => {
    const members = [member("p", "Parent"), member("c", "Child", "p")];
    const apps = [app("a", ["p", "c"])];
    const roots = buildGroupTree(apps, TYPE, members, (_app, memberId) => memberId === "c");
    const parent = findNode(roots, "p")!;
    expect(parent.directApps).toHaveLength(0);
    expect(findNode(roots, "c")!.directApps).toHaveLength(1);
    // Roll-up attribution comes from the matching child.
    expect(parent.deepApps.get("a")!.memberId).toBe("c");
  });

  it("ignores relations to other card types", () => {
    const a: AppData = {
      ...app("a", []),
      relations: [
        {
          relation_type: "app_to_org",
          related_id: "l1",
          related_name: "l1",
          related_type: "Organization",
          attributes: {},
        },
      ],
    };
    expect(buildGroupTree([a], TYPE, HIER)).toEqual([]);
  });
});

describe("getVisibleGroupApps / isLeafAtDepth", () => {
  it("rolls the whole subtree into a node cut off by the display depth", () => {
    const apps = [app("a", ["l3"]), app("b", ["l2"])];
    const roots = buildGroupTree(apps, TYPE, HIER);
    const l1 = findNode(roots, "l1")!;
    expect(isLeafAtDepth(l1, 1)).toBe(true);
    const visible = getVisibleGroupApps(l1, 1);
    expect(visible.map((e) => e.app.id).sort()).toEqual(["a", "b"]);
    // Rolled-up entries keep their own (deepest) member attribution.
    expect(visible.find((e) => e.app.id === "a")!.memberId).toBe("l3");
  });

  it("shows only direct apps absent from child subtrees on a non-leaf node", () => {
    const apps = [app("a", ["l1"]), app("b", ["l1", "l2"]), app("c", ["l3"])];
    const roots = buildGroupTree(apps, TYPE, HIER);
    const l1 = findNode(roots, "l1")!;
    expect(isLeafAtDepth(l1, ALL_LEVELS)).toBe(false);
    // "b" also lives under l2, so at full depth l1 shows only "a".
    expect(getVisibleGroupApps(l1, ALL_LEVELS).map((e) => e.app.id)).toEqual(["a"]);
  });

  it("each app appears at exactly one visible node, at every depth", () => {
    const apps = [
      app("a", ["l1"]),
      app("b", ["l2"]),
      app("c", ["l3"]),
      app("d", ["l2", "l3"]),
      app("e", ["s1"]),
    ];
    const roots = buildGroupTree(apps, TYPE, HIER);

    for (const depth of [1, 2, 3, ALL_LEVELS]) {
      const seen: string[] = [];
      const walk = (n: GroupNode) => {
        for (const e of getVisibleGroupApps(n, depth)) seen.push(e.app.id);
        if (!isLeafAtDepth(n, depth)) n.children.forEach(walk);
      };
      roots.forEach(walk);
      expect(seen.sort()).toEqual(["a", "b", "c", "d", "e"]);
    }
  });
});

describe("getMaxGroupLevel", () => {
  it("returns the deepest level present after pruning", () => {
    const roots = buildGroupTree([app("a", ["l3"])], TYPE, HIER);
    expect(getMaxGroupLevel(roots)).toBe(3);
    const shallow = buildGroupTree([app("a", ["l1"])], TYPE, HIER);
    expect(getMaxGroupLevel(shallow)).toBe(1);
    expect(getMaxGroupLevel([])).toBe(0);
  });
});

describe("buildColorSegmentsFor", () => {
  const sub: RelSubtype = {
    composite: "app_to_cap::usageType",
    relTypeKey: "app_to_cap",
    fieldKey: "usageType",
    relatedTypeKey: TYPE,
    comboLabel: "relates to · Usage Type",
    options: [
      { key: "owner", label: "Owner", color: "#1976d2" },
      { key: "user", label: "User", color: "#66bb6a" },
    ],
  };
  const res: ColorResolution = { kind: "rel", sub };

  it("colours each rolled-up entry by its OWN member relation", () => {
    const a: AppData = {
      ...app("a", []),
      relations: [
        {
          relation_type: "app_to_cap",
          related_id: "l3",
          related_name: "l3",
          related_type: TYPE,
          attributes: { usageType: "owner" },
        },
      ],
    };
    // Entry attributed to l3, displayed rolled-up under l1.
    const entries: GroupEntry[] = [{ app: a, memberId: "l3" }];
    const segments = buildColorSegmentsFor(entries, res, LABELS, true);
    expect(segments).toEqual([{ color: "#1976d2", label: "Owner", n: 1 }]);
    // Without per-member scoping the same single relation still buckets once.
    const flat = buildColorSegmentsFor(entries, res, LABELS, false);
    expect(flat).toHaveLength(1);
  });

  it("returns [] for the no-colour resolution", () => {
    const entries: GroupEntry[] = [{ app: app("a", ["l1"]), memberId: "l1" }];
    expect(buildColorSegmentsFor(entries, { kind: "none" }, LABELS, false)).toEqual([]);
  });
});
