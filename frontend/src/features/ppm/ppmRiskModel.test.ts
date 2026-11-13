import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RAG_COLORS } from "@/theme/tokens";
import type { PpmRisk } from "@/types";
import {
  DEFAULT_RISK_GRID_PREFS,
  DEFAULT_RISK_SORT,
  DEFAULT_VISIBLE_RISK_COLUMNS,
  EMPTY_RISK_FILTERS,
  LOCKED_RISK_COLUMNS,
  NO_OWNER,
  RISK_GRID_COLUMNS,
  RISK_GRID_COLUMN_IDS,
  RISK_GRID_PREFS_KEY,
  RISK_GROUP_AXES,
  RISK_SCORE_BANDS,
  RISK_STATUSES,
  RISK_STATUS_CHIP_COLOR,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  activeRiskFilterCount,
  bandColor,
  defaultRiskGridPrefs,
  filterRisks,
  loadRiskGridPrefs,
  paletteColor,
  riskCellText,
  riskColumnsDifferFromDefault,
  riskOwnerOptions,
  riskStatusLabel,
  riskStatusLabelKey,
  riskStatusPaletteColor,
  riskSummary,
  saveRiskGridPrefs,
  scoreBand,
  scoreBandLabel,
  scoreColor,
  sortRisksForPrint,
  type PpmRiskFilters,
} from "./ppmRiskModel";

function risk(over: Partial<PpmRisk> & { id: string }): PpmRisk {
  return {
    initiative_id: "i1",
    title: over.id,
    description: null,
    probability: 3,
    impact: 3,
    risk_score: 9,
    mitigation: null,
    owner_id: null,
    owner_name: null,
    status: "open",
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    ...over,
  };
}

/** A translator that shows which key it was asked for. */
const tKey = (key: string) => `<${key}>`;

describe("score bands", () => {
  it("splits at 6 and 15", () => {
    expect([1, 5, 6, 14, 15, 25].map(scoreBand)).toEqual([
      "low",
      "low",
      "medium",
      "medium",
      "high",
      "high",
    ]);
    expect(RISK_SCORE_BANDS).toEqual(["high", "medium", "low"]);
  });

  it("colours each band with its RAG token", () => {
    expect(scoreColor(5)).toBe(RAG_COLORS.green);
    expect(scoreColor(6)).toBe(RAG_COLORS.amber);
    expect(scoreColor(14)).toBe(RAG_COLORS.amber);
    expect(scoreColor(15)).toBe(RAG_COLORS.red);
    expect(RISK_SCORE_BANDS.map(bandColor)).toEqual([
      RAG_COLORS.red,
      RAG_COLORS.amber,
      RAG_COLORS.green,
    ]);
  });

  it("labels each band", () => {
    expect(RISK_SCORE_BANDS.map((b) => scoreBandLabel(b, tKey))).toEqual([
      "<riskGridBandHigh>",
      "<riskGridBandMedium>",
      "<riskGridBandLow>",
    ]);
  });
});

describe("statuses", () => {
  it("lists every status in workflow order with its label key and chip colour", () => {
    expect(RISK_STATUSES).toEqual(["open", "mitigating", "mitigated", "closed", "accepted"]);
    expect(RISK_STATUSES.map(riskStatusLabelKey)).toEqual([
      "riskStatusOpen",
      "riskStatusMitigating",
      "riskStatusMitigated",
      "riskStatusClosed",
      "riskStatusAccepted",
    ]);
    expect(RISK_STATUSES.map((s) => RISK_STATUS_CHIP_COLOR[s])).toEqual([
      "error",
      "warning",
      "success",
      "default",
      "info",
    ]);
  });

  it("hands an unknown status back as itself", () => {
    expect(riskStatusLabelKey("escalated")).toBe("escalated");
    expect(riskStatusLabelKey("toString")).toBe("toString");
    expect(riskStatusLabel("escalated", tKey)).toBe("<escalated>");
    expect(riskStatusLabel("open", tKey)).toBe("<riskStatusOpen>");
  });

  it("names the theme colour behind each status chip", () => {
    expect(RISK_STATUSES.map(riskStatusPaletteColor)).toEqual([
      "error.main",
      "warning.main",
      "success.main",
      "grey.600",
      "info.main",
    ]);
    expect(riskStatusPaletteColor("escalated")).toBe("grey.600");
    expect(riskStatusPaletteColor("toString")).toBe("grey.600");
  });

  it("resolves a palette path against a theme palette", () => {
    const palette = { error: { main: "red-ish" }, grey: { 600: "grey-ish" }, mode: "light" };
    expect(paletteColor(palette, "error.main")).toBe("red-ish");
    expect(paletteColor(palette, "grey.600")).toBe("grey-ish");
    expect(paletteColor(palette, "error.dark")).toBeUndefined();
    expect(paletteColor(palette, "info.main")).toBeUndefined();
    expect(paletteColor(palette, "mode.x")).toBeUndefined();
  });

  it("resolves only a string shade of an object group", () => {
    // A string group is not a colour group, even where indexing it would
    // hand back a character.
    expect(paletteColor({ mode: "light" }, "mode.0")).toBeUndefined();
    // A shade that is not a string (an opacity, a nested object) is no colour.
    const palette = { action: { disabledOpacity: 0.38, nested: { main: "x" } } };
    expect(paletteColor(palette, "action.disabledOpacity")).toBeUndefined();
    expect(paletteColor(palette, "action.nested")).toBeUndefined();
  });
});

describe("riskSummary", () => {
  it("counts all, open and high (score >= 15) risks", () => {
    const risks = [
      risk({ id: "a", status: "open", risk_score: 15 }),
      risk({ id: "b", status: "open", risk_score: 14 }),
      risk({ id: "c", status: "mitigating", risk_score: 20 }),
      risk({ id: "d", status: "closed", risk_score: 2 }),
    ];
    expect(riskSummary(risks)).toEqual({ total: 4, open: 2, high: 2 });
    expect(riskSummary([])).toEqual({ total: 0, open: 0, high: 0 });
  });
});

describe("sortRisksForPrint", () => {
  it("orders by score, highest first, ties by title, without touching the input", () => {
    const input = [
      risk({ id: "1", title: "Charlie", risk_score: 9 }),
      risk({ id: "2", title: "Alpha", risk_score: 4 }),
      risk({ id: "3", title: "Bravo", risk_score: 9 }),
      risk({ id: "4", title: "Delta", risk_score: 20 }),
    ];
    const before = input.map((r) => r.id);
    const out = sortRisksForPrint(input);
    expect(out.map((r) => r.title)).toEqual(["Delta", "Bravo", "Charlie", "Alpha"]);
    expect(out).not.toBe(input);
    expect(input.map((r) => r.id)).toEqual(before);
  });
});

describe("riskCellText", () => {
  it("is the title, then the description on its own line", () => {
    expect(riskCellText(risk({ id: "a", title: "Lock-in", description: "Vendor X" }))).toBe(
      "Lock-in\nVendor X",
    );
    expect(riskCellText(risk({ id: "a", title: "Lock-in" }))).toBe("Lock-in");
    expect(riskCellText(undefined)).toBe("");
  });
});

describe("filterRisks", () => {
  const ADA = risk({
    id: "ada",
    title: "Vendor lock-in",
    description: "Single supplier for the ERP",
    mitigation: "Dual-source the platform",
    owner_id: "u1",
    owner_name: "Ada Lovelace",
    status: "open",
    risk_score: 20,
  });
  const GRACE = risk({
    id: "grace",
    title: "Budget overrun",
    description: null,
    mitigation: null,
    owner_id: "u2",
    owner_name: "Grace Hopper",
    status: "mitigating",
    risk_score: 9,
  });
  const NOBODY = risk({ id: "nobody", title: "Late delivery", status: "accepted", risk_score: 2 });
  const ALL = [ADA, GRACE, NOBODY];
  const ids = (f: Partial<PpmRiskFilters>) =>
    filterRisks(ALL, { ...EMPTY_RISK_FILTERS, ...f }).map((r) => r.id);

  it("keeps everything with no filter", () => {
    expect(ids({})).toEqual(["ada", "grace", "nobody"]);
    expect(ids({ search: "   " })).toEqual(["ada", "grace", "nobody"]);
  });

  it("keeps a risk with no text at all when nothing is searched", () => {
    const blank = risk({ id: "blank", title: "" });
    expect(filterRisks([blank], EMPTY_RISK_FILTERS)).toEqual([blank]);
    expect(filterRisks([blank], { ...EMPTY_RISK_FILTERS, search: "x" })).toEqual([]);
  });

  it("searches title, description, mitigation and owner, case-insensitively", () => {
    expect(ids({ search: "LOCK-IN" })).toEqual(["ada"]);
    expect(ids({ search: "supplier" })).toEqual(["ada"]);
    expect(ids({ search: "dual-source" })).toEqual(["ada"]);
    expect(ids({ search: "hopper" })).toEqual(["grace"]);
    expect(ids({ search: "  delivery " })).toEqual(["nobody"]);
    expect(ids({ search: "nothing like this" })).toEqual([]);
  });

  it("filters by status", () => {
    expect(ids({ statuses: ["mitigating"] })).toEqual(["grace"]);
    expect(ids({ statuses: ["open", "accepted"] })).toEqual(["ada", "nobody"]);
  });

  it("filters by score band", () => {
    expect(ids({ bands: ["high"] })).toEqual(["ada"]);
    expect(ids({ bands: ["medium"] })).toEqual(["grace"]);
    expect(ids({ bands: ["low", "medium"] })).toEqual(["grace", "nobody"]);
  });

  it("filters by owner, with a no-owner option", () => {
    expect(ids({ owners: ["u2"] })).toEqual(["grace"]);
    expect(ids({ owners: [NO_OWNER] })).toEqual(["nobody"]);
    expect(ids({ owners: ["u1", NO_OWNER] })).toEqual(["ada", "nobody"]);
  });

  it("combines every filter", () => {
    expect(ids({ statuses: ["open", "mitigating"], bands: ["medium"] })).toEqual(["grace"]);
    expect(ids({ statuses: ["open"], owners: ["u2"] })).toEqual([]);
    expect(ids({ search: "e", owners: ["u1", "u2"], bands: ["high"] })).toEqual(["ada"]);
  });

  it("counts active filters", () => {
    expect(activeRiskFilterCount(EMPTY_RISK_FILTERS)).toBe(0);
    expect(activeRiskFilterCount({ ...EMPTY_RISK_FILTERS, search: "  " })).toBe(0);
    expect(
      activeRiskFilterCount({
        search: "x",
        statuses: ["open", "closed"],
        bands: ["high"],
        owners: [NO_OWNER, "u1", "u2"],
      }),
    ).toBe(7);
  });

  it("lists the owners present, by name, once each", () => {
    const named = risk({ id: "n", owner_id: "u3", owner_name: "" });
    expect(riskOwnerOptions([GRACE, ADA, NOBODY, { ...ADA, id: "ada2" }, named])).toEqual([
      { id: "u1", name: "Ada Lovelace" },
      { id: "u2", name: "Grace Hopper" },
      { id: "u3", name: "u3" },
    ]);
  });
});

describe("columns", () => {
  it("lists the grid's columns, with Risk and the actions locked", () => {
    expect(RISK_GRID_COLUMN_IDS).toEqual([
      "risk",
      "probability",
      "impact",
      "risk_score",
      "status",
      "owner_name",
      "mitigation",
      "actions",
    ]);
    expect(RISK_GRID_COLUMNS.map((c) => c.labelKey)).toEqual([
      "riskGridColumnRisk",
      "probability",
      "impact",
      "riskScore",
      "riskStatus",
      "riskOwner",
      "mitigation",
      "riskGridColumnActions",
    ]);
    for (const c of RISK_GRID_COLUMNS) expect(c.icon).toMatch(/^[a-z_]+$/);
    expect([...LOCKED_RISK_COLUMNS]).toEqual(["risk", "actions"]);
  });

  it("shows every column but probability and impact by default", () => {
    expect(DEFAULT_VISIBLE_RISK_COLUMNS).toEqual([
      "risk",
      "risk_score",
      "status",
      "owner_name",
      "mitigation",
      "actions",
    ]);
  });

  it("knows when the visible set differs from the default", () => {
    expect(riskColumnsDifferFromDefault(new Set(DEFAULT_VISIBLE_RISK_COLUMNS))).toBe(false);
    expect(riskColumnsDifferFromDefault(new Set(RISK_GRID_COLUMN_IDS))).toBe(true);
    expect(
      riskColumnsDifferFromDefault(new Set([...DEFAULT_VISIBLE_RISK_COLUMNS, "impact"])),
    ).toBe(true);
    expect(
      riskColumnsDifferFromDefault(
        new Set(DEFAULT_VISIBLE_RISK_COLUMNS.filter((id) => id !== "status")),
      ),
    ).toBe(true);
    // Same size, different members.
    expect(
      riskColumnsDifferFromDefault(
        new Set([...DEFAULT_VISIBLE_RISK_COLUMNS.filter((id) => id !== "status"), "impact"]),
      ),
    ).toBe(true);
  });
});

describe("grid prefs", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  const DEFAULTS = {
    filtersCollapsed: false,
    sidebarWidth: 260,
    visibleColumns: ["risk", "risk_score", "status", "owner_name", "mitigation", "actions"],
    frozenColumns: [],
    columnOrder: [],
    sortModel: [],
    groupBy: null,
  };

  it("defaults when nothing or garbage is stored", () => {
    expect(SIDEBAR_DEFAULT_WIDTH).toBe(260);
    expect([SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH]).toEqual([220, 480]);
    expect(DEFAULT_RISK_SORT).toEqual([{ colId: "risk_score", sort: "desc" }]);
    expect(RISK_GROUP_AXES).toEqual(["status", "owner", "band"]);
    expect(loadRiskGridPrefs()).toEqual(DEFAULTS);
    expect(DEFAULT_RISK_GRID_PREFS).toEqual(DEFAULTS);
    for (const raw of ["{not json", "null", "42", '"text"']) {
      localStorage.setItem(RISK_GRID_PREFS_KEY, raw);
      expect(loadRiskGridPrefs()).toEqual(DEFAULTS);
    }
    localStorage.setItem(
      RISK_GRID_PREFS_KEY,
      JSON.stringify({
        filtersCollapsed: "yes",
        sidebarWidth: "wide",
        visibleColumns: "risk",
        frozenColumns: "risk",
        columnOrder: 3,
        sortModel: { colId: "risk" },
        groupBy: "category",
      }),
    );
    expect(loadRiskGridPrefs()).toEqual(DEFAULTS);
  });

  it("drops unknown colIds, the action column and malformed sort entries", () => {
    localStorage.setItem(
      RISK_GRID_PREFS_KEY,
      JSON.stringify({
        frozenColumns: ["risk", "nope", 7, "actions", "title"],
        columnOrder: ["mitigation", "ghost", "risk", null, "actions"],
        sortModel: [
          { colId: "risk_score", sort: "asc", extra: true },
          { colId: "ghost", sort: "desc" },
          { colId: "actions", sort: "desc" },
          { colId: "risk", sort: "sideways" },
          { colId: 5, sort: "asc" },
          null,
          "risk",
          { colId: "status", sort: "desc" },
        ],
      }),
    );
    const p = loadRiskGridPrefs();
    expect(p.frozenColumns).toEqual(["risk"]);
    expect(p.columnOrder).toEqual(["mitigation", "risk"]);
    expect(p.sortModel).toEqual([
      { colId: "risk_score", sort: "asc" },
      { colId: "status", sort: "desc" },
    ]);
  });

  it("keeps the locked columns visible and drops unknown ones", () => {
    localStorage.setItem(
      RISK_GRID_PREFS_KEY,
      JSON.stringify({ visibleColumns: ["mitigation", "ghost", "status", 4] }),
    );
    expect(loadRiskGridPrefs().visibleColumns).toEqual(["risk", "status", "mitigation", "actions"]);
    localStorage.setItem(RISK_GRID_PREFS_KEY, JSON.stringify({ visibleColumns: ["ghost"] }));
    expect(loadRiskGridPrefs().visibleColumns).toEqual([...DEFAULT_VISIBLE_RISK_COLUMNS]);
    // A stored choice to show probability and impact is kept.
    localStorage.setItem(
      RISK_GRID_PREFS_KEY,
      JSON.stringify({ visibleColumns: ["probability", "impact", "risk_score"] }),
    );
    expect(loadRiskGridPrefs().visibleColumns).toEqual([
      "risk",
      "probability",
      "impact",
      "risk_score",
      "actions",
    ]);
  });

  it("clamps the sidebar width and reads the collapse flag and group-by", () => {
    const load = (o: object) => {
      localStorage.setItem(RISK_GRID_PREFS_KEY, JSON.stringify(o));
      return loadRiskGridPrefs();
    };
    expect(load({ sidebarWidth: 100 }).sidebarWidth).toBe(220);
    expect(load({ sidebarWidth: 900 }).sidebarWidth).toBe(480);
    expect(load({ sidebarWidth: 333 }).sidebarWidth).toBe(333);
    expect(load({ sidebarWidth: null }).sidebarWidth).toBe(260);
    // JSON can still spell an infinite number; it is not a width.
    localStorage.setItem(RISK_GRID_PREFS_KEY, '{"sidebarWidth": 1e400}');
    expect(loadRiskGridPrefs().sidebarWidth).toBe(260);
    expect(load({ filtersCollapsed: true }).filtersCollapsed).toBe(true);
    expect(load({ filtersCollapsed: 1 }).filtersCollapsed).toBe(false);
    for (const axis of ["status", "owner", "band"]) expect(load({ groupBy: axis }).groupBy).toBe(axis);
    expect(load({ groupBy: "toString" }).groupBy).toBeNull();
  });

  it("round-trips what it saves", () => {
    const prefs = {
      filtersCollapsed: true,
      sidebarWidth: 300,
      visibleColumns: ["risk", "status", "actions"],
      frozenColumns: ["risk", "status"],
      columnOrder: ["mitigation", "risk"],
      sortModel: [{ colId: "owner_name", sort: "asc" as const }],
      groupBy: "band" as const,
    };
    saveRiskGridPrefs(prefs);
    expect(JSON.parse(localStorage.getItem(RISK_GRID_PREFS_KEY)!)).toEqual(prefs);
    expect(loadRiskGridPrefs()).toEqual(prefs);
  });

  it("works without storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(loadRiskGridPrefs()).toEqual(DEFAULTS);
    expect(() => saveRiskGridPrefs(defaultRiskGridPrefs())).not.toThrow();
  });

  it("hands back a fresh default each time", () => {
    const a = loadRiskGridPrefs();
    a.frozenColumns.push("risk");
    a.visibleColumns.pop();
    expect(loadRiskGridPrefs()).toEqual(DEFAULTS);
    expect(defaultRiskGridPrefs()).not.toBe(defaultRiskGridPrefs());
  });
});
