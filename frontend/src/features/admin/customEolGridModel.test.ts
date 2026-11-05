import { beforeEach, describe, expect, it } from "vitest";
import type { EolCustomCycle, EolCustomProduct } from "@/types";
import { EMPTY_CUSTOM_EOL_FILTERS } from "./CustomEolFilterSidebar";
import {
  DEFAULT_PREFS,
  PREFS_STORAGE_KEY,
  STATUS_RANK,
  buildRows,
  filterRows,
  latestCycleOf,
  loadPrefs,
  savePrefs,
  worstStatus,
} from "./customEolGridModel";

const TODAY = "2026-06-15";

const cycle = (over: Partial<EolCustomCycle>): EolCustomCycle => ({
  id: "c",
  cycle: "1",
  releaseDate: null,
  support: null,
  eol: false,
  latest: null,
  latestReleaseDate: null,
  sort_order: 0,
  linked_cards: 0,
  updated_at: null,
  ...over,
});

const ACME: EolCustomProduct = {
  id: "p1",
  key: "acme-erp",
  product: "custom:acme-erp",
  title: "Acme ERP",
  description: null,
  link: null,
  eol_category: null,
  release_policy_note: null,
  linked_cards: 3,
  updated_at: "2026-01-01T00:00:00Z",
  cycles: [
    cycle({
      id: "c1",
      cycle: "1",
      releaseDate: "2020-01-01",
      support: false,
      eol: "2025-01-01",
      linked_cards: 3,
      updated_at: "2026-03-01T00:00:00Z",
    }),
    cycle({
      id: "c2",
      cycle: "2",
      releaseDate: "2024-01-01",
      support: true,
      eol: false,
      latest: "2.4.1",
      updated_at: "2026-02-01T00:00:00Z",
    }),
  ],
};
const BARE: EolCustomProduct = {
  ...ACME,
  id: "p2",
  key: "bare",
  product: "custom:bare",
  title: "Bare Tool",
  linked_cards: 0,
  updated_at: null,
  cycles: [],
};

describe("buildRows", () => {
  it("summarises a product's cycles in one row", () => {
    const [row] = buildRows([ACME], TODAY);
    expect({ ...row, product: undefined }).toEqual({
      key: "acme-erp",
      product: undefined,
      title: "Acme ERP",
      cycleCount: 2,
      latestCycle: "2",
      latestVersion: "2.4.1",
      status: "eol",
      statuses: ["eol", "supported"],
      statusCounts: { eol: 1, supported: 1 },
      linked: 3,
      updated: "2026-03-01T00:00:00Z",
    });
    expect(row.product).toBe(ACME);
  });

  it("gives a product with no cycles an unknown status and no latest cycle", () => {
    expect(buildRows([BARE], TODAY)).toEqual([
      {
        key: "bare",
        product: BARE,
        title: "Bare Tool",
        cycleCount: 0,
        latestCycle: null,
        latestVersion: null,
        status: "unknown",
        statuses: [],
        statusCounts: {},
        linked: 0,
        updated: null,
      },
    ]);
  });

  it("takes the product's own change when it is the newest", () => {
    const p = { ...ACME, updated_at: "2026-09-09T00:00:00Z" };
    expect(buildRows([p], TODAY)[0].updated).toBe("2026-09-09T00:00:00Z");
    const onlyCycle = { ...ACME, updated_at: null };
    expect(buildRows([onlyCycle], TODAY)[0].updated).toBe("2026-03-01T00:00:00Z");
  });
});

describe("worstStatus", () => {
  it.each([
    [[], "unknown"],
    [["supported"], "supported"],
    [["supported", "unknown"], "unknown"],
    [["unknown", "approaching"], "approaching"],
    [["approaching", "eol", "supported"], "eol"],
    [["eol", "approaching"], "eol"],
  ] as const)("%j → %s", (statuses, expected) => {
    expect(worstStatus([...statuses])).toBe(expected);
  });

  it("ranks eol > approaching > unknown > supported", () => {
    expect(STATUS_RANK).toEqual({ eol: 3, approaching: 2, unknown: 1, supported: 0 });
  });
});

describe("latestCycleOf", () => {
  const a = cycle({ id: "a", releaseDate: "2022-01-01" });
  const b = cycle({ id: "b", releaseDate: "2024-01-01" });
  const b2 = cycle({ id: "b2", releaseDate: "2024-01-01" });
  const u = cycle({ id: "u", releaseDate: null });
  const u2 = cycle({ id: "u2", releaseDate: null });
  it.each([
    [[], null],
    [[a, b], "b"],
    [[b, a], "b"],
    [[u, a], "a"],
    [[a, u], "a"],
    [[b, b2], "b"],
    [[u, u2], "u"],
  ] as const)("%# → %s", (cycles, id) => {
    expect(latestCycleOf([...cycles])?.id ?? null).toBe(id);
  });
});

describe("filterRows", () => {
  const SUPPORTED: EolCustomProduct = {
    ...ACME,
    id: "p3",
    key: "fine",
    title: "Fine App",
    linked_cards: 1,
    cycles: [cycle({ id: "f1", cycle: "9", eol: false, support: true, latest: "9.9.9" })],
  };
  const rows = buildRows([ACME, BARE, SUPPORTED], TODAY);
  const keys = (f: Partial<typeof EMPTY_CUSTOM_EOL_FILTERS>) =>
    filterRows(rows, { ...EMPTY_CUSTOM_EOL_FILTERS, ...f }).map((r) => r.key);

  it("keeps everything without a filter", () => {
    expect(keys({})).toEqual(["acme-erp", "bare", "fine"]);
  });

  it("filters on the product's worst status, not on any cycle's", () => {
    expect(keys({ statuses: ["eol"] })).toEqual(["acme-erp"]);
    expect(keys({ statuses: ["supported"] })).toEqual(["fine"]);
    expect(keys({ statuses: ["unknown"] })).toEqual(["bare"]);
    expect(keys({ statuses: ["approaching"] })).toEqual([]);
    expect(keys({ statuses: ["unknown", "supported"] })).toEqual(["bare", "fine"]);
  });

  it("filters on usage", () => {
    expect(keys({ usage: "linked" })).toEqual(["acme-erp", "fine"]);
    expect(keys({ usage: "unused" })).toEqual(["bare"]);
  });

  it("searches title, key, cycle names and latest versions, case-insensitively", () => {
    expect(keys({ search: "  bare TOOL " })).toEqual(["bare"]);
    expect(keys({ search: "acme-e" })).toEqual(["acme-erp"]);
    expect(keys({ search: "9" })).toEqual(["fine"]);
    expect(keys({ search: "2.4.1" })).toEqual(["acme-erp"]);
    expect(keys({ search: "zzz" })).toEqual([]);
  });

  it("combines filters", () => {
    expect(keys({ usage: "linked", statuses: ["supported"], search: "fine" })).toEqual(["fine"]);
    expect(keys({ usage: "unused", statuses: ["eol"] })).toEqual([]);
  });
});

describe("prefs", () => {
  beforeEach(() => localStorage.clear());

  it("uses the v2 key and ignores the old one", () => {
    expect(PREFS_STORAGE_KEY).toBe("turboea.eolCustomProducts.v2.prefs");
    localStorage.setItem(
      "turboea.eolCustomProducts.prefs",
      JSON.stringify({ filtersCollapsed: true, frozenColumns: ["cycle"] }),
    );
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("defaults to freezing the product column, with no grouping", () => {
    expect(DEFAULT_PREFS.frozenColumns).toEqual(["product"]);
    expect(DEFAULT_PREFS).not.toHaveProperty("groupBy");
    expect(DEFAULT_PREFS).toEqual({
      filtersCollapsed: false,
      sidebarWidth: 260,
      visibleColumns: ["product", "cycles", "latestCycle", "latest", "status", "linked", "updated"],
      frozenColumns: ["product"],
      columnOrder: [],
    });
  });

  it("round-trips, drops unknown columns and groupBy, and clamps the width", () => {
    savePrefs({
      filtersCollapsed: true,
      sidebarWidth: 300,
      visibleColumns: ["status"],
      frozenColumns: [],
      columnOrder: ["status", "product"],
    });
    expect(loadPrefs()).toEqual({
      filtersCollapsed: true,
      sidebarWidth: 300,
      visibleColumns: ["product", "status"],
      frozenColumns: [],
      columnOrder: ["status", "product"],
    });
    localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({
        sidebarWidth: 9999,
        visibleColumns: ["cycle", "bogus"],
        frozenColumns: ["cycle", "product"],
        groupBy: "product",
      }),
    );
    const p = loadPrefs();
    expect(p).not.toHaveProperty("groupBy");
    expect(p.sidebarWidth).toBe(480);
    expect(p.visibleColumns).toEqual(DEFAULT_PREFS.visibleColumns);
    expect(p.frozenColumns).toEqual(["product"]);
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ sidebarWidth: 1 }));
    expect(loadPrefs().sidebarWidth).toBe(220);
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ sidebarWidth: "wide" }));
    expect(loadPrefs().sidebarWidth).toBe(260);
  });

  it("falls back to the defaults on malformed storage", () => {
    localStorage.setItem(PREFS_STORAGE_KEY, "{not json");
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });
});
