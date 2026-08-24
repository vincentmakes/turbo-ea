import { describe, it, expect } from "vitest";
import {
  COLUMN_COUNTS,
  DEFAULT_COLUMNS,
  columnGridProps,
  columnGridTemplate,
  columnPrintClass,
  isColumnCount,
  type ColumnCount,
} from "./cardColumns";

describe("columnGridTemplate", () => {
  it("never renders more than one column on xs", () => {
    for (const n of COLUMN_COUNTS) {
      expect(columnGridTemplate(n).xs).toBe("1fr");
    }
  });

  it("never renders more than two columns on sm", () => {
    for (const n of COLUMN_COUNTS) {
      expect(columnGridTemplate(n).sm.split(" ").length).toBeLessThanOrEqual(2);
    }
  });

  it("reaches the chosen count at md and lg", () => {
    for (const n of COLUMN_COUNTS) {
      const tpl = columnGridTemplate(n);
      expect(tpl.md.split(" ")).toHaveLength(n);
      expect(tpl.lg.split(" ")).toHaveLength(n);
      expect(tpl.md).toBe(tpl.lg);
    }
  });

  it("builds 1fr tracks", () => {
    expect(columnGridTemplate(3)).toEqual({
      xs: "1fr",
      sm: "1fr 1fr",
      md: "1fr 1fr 1fr",
      lg: "1fr 1fr 1fr",
    });
    expect(columnGridTemplate(1)).toEqual({
      xs: "1fr",
      sm: "1fr",
      md: "1fr",
      lg: "1fr",
    });
  });
});

describe("columnPrintClass", () => {
  // Contract with the .report-print-grid-* rules in print.css, which nothing
  // type-checks — pin the exact strings.
  it("returns the print class matching the count", () => {
    expect(columnPrintClass(1)).toBe("report-print-grid-1");
    expect(columnPrintClass(2)).toBe("report-print-grid-2");
    expect(columnPrintClass(3)).toBe("report-print-grid-3");
  });
});

describe("isColumnCount", () => {
  it("accepts the supported counts", () => {
    for (const n of COLUMN_COUNTS) expect(isColumnCount(n)).toBe(true);
  });

  it("rejects anything else read back from storage or a URL", () => {
    // 4 is the count an older build could have persisted.
    for (const bad of [0, 4, -1, 2.5, "3", null, undefined, NaN, {}, []]) {
      expect(isColumnCount(bad)).toBe(false);
    }
  });

  it("guards the default", () => {
    expect(isColumnCount(DEFAULT_COLUMNS)).toBe(true);
  });
});

describe("columnGridProps", () => {
  it("carries the print class and a grid display", () => {
    const props = columnGridProps(2);
    expect(props.className).toBe("report-print-grid-2");
    expect(props.sx.display).toBe("grid");
    expect(props.sx.gridTemplateColumns).toEqual(columnGridTemplate(2));
  });

  it("defaults the gap to 2 and honours an override", () => {
    expect(columnGridProps(3).sx.gap).toBe(2);
    expect(columnGridProps(3, { gap: 1.5 }).sx.gap).toBe(1.5);
  });

  it("merges extra sx without clobbering the grid template", () => {
    const props = columnGridProps(3, { sx: { alignItems: "start" } });
    expect(props.sx.alignItems).toBe("start");
    expect(props.sx.gridTemplateColumns).toEqual(columnGridTemplate(3));
    expect(props.sx.display).toBe("grid");
  });

  it("lets an explicit sx override win, so a call site can opt out", () => {
    const props = columnGridProps(3, { sx: { gridTemplateColumns: "1fr" } });
    expect(props.sx.gridTemplateColumns).toBe("1fr");
  });
});

describe("module contract", () => {
  it("offers exactly 1, 2 and 3 with 3 as the default", () => {
    expect(COLUMN_COUNTS).toEqual<ColumnCount[]>([1, 2, 3]);
    expect(DEFAULT_COLUMNS).toBe(3);
  });
});
