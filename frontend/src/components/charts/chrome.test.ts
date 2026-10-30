import { describe, expect, it } from "vitest";
import { escapeHtml as escapeHtmlLeaf } from "@/lib/escapeHtml";
import {
  axisLabel,
  BAR_MAX_THICKNESS,
  base,
  COLUMN_MAX_WIDTH,
  defaultValueFormatter,
  escapeHtml,
  fmt,
  grid,
  GRID_TRAILING_INSET,
  LABEL_CHAR_WIDTH,
  legend,
  LEGEND_LABEL_WIDTH,
  niceMax,
  splitLine,
  tooltip,
  treemapLabel,
  VALUE_LABEL_DISTANCE,
  VALUE_LABEL_FONT_SIZE,
  valueLabel,
  valueLabelInset,
  type ChartChromeContext,
} from "./chrome";
import { buildEChartsChrome } from "./echartsTheme";

/* eslint-disable @typescript-eslint/no-explicit-any -- option fragments are plain JSON here */

const theme = buildEChartsChrome({
  mode: "light",
  text: { primary: "#111111", secondary: "#555555" },
  divider: "#dddddd",
  background: { paper: "#ffffff" },
  action: { hover: "#eeeeee" },
});

const ctx = (over: Partial<ChartChromeContext> = {}): ChartChromeContext => ({ theme, isRtl: false, ...over });
const euro = (v: number) => `${v} €`;

describe("constants", () => {
  it("keeps the mark and label sizes the dashboard was tuned with", () => {
    expect(COLUMN_MAX_WIDTH).toBe(72);
    expect(BAR_MAX_THICKNESS).toBe(40);
    expect(LABEL_CHAR_WIDTH).toBe(6.6);
    expect(LEGEND_LABEL_WIDTH).toBe(120);
    expect(VALUE_LABEL_FONT_SIZE).toBe(11);
    expect(VALUE_LABEL_DISTANCE).toBe(5);
    expect(GRID_TRAILING_INSET).toBe(16);
  });
});

describe("formatters", () => {
  it("prints integers whole, other numbers to one decimal and a non-finite value as 0", () => {
    expect(defaultValueFormatter(3)).toBe("3");
    expect(defaultValueFormatter(2.46)).toBe("2.5");
    expect(defaultValueFormatter(Number.NaN)).toBe("0");
    expect(defaultValueFormatter(Number.POSITIVE_INFINITY)).toBe("0");
  });

  it("uses the context's formatter when it has one", () => {
    expect(fmt(ctx())).toBe(defaultValueFormatter);
    expect(fmt(ctx({ valueFormatter: euro }))(4)).toBe("4 €");
  });
});

describe("base", () => {
  it("sets the font, the secondary text colour, aria and a short animation", () => {
    expect(base(ctx())).toEqual({
      backgroundColor: "transparent",
      aria: { enabled: true },
      animationDuration: 300,
      textStyle: { fontFamily: theme.fontFamily, color: "#555555" },
    });
  });
});

describe("tooltip", () => {
  it("sits on the surface, confined, left-to-right with no extra CSS", () => {
    const t = tooltip(ctx()) as any;
    expect(t).toMatchObject({
      confine: true,
      backgroundColor: "#ffffff",
      borderColor: "#dddddd",
      textStyle: { color: "#111111", fontFamily: theme.fontFamily },
      extraCssText: "",
    });
    expect(t.valueFormatter("2.25")).toBe("2.3");
  });

  it("reads right-to-left in RTL", () => {
    expect((tooltip(ctx({ isRtl: true })) as any).extraCssText).toBe("direction: rtl; text-align: right;");
  });

  it("formats values through the context and lets extra win", () => {
    expect((tooltip(ctx({ valueFormatter: euro })) as any).valueFormatter(7)).toBe("7 €");
    const t = tooltip(ctx(), { trigger: "item", confine: false }) as any;
    expect(t.trigger).toBe("item");
    expect(t.confine).toBe(false);
  });
});

describe("axisLabel", () => {
  it("is a recessive 12 px label, extended by extra", () => {
    expect(axisLabel(ctx())).toEqual({ color: "#555555", fontSize: 12 });
    expect(axisLabel(ctx(), { width: 96, fontSize: 10 })).toEqual({ color: "#555555", fontSize: 10, width: 96 });
  });
});

describe("grid", () => {
  it("keeps the wider inset on the trailing edge and contains its labels", () => {
    expect(grid(ctx(), 16, 8)).toEqual({ left: 8, right: 16, top: 16, bottom: 8, containLabel: true });
  });

  it("mirrors the insets in RTL", () => {
    expect(grid(ctx({ isRtl: true }), 4, 40)).toEqual({ left: 16, right: 8, top: 4, bottom: 40, containLabel: true });
  });
});

describe("splitLine", () => {
  it("is dashed in the divider colour", () => {
    expect(splitLine(ctx())).toEqual({ show: true, lineStyle: { color: "#dddddd", type: "dashed" } });
  });
});

describe("valueLabel", () => {
  it("prints the mark's figure through the default formatter", () => {
    const l = valueLabel(ctx(), "right") as any;
    expect(l).toMatchObject({ show: true, position: "right", color: "#555555", fontSize: VALUE_LABEL_FONT_SIZE });
    expect(l.formatter({ value: 2.5 })).toBe("2.5");
    expect(l.formatter({})).toBe("0");
  });

  it("prints through the context's formatter and lets extra win", () => {
    const l = valueLabel(ctx({ valueFormatter: euro }), "inside", { color: "#000000" }) as any;
    expect(l.formatter({ value: 3 })).toBe("3 €");
    expect(l.position).toBe("inside");
    expect(l.color).toBe("#000000");
  });
});

describe("valueLabelInset", () => {
  it("never drops below the plain grid's inset", () => {
    expect(valueLabelInset([], String)).toBe(GRID_TRAILING_INSET);
    expect(valueLabelInset([1], String)).toBe(GRID_TRAILING_INSET);
  });

  it("holds the longest formatted value at the 11 px estimate plus the gap", () => {
    // 9 chars × 6.6 × 11/12 = 54.45; + 5 + 4 → ceil(63.45) = 64.
    expect(valueLabelInset([5, 123456789, 42], String)).toBe(64);
    // "1 234 €" is 7 chars: 7 × 6.6 × 11/12 = 42.35; + 9 → 52.
    expect(valueLabelInset([1], () => "1 234 €")).toBe(52);
  });
});

describe("legend", () => {
  it("is a paged band at the bottom, left-aligned, names capped", () => {
    expect(legend(ctx(), ["A", "B"])).toEqual({
      type: "scroll",
      orient: "horizontal",
      bottom: 0,
      left: "left",
      align: "left",
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: "#111111", fontSize: 12, width: LEGEND_LABEL_WIDTH, overflow: "truncate" },
      pageTextStyle: { color: "#555555" },
      tooltip: { show: true },
      data: ["A", "B"],
    });
  });

  it("starts from the right in RTL", () => {
    const l = legend(ctx({ isRtl: true }), []) as any;
    expect(l.left).toBe("right");
    expect(l.align).toBe("right");
  });

  it("merges extra last", () => {
    const l = legend(ctx(), ["A"], { selectedMode: false, bottom: 8 }) as any;
    expect(l.selectedMode).toBe(false);
    expect(l.bottom).toBe(8);
    expect(l.data).toEqual(["A"]);
    // An extra without a textStyle keeps the default one whole.
    expect(l.textStyle).toEqual({ color: "#111111", fontSize: 12, width: LEGEND_LABEL_WIDTH, overflow: "truncate" });
  });

  it("merges extra's textStyle over the default one instead of replacing it", () => {
    const l = legend(ctx(), ["A"], { selectedMode: false, textStyle: { width: 260 } }) as any;
    expect(l.textStyle).toEqual({ color: "#111111", fontSize: 12, width: 260, overflow: "truncate" });
    expect(l.selectedMode).toBe(false);
    expect(l.type).toBe("scroll");
    expect(l.data).toEqual(["A"]);
  });

  it("lets extra's textStyle override any default key, keeping the others", () => {
    const l = legend(ctx(), [], { textStyle: { color: "#ff0000", overflow: "break" } }) as any;
    expect(l.textStyle).toEqual({ color: "#ff0000", fontSize: 12, width: LEGEND_LABEL_WIDTH, overflow: "break" });
  });
});

describe("niceMax", () => {
  it("rounds up to 1, 2, 2.5, 5 or 10 times a power of ten", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-3)).toBe(1);
    expect(niceMax(Number.NaN)).toBe(1);
    expect(niceMax(Number.POSITIVE_INFINITY)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(42)).toBe(50);
    expect(niceMax(120)).toBe(200);
    expect(niceMax(240)).toBe(250);
    expect(niceMax(100)).toBe(100);
    expect(niceMax(0.3)).toBe(0.5);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(2)).toBe(2);
    expect(niceMax(2.2)).toBe(2.5);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(5.5)).toBe(10);
  });
});

describe("treemapLabel", () => {
  it("shows the name only, in the surface colour, by default", () => {
    expect(treemapLabel(ctx())).toEqual({ show: true, color: "#ffffff", fontSize: 12, overflow: "truncate" });
    expect(treemapLabel(ctx(), { showValues: false })).toEqual({
      show: true,
      color: "#ffffff",
      fontSize: 12,
      overflow: "truncate",
    });
  });

  it("puts the figure on a smaller second line with showValues", () => {
    const l = treemapLabel(ctx({ valueFormatter: euro }), { showValues: true }) as any;
    expect(l).toMatchObject({ show: true, color: "#ffffff", fontSize: 12, overflow: "truncate" });
    expect(l).not.toHaveProperty("fontWeight");
    expect(l.formatter({ name: "Apps", value: 3 })).toBe("Apps\n{value|3 €}");
    expect(l.formatter({})).toBe("\n{value|0 €}");
    expect(l.rich).toEqual({ value: { color: "#ffffff", fontSize: VALUE_LABEL_FONT_SIZE, lineHeight: 16 } });
  });

  it("takes its colour, size and weight from the options, the figure following the name's colour", () => {
    const l = treemapLabel(ctx(), { showValues: true, color: "#222222", fontSize: 14, fontWeight: 600 }) as any;
    expect(l).toMatchObject({ color: "#222222", fontSize: 14, fontWeight: 600 });
    expect(l.rich.value).toEqual({ color: "#222222", fontSize: VALUE_LABEL_FONT_SIZE, lineHeight: 16 });
  });

  it("styles the figure apart from the name when asked", () => {
    const l = treemapLabel(ctx(), { showValues: true, valueColor: "#333333", valueFontSize: 13 }) as any;
    expect(l.color).toBe("#ffffff");
    expect(l.rich.value).toEqual({ color: "#333333", fontSize: 13, lineHeight: 16 });
  });

  it("applies the name options without a figure line", () => {
    expect(treemapLabel(ctx(), { color: "#222222", fontSize: 10, fontWeight: "bold" })).toEqual({
      show: true,
      color: "#222222",
      fontSize: 10,
      overflow: "truncate",
      fontWeight: "bold",
    });
  });
});

describe("escapeHtml", () => {
  it("is the shared leaf, re-exported for tooltip formatters", () => {
    expect(escapeHtml).toBe(escapeHtmlLeaf);
    expect(escapeHtml("<b>&</b>")).toBe("&lt;b&gt;&amp;&lt;/b&gt;");
  });
});
