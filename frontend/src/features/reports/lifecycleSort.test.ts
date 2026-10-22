import { describe, expect, it } from "vitest";
import {
  availableSortKeys,
  currentPhase,
  normalizeSortKey,
  parseDate,
  phaseRank,
  sortLifecycleItems,
  sortValue,
  type LifecycleSortContext,
  type LifecycleSortItem,
} from "./lifecycleSort";

const NOW = Date.parse("2026-06-01T00:00:00Z");

const item = (
  name: string,
  over: Partial<LifecycleSortItem> = {},
): LifecycleSortItem => ({ id: name, name, type: "Application", lifecycle: {}, ...over });

const ctx: LifecycleSortContext = {
  typeLabel: (k) => ({ Application: "Application", ITComponent: "IT Component" })[k] ?? k,
  subtypeLabel: (i) => (i.subtype ? `~${i.subtype}` : ""),
  startDateKey: "contractStart",
  endDateKey: "contractEnd",
  statusLabel: (i) => (i.attributes?.health as string | undefined) ?? null,
  optionOrder: (k) => (k === "criticality" ? ["low", "medium", "high", "mission"] : []),
  now: NOW,
};

const names = (items: LifecycleSortItem[]) => items.map((i) => i.name);

describe("parseDate", () => {
  it("reads ISO dates and refuses everything else", () => {
    expect(parseDate("2026-01-01")).toBe(Date.parse("2026-01-01"));
    expect(parseDate("")).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate(20260101)).toBeNull();
    expect(parseDate("not a date")).toBeNull();
  });
});

describe("currentPhase", () => {
  it("is the latest phase whose date has passed", () => {
    expect(currentPhase({ plan: "2020-01-01", active: "2022-01-01", phaseOut: "2030-01-01" }, NOW)).toBe(
      "active",
    );
    expect(currentPhase({ endOfLife: "2026-06-01T00:00:00Z" }, NOW)).toBe("endOfLife");
  });

  it("is planning when nothing has started", () => {
    expect(currentPhase({}, NOW)).toBe("plan");
    expect(currentPhase({ active: "2030-01-01" }, NOW)).toBe("plan");
  });

  it("ranks the phases in lifecycle order", () => {
    expect(["plan", "phaseIn", "active", "phaseOut", "endOfLife"].map(phaseRank)).toEqual([0, 1, 2, 3, 4]);
    expect(phaseRank("bogus")).toBe(-1);
  });
});

describe("availableSortKeys", () => {
  it("offers the phase dates in phase mode, with subtype and select fields when there are some", () => {
    expect(availableSortKeys({ customDates: false, hasSubtypes: true, selectFieldKeys: ["criticality"] })).toEqual([
      "name",
      "type",
      "subtype",
      "phase",
      "plan",
      "phaseIn",
      "active",
      "phaseOut",
      "endOfLife",
      "attr:criticality",
    ]);
  });

  it("offers the range columns in date-range mode", () => {
    expect(availableSortKeys({ customDates: true, hasSubtypes: false, selectFieldKeys: [] })).toEqual([
      "name",
      "type",
      "startDate",
      "endDate",
      "status",
    ]);
  });
});

describe("normalizeSortKey", () => {
  const keys = ["name", "type", "endOfLife"];
  it("maps the legacy eol key to the End of Life date", () => {
    expect(normalizeSortKey("eol", keys)).toBe("endOfLife");
  });
  it("falls back to the name for a key the view does not offer", () => {
    expect(normalizeSortKey("attr:gone", keys)).toBe("name");
    expect(normalizeSortKey("eol", ["name"])).toBe("name");
  });
  it("keeps an offered key", () => {
    expect(normalizeSortKey("type", keys)).toBe("type");
  });
});

describe("sortValue", () => {
  it("reads each kind of key", () => {
    const i = item("Alpha", {
      type: "ITComponent",
      subtype: "saas",
      lifecycle: { active: "2020-01-01", phaseOut: "2027-03-01" },
      attributes: { contractStart: "2021-01-01", contractEnd: "2029-01-01", health: "Good", criticality: "high" },
    });
    expect(sortValue(i, "name", ctx)).toBe("Alpha");
    expect(sortValue(i, "type", ctx)).toBe("IT Component");
    expect(sortValue(i, "subtype", ctx)).toBe("~saas");
    expect(sortValue(i, "phase", ctx)).toBe(2);
    expect(sortValue(i, "phaseOut", ctx)).toBe(Date.parse("2027-03-01"));
    expect(sortValue(i, "startDate", ctx)).toBe(Date.parse("2021-01-01"));
    expect(sortValue(i, "endDate", ctx)).toBe(Date.parse("2029-01-01"));
    expect(sortValue(i, "status", ctx)).toBe("Good");
    expect(sortValue(i, "attr:criticality", ctx)).toBe(2);
    expect(sortValue(i, "bogus", ctx)).toBeNull();
  });

  it("reads a missing value as null", () => {
    const bare = item("Bare", { attributes: { criticality: "" } });
    for (const key of ["subtype", "endOfLife", "startDate", "endDate", "status", "attr:criticality", "attr:other"]) {
      expect(sortValue(bare, key, ctx)).toBeNull();
    }
  });

  it("puts an option the field no longer defines after every known one", () => {
    expect(sortValue(item("X", { attributes: { criticality: "legacy" } }), "attr:criticality", ctx)).toBe(4);
  });
});

describe("sortLifecycleItems", () => {
  const items = [
    item("Delta", { lifecycle: { phaseOut: "2028-01-01" }, attributes: { criticality: "low" } }),
    item("Bravo", { lifecycle: {}, attributes: { criticality: "mission" } }),
    item("Charlie", { lifecycle: { phaseOut: "2026-09-01" } }),
    item("Alpha", { lifecycle: {}, attributes: { criticality: "high" } }),
    item("Echo", { lifecycle: { phaseOut: "2026-09-01" }, attributes: { criticality: "low" } }),
  ];

  it("sorts by name both ways", () => {
    expect(names(sortLifecycleItems(items, "name", "asc", ctx))).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
    expect(names(sortLifecycleItems(items, "name", "desc", ctx))).toEqual(["Echo", "Delta", "Charlie", "Bravo", "Alpha"]);
  });

  it("keeps the cards without a date last, whichever way it runs", () => {
    expect(names(sortLifecycleItems(items, "phaseOut", "asc", ctx))).toEqual(["Charlie", "Echo", "Delta", "Alpha", "Bravo"]);
    expect(names(sortLifecycleItems(items, "phaseOut", "desc", ctx))).toEqual(["Delta", "Charlie", "Echo", "Alpha", "Bravo"]);
  });

  it("sorts a select field by option order, not alphabetically", () => {
    // low < medium < high < mission, though "high" < "low" < "mission" by name.
    expect(names(sortLifecycleItems(items, "attr:criticality", "desc", ctx))).toEqual([
      "Bravo",
      "Alpha",
      "Delta",
      "Echo",
      "Charlie",
    ]);
    expect(names(sortLifecycleItems(items, "attr:criticality", "asc", ctx))).toEqual([
      "Delta",
      "Echo",
      "Alpha",
      "Bravo",
      "Charlie",
    ]);
  });

  it("compares option positions as numbers, so the tenth option follows the ninth", () => {
    const many: LifecycleSortContext = {
      ...ctx,
      optionOrder: () => ["o0", "o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8", "o9", "o10", "o11"],
    };
    const items = [
      item("Ten", { attributes: { level: "o10" } }),
      item("Two", { attributes: { level: "o2" } }),
      item("Nine", { attributes: { level: "o9" } }),
      item("Eleven", { attributes: { level: "o11" } }),
    ];
    expect(names(sortLifecycleItems(items, "attr:level", "asc", many))).toEqual(["Two", "Nine", "Ten", "Eleven"]);
    expect(names(sortLifecycleItems(items, "attr:level", "desc", many))).toEqual(["Eleven", "Ten", "Nine", "Two"]);
  });

  it("reads a card with no attributes at all as missing every attribute value", () => {
    const bare: LifecycleSortItem = { id: "b", name: "Bare", type: "Application", lifecycle: {} };
    for (const key of ["startDate", "endDate", "attr:criticality"]) expect(sortValue(bare, key, ctx)).toBeNull();
    const dated = item("Dated", { attributes: { contractStart: "2020-01-01" } });
    expect(names(sortLifecycleItems([bare, dated], "startDate", "desc", ctx))).toEqual(["Dated", "Bare"]);
  });

  it("does not change the list it was given", () => {
    const before = names(items);
    sortLifecycleItems(items, "name", "desc", ctx);
    expect(names(items)).toEqual(before);
  });
});
