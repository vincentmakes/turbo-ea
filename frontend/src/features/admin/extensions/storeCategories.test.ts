import { describe, it, expect } from "vitest";
import { groupStoreItems } from "./storeCategories";
import type { StoreItem } from "./types";

function item(key: string, category?: string): StoreItem {
  return {
    key,
    name: key,
    description: "",
    price: "Commercial",
    payment_link: "https://buy.test/pl",
    version: "1.0.0",
    installed_version: null,
    update_available: false,
    entitlement_state: "unlicensed",
    ...(category === undefined ? {} : { category }),
  };
}

describe("groupStoreItems", () => {
  it("orders sections by the fixed vocabulary, not by first appearance", () => {
    const groups = groupStoreItems([
      item("r", "regulations"),
      item("i", "integrations"),
      item("s", "strategy"),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["strategy", "integrations", "regulations"]);
    // A fourth section exists for governance and automation listings.
    expect(groupStoreItems([item("g", "governance"), item("s", "strategy")]).map((g) => g.category)).toEqual(["strategy", "governance"]);
  });

  it("keeps catalogue order inside a section and omits empty sections", () => {
    const groups = groupStoreItems([
      item("b", "integrations"),
      item("a", "integrations"),
      item("s", "strategy"),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["strategy", "integrations"]);
    expect(groups[1].items.map((i) => i.key)).toEqual(["b", "a"]);
  });

  it("files unknown and missing categories under a trailing Other section", () => {
    // A newer catalogue may introduce a slug this build has never heard of;
    // it must still be listed, never dropped.
    const groups = groupStoreItems([
      item("new", "observability"),
      item("none"),
      item("s", "strategy"),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["strategy", "other"]);
    expect(groups[1].items.map((i) => i.key)).toEqual(["new", "none"]);
  });

  it("returns one unlabeled group when nothing carries a known category", () => {
    // A pre-category catalogue keeps rendering as the flat grid it always
    // did — a lone "Other" heading over everything would be noise.
    const groups = groupStoreItems([item("a"), item("b", "whatever")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBeNull();
    expect(groups[0].items.map((i) => i.key)).toEqual(["a", "b"]);
  });

  it("returns nothing for an empty list", () => {
    expect(groupStoreItems([])).toEqual([]);
  });
});
