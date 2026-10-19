import { describe, expect, it } from "vitest";

import {
  CARD_TYPE_CATEGORY_ORDER,
  UNCATEGORIZED_GROUP_KEY,
  categoryDisplayName,
  categoryKeyOrder,
  defaultNewTypeCategory,
  groupCardTypesByCategory,
  orderCategories,
  orderCategoryKeys,
} from "./cardTypeOrder";
import type { CardType, CardTypeCategory } from "@/types";

/** Minimal CardType — only the columns the grouping actually reads. */
function makeType(partial: Partial<CardType> & { key: string }): CardType {
  return {
    label: partial.key,
    icon: "category",
    color: "#000000",
    has_hierarchy: false,
    has_successors: false,
    allow_card_logo: false,
    fields_schema: [],
    built_in: false,
    is_hidden: false,
    sort_order: 0,
    ...partial,
  } as CardType;
}

const [STRATEGY, BUSINESS, APPLICATION, TECHNICAL] = CARD_TYPE_CATEGORY_ORDER;

/** The 13 seeded types, in the order the API hands them over. */
function seeded(): CardType[] {
  return [
    makeType({ key: "Objective", category: STRATEGY, sort_order: 0 }),
    makeType({ key: "Platform", category: STRATEGY, sort_order: 1 }),
    makeType({ key: "Initiative", category: STRATEGY, sort_order: 2 }),
    makeType({ key: "Organization", category: BUSINESS, sort_order: 3 }),
    makeType({ key: "BusinessCapability", category: BUSINESS, sort_order: 4 }),
    makeType({ key: "Application", category: APPLICATION, sort_order: 7 }),
    makeType({ key: "Interface", category: APPLICATION, sort_order: 8 }),
    makeType({ key: "ITComponent", category: TECHNICAL, sort_order: 10 }),
    makeType({ key: "Provider", category: TECHNICAL, sort_order: 12 }),
  ];
}

const keysOf = (groups: ReturnType<typeof groupCardTypesByCategory>) =>
  groups.map((g) => g.key);

describe("groupCardTypesByCategory", () => {
  it("puts a custom type in its own layer instead of at the bottom of the list", () => {
    // The bug: a type created after the seed gets `max(sort_order) + 1`, so a
    // flat `ORDER BY sort_order` renders it below every other layer.
    const custom = makeType({
      key: "ValueStream",
      category: BUSINESS,
      sort_order: 99,
    });
    const groups = groupCardTypesByCategory([...seeded(), custom]);

    const business = groups.find((g) => g.category === BUSINESS);
    expect(business?.types.map((t) => t.key)).toEqual([
      "Organization",
      "BusinessCapability",
      "ValueStream",
    ]);
    // …and it did not leak into the last group.
    expect(groups[groups.length - 1].category).toBe(TECHNICAL);
  });

  it("orders the groups by canonical layer whatever order the types arrive in", () => {
    const shuffled = [...seeded()].reverse();
    expect(keysOf(groupCardTypesByCategory(shuffled))).toEqual([
      STRATEGY,
      BUSINESS,
      APPLICATION,
      TECHNICAL,
    ]);
  });

  it("omits a canonical layer that has no visible types", () => {
    const groups = groupCardTypesByCategory([
      makeType({ key: "Objective", category: STRATEGY }),
      makeType({ key: "Provider", category: TECHNICAL }),
    ]);
    expect(keysOf(groups)).toEqual([STRATEGY, TECHNICAL]);
  });

  it("keeps an admin's own layer name and places it after the canonical four", () => {
    const groups = groupCardTypesByCategory([
      makeType({ key: "Control", category: "Security Architecture", sort_order: 20 }),
      ...seeded(),
    ]);
    expect(keysOf(groups)).toEqual([
      STRATEGY,
      BUSINESS,
      APPLICATION,
      TECHNICAL,
      "Security Architecture",
    ]);
    expect(groups[4].category).toBe("Security Architecture");
    expect(groups[4].types.map((t) => t.key)).toEqual(["Control"]);
  });

  it("keeps two non-canonical layers in first-encounter order", () => {
    const groups = groupCardTypesByCategory([
      makeType({ key: "Control", category: "Security Architecture", sort_order: 20 }),
      makeType({ key: "Region", category: "Geography", sort_order: 21 }),
      makeType({ key: "Policy", category: "Security Architecture", sort_order: 22 }),
    ]);
    expect(keysOf(groups)).toEqual(["Security Architecture", "Geography"]);
  });

  it("collects types with no category into one last group", () => {
    const groups = groupCardTypesByCategory([
      makeType({ key: "Loose", sort_order: 50 }),
      ...seeded(),
    ]);
    const last = groups[groups.length - 1];
    expect(last.key).toBe(UNCATEGORIZED_GROUP_KEY);
    expect(last.category).toBeNull();
    expect(last.types.map((t) => t.key)).toEqual(["Loose"]);
  });

  it("treats a blank or whitespace category as no category at all", () => {
    const groups = groupCardTypesByCategory([
      makeType({ key: "NullCat", sort_order: 0 }),
      makeType({ key: "EmptyCat", category: "", sort_order: 1 }),
      makeType({ key: "SpaceCat", category: "   ", sort_order: 2 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe(UNCATEGORIZED_GROUP_KEY);
    expect(groups[0].types.map((t) => t.key)).toEqual([
      "NullCat",
      "EmptyCat",
      "SpaceCat",
    ]);
  });

  it("trims a padded category rather than making it its own layer", () => {
    const groups = groupCardTypesByCategory([
      makeType({ key: "A", category: BUSINESS, sort_order: 0 }),
      makeType({ key: "B", category: `  ${BUSINESS}  `, sort_order: 1 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe(BUSINESS);
  });

  it("excludes hidden types by default and includes them on request", () => {
    const types = [
      makeType({ key: "Visible", category: BUSINESS, sort_order: 0 }),
      makeType({ key: "Hidden", category: BUSINESS, sort_order: 1, is_hidden: true }),
    ];
    expect(groupCardTypesByCategory(types)[0].types.map((t) => t.key)).toEqual([
      "Visible",
    ]);
    expect(
      groupCardTypesByCategory(types, { includeHidden: true })[0].types.map(
        (t) => t.key,
      ),
    ).toEqual(["Visible", "Hidden"]);
  });

  it("drops a layer whose only types are hidden", () => {
    const groups = groupCardTypesByCategory([
      makeType({ key: "Visible", category: BUSINESS }),
      makeType({ key: "Hidden", category: TECHNICAL, is_hidden: true }),
    ]);
    expect(keysOf(groups)).toEqual([BUSINESS]);
  });

  it("orders types within a layer by sort_order, keeping the seeded sequence", () => {
    const groups = groupCardTypesByCategory([
      makeType({ key: "DataObject", category: APPLICATION, sort_order: 9 }),
      makeType({ key: "Application", category: APPLICATION, sort_order: 7 }),
      makeType({ key: "Interface", category: APPLICATION, sort_order: 8 }),
    ]);
    expect(groups[0].types.map((t) => t.key)).toEqual([
      "Application",
      "Interface",
      "DataObject",
    ]);
  });

  it("breaks a sort_order tie on the localized label", () => {
    // English: "Alpha" before "Beta". German translations invert that.
    const alpha = makeType({
      key: "alpha",
      label: "Alpha",
      category: BUSINESS,
      sort_order: 5,
      translations: { label: { de: "Zebra" } },
    });
    const beta = makeType({
      key: "beta",
      label: "Beta",
      category: BUSINESS,
      sort_order: 5,
      translations: { label: { de: "Anton" } },
    });

    expect(
      groupCardTypesByCategory([beta, alpha], { locale: "en" })[0].types.map(
        (t) => t.key,
      ),
    ).toEqual(["alpha", "beta"]);
    expect(
      groupCardTypesByCategory([alpha, beta], { locale: "de" })[0].types.map(
        (t) => t.key,
      ),
    ).toEqual(["beta", "alpha"]);
  });

  it("returns no groups for no types", () => {
    expect(groupCardTypesByCategory([])).toEqual([]);
  });

  it("does not mutate or reorder the input", () => {
    const input = [...seeded()].reverse();
    const original = input.map((t) => t.key);
    groupCardTypesByCategory(input);
    expect(input.map((t) => t.key)).toEqual(original);
  });
});


function makeCategory(
  partial: Partial<CardTypeCategory> & { key: string },
): CardTypeCategory {
  return {
    id: partial.key,
    label: partial.key,
    color: "#999999",
    sort_order: 0,
    built_in: false,
    translations: {},
    ...partial,
  };
}

/** The registry with a custom layer an admin placed between two defaults. */
function registry(): CardTypeCategory[] {
  return [
    makeCategory({ key: TECHNICAL, sort_order: 4, built_in: true }),
    makeCategory({ key: "Security", sort_order: 2, color: "#ff0000" }),
    makeCategory({ key: STRATEGY, sort_order: 0, built_in: true }),
    makeCategory({
      key: APPLICATION,
      sort_order: 3,
      built_in: true,
      color: "#0f7eb5",
      translations: { fr: "Application et données" },
    }),
    makeCategory({ key: BUSINESS, sort_order: 1, built_in: true }),
  ];
}

describe("groupCardTypesByCategory with a registry", () => {
  it("orders groups by the registry, a custom layer included", () => {
    const sec = makeType({ key: "Firewall", category: "Security", sort_order: 99 });
    const groups = groupCardTypesByCategory([...seeded(), sec], {
      categories: registry(),
    });
    expect(keysOf(groups)).toEqual([STRATEGY, BUSINESS, "Security", APPLICATION, TECHNICAL]);
  });

  it("resolves the label and colour from the registry", () => {
    const groups = groupCardTypesByCategory(seeded(), {
      categories: registry(),
      locale: "fr",
    });
    const app = groups.find((g) => g.key === APPLICATION)!;
    expect(app.label).toBe("Application et données");
    expect(app.color).toBe("#0f7eb5");
    expect(app.category).toBe(APPLICATION);
  });

  it("keeps an unknown category after the known ones, under its raw name", () => {
    const stray = makeType({ key: "Stray", category: "Legacy", sort_order: 0 });
    const groups = groupCardTypesByCategory([stray, ...seeded()], {
      categories: registry(),
    });
    expect(keysOf(groups).at(-1)).toBe("Legacy");
    const legacy = groups.at(-1)!;
    expect(legacy.label).toBe("Legacy");
    expect(legacy.color).toBeNull();
  });

  it("labels the uncategorized bucket null", () => {
    const groups = groupCardTypesByCategory([makeType({ key: "X", category: null })], {
      categories: registry(),
    });
    expect(groups[0]).toMatchObject({
      key: UNCATEGORIZED_GROUP_KEY,
      category: null,
      label: null,
      color: null,
    });
  });

  it("falls back to the built-in order when the registry is empty", () => {
    const shuffled = [...seeded()].reverse();
    expect(keysOf(groupCardTypesByCategory(shuffled, { categories: [] }))).toEqual([
      STRATEGY,
      BUSINESS,
      APPLICATION,
      TECHNICAL,
    ]);
  });
});

describe("category ordering helpers", () => {
  it("orderCategories sorts by sort_order then label without mutating", () => {
    const input = [
      makeCategory({ key: "b", sort_order: 1 }),
      makeCategory({ key: "c", sort_order: 0 }),
      makeCategory({ key: "a", sort_order: 1 }),
    ];
    expect(orderCategories(input).map((c) => c.key)).toEqual(["c", "a", "b"]);
    expect(input.map((c) => c.key)).toEqual(["b", "c", "a"]);
  });

  it("categoryKeyOrder uses the registry, else the fallback", () => {
    expect(categoryKeyOrder(registry())).toEqual([
      STRATEGY,
      BUSINESS,
      "Security",
      APPLICATION,
      TECHNICAL,
    ]);
    expect(categoryKeyOrder([])).toEqual([...CARD_TYPE_CATEGORY_ORDER]);
    expect(categoryKeyOrder(undefined)).toEqual([...CARD_TYPE_CATEGORY_ORDER]);
  });

  it("orderCategoryKeys keeps only present keys, unknown ones last, deduplicated", () => {
    expect(
      orderCategoryKeys(["Zed", TECHNICAL, "Security", STRATEGY, "Zed", "Alpha"], registry()),
    ).toEqual([STRATEGY, "Security", TECHNICAL, "Zed", "Alpha"]);
  });

  it("categoryDisplayName resolves, passes unknown values through, and nulls blanks", () => {
    expect(categoryDisplayName(` ${APPLICATION} `, registry(), "fr")).toBe(
      "Application et données",
    );
    expect(categoryDisplayName(APPLICATION, registry(), "de")).toBe(APPLICATION);
    expect(categoryDisplayName("Legacy", registry(), "fr")).toBe("Legacy");
    expect(categoryDisplayName("Legacy", undefined)).toBe("Legacy");
    expect(categoryDisplayName("  ", registry())).toBeNull();
    expect(categoryDisplayName(null, registry())).toBeNull();
    expect(categoryDisplayName(undefined, registry())).toBeNull();
  });
});

describe("defaultNewTypeCategory", () => {
  it("is Application & Data when the registry holds it, wherever it sorts", () => {
    // Strategy & Transformation sorts first; the default is not "first".
    expect(defaultNewTypeCategory(registry())).toBe(APPLICATION);
  });

  it("falls back to the registry's first layer without Application & Data", () => {
    const rows = registry().filter((c) => c.key !== APPLICATION);
    expect(defaultNewTypeCategory(rows)).toBe(STRATEGY);
    expect(
      defaultNewTypeCategory([
        makeCategory({ key: "Zed", sort_order: 1 }),
        makeCategory({ key: "Alpha", sort_order: 1 }),
        makeCategory({ key: "Late", sort_order: 5 }),
      ]),
    ).toBe("Alpha");
  });

  it("is none for an empty registry", () => {
    expect(defaultNewTypeCategory([])).toBeNull();
  });
});
