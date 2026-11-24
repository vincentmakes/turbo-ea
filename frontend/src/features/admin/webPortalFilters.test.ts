import { describe, expect, it } from "vitest";
import { EMPTY_CARD_FILTERS, type CardFilterValue } from "@/features/reports/cardFilters";
import type { FilterKind } from "@/lib/fieldFilters";
import {
  canBeVisitorFilter,
  defaultVisitorFilters,
  effectiveVisitorFilters,
  eligibleVisitorFilters,
  legacyTagsSpanGroups,
  portalCardFilters,
  portalFiltersBody,
  shownOnPortal,
  storedVisitorFilters,
  toggleVisitorFilter,
  visitorFiltersBody,
  type VisitorFilterInput,
} from "./webPortalFilters";

describe("portalCardFilters", () => {
  it("reads stored card filters, dropping anything malformed", () => {
    expect(
      portalCardFilters({
        subtypes: ["ignored"],
        card_filters: { subtypeFilters: ["a", 3], relationFilters: { Org: ["o1"] }, includeDescendants: true },
      }),
    ).toEqual({
      ...EMPTY_CARD_FILTERS,
      subtypeFilters: ["a"],
      relationFilters: { Org: ["o1"] },
      includeDescendants: true,
    });
  });

  it("reads stored conditions back, dropping the unusable ones", () => {
    expect(
      portalCardFilters({ card_filters: { attrConditions: { code: { contains: "x" }, bad: { min: "1" } } } }),
    ).toEqual({ ...EMPTY_CARD_FILTERS, attrConditions: { code: { contains: "x" } } });
  });

  it("seeds a portal saved before card filters from its subtypes and tags", () => {
    expect(portalCardFilters({ subtypes: ["a"], tag_ids: ["t1"], approval_statuses: ["APPROVED"] })).toEqual({
      ...EMPTY_CARD_FILTERS,
      subtypeFilters: ["a"],
      tagFilterIds: ["t1"],
    });
  });

  it.each([null, undefined, {}, { card_filters: ["not", "an", "object"] }, { card_filters: null }])(
    "starts empty from %j",
    (filters) => {
      expect(portalCardFilters(filters as Record<string, unknown> | null)).toEqual(EMPTY_CARD_FILTERS);
    },
  );
});

describe("portalFiltersBody", () => {
  const base = { cardFilters: EMPTY_CARD_FILTERS, subtypes: [], tagIds: [], approvalStatuses: [] };
  /** The preset as stored: the dialog's added rows are editing state, never sent. */
  const stored = (v: CardFilterValue) => {
    const out: Partial<CardFilterValue> = { ...v };
    delete out.filterFields;
    return out;
  };

  it("is null when nothing narrows the portal", () => {
    expect(portalFiltersBody({ ...base, view: "cards" })).toBeNull();
    expect(portalFiltersBody({ ...base, view: "ppm_portfolio" })).toBeNull();
  });

  it("sends a card-list portal's card filters, never the board keys", () => {
    const cardFilters = { ...EMPTY_CARD_FILTERS, tagFilterIds: ["t1"] };
    expect(portalFiltersBody({ ...base, view: "cards", cardFilters, subtypes: ["x"], tagIds: ["y"] })).toEqual({
      card_filters: stored(cardFilters),
    });
  });

  it("never sends the rows the admin added in the dialog", () => {
    const cardFilters = { ...EMPTY_CARD_FILTERS, attrFilters: { risk: ["high"] }, filterFields: ["risk"] };
    const body = portalFiltersBody({ ...base, view: "cards", cardFilters });
    expect(body).toEqual({ card_filters: { ...stored(EMPTY_CARD_FILTERS), attrFilters: { risk: ["high"] } } });
    expect("filterFields" in (body!.card_filters as object)).toBe(false);
    // The dialog's own value is left as it was.
    expect(cardFilters.filterFields).toEqual(["risk"]);
  });

  it("sends the conditions on the dialog's catalog fields, canonical, and no other", () => {
    const kindByKey = new Map<string, FilterKind>([
      ["code", "text"],
      ["go", "date"],
    ]);
    const cardFilters = {
      ...EMPTY_CARD_FILTERS,
      attrConditions: {
        code: { contains: " ORG-12 " },
        go: { from: "2026-01-01" },
        price: { min: 10 },
        blank: { contains: "" },
      },
      filterFields: ["code"],
    };
    expect(portalFiltersBody({ ...base, view: "cards", cardFilters, kindByKey })).toEqual({
      card_filters: {
        ...stored(EMPTY_CARD_FILTERS),
        attrConditions: { code: { contains: "ORG-12" }, go: { from: "2026-01-01" } },
      },
    });
  });

  it("sends nothing for a condition alone on a field outside the catalog", () => {
    const cardFilters = { ...EMPTY_CARD_FILTERS, attrConditions: { price: { min: 10 } } };
    const kindByKey = new Map<string, FilterKind>([["code", "text"]]);
    expect(portalFiltersBody({ ...base, view: "cards", cardFilters, kindByKey })).toBeNull();
    expect(portalFiltersBody({ ...base, view: "cards", cardFilters })).toBeNull();
  });

  it("sends nothing for added rows alone", () => {
    const cardFilters = { ...EMPTY_CARD_FILTERS, filterFields: ["risk"] };
    expect(portalFiltersBody({ ...base, view: "cards", cardFilters })).toBeNull();
  });

  it("keeps the include-sub-cards preference even with no pick", () => {
    const cardFilters = { ...EMPTY_CARD_FILTERS, includeDescendants: true };
    expect(portalFiltersBody({ ...base, view: "cards", cardFilters })).toEqual({ card_filters: stored(cardFilters) });
  });

  it("sends a board's subtypes and tags, never card filters", () => {
    const cardFilters = { ...EMPTY_CARD_FILTERS, subtypeFilters: ["a"] };
    expect(
      portalFiltersBody({ ...base, view: "process_navigator", cardFilters, subtypes: ["core"], tagIds: ["t1"] }),
    ).toEqual({ subtypes: ["core"], tag_ids: ["t1"] });
    expect(portalFiltersBody({ ...base, view: "ppm_portfolio", tagIds: ["t1"] })).toEqual({ tag_ids: ["t1"] });
  });

  it("carries the approval statuses back whatever the view", () => {
    expect(portalFiltersBody({ ...base, view: "cards", approvalStatuses: ["APPROVED"] })).toEqual({
      approval_statuses: ["APPROVED"],
    });
    expect(
      portalFiltersBody({ ...base, view: "ppm_portfolio", subtypes: ["p"], approvalStatuses: ["APPROVED"] }),
    ).toEqual({ subtypes: ["p"], approval_statuses: ["APPROVED"] });
  });
});

describe("legacyTagsSpanGroups", () => {
  const groups = [
    { id: "g1", name: "Domain", mode: "multi", tags: [{ id: "t1", name: "Finance" }, { id: "t2", name: "Sales" }] },
    { id: "g2", name: "Tier", mode: "single", tags: [{ id: "t3", name: "Gold" }] },
  ];

  it("is true for legacy tags from two groups", () => {
    expect(legacyTagsSpanGroups({ tag_ids: ["t1", "t3"] }, groups)).toBe(true);
  });

  it("is false for tags of one group, or none", () => {
    expect(legacyTagsSpanGroups({ tag_ids: ["t1", "t2"] }, groups)).toBe(false);
    expect(legacyTagsSpanGroups({ tag_ids: ["t1"] }, groups)).toBe(false);
    expect(legacyTagsSpanGroups({ subtypes: ["a"] }, groups)).toBe(false);
    expect(legacyTagsSpanGroups(null, groups)).toBe(false);
  });

  it("is false once the portal has card filters", () => {
    expect(legacyTagsSpanGroups({ tag_ids: ["t1", "t3"], card_filters: {} }, groups)).toBe(false);
  });

  it("counts an unlisted tag as a group of its own", () => {
    expect(legacyTagsSpanGroups({ tag_ids: ["t1", "gone"] }, groups)).toBe(true);
    expect(legacyTagsSpanGroups({ tag_ids: ["t1"] }, [])).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Visitor filters (#1425)                                            */
/* ------------------------------------------------------------------ */

const OPTS = [{ key: "a", label: "A" }];
const f = (key: string, type: string, options?: { key: string; label: string }[]) => ({
  key,
  label: key,
  type,
  ...(options ? { options } : {}),
});

/** Mirrors `FILTER_SCHEMA` in `backend/tests/services/test_portal_visibility.py`. */
const INPUT: VisitorFilterInput = {
  subtypes: [{ key: "s" }],
  fieldsSchema: [
    {
      fields: [
        f("single", "single_select", OPTS),
        f("multi", "multiple_select", OPTS),
        f("noOptions", "single_select"),
        f("emptyOptions", "single_select", []),
        f("flag", "boolean"),
        f("code", "text"),
        f("notes", "multiline_text"),
        f("site", "url"),
        f("count", "number"),
        f("share", "percentage"),
        f("since", "date"),
        f("spend", "cost"),
        f("rating", "ext.plus.rating"),
      ],
    },
    {
      hideInFilters: true,
      fields: [f("quietSelect", "single_select", OPTS), f("quietText", "text"), f("single", "text")],
    },
  ],
  relationKeys: ["r1", "r2"],
  toggles: { "rel:r1": { card: true, detail: false } },
};

describe("shownOnPortal", () => {
  it("follows a toggle, else shows a field or built-in and hides a relation type", () => {
    expect(shownOnPortal({}, "tags")).toBe(true);
    expect(shownOnPortal({}, "field:x")).toBe(true);
    expect(shownOnPortal({}, "rel:r")).toBe(false);
    expect(shownOnPortal({ tags: { card: false, detail: false } }, "tags")).toBe(false);
    expect(shownOnPortal({ tags: { card: true, detail: false } }, "tags")).toBe(true);
    expect(shownOnPortal({ "rel:r": { card: false, detail: true } }, "rel:r")).toBe(true);
  });
});

describe("canBeVisitorFilter", () => {
  it.each([
    ["single_select", OPTS, true],
    ["single_select", undefined, false],
    ["boolean", undefined, true],
    ["text", undefined, true],
    ["number", undefined, true],
    ["date", undefined, true],
    ["cost", undefined, false],
    ["ext.plus.rating", undefined, false],
  ])("%s → %s", (type, options, expected) => {
    expect(canBeVisitorFilter(f("x", type, options))).toBe(expected);
  });
});

describe("visitor filter defaults (twin of default_shown_filters)", () => {
  it("defaults to the old bar: subtype, tags, shown selects with options, shown relations", () => {
    expect(defaultVisitorFilters(INPUT)).toEqual([
      "subtype",
      "tags",
      "field:single",
      "field:multi",
      "rel:r1",
    ]);
  });

  it("offers every shown filterable field, hidden sections included, never a cost field", () => {
    expect(eligibleVisitorFilters(INPUT)).toEqual([
      "subtype",
      "tags",
      "field:single",
      "field:multi",
      "field:flag",
      "field:code",
      "field:notes",
      "field:site",
      "field:count",
      "field:share",
      "field:since",
      "field:quietSelect",
      "field:quietText",
      "rel:r1",
    ]);
  });

  it("leaves out what is hidden, the subtype without subtypes and the tags when hidden", () => {
    const input: VisitorFilterInput = {
      ...INPUT,
      subtypes: [],
      toggles: {
        tags: { card: false, detail: false },
        "field:multi": { card: false, detail: false },
      },
    };
    expect(defaultVisitorFilters(input)).toEqual(["field:single"]);
    expect(defaultVisitorFilters({ ...input, subtypes: undefined })).toEqual(["field:single"]);
    expect(eligibleVisitorFilters(input)).not.toContain("field:multi");
    expect(eligibleVisitorFilters(input)).not.toContain("tags");
  });
});

describe("the visitor filter selection", () => {
  it("follows the default until the admin chooses", () => {
    expect(effectiveVisitorFilters(null, INPUT)).toEqual(defaultVisitorFilters(INPUT));
    expect(visitorFiltersBody(null, INPUT)).toBeUndefined();
  });

  it("keeps a chosen list within what can be a filter now, in table order", () => {
    expect(effectiveVisitorFilters(["rel:r2", "field:code", "field:spend", "tags"], INPUT)).toEqual([
      "tags",
      "field:code",
    ]);
  });

  it("ticks and unticks from what is checked now", () => {
    const ticked = toggleVisitorFilter(null, INPUT, "field:code", true);
    expect(ticked).toEqual(["subtype", "tags", "field:single", "field:multi", "rel:r1", "field:code"]);
    expect(toggleVisitorFilter(ticked, INPUT, "field:code", false)).toEqual(defaultVisitorFilters(INPUT));
    expect(toggleVisitorFilter(null, INPUT, "tags", false)).toEqual([
      "subtype",
      "field:single",
      "field:multi",
      "rel:r1",
    ]);
  });

  it("sends a list only when it differs from the default, in any order", () => {
    const reordered = ["rel:r1", "field:multi", "field:single", "tags", "subtype"];
    expect(visitorFiltersBody(reordered, INPUT)).toBeUndefined();
    expect(visitorFiltersBody(["tags"], INPUT)).toEqual(["tags"]);
    expect(visitorFiltersBody([], INPUT)).toEqual([]);
    // Same length, different keys.
    expect(visitorFiltersBody(["subtype", "tags", "field:single", "field:code", "rel:r1"], INPUT)).toEqual([
      "subtype",
      "tags",
      "field:single",
      "field:code",
      "rel:r1",
    ]);
    // A superset of the default differs.
    expect(visitorFiltersBody([...reordered, "field:code"], INPUT)).toHaveLength(6);
  });

  it("reads a stored list back, strings only; none means follow the default", () => {
    expect(storedVisitorFilters({ visitor_filters: ["tags", 3, null, "field:a"] })).toEqual(["tags", "field:a"]);
    expect(storedVisitorFilters({ visitor_filters: [] })).toEqual([]);
    expect(storedVisitorFilters({ visitor_filters: "tags" })).toBeNull();
    expect(storedVisitorFilters({})).toBeNull();
    expect(storedVisitorFilters(null)).toBeNull();
    expect(storedVisitorFilters(undefined)).toBeNull();
  });
});
