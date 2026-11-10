import { describe, it, expect } from "vitest";
import type { Bookmark, CardQuery } from "@/types";
import {
  activeQueryFromBookmark,
  bookmarkFilters,
  bookmarkGrouping,
  emptyFilters,
  hasActiveFacets,
  bookmarkViaColumns,
  isQueryView,
  isViaColumnId,
  refreshActiveQuery,
  splitViewColumns,
  stripViaIds,
  stripViaLayout,
  VIA_COLUMN_PREFIX,
  viaColumnId,
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

  it("selects every start type of a stacked query, in reading order", () => {
    const stack = {
      any_of: [
        { all_of: [{ type: "Application" }, { type: "Application" }] },
        QUERY,
      ],
    };
    expect(
      bookmarkFilters(bookmark({ query: stack, filters: { types: ["Application"] } })),
    ).toEqual({ ...EMPTY, types: ["Application", "Organization"] });
    expect(bookmarkFilters(bookmark({ query: stack }))).toEqual({
      ...EMPTY,
      types: ["Application", "Organization"],
    });
  });

  it("keeps the stored types for a query naming no type yet", () => {
    expect(
      bookmarkFilters(bookmark({ query: { type: "" }, filters: { types: ["Application"] } })),
    ).toEqual({ ...EMPTY, types: ["Application"] });
    expect(bookmarkFilters(bookmark({ query: { type: "" } }))).toBeNull();
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

describe("emptyFilters", () => {
  it("clears every facet", () => {
    expect(emptyFilters()).toEqual(EMPTY);
  });

  it("hands out a fresh object each call", () => {
    const a = emptyFilters();
    a.types.push("Application");
    expect(emptyFilters().types).toEqual([]);
  });
});

describe("hasActiveFacets", () => {
  it("is false for no filters", () => {
    expect(hasActiveFacets(emptyFilters())).toBe(false);
  });

  it("is false for filters saved before the newer facets", () => {
    const legacy = { ...emptyFilters() } as Partial<ReturnType<typeof emptyFilters>>;
    delete legacy.origins;
    delete legacy.linkTypes;
    delete legacy.tagIds;
    expect(hasActiveFacets(legacy as ReturnType<typeof emptyFilters>)).toBe(false);
  });

  it.each([
    ["a single selected type", { types: ["Application"] }],
    ["several types", { types: ["Application", "Objective"] }],
    ["a search", { search: "SAP" }],
    ["a subtype", { subtypes: ["Business"] }],
    ["a lifecycle phase", { lifecyclePhases: ["active"] }],
    ["a quality band", { dataQualityBands: ["low"] }],
    ["an approval status", { approvalStatuses: ["APPROVED"] }],
    ["archived only", { showArchived: true }],
    ["an attribute", { attributes: { criticality: ["high"] } }],
    ["a relation", { relations: { relAppToITC: ["SAP"] } }],
    ["a tag", { tagIds: ["t1"] }],
    ["my cards", { mineScope: "stakeholder" }],
    ["orphaned only", { orphanedOnly: true }],
    ["stale only", { staleOnly: true }],
    ["an end-of-life status", { eolStatuses: ["eol"] }],
    ["a link type", { linkTypes: ["parent"] }],
    ["an origin", { origins: ["mcp"] }],
  ])("is true for %s", (_label, facet) => {
    expect(hasActiveFacets({ ...emptyFilters(), ...facet } as ReturnType<typeof emptyFilters>)).toBe(
      true,
    );
  });
});

describe("matched-cards columns in a view's columns", () => {
  it("names a column via:<key>", () => {
    expect(VIA_COLUMN_PREFIX).toBe("via:");
    expect(viaColumnId("0:1.2")).toBe("via:0:1.2");
    expect(isViaColumnId("via:0:0")).toBe(true);
    expect(isViaColumnId("core_name")).toBe(false);
    expect(isViaColumnId("rel_via:0")).toBe(false);
  });

  it("splits the picker's keys from the via keys, deduped, in order", () => {
    expect(
      splitViewColumns(["core_name", "via:0:1", "attr_x", "via:0:0", "via:0:1", "via:"]),
    ).toEqual({ columns: ["core_name", "attr_x"], via: ["0:1", "0:0"] });
    expect(splitViewColumns(undefined)).toEqual({ columns: [], via: [] });
    expect(splitViewColumns(null)).toEqual({ columns: [], via: [] });
    expect(splitViewColumns(["core_name", 3 as unknown as string])).toEqual({
      columns: ["core_name"],
      via: [],
    });
  });

  it("restores only the via keys the view's query still holds", () => {
    const chain: CardQuery = {
      type: "Organization",
      related: [
        {
          relation: "relOrgToApp",
          type: "Application",
          related: [{ relation: "relAppToITC", type: "ITComponent" }],
        },
      ],
    };
    expect(
      bookmarkViaColumns(
        bookmark({ query: chain, columns: ["core_name", "via:0:0.0", "via:0:3", "via:0:0"] }),
      ),
    ).toEqual(["0:0.0", "0:0"]);
  });

  it("restores none for a plain view or a view without via entries", () => {
    expect(bookmarkViaColumns(bookmark({ columns: ["via:0:0"] }))).toEqual([]);
    expect(bookmarkViaColumns(bookmark({ query: QUERY, columns: ["core_name"] }))).toEqual([]);
    expect(bookmarkViaColumns(bookmark({ query: QUERY }))).toEqual([]);
  });
});

describe("stripViaLayout", () => {
  const model = {
    attr_cost: { filterType: "number", type: "greaterThan", filter: 5 },
    "via:0:0": { filterType: "text", type: "contains", filter: "SAP" },
    "via:0:1": { filterType: "text", type: "contains", filter: "Linux" },
  };
  const state = [
    { colId: "core_name", width: 200 },
    { colId: "via:0:0", width: 300, sort: "asc" as const, pinned: "left" as const },
    { colId: "via:0:1", width: 120 },
  ];

  it("drops every via: entry whose key is not switched on, and nothing else", () => {
    expect(stripViaLayout(model, state, ["0:1"])).toEqual({
      filterModel: {
        attr_cost: model.attr_cost,
        "via:0:1": model["via:0:1"],
      },
      columnState: [
        { colId: "core_name", width: 200 },
        { colId: "via:0:1", width: 120 },
      ],
    });
    expect(stripViaLayout(model, state, [])).toEqual({
      filterModel: { attr_cost: model.attr_cost },
      columnState: [{ colId: "core_name", width: 200 }],
    });
  });

  it("returns the inputs themselves when nothing is stale", () => {
    const out = stripViaLayout(model, state, ["0:0", "0:1"]);
    expect(out.filterModel).toBe(model);
    expect(out.columnState).toBe(state);
    const plain = { attr_cost: model.attr_cost };
    expect(stripViaLayout(plain, [state[0]], []).filterModel).toBe(plain);
  });

  it("leaves a missing model or state missing", () => {
    expect(stripViaLayout(null, undefined, ["0:0"])).toEqual({
      filterModel: null,
      columnState: undefined,
    });
    expect(stripViaLayout(undefined, null, [])).toEqual({
      filterModel: undefined,
      columnState: null,
    });
  });
});

describe("stripViaIds", () => {
  it("keeps plain ids and the switched-on via: ids, in order", () => {
    expect(stripViaIds(["via:0:1", "core_name", "via:0:0", "attr_cost"], ["0:0"])).toEqual([
      "core_name",
      "via:0:0",
      "attr_cost",
    ]);
    expect(stripViaIds(["via:0:0"], [])).toEqual([]);
  });
});
