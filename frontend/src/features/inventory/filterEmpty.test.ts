import { describe, it, expect } from "vitest";
import type { Filters } from "./InventoryFilterSidebar";
import {
  EMPTY_VALUE,
  filtersAfterTypeToggle,
  tagEmptyToken,
  tagsToFilterText,
  valueIsEmpty,
} from "./InventoryFilterSidebar";

const baseFilters: Filters = {
  types: ["Application"],
  search: "",
  subtypes: ["business_app"],
  lifecyclePhases: ["active"],
  dataQualityMin: 50,
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
    expect(next.dataQualityMin).toBe(50);
    expect(next.approvalStatuses).toEqual(["APPROVED"]);
    expect(next.tagIds).toEqual(["t1"]);
  });

  it("does not mutate the input filters", () => {
    filtersAfterTypeToggle(baseFilters, "Application");
    expect(baseFilters.types).toEqual(["Application"]);
    expect(baseFilters.relations).toEqual({ relAppToItComponent: ["PostgreSQL"] });
  });
});
