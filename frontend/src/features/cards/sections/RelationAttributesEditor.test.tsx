import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RelationAttributesEditor, {
  hasEditableRelationAttributes,
  relationAttributeBadges,
} from "./RelationAttributesEditor";
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

const noOptions: RelationType = {
  key: "relAppToApp",
  label: "depends on",
  source_type_key: "Application",
  target_type_key: "Application",
  cardinality: "n:m",
  built_in: true,
  is_hidden: false,
  attributes_schema: [
    {
      key: "kind",
      label: "Kind",
      type: "single_select",
      options: [],
    },
  ],
} as unknown as RelationType;

/**
 * A relation type whose only dimensions are flags. CRUD is the seeded example,
 * but nothing in the code is keyed to these names — any boolean behaves the
 * same, which is what these cases pin down.
 */
const flagsOnly: RelationType = {
  key: "relAppToDataObj",
  label: "CRUD",
  source_type_key: "Application",
  target_type_key: "DataObject",
  cardinality: "n:m",
  built_in: true,
  is_hidden: false,
  attributes_schema: [
    { key: "crudCreate", label: "Create", type: "boolean" },
    { key: "crudRead", label: "Read", type: "boolean" },
    { key: "crudUpdate", label: "Update", type: "boolean" },
    { key: "crudDelete", label: "Delete", type: "boolean" },
  ],
} as unknown as RelationType;

/** Flags and a select side by side, in a deliberately interleaved order. */
const mixedDimensions: RelationType = {
  key: "relCustomMixed",
  label: "custom",
  source_type_key: "Application",
  target_type_key: "DataObject",
  cardinality: "n:m",
  built_in: false,
  is_hidden: false,
  attributes_schema: [
    { key: "archived", label: "Archived", type: "boolean" },
    {
      key: "usageType",
      label: "Usage",
      type: "single_select",
      options: [{ key: "owner", label: "Owner", color: "#1976d2" }],
    },
    { key: "encrypted", label: "Encrypted", type: "boolean" },
  ],
} as unknown as RelationType;

const noSchema: RelationType = {
  key: "relBare",
  label: "relates to",
  source_type_key: "Application",
  target_type_key: "DataObject",
  cardinality: "n:m",
  built_in: true,
  is_hidden: false,
  attributes_schema: [],
} as unknown as RelationType;

describe("hasEditableRelationAttributes", () => {
  it("returns true when a single_select field has options", () => {
    expect(hasEditableRelationAttributes(usageType)).toBe(true);
    expect(hasEditableRelationAttributes(flowOnly)).toBe(true);
    expect(hasEditableRelationAttributes(multiDimension)).toBe(true);
  });

  it("returns true for a schema of nothing but boolean flags", () => {
    // Gating on single_select alone is what left these values unsettable.
    expect(hasEditableRelationAttributes(flagsOnly)).toBe(true);
  });

  it("returns true when flags and selects are mixed", () => {
    expect(hasEditableRelationAttributes(mixedDimensions)).toBe(true);
  });

  it("returns false when a single_select field has no options (nothing to pick)", () => {
    expect(hasEditableRelationAttributes(noOptions)).toBe(false);
  });

  it("returns false for an empty attributes_schema", () => {
    expect(hasEditableRelationAttributes(noSchema)).toBe(false);
  });

  it("returns false when relationType is undefined", () => {
    expect(hasEditableRelationAttributes(undefined)).toBe(false);
  });
});

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

  it("returns a flag badge for each boolean that is switched on", () => {
    const badges = relationAttributeBadges(flagsOnly, {
      crudCreate: true,
      crudRead: true,
      crudDelete: false,
    });
    expect(badges.map((b) => b.fieldKey)).toEqual(["crudCreate", "crudRead"]);
    expect(badges.every((b) => b.isFlag)).toBe(true);
    // A flag has no option entity, so its label doubles as its value.
    expect(badges.map((b) => b.optionLabel)).toEqual(["Create", "Read"]);
    expect(badges.map((b) => b.optionKey)).toEqual(["true", "true"]);
  });

  it("ignores booleans that are false or absent", () => {
    expect(relationAttributeBadges(flagsOnly, { crudCreate: false })).toEqual([]);
    expect(relationAttributeBadges(flagsOnly, {})).toEqual([]);
  });

  it("returns flags and select values together, in schema order", () => {
    const badges = relationAttributeBadges(mixedDimensions, {
      archived: true,
      usageType: "owner",
      encrypted: true,
    });
    expect(badges.map((b) => b.fieldKey)).toEqual(["archived", "usageType", "encrypted"]);
    expect(badges.map((b) => !!b.isFlag)).toEqual([true, false, true]);
    expect(badges[1].color).toBe("#1976d2");
  });
});

describe("RelationAttributesEditor — boolean flags", () => {
  it("renders one checkbox per boolean field, labelled from the schema", () => {
    render(
      <RelationAttributesEditor relationType={flagsOnly} value={{}} onChange={vi.fn()} />,
    );

    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    for (const label of ["Create", "Read", "Update", "Delete"]) {
      expect(screen.getByRole("checkbox", { name: label })).toBeInTheDocument();
    }
  });

  it("reflects the stored value", () => {
    render(
      <RelationAttributesEditor
        relationType={flagsOnly}
        value={{ crudCreate: true }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Create" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Read" })).not.toBeChecked();
  });

  it("ticking a flag merges it into the attributes bag", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RelationAttributesEditor
        relationType={flagsOnly}
        value={{ crudRead: true }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Create" }));

    expect(onChange).toHaveBeenCalledWith({ crudRead: true, crudCreate: true });
  });

  it("unticking a flag removes the key rather than storing false", async () => {
    // "Never ticked" and "ticked then unticked" must look identical to every
    // reader — badges, filters and the matrix all treat absent as not-set.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RelationAttributesEditor
        relationType={flagsOnly}
        value={{ crudCreate: true, crudRead: true }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Create" }));

    expect(onChange).toHaveBeenCalledWith({ crudRead: true });
  });

  it("renders flags and selects together", () => {
    render(
      <RelationAttributesEditor relationType={mixedDimensions} value={{}} onChange={vi.fn()} />,
    );

    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
});
