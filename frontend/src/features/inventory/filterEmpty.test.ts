import { describe, it, expect } from "vitest";
import type { Filters } from "./InventoryFilterSidebar";
import {
  EMPTY_VALUE,
  filtersAfterTypeToggle,
  normalizeRelationFilterKeys,
  normalizeSelectAttributeFilters,
  tagEmptyToken,
  tagsToFilterText,
  valueIsEmpty,
} from "./InventoryFilterSidebar";
import type { FieldDef } from "@/types";

const baseFilters: Filters = {
  types: ["Application"],
  search: "",
  subtypes: ["business_app"],
  lifecyclePhases: ["active"],
  dataQualityBands: ["partial"],
  orphanedOnly: false,
  staleOnly: false,
  approvalStatuses: ["APPROVED"],
  showArchived: false,
  attributes: { vendor: ["SAP"] },
  relations: { relAppToItComponent: ["PostgreSQL"] },
  tagIds: ["t1"],
  mineScope: null,
};

describe("valueIsEmpty", () => {
  it("treats null, undefined, empty string and empty array as empty", () => {
    expect(valueIsEmpty(null)).toBe(true);
    expect(valueIsEmpty(undefined)).toBe(true);
    expect(valueIsEmpty("")).toBe(true);
    expect(valueIsEmpty([])).toBe(true);
  });

  it("treats any actual value as non-empty", () => {
    expect(valueIsEmpty("active")).toBe(false);
    expect(valueIsEmpty(0)).toBe(false);
    expect(valueIsEmpty(false)).toBe(false);
    expect(valueIsEmpty(["a"])).toBe(false);
  });
});

describe("tagEmptyToken", () => {
  it("scopes the empty sentinel per group", () => {
    expect(tagEmptyToken("grp-1")).toBe(`${EMPTY_VALUE}:grp-1`);
    expect(tagEmptyToken("grp-1")).not.toBe(tagEmptyToken("grp-2"));
  });

  it("can be parsed back to its group id with the shared prefix", () => {
    const token = tagEmptyToken("grp-42");
    const prefix = `${EMPTY_VALUE}:`;
    expect(token.startsWith(prefix)).toBe(true);
    expect(token.slice(prefix.length)).toBe("grp-42");
  });
});

describe("tagsToFilterText", () => {
  it("joins tag names so AG Grid's text filter can match them (issue #728)", () => {
    const text = tagsToFilterText([
      { name: "R&D" },
      { name: "Critical" },
    ]);
    expect(text).toBe("R&D, Critical");
    // A typed tag-name fragment must be a substring of the filter text.
    expect(text.toLowerCase().includes("r&".toLowerCase())).toBe(true);
  });

  it("handles empty / undefined tag lists", () => {
    expect(tagsToFilterText([])).toBe("");
    expect(tagsToFilterText(undefined)).toBe("");
  });
});

describe("normalizeSelectAttributeFilters", () => {
  const fields: FieldDef[] = [
    {
      key: "timeModel",
      label: "TIME Model",
      type: "single_select",
      options: [{ key: "invest", label: "Invest" }],
    },
    {
      key: "platforms",
      label: "Platforms",
      type: "multiple_select",
      options: [{ key: "aws", label: "AWS" }],
    },
    { key: "vendor", label: "Vendor", type: "text" },
    { key: "costTotalAnnual", label: "Annual Cost", type: "cost" },
  ] as FieldDef[];

  it("promotes URL-seeded scalar values on select fields to arrays (issue: sidebar highlight)", () => {
    const next = normalizeSelectAttributeFilters(
      { timeModel: "invest", platforms: "aws" },
      fields,
    );
    expect(next).toEqual({ timeModel: ["invest"], platforms: ["aws"] });
  });

  it("promotes the (empty) sentinel too, so Not-set deep-links highlight", () => {
    const next = normalizeSelectAttributeFilters({ timeModel: EMPTY_VALUE }, fields);
    expect(next).toEqual({ timeModel: [EMPTY_VALUE] });
  });

  it("leaves non-select scalars and unknown keys untouched", () => {
    const attributes = { vendor: "sap", costTotalAnnual: "1000", mystery: "x" };
    expect(normalizeSelectAttributeFilters(attributes, fields)).toBe(attributes);
  });

  it("leaves already-normalized arrays untouched and returns the same reference when nothing changes", () => {
    const attributes: Filters["attributes"] = { timeModel: ["invest"] };
    expect(normalizeSelectAttributeFilters(attributes, fields)).toBe(attributes);
    expect(normalizeSelectAttributeFilters({}, fields)).toEqual({});
  });
});

describe("normalizeRelationFilterKeys", () => {
  const relTypeKeys = new Set(["relAppToProvider", "relAppToItComponent"]);
  const cardTypeToRelTypes = new Map([
    ["Provider", ["relAppToProvider"]],
    ["ITComponent", ["relAppToItComponent", "relItComponentToApp"]],
  ]);

  it("remaps a related-card-type key to its relation-type key (deep-link bug: rel_Provider matched nothing)", () => {
    expect(
      normalizeRelationFilterKeys({ Provider: ["Altium"] }, relTypeKeys, cardTypeToRelTypes),
    ).toEqual({ relAppToProvider: ["Altium"] });
  });

  it("uses the FIRST mapped relation type, matching the relation columns' dedup rule", () => {
    expect(
      normalizeRelationFilterKeys({ ITComponent: ["PostgreSQL"] }, relTypeKeys, cardTypeToRelTypes),
    ).toEqual({ relAppToItComponent: ["PostgreSQL"] });
  });

  it("keeps keys that already are relation-type keys, same reference when nothing changes", () => {
    const relations = { relAppToProvider: ["Altium"] };
    expect(normalizeRelationFilterKeys(relations, relTypeKeys, cardTypeToRelTypes)).toBe(relations);
    expect(normalizeRelationFilterKeys({}, relTypeKeys, cardTypeToRelTypes)).toEqual({});
  });

  it("merges when both spellings of the same relation are present", () => {
    expect(
      normalizeRelationFilterKeys(
        { relAppToProvider: ["Altium"], Provider: ["Siemens", "Altium"] },
        relTypeKeys,
        cardTypeToRelTypes,
      ),
    ).toEqual({ relAppToProvider: ["Altium", "Siemens"] });
  });

  it("drops unresolvable keys — a deep link may show more items, never a silent zero", () => {
    expect(
      normalizeRelationFilterKeys(
        { Nonsense: ["x"], Provider: ["Altium"] },
        relTypeKeys,
        cardTypeToRelTypes,
      ),
    ).toEqual({ relAppToProvider: ["Altium"] });
  });
});

describe("filtersAfterTypeToggle", () => {
  it("clears type-specific filters (subtypes, attributes, relations) when switching type (issue #686)", () => {
    // Switch from Application to Organization: deselect the old, select the new.
    const deselected = filtersAfterTypeToggle(baseFilters, "Application");
    expect(deselected.types).toEqual([]);
    const next = filtersAfterTypeToggle(deselected, "Organization");

    expect(next.types).toEqual(["Organization"]);
    // The stale Application relationship filter must not survive the type change,
    // otherwise it silently empties the Organization result list.
    expect(next.relations).toEqual({});
    expect(next.subtypes).toEqual([]);
    expect(next.attributes).toEqual({});
  });

  it("preserves non-type-specific filters across a type change", () => {
    const next = filtersAfterTypeToggle(baseFilters, "Objective");
    expect(next.types).toEqual(["Application", "Objective"]);
    expect(next.search).toBe(baseFilters.search);
    expect(next.lifecyclePhases).toEqual(["active"]);
    expect(next.dataQualityBands).toEqual(["partial"]);
    expect(next.approvalStatuses).toEqual(["APPROVED"]);
    expect(next.tagIds).toEqual(["t1"]);
  });

  it("does not mutate the input filters", () => {
    filtersAfterTypeToggle(baseFilters, "Application");
    expect(baseFilters.types).toEqual(["Application"]);
    expect(baseFilters.relations).toEqual({ relAppToItComponent: ["PostgreSQL"] });
  });
});
