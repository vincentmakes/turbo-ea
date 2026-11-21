import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  BOARD_PARAMS,
  boardParams,
  clearBoardPrefs,
  loadBoardPrefs,
  restoreTarget,
  sameBoardParams,
  saveBoardPrefs,
  withBoardParams,
} from "./ppmBoardPrefs";
import { filterSearchParams } from "./ppmPortfolioModel";

const KEY = "turboea.ppm.portfolio.prefs";
const store = (value: unknown) => localStorage.setItem(KEY, JSON.stringify(value));

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("BOARD_PARAMS", () => {
  it("lists exactly the parameters the board's URL-sync writes", () => {
    // Every field set away from its opening value, so each parameter is written.
    const written = filterSearchParams(new URLSearchParams("tab=x"), {
      groupBy: "Platform",
      search: "erp",
      subtype: "Project",
      initialGroupBy: "Organization",
      initialSubtype: "",
      hierarchy: true,
      depth: 2,
      bySubtype: false,
      filters: "{}",
    });
    const sub = filterSearchParams(new URLSearchParams(), {
      groupBy: "Organization",
      search: "",
      subtype: "",
      initialGroupBy: "Organization",
      initialSubtype: "",
      hierarchy: false,
      depth: 2,
      bySubtype: true,
      filters: "",
    });
    const keys = new Set([...written.keys(), ...sub.keys()]);
    keys.delete("tab");
    expect([...keys].sort()).toEqual([...BOARD_PARAMS].sort());
    // And it clears every one of them from a link that carries them all.
    const all = new URLSearchParams(BOARD_PARAMS.map((k) => [k, "x"]));
    const cleared = filterSearchParams(all, {
      groupBy: "",
      search: "",
      subtype: "",
      initialGroupBy: "Organization",
      initialSubtype: "",
      hierarchy: false,
      depth: 0,
      bySubtype: false,
      filters: "",
    });
    expect(cleared.toString()).toBe("");
  });
});

describe("loadBoardPrefs", () => {
  it("defaults to nothing remembered and the section folded", () => {
    expect(loadBoardPrefs()).toEqual({ params: {}, filtersCollapsed: true });
  });

  it("round-trips what was saved", () => {
    saveBoardPrefs({ params: { search: "erp", hierarchy: "1" }, filtersCollapsed: false });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      params: { search: "erp", hierarchy: "1" },
      filtersCollapsed: false,
    });
    expect(loadBoardPrefs()).toEqual({
      params: { search: "erp", hierarchy: "1" },
      filtersCollapsed: false,
    });
  });

  it("falls back to the defaults on corrupt JSON", () => {
    localStorage.setItem(KEY, "{nope");
    expect(loadBoardPrefs()).toEqual({ params: {}, filtersCollapsed: true });
  });

  it("falls back to the defaults on a stored value that is not an object", () => {
    store(["search"]);
    expect(loadBoardPrefs()).toEqual({ params: {}, filtersCollapsed: true });
    store(null);
    expect(loadBoardPrefs()).toEqual({ params: {}, filtersCollapsed: true });
    store("search");
    expect(loadBoardPrefs()).toEqual({ params: {}, filtersCollapsed: true });
  });

  it("drops params that are not an object", () => {
    store({ params: ["search"], filtersCollapsed: false });
    expect(loadBoardPrefs()).toEqual({ params: {}, filtersCollapsed: false });
    store({ params: "search=erp", filtersCollapsed: false });
    expect(loadBoardPrefs().params).toEqual({});
    store({ params: null });
    expect(loadBoardPrefs().params).toEqual({});
  });

  it("keeps only the board's own parameters, as non-empty strings", () => {
    store({
      params: { search: "erp", tab: "x", depth: 2, hierarchy: true, subtype: "", groupBy: "Platform" },
    });
    expect(loadBoardPrefs().params).toEqual({ search: "erp", groupBy: "Platform" });
  });

  it("reads the fold only from a real boolean", () => {
    store({ filtersCollapsed: "false" });
    expect(loadBoardPrefs().filtersCollapsed).toBe(true);
    store({ filtersCollapsed: 0 });
    expect(loadBoardPrefs().filtersCollapsed).toBe(true);
    store({ filtersCollapsed: true });
    expect(loadBoardPrefs().filtersCollapsed).toBe(true);
    store({ filtersCollapsed: false });
    expect(loadBoardPrefs().filtersCollapsed).toBe(false);
  });

  it("falls back to the defaults when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadBoardPrefs()).toEqual({ params: {}, filtersCollapsed: true });
  });
});

describe("saveBoardPrefs / clearBoardPrefs", () => {
  it("stores only the board's own parameters", () => {
    saveBoardPrefs({ params: { search: "erp", tab: "x", subtype: "" }, filtersCollapsed: true });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      params: { search: "erp" },
      filtersCollapsed: true,
    });
  });

  it("remembers an unfolded section with nothing else set", () => {
    saveBoardPrefs({ params: {}, filtersCollapsed: false });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      params: {},
      filtersCollapsed: false,
    });
  });

  it("leaves no entry for the default state", () => {
    store({ params: { search: "erp" }, filtersCollapsed: false });
    saveBoardPrefs({ params: {}, filtersCollapsed: true });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("clears what was remembered", () => {
    store({ params: { search: "erp" }, filtersCollapsed: false });
    localStorage.setItem("other", "kept");
    clearBoardPrefs();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(localStorage.getItem("other")).toBe("kept");
  });

  it("swallows storage that refuses to write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() =>
      saveBoardPrefs({ params: { search: "erp" }, filtersCollapsed: true }),
    ).not.toThrow();
  });

  it("swallows storage that refuses to remove", () => {
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => clearBoardPrefs()).not.toThrow();
    expect(() => saveBoardPrefs({ params: {}, filtersCollapsed: true })).not.toThrow();
    expect(remove).toHaveBeenCalledTimes(2);
  });
});

describe("boardParams", () => {
  it("takes the board's own parameters of a link and ignores the rest", () => {
    expect(boardParams(new URLSearchParams("tab=x&search=erp&depth=2&foo=1&subtype="))).toEqual({
      search: "erp",
      depth: "2",
    });
    expect(boardParams(new URLSearchParams("tab=x"))).toEqual({});
  });
});

describe("restoreTarget", () => {
  const stored = { search: "erp", groupBy: "Platform" };

  it("restores what is remembered onto a link with no board parameter", () => {
    expect(restoreTarget(new URLSearchParams("tab=x"), stored)).toEqual(stored);
  });

  it("restores nothing onto a link with a board parameter of its own", () => {
    expect(restoreTarget(new URLSearchParams("depth=2"), stored)).toBeNull();
  });

  it("restores nothing when nothing is remembered", () => {
    expect(restoreTarget(new URLSearchParams(), {})).toBeNull();
  });
});

describe("sameBoardParams", () => {
  it("compares the board's parameters key for key", () => {
    expect(sameBoardParams({ search: "a" }, { search: "a" })).toBe(true);
    expect(sameBoardParams({}, {})).toBe(true);
    expect(sameBoardParams({ search: "a" }, { search: "b" })).toBe(false);
    expect(sameBoardParams({ search: "a" }, {})).toBe(false);
    expect(sameBoardParams({}, { filters: "{}" })).toBe(false);
  });
});

describe("withBoardParams", () => {
  it("replaces the board's parameters and keeps every other one", () => {
    const next = withBoardParams(new URLSearchParams("tab=x&search=old&depth=2"), {
      search: "new",
      groupBy: "Platform",
    });
    expect(Object.fromEntries(next)).toEqual({ tab: "x", search: "new", groupBy: "Platform" });
  });

  it("strips the board's parameters with an empty set", () => {
    const prev = new URLSearchParams("tab=x&search=old&filters=%7B%7D");
    expect(withBoardParams(prev, {}).toString()).toBe("tab=x");
    // The link it was given is left alone.
    expect(prev.get("search")).toBe("old");
  });
});
