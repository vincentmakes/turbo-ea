import { describe, it, expect } from "vitest";
import { relationAttributeBadge } from "./RelationAttributesEditor";
import type { RelationType } from "@/types";

const usageType: RelationType = {
  key: "relOrgToApp",
  label: "uses",
  reverse_label: "is used by",
  source_type_key: "Organization",
  target_type_key: "Application",
  cardinality: "n:m",
  built_in: true,
  is_hidden: false,
  attributes_schema: [
    {
      key: "usageType",
      label: "Usage Type",
      type: "single_select",
      options: [
        { key: "owner", label: "Owner", color: "#1976d2" },
        { key: "user", label: "User", color: "#66bb6a" },
      ],
    },
  ],
} as unknown as RelationType;

const flowOnly: RelationType = {
  key: "relAppToInterface",
  label: "provides / consumes",
  source_type_key: "Application",
  target_type_key: "Interface",
  cardinality: "n:m",
  built_in: true,
  is_hidden: false,
  attributes_schema: [
    {
      key: "flowDirection",
      label: "Flow direction",
      type: "single_select",
      options: [{ key: "forward", label: "Forward" }],
    },
  ],
} as unknown as RelationType;

describe("relationAttributeBadge", () => {
  it("returns null when no value is set", () => {
    expect(relationAttributeBadge(usageType, {})).toBeNull();
    expect(relationAttributeBadge(usageType, undefined)).toBeNull();
  });

  it("returns the selected option with its colour for usageType", () => {
    const badge = relationAttributeBadge(usageType, { usageType: "owner" });
    expect(badge).not.toBeNull();
    expect(badge?.fieldKey).toBe("usageType");
    expect(badge?.fieldLabel).toBe("Usage Type");
    expect(badge?.optionKey).toBe("owner");
    expect(badge?.optionLabel).toBe("Owner");
    expect(badge?.color).toBe("#1976d2");
  });

  it("ignores flowDirection (rendered as a directional icon instead)", () => {
    expect(relationAttributeBadge(flowOnly, { flowDirection: "forward" })).toBeNull();
  });

  it("returns null for an unknown option value", () => {
    expect(relationAttributeBadge(usageType, { usageType: "bogus" })).toBeNull();
  });

  it("returns null when relationType is undefined", () => {
    expect(relationAttributeBadge(undefined, { usageType: "owner" })).toBeNull();
  });
});
