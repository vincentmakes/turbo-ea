import { describe, expect, it } from "vitest";

import {
  escapeListItem,
  escapeListSeparator,
  isCurrentWorkbookFormat,
  listCellReadings,
  splitListCell,
  tagsAreSemicolonSeparated,
  unescapeListItem,
  WORKBOOK_FORMAT_VERSION,
} from "./listCell";

describe("splitListCell", () => {
  describe("semicolon mode (a workbook with _Meta)", () => {
    it("keeps a lone comma-bearing value whole (#1171)", () => {
      expect(splitListCell("This is X, it does Y", "semicolon").parts).toEqual([
        "This is X, it does Y",
      ]);
    });

    it("splits on `; ` and trims", () => {
      expect(splitListCell("Acme, Inc.;  DB ;", "semicolon")).toEqual({
        parts: ["Acme, Inc.", "DB"],
        bySemicolon: true,
      });
    });

    it("does not split on an escaped `;`, and keeps every escape", () => {
      expect(splitListCell("A\\; B; SAP S\\/4HANA; C\\\\", "semicolon").parts).toEqual([
        "A\\; B",
        "SAP S\\/4HANA",
        "C\\\\",
      ]);
    });

    it("never consults the resolver", () => {
      const parts = splitListCell("DB, Cache", "semicolon", () => false).parts;
      expect(parts).toEqual(["DB, Cache"]);
    });
  });

  describe("comma mode (an older workbook)", () => {
    it("splits on commas when the whole cell names nothing", () => {
      expect(splitListCell("DB, Cache", "comma", () => false)).toEqual({
        parts: ["DB", "Cache"],
        bySemicolon: false,
      });
    });

    it("keeps the cell whole when it names something", () => {
      const seen: string[] = [];
      const parts = splitListCell(" Acme, Inc. ", "comma", (whole) => {
        seen.push(whole);
        return whole === "Acme, Inc.";
      }).parts;
      expect(parts).toEqual(["Acme, Inc."]);
      expect(seen).toEqual(["Acme, Inc."]);
    });

    it("does not split on `;` — a format-3 tag name may hold one", () => {
      expect(splitListCell("Group: a;b", "comma").parts).toEqual(["Group: a;b"]);
    });

    it("skips the resolver when there is no comma", () => {
      let called = false;
      splitListCell("DB", "comma", () => {
        called = true;
        return false;
      });
      expect(called).toBe(false);
    });
  });

  describe("auto mode (no _Meta)", () => {
    it("uses `;` when the cell has one", () => {
      expect(splitListCell("Acme, Inc.; DB", "auto", () => false)).toEqual({
        parts: ["Acme, Inc.", "DB"],
        bySemicolon: true,
      });
    });

    it("ignores an escaped `;` when deciding", () => {
      expect(splitListCell("A\\;B, C", "auto", () => false).parts).toEqual(["A\\;B", "C"]);
    });

    it("falls back to the comma reading without a `;`", () => {
      expect(splitListCell("DB, Cache", "auto", () => false).parts).toEqual(["DB", "Cache"]);
      expect(splitListCell("Acme, Inc.", "auto", () => true).parts).toEqual(["Acme, Inc."]);
    });
  });

  it("returns nothing for a blank cell", () => {
    expect(splitListCell("   ", "auto")).toEqual({ parts: [], bySemicolon: false });
  });
});

describe("listCellReadings", () => {
  it("offers the whole cell and each part when the comma reading is ambiguous", () => {
    expect(listCellReadings("A, B", "auto")).toEqual(["A, B", "A", "B"]);
    expect(listCellReadings("A, B", "comma")).toEqual(["A, B", "A", "B"]);
  });

  it("offers only the `;` parts when the cell is read by `;`", () => {
    expect(listCellReadings("A, B; C", "auto")).toEqual(["A, B", "C"]);
    expect(listCellReadings("A, B", "semicolon")).toEqual(["A, B"]);
  });

  it("offers a comma-free cell as is", () => {
    expect(listCellReadings("DB", "auto")).toEqual(["DB"]);
    expect(listCellReadings("", "auto")).toEqual([]);
  });
});

describe("escaping", () => {
  it.each(["plain", "Acme, Inc.", "a;b", "a\\b", "trailing\\", "\\;", "a\\;b"])(
    "escapeListItem / unescapeListItem round-trip %s through a split cell",
    (value) => {
      const cell = [escapeListItem(value), escapeListItem("other")].join("; ");
      const split = splitListCell(cell, "semicolon");
      expect(split.parts.map(unescapeListItem)).toEqual([value, "other"]);
    },
  );

  it("escapeListSeparator touches only `;`, leaving path escapes for decodePath", () => {
    expect(escapeListSeparator("Ops \\/ Run; Sales")).toBe("Ops \\/ Run\\; Sales");
  });

  it("unescapeListItem keeps a lone trailing backslash", () => {
    expect(unescapeListItem("a\\")).toBe("a\\");
  });
});

describe("workbook format", () => {
  it("reads format 3 and the current format without a banner", () => {
    expect(isCurrentWorkbookFormat("3")).toBe(true);
    expect(isCurrentWorkbookFormat(WORKBOOK_FORMAT_VERSION)).toBe(true);
    expect(isCurrentWorkbookFormat(undefined)).toBe(true);
  });

  it("flags older and unknown formats", () => {
    expect(isCurrentWorkbookFormat("2")).toBe(false);
    expect(isCurrentWorkbookFormat("1")).toBe(false);
    expect(isCurrentWorkbookFormat("99")).toBe(false);
  });

  it("knows which formats write tags `;`-separated", () => {
    expect(tagsAreSemicolonSeparated("3")).toBe(false);
    expect(tagsAreSemicolonSeparated("4")).toBe(true);
    expect(tagsAreSemicolonSeparated(undefined)).toBe(false);
    expect(tagsAreSemicolonSeparated("x")).toBe(false);
  });
});
