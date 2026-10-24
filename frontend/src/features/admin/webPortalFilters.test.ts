import { describe, expect, it } from "vitest";
import { EMPTY_CARD_FILTERS } from "@/features/reports/cardFilters";
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

  it("is null when nothing narrows the portal", () => {
    expect(portalFiltersBody({ ...base, view: "cards" })).toBeNull();
    expect(portalFiltersBody({ ...base, view: "ppm_portfolio" })).toBeNull();
  });

  it("sends a card-list portal's card filters, never the board keys", () => {
    const cardFilters = { ...EMPTY_CARD_FILTERS, tagFilterIds: ["t1"] };
    expect(portalFiltersBody({ ...base, view: "cards", cardFilters, subtypes: ["x"], tagIds: ["y"] })).toEqual({
      card_filters: cardFilters,
    });
  });

  it("keeps the include-sub-cards preference even with no pick", () => {
    const cardFilters = { ...EMPTY_CARD_FILTERS, includeDescendants: true };
    expect(portalFiltersBody({ ...base, view: "cards", cardFilters })).toEqual({ card_filters: cardFilters });
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
