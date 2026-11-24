import { describe, expect, it } from "vitest";
import { EMPTY_CARD_FILTERS, type CardFilterValue } from "@/features/reports/cardFilters";
import type { FilterKind } from "@/lib/fieldFilters";
import { legacyTagsSpanGroups, portalCardFilters, portalFiltersBody } from "./webPortalFilters";

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
