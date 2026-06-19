import { describe, it, expect } from "vitest";
import { relationAttributeBadges } from "./RelationAttributesEditor";
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

const multiDimension: RelationType = {
  key: "relProcessToApp",
  label: "uses",
  source_type_key: "BusinessProcess",
  target_type_key: "Application",
  cardinality: "n:m",
  built_in: true,
  is_hidden: false,
  attributes_schema: [
    {
      key: "usageType",
      label: "Usage",
      type: "single_select",
      options: [{ key: "reads", label: "Reads", color: "#1976d2" }],
    },
    {
      key: "criticality",
      label: "Criticality",
      type: "single_select",
      options: [{ key: "high", label: "High", color: "#d32f2f" }],
    },
  ],
} as unknown as RelationType;

describe("relationAttributeBadges", () => {
  it("returns an empty array when no value is set", () => {
    expect(relationAttributeBadges(usageType, {})).toEqual([]);
    expect(relationAttributeBadges(usageType, undefined)).toEqual([]);
  });

  it("returns the selected option with its colour for usageType", () => {
    const badges = relationAttributeBadges(usageType, { usageType: "owner" });
    expect(badges).toHaveLength(1);
    expect(badges[0].fieldKey).toBe("usageType");
    expect(badges[0].fieldLabel).toBe("Usage Type");
    expect(badges[0].optionKey).toBe("owner");
    expect(badges[0].optionLabel).toBe("Owner");
    expect(badges[0].color).toBe("#1976d2");
  });

  it("returns ALL set single_select values (multiple types)", () => {
    const badges = relationAttributeBadges(multiDimension, {
      usageType: "reads",
      criticality: "high",
    });
    expect(badges.map((b) => b.fieldKey)).toEqual(["usageType", "criticality"]);
    expect(badges.map((b) => b.optionKey)).toEqual(["reads", "high"]);
  });

  it("only returns dimensions that actually have a value set", () => {
    const badges = relationAttributeBadges(multiDimension, { criticality: "high" });
    expect(badges.map((b) => b.fieldKey)).toEqual(["criticality"]);
  });

  it("ignores flowDirection (rendered as a directional icon instead)", () => {
    expect(relationAttributeBadges(flowOnly, { flowDirection: "forward" })).toEqual([]);
  });

  it("skips unknown option values", () => {
    expect(relationAttributeBadges(usageType, { usageType: "bogus" })).toEqual([]);
  });

  it("returns an empty array when relationType is undefined", () => {
    expect(relationAttributeBadges(undefined, { usageType: "owner" })).toEqual([]);
  });
});
