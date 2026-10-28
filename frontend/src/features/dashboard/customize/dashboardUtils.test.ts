import { describe, expect, it } from "vitest";
import {
  baseLocale,
  canManageDashboards,
  dashboardLabel,
  isWildcardRole,
  swapSortOrders,
} from "./dashboardUtils";

describe("canManageDashboards", () => {
  it("needs admin.dashboards or the wildcard", () => {
    expect(canManageDashboards({ "admin.dashboards": true })).toBe(true);
    expect(canManageDashboards({ "*": true })).toBe(true);
    expect(canManageDashboards({ "admin.users": true })).toBe(false);
    expect(canManageDashboards(undefined)).toBe(false);
  });
});

describe("dashboardLabel", () => {
  const d = { name: "Overview", translations: { fr: "Vue d'ensemble", de: " " } };

  it("uses the translation of the base locale", () => {
    expect(dashboardLabel(d, "fr")).toBe("Vue d'ensemble");
    expect(dashboardLabel(d, "fr-CA")).toBe("Vue d'ensemble");
  });

  it("falls back to the stored name when missing or blank", () => {
    expect(dashboardLabel(d, "es")).toBe("Overview");
    expect(dashboardLabel(d, "de")).toBe("Overview");
    expect(dashboardLabel({ name: "Mine", translations: undefined as unknown as Record<string, string> }, "fr")).toBe(
      "Mine",
    );
  });

  it("normalises the locale", () => {
    expect(baseLocale("PT-br")).toBe("pt");
    expect(baseLocale(undefined)).toBe("en");
    expect(baseLocale("")).toBe("en");
  });
});

describe("swapSortOrders", () => {
  const list = [
    { id: "a", sort_order: 0 },
    { id: "b", sort_order: 1 },
    { id: "c", sort_order: 5 },
  ];

  it("swaps with the left neighbour", () => {
    expect(swapSortOrders(list, 1, -1)).toEqual([
      { id: "b", sort_order: 0 },
      { id: "a", sort_order: 1 },
    ]);
  });

  it("swaps with the right neighbour", () => {
    expect(swapSortOrders(list, 1, 1)).toEqual([
      { id: "b", sort_order: 5 },
      { id: "c", sort_order: 1 },
    ]);
  });

  it("does nothing at either end or out of range", () => {
    expect(swapSortOrders(list, 0, -1)).toEqual([]);
    expect(swapSortOrders(list, 2, 1)).toEqual([]);
    expect(swapSortOrders(list, -1, 1)).toEqual([]);
    expect(swapSortOrders(list, 3, -1)).toEqual([]);
  });

  it("breaks a tie so the moved dashboard lands on the right side", () => {
    const tied = [
      { id: "a", sort_order: 3 },
      { id: "b", sort_order: 3 },
    ];
    expect(swapSortOrders(tied, 1, -1)).toEqual([
      { id: "b", sort_order: 3 },
      { id: "a", sort_order: 4 },
    ]);
    expect(swapSortOrders(tied, 0, 1)).toEqual([
      { id: "a", sort_order: 4 },
      { id: "b", sort_order: 3 },
    ]);
  });
});

describe("isWildcardRole", () => {
  it("recognises the wildcard permission or the admin key", () => {
    expect(isWildcardRole({ key: "admin" })).toBe(true);
    expect(isWildcardRole({ key: "superuser", permissions: { "*": true } })).toBe(true);
    expect(isWildcardRole({ key: "member", permissions: { "*": false, "admin.users": true } })).toBe(false);
    expect(isWildcardRole({ key: "viewer" })).toBe(false);
  });
});
