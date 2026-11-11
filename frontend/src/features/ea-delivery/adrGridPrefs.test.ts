import { describe, it, expect, beforeEach } from "vitest";
import {
  ADR_GRID_LS_KEY,
  ADR_COLUMN_DEFS,
  ADR_GROUP_BY_KEYS,
  ADR_LOCKED_COLUMN_KEYS,
  adrGroupByOf,
  loadAdrGridPrefs,
  updateAdrGridPrefs,
} from "./adrGridPrefs";

describe("adrGridPrefs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing is stored", () => {
    expect(loadAdrGridPrefs()).toBeNull();
  });

  it("round-trips a stored pref", () => {
    updateAdrGridPrefs({ hiddenColumns: ["decision", "signed"] });
    expect(loadAdrGridPrefs()).toEqual({ hiddenColumns: ["decision", "signed"] });
  });

  it("merges partial patches without dropping other fields", () => {
    updateAdrGridPrefs({ hiddenColumns: ["decision"] });
    updateAdrGridPrefs({ columnFilterModel: { title: { filterType: "text" } } });
    updateAdrGridPrefs({ columnState: [{ colId: "title" }] });
    expect(loadAdrGridPrefs()).toEqual({
      hiddenColumns: ["decision"],
      columnFilterModel: { title: { filterType: "text" } },
      columnState: [{ colId: "title" }],
    });
  });

  it("returns null on corrupt or non-object JSON", () => {
    localStorage.setItem(ADR_GRID_LS_KEY, "{not json");
    expect(loadAdrGridPrefs()).toBeNull();
    localStorage.setItem(ADR_GRID_LS_KEY, "[1,2]");
    expect(loadAdrGridPrefs()).toBeNull();
    localStorage.setItem(ADR_GRID_LS_KEY, '"str"');
    expect(loadAdrGridPrefs()).toBeNull();
  });

  it("recovers from a corrupt store on the next update", () => {
    localStorage.setItem(ADR_GRID_LS_KEY, "{not json");
    updateAdrGridPrefs({ hiddenColumns: [] });
    expect(loadAdrGridPrefs()).toEqual({ hiddenColumns: [] });
  });

  it("locked columns are part of the built-in column catalogue", () => {
    const keys = new Set(ADR_COLUMN_DEFS.map((d) => d.key));
    for (const locked of ADR_LOCKED_COLUMN_KEYS) {
      expect(keys.has(locked)).toBe(true);
    }
  });

  it("declares the register columns after the signing ones", () => {
    expect(ADR_COLUMN_DEFS.slice(-5)).toEqual([
      { key: "standing", tKey: "adr.grid.standing" },
      { key: "decidedOn", tKey: "adr.dates.decidedOn" },
      { key: "effectiveFrom", tKey: "adr.dates.effectiveFrom" },
      { key: "validUntil", tKey: "adr.dates.validUntil" },
      { key: "decisionMakers", tKey: "adr.people.decisionMakers" },
    ]);
  });

  it("groups by status or standing, and reads any other stored value as none", () => {
    expect(ADR_GROUP_BY_KEYS).toEqual(["status", "standing"]);
    expect(adrGroupByOf("status")).toBe("status");
    expect(adrGroupByOf("standing")).toBe("standing");
    expect(adrGroupByOf("owner")).toBeNull();
    expect(adrGroupByOf(null)).toBeNull();
    expect(adrGroupByOf(undefined)).toBeNull();
    expect(adrGroupByOf(3)).toBeNull();
  });

  it("keeps a group-by stored before the standing axis existed", () => {
    localStorage.setItem(ADR_GRID_LS_KEY, JSON.stringify({ groupBy: "status" }));
    expect(adrGroupByOf(loadAdrGridPrefs()?.groupBy)).toBe("status");
  });
});
