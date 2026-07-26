import { describe, it, expect } from "vitest";
import { compareAffectedCards, groupCardsByType } from "./affectedCards";
import type { CardType, RiskCardLink } from "@/types";

function cardType(key: string, sort_order: number, extra: Partial<CardType> = {}): CardType {
  return {
    key,
    label: `${key} Label`,
    icon: "apps",
    color: `#00000${sort_order}`,
    has_hierarchy: false,
    has_successors: false,
    fields_schema: [],
    built_in: true,
    is_hidden: false,
    sort_order,
    ...extra,
  } as CardType;
}

function link(name: string, type: string): RiskCardLink {
  return { card_id: `${type}:${name}`, card_name: name, card_type: type, role: "affected" };
}

const TYPES: CardType[] = [
  cardType("Application", 2),
  cardType("Objective", 1),
  cardType("ITComponent", 3),
];

describe("groupCardsByType", () => {
  it("returns an empty list for no cards", () => {
    expect(groupCardsByType([], TYPES)).toEqual([]);
  });

  it("orders groups by the metamodel sort_order, not by insertion order", () => {
    const groups = groupCardsByType(
      [link("Zeta", "ITComponent"), link("Beta", "Application"), link("Alpha", "Objective")],
      TYPES,
    );
    expect(groups.map((g) => g.typeKey)).toEqual(["Objective", "Application", "ITComponent"]);
  });

  it("sorts cards alphabetically within a group", () => {
    const groups = groupCardsByType(
      [
        link("Zulu", "Application"),
        link("alpha", "Application"),
        link("Mike", "Application"),
      ],
      TYPES,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].cards.map((c) => c.card_name)).toEqual(["alpha", "Mike", "Zulu"]);
  });

  it("carries the type colour and translated label", () => {
    const localized = [
      cardType("Application", 1, {
        translations: { label: { de: "Anwendung" } },
      }),
    ];
    const [group] = groupCardsByType([link("Alpha", "Application")], localized, "de");
    expect(group.label).toBe("Anwendung");
    expect(group.color).toBe("#000001");
  });

  it("falls back to the raw key and sorts last for an unknown type", () => {
    const groups = groupCardsByType(
      [link("Ghost", "DeletedType"), link("Alpha", "Objective")],
      TYPES,
    );
    expect(groups.map((g) => g.typeKey)).toEqual(["Objective", "DeletedType"]);
    const unknown = groups[1];
    expect(unknown.label).toBe("DeletedType");
    expect(unknown.color).toBeUndefined();
  });

  it("uses the type label (not the key) when a type has no translations", () => {
    // Admin-created types ship with an empty translations map, so the label
    // field is what must render — never the internal slug.
    const custom = [cardType("itAsset", 1, { label: "IT Asset", translations: {} })];
    const [group] = groupCardsByType([link("Laptop", "itAsset")], custom, "en");
    expect(group.label).toBe("IT Asset");
  });
});

describe("compareAffectedCards", () => {
  it("orders by type first, then name", () => {
    const sorted = [
      link("Zebra", "Objective"),
      link("Apple", "ITComponent"),
      link("Mango", "Application"),
      link("Apricot", "Objective"),
    ].sort(compareAffectedCards(TYPES));

    expect(sorted.map((c) => `${c.card_type}/${c.card_name}`)).toEqual([
      "Objective/Apricot",
      "Objective/Zebra",
      "Application/Mango",
      "ITComponent/Apple",
    ]);
  });

  it("keeps unknown types together at the end", () => {
    const sorted = [
      link("Ghost", "Unknown"),
      link("Mango", "Application"),
      link("Aardvark", "Unknown"),
    ].sort(compareAffectedCards(TYPES));

    expect(sorted.map((c) => c.card_name)).toEqual(["Mango", "Aardvark", "Ghost"]);
  });
});
