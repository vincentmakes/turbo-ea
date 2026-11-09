import { describe, it, expect } from "vitest";
import type { Bookmark, CardQuery } from "@/types";
import {
  activeQueryFromBookmark,
  bookmarkFilters,
  bookmarkGrouping,
  isQueryView,
  refreshActiveQuery,
} from "./viewApply";

function bookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "bm-1",
    name: "View",
    is_default: false,
    visibility: "private",
    odata_enabled: false,
    owner_id: "u1",
    is_owner: true,
    can_edit: true,
    ...overrides,
  };
}

const QUERY: CardQuery = {
  type: "Organization",
  related: [{ relation: "relOrgToApp", type: "Application" }],
};

const EMPTY = {
  types: [],
  search: "",
  subtypes: [],
  lifecyclePhases: [],
  dataQualityBands: [],
  approvalStatuses: [],
  showArchived: false,
  orphanedOnly: false,
  staleOnly: false,
  eolStatuses: [],
  linkTypes: [],
  origins: [],
  attributes: {},
  relations: {},
  tagIds: [],
  mineScope: null,
};

describe("isQueryView", () => {
  it("is true only when the view carries a query", () => {
    expect(isQueryView(bookmark({ query: QUERY }))).toBe(true);
    expect(isQueryView(bookmark({ query: null }))).toBe(false);
    expect(isQueryView(bookmark())).toBe(false);
  });
});

describe("bookmarkFilters", () => {
  it("is null for a plain view without a filters payload", () => {
    expect(bookmarkFilters(bookmark())).toBeNull();
  });

  it("defaults every facet a view saved before it existed does not carry", () => {
    expect(bookmarkFilters(bookmark({ filters: {} }))).toEqual(EMPTY);
  });

  it("restores every stored facet, leaving the grouping out", () => {
    const facets = {
      types: ["Application"],
      search: "erp",
      subtypes: ["business_app"],
      lifecyclePhases: ["active"],
      dataQualityBands: ["complete"],
      approvalStatuses: ["APPROVED"],
      showArchived: true,
      orphanedOnly: true,
      staleOnly: true,
      eolStatuses: ["eol"],
      linkTypes: ["primary"],
      origins: ["mcp"],
      attributes: { criticality: ["high"] },
      relations: { relAppToITC: ["PostgreSQL"] },
      tagIds: ["t1"],
      mineScope: "stakeholder",
    };
    expect(bookmarkFilters(bookmark({ filters: { ...facets, groupBy: "subtype" } }))).toEqual(
      facets,
    );
  });

  it("maps a legacy dataQualityMin threshold to bands", () => {
    expect(bookmarkFilters(bookmark({ filters: { dataQualityMin: 50 } }))?.dataQualityBands).toEqual(
      ["complete", "partial"],
    );
  });

  it("selects a query view's start type whatever its stored types say", () => {
    expect(
      bookmarkFilters(
        bookmark({ query: QUERY, filters: { types: ["Application"], search: "x" } }),
      ),
    ).toEqual({ ...EMPTY, types: ["Organization"], search: "x" });
    // …and even with no filters payload at all.
    expect(bookmarkFilters(bookmark({ query: QUERY }))).toEqual({
      ...EMPTY,
      types: ["Organization"],
    });
  });
});

describe("bookmarkGrouping", () => {
  it("restores the axis, the tree layer and its level", () => {
    expect(
      bookmarkGrouping(
        bookmark({ filters: { groupBy: "lifecycle", groupTree: true, groupTreeLevel: 2 } }),
      ),
    ).toEqual({ groupBy: "lifecycle", groupTree: true, groupTreeLevel: 2 });
  });

  it("restores no grouping for a view saved without one", () => {
    expect(bookmarkGrouping(bookmark())).toEqual({
      groupBy: null,
      groupTree: false,
      groupTreeLevel: null,
    });
    expect(
      bookmarkGrouping(bookmark({ filters: { groupBy: 3, groupTreeLevel: "0" } })),
    ).toEqual({ groupBy: null, groupTree: false, groupTreeLevel: null });
  });
});

describe("activeQueryFromBookmark", () => {
  it("carries a query view's id, name, query and origin", () => {
    expect(
      activeQueryFromBookmark(
        bookmark({ id: "bm-9", name: "In flight", query: QUERY, created_via: "mcp" }),
      ),
    ).toEqual({ viewId: "bm-9", name: "In flight", query: QUERY, createdVia: "mcp" });
  });

  it("has a null origin when the view records none", () => {
    expect(activeQueryFromBookmark(bookmark({ query: QUERY }))?.createdVia).toBeNull();
  });

  it("is null for a plain view", () => {
    expect(activeQueryFromBookmark(bookmark())).toBeNull();
    expect(activeQueryFromBookmark(bookmark({ query: null }))).toBeNull();
  });
});

describe("refreshActiveQuery", () => {
  const ACTIVE = { viewId: "bm-1", name: "View", query: QUERY, createdVia: "mcp" };

  it("keeps the same object when the view is unchanged", () => {
    const bms = [bookmark({ id: "bm-0" }), bookmark({ query: QUERY, created_via: "mcp" })];
    expect(refreshActiveQuery(ACTIVE, bms)).toBe(ACTIVE);
  });

  it("drops a view that is gone or no longer a query view", () => {
    expect(refreshActiveQuery(ACTIVE, [bookmark({ id: "bm-other", query: QUERY })])).toBeNull();
    expect(refreshActiveQuery(ACTIVE, [bookmark()])).toBeNull();
  });

  it("returns the fresh query when the view was re-saved", () => {
    const changed: CardQuery = { type: "Organization", related: [] };
    expect(refreshActiveQuery(ACTIVE, [bookmark({ query: changed, created_via: "mcp" })])).toEqual(
      { ...ACTIVE, query: changed },
    );
  });

  it("returns the fresh name when the view was renamed", () => {
    const renamed = refreshActiveQuery(ACTIVE, [
      bookmark({ name: "Renamed", query: QUERY, created_via: "mcp" }),
    ]);
    expect(renamed).not.toBe(ACTIVE);
    expect(renamed).toEqual({ ...ACTIVE, name: "Renamed" });
  });
});
