import { describe, it, expect } from "vitest";
import { moveFieldBetweenSections, ungroupedZoneColumn, ungroupedZoneHit } from "./CardLayoutEditor";
import type { SectionDef } from "@/types";

function schema(): SectionDef[] {
  return [
    {
      section: "Application Information",
      fields: [
        { key: "hostingType", label: "Hosting Type", type: "single_select" },
        { key: "commercialApplication", label: "Commercial", type: "boolean" },
      ],
    },
    {
      section: "Assessment",
      fields: [{ key: "timeModel", label: "TIME Model", type: "single_select" }],
    },
  ];
}

describe("moveFieldBetweenSections", () => {
  it("moves a field to the target section, preserving its definition", () => {
    const next = moveFieldBetweenSections(schema(), 0, "hostingType", 1);
    expect(next).not.toBeNull();
    const src = next![0].fields.map((f) => f.key);
    const dst = next![1].fields;
    expect(src).toEqual(["commercialApplication"]);
    expect(dst.map((f) => f.key)).toEqual(["timeModel", "hostingType"]);
    // Definition preserved (type kept), landed ungrouped in column 0.
    const moved = dst.find((f) => f.key === "hostingType")!;
    expect(moved.type).toBe("single_select");
    expect(moved.group).toBeUndefined();
    expect(moved.column).toBe(0);
  });

  it("clears any group when moving (target may not share groups)", () => {
    const s = schema();
    s[0].fields[0].group = "Hosting";
    s[0].fields[0].column = 1;
    const next = moveFieldBetweenSections(s, 0, "hostingType", 1);
    const moved = next![1].fields.find((f) => f.key === "hostingType")!;
    expect(moved.group).toBeUndefined();
    expect(moved.column).toBe(0);
  });

  it("does not mutate the input schema", () => {
    const s = schema();
    const before = JSON.stringify(s);
    moveFieldBetweenSections(s, 0, "hostingType", 1);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("returns null for a no-op (same section), missing field, or bad index", () => {
    expect(moveFieldBetweenSections(schema(), 0, "hostingType", 0)).toBeNull();
    expect(moveFieldBetweenSections(schema(), 0, "doesNotExist", 1)).toBeNull();
    expect(moveFieldBetweenSections(schema(), 0, "hostingType", 5)).toBeNull();
    expect(moveFieldBetweenSections(schema(), -1, "hostingType", 1)).toBeNull();
  });
});

describe("Ungrouped fields drop zone (#1286)", () => {
  it("names the column a zone id stands for, and nothing for any other id", () => {
    expect(ungroupedZoneColumn("ungrouped:col-0")).toBe("col-0");
    expect(ungroupedZoneColumn("ungrouped:col-1")).toBe("col-1");
    expect(ungroupedZoneColumn("col-0")).toBeUndefined();
    expect(ungroupedZoneColumn("group:ungrouped:col-0")).toBeUndefined();
    expect(ungroupedZoneColumn("alpha")).toBeUndefined();
  });

  const hits = [{ id: "group:Grp" }, { id: "ungrouped:col-1" }, { id: "col-1" }];

  it("lets a dragged field's zone outrank the group it is also inside", () => {
    expect(ungroupedZoneHit(hits, "field")).toEqual({ id: "ungrouped:col-1" });
    expect(ungroupedZoneHit(hits, undefined)).toEqual({ id: "ungrouped:col-1" });
  });

  it("gives a dragged group no zone, and nothing when no zone is hit", () => {
    expect(ungroupedZoneHit(hits, "group")).toBeUndefined();
    expect(ungroupedZoneHit([{ id: "group:Grp" }, { id: "col-0" }], "field")).toBeUndefined();
  });
});
