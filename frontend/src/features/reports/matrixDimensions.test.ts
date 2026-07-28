import { describe, it, expect } from "vitest";
import {
  buildDimensions,
  buildValueIndex,
  fallbackColor,
  shortCode,
  valueIdsForAttributes,
} from "./matrixDimensions";
import type { FieldDef, FieldOption, RelationType } from "@/types";

// The attribute keys below are deliberately arbitrary. Nothing in the module
// knows any of them — they are read out of `attributes_schema` — so an
// admin-defined dimension behaves exactly like a seeded one.
const relationType = (key: string, schema: Partial<FieldDef>[]): RelationType =>
  ({
    key,
    label: key,
    source_type_key: "Application",
    target_type_key: "DataObject",
    cardinality: "n:m",
    built_in: false,
    is_hidden: false,
    attributes_schema: schema,
  }) as unknown as RelationType;

const resolvers = {
  fieldLabel: (f: FieldDef) => f.label,
  optionLabel: (o: FieldOption) => o.label,
};

const flags = relationType("relFlags", [
  { key: "alpha", label: "Create", type: "boolean" },
  { key: "beta", label: "Read", type: "boolean" },
  { key: "gamma", label: "Update", type: "boolean" },
  { key: "delta", label: "Delete", type: "boolean" },
]);

const selects = relationType("relSelects", [
  {
    key: "usage",
    label: "Usage",
    type: "single_select",
    options: [
      { key: "owner", label: "Owner", color: "#1976d2" },
      { key: "user", label: "User" },
      { key: "legacy", label: "Legacy", hidden: true },
    ],
  },
]);

describe("buildDimensions", () => {
  it("classifies each field from its declared type", () => {
    const rt = relationType("relMixed", [
      { key: "flag", label: "Flag", type: "boolean" },
      { key: "pick", label: "Pick", type: "single_select", options: [{ key: "a", label: "A" }] },
      { key: "note", label: "Note", type: "text" },
      { key: "amount", label: "Amount", type: "number" },
    ]);

    expect(buildDimensions([rt]).map((d) => [d.field.key, d.kind])).toEqual([
      ["flag", "flag"],
      ["pick", "enum"],
      ["note", "scalar"],
      ["amount", "scalar"],
    ]);
  });

  it("treats an options-less single_select as a scalar (nothing to enumerate)", () => {
    const rt = relationType("relBare", [
      { key: "pick", label: "Pick", type: "single_select", options: [] },
    ]);
    expect(buildDimensions([rt])[0].kind).toBe("scalar");
  });

  it("gives flowDirection no special treatment — it is a select like any other", () => {
    const rt = relationType("relFlow", [
      {
        key: "flowDirection",
        label: "Flow direction",
        type: "single_select",
        options: [
          { key: "forward", label: "Forward" },
          { key: "reverse", label: "Reverse" },
        ],
      },
    ]);
    expect(buildDimensions([rt])[0].kind).toBe("enum");
  });
});

describe("shortCode", () => {
  it("uses the uppercased first character when it is free", () => {
    expect(shortCode("Create", new Set())).toBe("C");
  });

  it("extends to the next character on a collision", () => {
    expect(shortCode("Clone", new Set(["C"]))).toBe("Cl");
    expect(shortCode("Close", new Set(["C", "Cl"]))).toBe("Clo");
  });

  it("falls back to a numbered code when even three characters collide", () => {
    expect(shortCode("Close", new Set(["C", "Cl", "Clo"]))).toBe("C2");
  });

  it("keeps multi-byte characters whole", () => {
    // Slicing by code unit would cut a surrogate pair in half and render as a
    // replacement character.
    expect(shortCode("创建", new Set())).toBe("创");
    expect(shortCode("إنشاء", new Set())).toBe("إ");
    expect(shortCode("😀 Emoji", new Set())).toBe("😀");
  });

  it("never returns an empty code", () => {
    expect(shortCode("   ", new Set())).toBe("?");
  });
});

describe("fallbackColor", () => {
  it("gives consecutive positions distinct colours", () => {
    // Values of one relation type sit side by side in a cell and in the
    // legend, so neighbours must not look alike.
    const colors = [0, 1, 2, 3].map(fallbackColor);
    expect(new Set(colors).size).toBe(4);
  });

  it("wraps around once the palette runs out", () => {
    expect(fallbackColor(0)).toBe(fallbackColor(10));
  });
});

describe("buildValueIndex", () => {
  it("emits one value per flag, coded from the localized field label", () => {
    const index = buildValueIndex([flags], resolvers);
    expect(index.values.map((v) => v.code)).toEqual(["C", "R", "U", "D"]);
    expect(new Set(index.values.map((v) => v.color)).size).toBe(4);
    expect(index.values.map((v) => v.label)).toEqual(["Create", "Read", "Update", "Delete"]);
    expect(index.values.every((v) => v.kind === "flag")).toBe(true);
  });

  it("emits one value per visible option and keeps the metamodel colour", () => {
    const index = buildValueIndex([selects], resolvers);
    expect(index.values.map((v) => v.optionKey)).toEqual(["owner", "user"]);
    expect(index.values[0].color).toBe("#1976d2");
    // No colour in the metamodel — assigned one by position rather than left blank.
    expect(index.values[1].color).toBe(fallbackColor(1));
  });

  it("drops hidden options", () => {
    const index = buildValueIndex([selects], resolvers);
    expect(index.values.map((v) => v.optionKey)).not.toContain("legacy");
  });

  it("scopes code uniqueness to each relation type", () => {
    // Both types start with the same letter; each gets a plain "C" because a
    // cell and a legend block only ever mix values of one relation type's data.
    const other = relationType("relOther", [{ key: "x", label: "Create", type: "boolean" }]);
    const index = buildValueIndex([flags, other], resolvers);
    expect(index.byRelationType.get("relFlags")?.[0].code).toBe("C");
    expect(index.byRelationType.get("relOther")?.[0].code).toBe("C");
  });

  it("ignores scalar fields", () => {
    const rt = relationType("relScalar", [{ key: "note", label: "Note", type: "text" }]);
    expect(buildValueIndex([rt], resolvers).values).toEqual([]);
  });
});

describe("valueIdsForAttributes", () => {
  const index = buildValueIndex([flags, selects], resolvers);

  it("returns only the flags that are on", () => {
    expect(valueIdsForAttributes("relFlags", { alpha: true, beta: false }, index)).toEqual([
      "relFlags.alpha",
    ]);
  });

  it("ignores absent and falsy flags", () => {
    expect(valueIdsForAttributes("relFlags", {}, index)).toEqual([]);
    expect(valueIdsForAttributes("relFlags", undefined, index)).toEqual([]);
  });

  it("returns the selected option of an enum", () => {
    expect(valueIdsForAttributes("relSelects", { usage: "owner" }, index)).toEqual([
      "relSelects.usage:owner",
    ]);
  });

  it("skips a value the metamodel no longer knows", () => {
    // An option deleted after the relation was set must not invent a legend entry.
    expect(valueIdsForAttributes("relSelects", { usage: "deleted" }, index)).toEqual([]);
  });

  it("only reads dimensions belonging to the given relation type", () => {
    expect(valueIdsForAttributes("relSelects", { alpha: true }, index)).toEqual([]);
  });

  it("returns ids in schema order regardless of key order in the bag", () => {
    const ids = valueIdsForAttributes("relFlags", { delta: true, alpha: true }, index);
    expect(ids).toEqual(["relFlags.alpha", "relFlags.delta"]);
  });
});
