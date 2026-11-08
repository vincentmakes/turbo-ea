import { describe, it, expect } from "vitest";
import type { FieldOption, RelationType } from "@/types";
import { relationAttributeBadges, relationAttributeSuffix } from "./relationAttributeBadges";

const RT = {
  key: "relAppToDataObj",
  label: "CRUD",
  source_type_key: "Application",
  target_type_key: "DataObject",
  attributes_schema: [
    { key: "crudCreate", label: "Create", type: "boolean" },
    { key: "crudRead", label: "Read", type: "boolean", translations: { fr: "Lire" } },
    {
      key: "criticality",
      label: "Criticality",
      type: "single_select",
      options: [{ key: "high", label: "High", translations: { fr: "Élevée" } }],
    },
  ],
} as unknown as RelationType;

const plain = (o: FieldOption) => o.label;

describe("relationAttributeSuffix", () => {
  it("brackets one entry per badge card detail would show, joined by a middot", () => {
    const attrs = { crudCreate: true, crudRead: true, criticality: "high" };
    expect(relationAttributeBadges(RT, attrs)).toHaveLength(3);
    expect(relationAttributeSuffix(RT, attrs, plain)).toBe(" [Create · Read · High]");
  });

  it("hands the resolver an option-shaped entity carrying the translations", () => {
    const fr = (o: FieldOption) => o.translations?.fr ?? o.label;
    expect(relationAttributeSuffix(RT, { crudRead: true, criticality: "high" }, fr)).toBe(
      " [Lire · Élevée]",
    );
  });

  it("is undefined when nothing is set, or for no relation type", () => {
    expect(relationAttributeSuffix(RT, { crudCreate: false }, plain)).toBeUndefined();
    expect(relationAttributeSuffix(RT, undefined, plain)).toBeUndefined();
    expect(relationAttributeSuffix(undefined, { crudCreate: true }, plain)).toBeUndefined();
  });
});
