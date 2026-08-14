import { describe, expect, it } from "vitest";
import {
  bandColor,
  bandOf,
  DATA_QUALITY_BANDS,
  isDataQualityBand,
  normalizeDataQualityFilter,
} from "./dataQualityBands";

describe("bandOf", () => {
  it("puts each boundary score in the band the report counted it in", () => {
    // Mirrors _DQ_BAND_BOUNDS in backend/app/api/v1/reports.py — if these
    // diverge, a bar segment and the panel it opens disagree.
    expect(bandOf(100)).toBe("complete");
    expect(bandOf(80)).toBe("complete");
    expect(bandOf(79.9)).toBe("partial");
    expect(bandOf(40)).toBe("partial");
    expect(bandOf(39.9)).toBe("minimal");
    expect(bandOf(0)).toBe("minimal");
  });

  it("treats a missing score as 0 rather than leaving the card bandless", () => {
    expect(bandOf(null)).toBe("minimal");
    expect(bandOf(undefined)).toBe("minimal");
  });
});

describe("DATA_QUALITY_BANDS", () => {
  it("covers the range without gaps or overlaps", () => {
    expect(DATA_QUALITY_BANDS.map((b) => b.key)).toEqual(["complete", "partial", "minimal"]);
    for (const band of DATA_QUALITY_BANDS) {
      // Every band definition must agree with bandOf, which is what actually
      // filters and groups the grid.
      expect(bandOf(band.min)).toBe(band.key);
      if (band.max !== null) expect(bandOf(band.max)).not.toBe(band.key);
    }
  });
});

describe("bandColor", () => {
  it("gives one colour per band, taken from the band table", () => {
    expect(bandColor(90)).toBe("#4caf50");
    expect(bandColor(60)).toBe("#ff9800");
    expect(bandColor(10)).toBe("#f44336");
  });

  it("colours a 40-49 score as partial, not minimal", () => {
    // The regression this exists to prevent: the grid, the card-detail pill
    // and the portal used to cut at 50, so a 45% card was orange in the
    // report and red everywhere else.
    expect(bandColor(45)).toBe(bandColor(60));
    expect(bandColor(45)).not.toBe(bandColor(10));
  });

  it("treats a missing score as minimal, like bandOf", () => {
    expect(bandColor(null)).toBe(bandColor(0));
    expect(bandColor(undefined)).toBe(bandColor(0));
  });
});

describe("isDataQualityBand", () => {
  it("accepts band keys and rejects anything else", () => {
    expect(isDataQualityBand("partial")).toBe(true);
    expect(isDataQualityBand("excellent")).toBe(false);
    expect(isDataQualityBand(80)).toBe(false);
    expect(isDataQualityBand(undefined)).toBe(false);
  });
});

describe("normalizeDataQualityFilter", () => {
  it("passes through the current band shape, dropping unknown entries", () => {
    expect(normalizeDataQualityFilter({ dataQualityBands: ["partial", "minimal"] })).toEqual([
      "partial",
      "minimal",
    ]);
    expect(normalizeDataQualityFilter({ dataQualityBands: ["partial", "bogus"] })).toEqual([
      "partial",
    ]);
    expect(normalizeDataQualityFilter({ dataQualityBands: [] })).toEqual([]);
  });

  it("migrates a legacy dataQualityMin threshold from prefs or a bookmark", () => {
    // The old filter was a minimum: 50 meant "50 and above", which spans the
    // partial AND complete bands. Restoring it as partial alone would hide
    // rows the saved view used to show.
    expect(normalizeDataQualityFilter({ dataQualityMin: 80 })).toEqual(["complete"]);
    expect(normalizeDataQualityFilter({ dataQualityMin: 50 })).toEqual(["complete", "partial"]);
    expect(normalizeDataQualityFilter({ dataQualityMin: 0 })).toEqual(["minimal"]);
  });

  it("returns no filter for an absent, null or unrecognised value", () => {
    expect(normalizeDataQualityFilter({})).toEqual([]);
    expect(normalizeDataQualityFilter({ dataQualityMin: null })).toEqual([]);
    expect(normalizeDataQualityFilter({ dataQualityMin: 63 })).toEqual([]);
    expect(normalizeDataQualityFilter(null)).toEqual([]);
    expect(normalizeDataQualityFilter(undefined)).toEqual([]);
  });

  it("prefers the band shape when a payload somehow carries both", () => {
    expect(
      normalizeDataQualityFilter({ dataQualityBands: ["minimal"], dataQualityMin: 80 }),
    ).toEqual(["minimal"]);
  });
});
