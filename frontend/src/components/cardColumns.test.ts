import { describe, it, expect } from "vitest";
import {
  COLUMN_COUNTS,
  DEFAULT_COLUMNS,
  NESTED_MIN_TRACK,
  columnGridProps,
  columnGridTemplate,
  columnPrintClass,
  isColumnCount,
  nestedColumns,
  nestedGridProps,
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

describe("nestedColumns", () => {
  // The taper agreed with the user: each step down, and each extra column at
  // the top, costs one column.
  const TABLE: Record<ColumnCount, number[]> = {
    // depth:      1  2  3  4  5
    1: /* pick 1 */ [1, 3, 2, 1, 1],
    2: /* pick 2 */ [2, 2, 1, 1, 1],
    3: /* pick 3 */ [3, 1, 1, 1, 1],
  };

  it("matches the agreed table for every pick and depth", () => {
    for (const pick of COLUMN_COUNTS) {
      TABLE[pick].forEach((expected, i) => {
        expect(nestedColumns(pick, i + 1)).toBe(expected);
      });
    }
  });

  it("returns the pick unchanged at the top level", () => {
    for (const pick of COLUMN_COUNTS) expect(nestedColumns(pick, 1)).toBe(pick);
  });

  it("gives three columns at L2 when one is picked — the motivating case", () => {
    expect(nestedColumns(1, 2)).toBe(3);
  });

  it("never falls below one column, however deep the tree", () => {
    for (const pick of COLUMN_COUNTS) {
      for (let depth = 1; depth <= 12; depth++) {
        const n = nestedColumns(pick, depth);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(3);
      }
    }
  });

  it("never widens as it descends", () => {
    for (const pick of COLUMN_COUNTS) {
      for (let depth = 2; depth <= 8; depth++) {
        expect(nestedColumns(pick, depth + 1)).toBeLessThanOrEqual(
          nestedColumns(pick, depth),
        );
      }
    }
  });

  it("treats a non-positive depth as the top level", () => {
    expect(nestedColumns(2, 0)).toBe(2);
    expect(nestedColumns(2, -1)).toBe(2);
  });
});

describe("nestedGridProps", () => {
  const template = (p: ReturnType<typeof nestedGridProps>) =>
    String(p.sx.gridTemplateColumns);

  it("sizes tracks against the container, not the viewport", () => {
    // The top-level helper returns a breakpoint-keyed object, which would put
    // three tracks in a 390px card at a wide viewport. The nested one must be
    // a single expression that resolves against the grid container.
    expect(columnGridProps(3).sx.gridTemplateColumns).toEqual(
      expect.objectContaining({ xs: expect.any(String) }),
    );
    const t = nestedGridProps(3).sx.gridTemplateColumns;
    expect(typeof t).toBe("string");
    expect(String(t)).toContain("100%");
    expect(String(t)).toContain("/ 3)");
  });

  it("uses auto-fill with a floor so a narrow parent drops tracks", () => {
    const t = template(nestedGridProps(3));
    expect(t).toContain("auto-fill");
    expect(t).toContain(`max(${NESTED_MIN_TRACK}px`);
  });

  it("subtracts the gutters so the tracks actually fit", () => {
    // 3 tracks => 2 gutters; gap 1 is one MUI spacing unit = 8px.
    expect(template(nestedGridProps(3, { gap: 1 }))).toContain("100% - 16px");
    expect(template(nestedGridProps(2, { gap: 1.5 }))).toContain("100% - 12px");
    // A single track has no gutter to subtract.
    expect(template(nestedGridProps(1))).toContain("100% - 0px");
  });

  it("honours a custom floor", () => {
    expect(template(nestedGridProps(2, { minTrack: 240 }))).toContain("max(240px");
  });

  it("reports the count for devtools and tests", () => {
    expect(nestedGridProps(2)["data-nested-cols"]).toBe(2);
  });

  it("defaults the gap to 1 and honours an override", () => {
    expect(nestedGridProps(2).sx.gap).toBe(1);
    expect(nestedGridProps(2, { gap: 0.75 }).sx.gap).toBe(0.75);
  });

  it("merges extra sx without losing the template", () => {
    const p = nestedGridProps(2, { sx: { p: 1.5, alignItems: "start" } });
    expect(p.sx.p).toBe(1.5);
    expect(p.sx.alignItems).toBe("start");
    expect(p.sx.display).toBe("grid");
    expect(template(p)).toContain("auto-fill");
  });

  it("carries no print class", () => {
    // print.css forces a column count AND `gap: 8px !important` on those
    // classes; a nested grid is already parent-relative and must not inherit
    // either.
    expect(JSON.stringify(nestedGridProps(3))).not.toContain("report-print-grid-");
  });
});
