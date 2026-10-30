/**
 * Chart chrome — the one place the look around the data is defined: the font
 * and text colour, the cartesian grid and its insets, axis labels and split
 * lines, the hover tooltip, the legend band, value labels printed on marks and
 * treemap tile labels. Dashboard widgets (`features/dashboard/charts/
 * buildOption.ts`), the reports and extension charts all build their ECharts
 * options from these helpers, so a chart reads the same wherever it sits.
 *
 * Every helper is pure and takes a `ChartChromeContext`: the palette from
 * `useEChartsTheme()` (`echartsTheme.ts`), the live RTL flag — ECharts does
 * not inherit the document `dir`, so each helper mirrors itself — and the
 * caller's number formatter.
 */
import type { EChartsChrome } from "./echartsTheme";

export { escapeHtml } from "@/lib/escapeHtml";

/** What every chrome helper reads. */
export interface ChartChromeContext {
  theme: EChartsChrome;
  isRtl: boolean;
  /** How a figure is printed in tooltips and labels; `defaultValueFormatter` when omitted. */
  valueFormatter?: (value: number) => string;
  /** Mark cursor — "pointer" when a click drills somewhere. */
  cursor?: "pointer" | "default";
}

/**
 * Widest a column and thickest a horizontal bar is drawn. A cap at all
 * because one column across a wide chart reads as a block, not a mark; this
 * high because four columns on a six-column widget looked like sticks under
 * the old 32 px. Dense charts are bounded by `barCategoryGap` long before
 * either cap.
 */
export const COLUMN_MAX_WIDTH = 72;
export const BAR_MAX_THICKNESS = 40;

/**
 * Average glyph width of a 12 px label — the estimate insets are sized from
 * (ECharts measures the real text only when it draws it).
 */
export const LABEL_CHAR_WIDTH = 6.6;

/** Widest a legend entry's name is drawn before it is ellipsised. */
export const LEGEND_LABEL_WIDTH = 120;

/** Font size of a value printed on a mark (`showValues`). */
export const VALUE_LABEL_FONT_SIZE = 11;
/** ECharts' gap between a bar's end and an outside label, in px. */
export const VALUE_LABEL_DISTANCE = 5;
/** The trailing inset a cartesian grid keeps when nothing is printed past a bar. */
export const GRID_TRAILING_INSET = 16;

/** An integer as is, anything else to one decimal; a non-finite value as 0. */
export function defaultValueFormatter(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** The context's number formatter, or the default one. */
export function fmt(ctx: ChartChromeContext): (value: number) => string {
  return ctx.valueFormatter ?? defaultValueFormatter;
}

/** The option root every chart spreads first: font, text colour, aria, animation. */
export function base(ctx: ChartChromeContext): Record<string, unknown> {
  return {
    backgroundColor: "transparent",
    aria: { enabled: true },
    animationDuration: 300,
    textStyle: { fontFamily: ctx.theme.fontFamily, color: ctx.theme.textSecondary },
  };
}

/** The hover tooltip on the chart's surface, right-aligned in RTL; `extra` merges last. */
export function tooltip(ctx: ChartChromeContext, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    confine: true,
    backgroundColor: ctx.theme.tooltipBackground,
    borderColor: ctx.theme.divider,
    textStyle: { color: ctx.theme.textPrimary, fontFamily: ctx.theme.fontFamily },
    extraCssText: ctx.isRtl ? "direction: rtl; text-align: right;" : "",
    valueFormatter: (v: unknown) => fmt(ctx)(Number(v)),
    ...extra,
  };
}

/** A recessive 12 px axis label; `extra` merges last. */
export function axisLabel(ctx: ChartChromeContext, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { color: ctx.theme.textSecondary, fontSize: 12, ...extra };
}

/**
 * A cartesian grid that contains its axis labels, with the wider side inset
 * on the trailing edge (right, or left in RTL), where the last category's
 * label reaches past its column.
 */
export function grid(ctx: ChartChromeContext, top: number, bottom: number): Record<string, unknown> {
  return {
    left: ctx.isRtl ? GRID_TRAILING_INSET : 8,
    right: ctx.isRtl ? 8 : GRID_TRAILING_INSET,
    top,
    bottom,
    containLabel: true,
  };
}

/** Dashed split lines in the divider colour — recessive. */
export function splitLine(ctx: ChartChromeContext): Record<string, unknown> {
  return { show: true, lineStyle: { color: ctx.theme.divider, type: "dashed" } };
}

/**
 * The trailing inset a horizontal bar chart keeps when it prints its values:
 * the widest bar can end at the grid's edge, and its figure is drawn past
 * it, so the inset holds the longest formatted value at the 11 px estimate
 * plus the label's gap — never less than the plain grid's inset. Pure.
 */
export function valueLabelInset(values: number[], format: (value: number) => string): number {
  const chars = values.reduce((m, v) => Math.max(m, format(v).length), 0);
  const width = (chars * LABEL_CHAR_WIDTH * VALUE_LABEL_FONT_SIZE) / 12;
  return Math.max(GRID_TRAILING_INSET, Math.ceil(width + VALUE_LABEL_DISTANCE + 4));
}

/** A value label on a bar or column, read through the context's formatter; `extra` merges last. */
export function valueLabel(
  ctx: ChartChromeContext,
  position: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const valueOf = fmt(ctx);
  return {
    show: true,
    position,
    color: ctx.theme.textSecondary,
    fontSize: VALUE_LABEL_FONT_SIZE,
    formatter: (p: { value?: unknown }) => valueOf(Number(p.value ?? 0)),
    ...extra,
  };
}

/**
 * A legend in a fixed band at the bottom: one row that pages (arrows) when
 * the entries do not fit, each name capped at `LEGEND_LABEL_WIDTH` so a page
 * always shows whole entries, the full name on hover. `extra` merges last —
 * a report whose legend is a key, not a filter, passes `{ selectedMode: false }`.
 * Its `textStyle` merges over the default one rather than replacing it, so a
 * chart with few, long names can widen `width` and keep the colour, the size
 * and the truncation.
 */
export function legend(
  ctx: ChartChromeContext,
  names: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const { textStyle, ...rest } = extra;
  return {
    type: "scroll",
    orient: "horizontal",
    bottom: 0,
    left: ctx.isRtl ? "right" : "left",
    align: ctx.isRtl ? "right" : "left",
    icon: "roundRect",
    itemWidth: 10,
    itemHeight: 10,
    pageTextStyle: { color: ctx.theme.textSecondary },
    tooltip: { show: true },
    data: names,
    ...rest,
    textStyle: {
      color: ctx.theme.textPrimary,
      fontSize: 12,
      width: LEGEND_LABEL_WIDTH,
      overflow: "truncate",
      ...(textStyle as Record<string, unknown> | undefined),
    },
  };
}

/** A smallest-nice ceiling (1, 2, 2.5, 5 or 10 times a power of ten) for a scale without an explicit max. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  return ([1, 2, 2.5, 5].find((step) => step * exp >= value) ?? 10) * exp;
}

export interface TreemapLabelOptions {
  /** Print the tile's figure on a second line under its name. */
  showValues?: boolean;
  /** Name colour; the chart surface by default (text on a filled tile). */
  color?: string;
  /** Name size; 12 by default. */
  fontSize?: number;
  /** Name weight; ECharts' own when omitted. */
  fontWeight?: number | string;
  /** Figure size; `VALUE_LABEL_FONT_SIZE` by default. */
  valueFontSize?: number;
  /** Figure colour; the name's colour by default. */
  valueColor?: string;
}

/**
 * A treemap tile's label: its name, and with `showValues` its figure on a
 * second, smaller line — in the name's colour unless told otherwise.
 */
export function treemapLabel(ctx: ChartChromeContext, opts: TreemapLabelOptions = {}): Record<string, unknown> {
  const color = opts.color ?? ctx.theme.surface;
  const label: Record<string, unknown> = {
    show: true,
    color,
    fontSize: opts.fontSize ?? 12,
    overflow: "truncate",
    ...(opts.fontWeight !== undefined && { fontWeight: opts.fontWeight }),
  };
  if (!opts.showValues) return label;
  const valueOf = fmt(ctx);
  return {
    ...label,
    formatter: (p: { name?: string; value?: unknown }) => `${p.name ?? ""}\n{value|${valueOf(Number(p.value ?? 0))}}`,
    rich: {
      value: {
        color: opts.valueColor ?? color,
        fontSize: opts.valueFontSize ?? VALUE_LABEL_FONT_SIZE,
        lineHeight: 16,
      },
    },
  };
}
