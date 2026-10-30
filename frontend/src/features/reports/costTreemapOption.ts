/**
 * The Cost report's treemap, as an ECharts option. Pure: `CostReport.tsx`
 * hands in each panel's cards (already sorted by cost, largest first) and the
 * chart chrome, and gets back the option `EChart` draws.
 *
 * One tile per card that costs anything, sized by its cost and filled from a
 * fixed run of blues by its position, so the largest card always leads in the
 * darkest blue. A card costing nothing (or less) has no tile: ECharts'
 * squarify layout cannot place an area of zero or below, and a negative one
 * corrupts its siblings' tiles. Each tile carries the card's `id` and `name`,
 * which is what a click hands back to the page (drill into the card, or open
 * its side panel). The tooltip names the card, its cost and — when the panel
 * totals anything — its share of the panel's own total, so a drilled level
 * with one panel per source reads each share against its own scale. The
 * fills and label colours are tokens (`COST_TREEMAP_COLORS`,
 * `CHART_LABEL_ON_DARK*` in `@/theme/tokens`).
 *
 * A tile prints only what fits it. ECharts truncates each label line to the
 * tile's width and drops the ellipsis once fewer than two characters fit, so
 * left to itself a small tile reads "$42" for a $42,000 card. ECharts has no
 * per-line "fit or vanish", but a tile's area is its share of the chart's, so
 * once the page knows the chart's pixel area (`areaPx`) each datum gets a
 * label tier of its own: nothing, the name alone, or the name and the cost.
 */
import type { EChartsCoreOption } from "echarts/core";
import type { EChartsChrome } from "@/components/charts/echartsTheme";
import {
  base,
  escapeHtml,
  tooltip,
  treemapLabel,
  type ChartChromeContext,
} from "@/components/charts/chrome";
import { CHART_LABEL_ON_DARK, CHART_LABEL_ON_DARK_MUTED, COST_TREEMAP_COLORS } from "@/theme/tokens";

/** A tile's fill, cycling the palette by position. */
export function treemapColor(index: number): string {
  return COST_TREEMAP_COLORS[index % COST_TREEMAP_COLORS.length];
}

/** One card on the treemap; `index` is its position by cost, largest first. */
export interface CostTreemapItem {
  /** Absent for a row that names no card — its tile is inert. */
  id?: string;
  name: string;
  cost: number;
  index: number;
}

export interface CostTreemapOptions {
  chrome: EChartsChrome;
  isRtl: boolean;
  /** A cost as the workspace's currency prints it. */
  format: (v: number) => string;
  /** The panel's own total each tile's share is read against; 0 leaves the share out. */
  panelTotal: number;
  /** The share line, given the percentage already rounded to one decimal. */
  percentOfTotal: (pct: string) => string;
  /** Whether a click drills somewhere — the pointer cursor over the tiles. */
  clickable: boolean;
  /**
   * The chart's drawable area in px² (width × height), which sizes each
   * tile's label tier; undefined until the panel has been measured, and then
   * every tile gets the series label.
   */
  areaPx?: number;
}

/**
 * Smallest tile area (px²) that prints the card's name: about 55 × 40, the
 * Recharts treemap's old "wider than 50 px and taller than 30 px" rule with
 * room for squarify's tiles not being square.
 */
export const TREEMAP_NAME_MIN_AREA = 2200;

/**
 * Smallest tile area (px²) that prints the cost under the name: about 80 × 50,
 * the old "wider than 70 px and taller than 45 px" rule with the same slack.
 */
export const TREEMAP_VALUE_MIN_AREA = 4000;

/** What a tile prints: nothing, its name, or its name and cost. */
export type TileLabelTier = "none" | "name" | "full";

/** What a tile of `tileArea` px² prints: nothing, its name, or its name and cost. */
export function tileLabelTier(tileArea: number): TileLabelTier {
  if (tileArea < TREEMAP_NAME_MIN_AREA) return "none";
  if (tileArea < TREEMAP_VALUE_MIN_AREA) return "name";
  return "full";
}

/**
 * Each drawn tile's label tier, in tile order, on a chart of `areaPx` px²:
 * the tiles share the area by cost, so a tile's area is its share of the
 * drawn tiles' total. `undefined` while the chart is unmeasured (or 0);
 * NaN reads as unmeasured too, and Infinity gives every tile its full label.
 */
export function tileLabelTiers(items: CostTreemapItem[], areaPx: number | undefined): TileLabelTier[] | undefined {
  const area = areaPx ?? 0;
  if (!(area > 0)) return undefined;
  const drawn = items.filter((d) => d.cost > 0);
  const total = drawn.reduce((sum, d) => sum + d.cost, 0);
  return drawn.map((d) => tileLabelTier((d.cost / total) * area));
}

/** A tile's datum as the option carries it — and as a click hands it back. */
export interface CostTreemapDatum {
  name: string;
  value: number;
  id?: string;
  index: number;
  itemStyle: { color: string };
  /** A tile too small for the series label: no label, or the name alone. */
  label?: { show: false } | { formatter: string };
}

/** The per-datum label of a tile in `tier`; the series label serves a full one. */
function tileLabel(tier: TileLabelTier): CostTreemapDatum["label"] {
  if (tier === "none") return { show: false };
  // A data item's label merges over the series label, so this string
  // formatter replaces the name-and-cost one for this tile alone.
  if (tier === "name") return { formatter: "{b}" };
  return undefined;
}

/** The hover tooltip of one tile: its name, its cost and, against a non-zero total, its share. */
export function costTooltipHtml(
  d: { name: string; cost: number },
  o: Pick<CostTreemapOptions, "format" | "panelTotal" | "percentOfTotal">,
): string {
  let html =
    `<div style="font-weight:700">${escapeHtml(d.name)}</div>` +
    `<div style="font-size:12px">${escapeHtml(o.format(d.cost))}</div>`;
  if (o.panelTotal > 0) {
    const pct = ((d.cost / o.panelTotal) * 100).toFixed(1);
    html += `<div style="font-size:12px;opacity:.7">${escapeHtml(o.percentOfTotal(pct))}</div>`;
  }
  return html;
}

/** The treemap of one panel's cards. */
export function buildCostTreemapOption(items: CostTreemapItem[], o: CostTreemapOptions): EChartsCoreOption {
  // The tile labels print their cost through the chrome's value formatter.
  const ctx: ChartChromeContext = { theme: o.chrome, isRtl: o.isRtl, valueFormatter: o.format };
  const drawn = items.filter((d) => d.cost > 0);
  // Unmeasured, every tile keeps the series label.
  const tiers = tileLabelTiers(drawn, o.areaPx);
  const data: CostTreemapDatum[] = drawn.map((d, i) => {
    const datum: CostTreemapDatum = {
      name: d.name,
      value: d.cost,
      id: d.id,
      index: d.index,
      itemStyle: { color: treemapColor(d.index) },
    };
    const label = tiers && tileLabel(tiers[i]);
    if (label) datum.label = label;
    return datum;
  });
  return {
    ...base(ctx),
    tooltip: tooltip(ctx, {
      trigger: "item",
      formatter: (p: { data?: CostTreemapDatum } | undefined) => {
        const d = p?.data;
        return d ? costTooltipHtml({ name: d.name, cost: d.value }, o) : "";
      },
    }),
    series: [
      {
        type: "treemap",
        // The tiles are the whole chart: no zoom, no drill by ECharts itself
        // (the page drills through its own breadcrumb), no ECharts breadcrumb.
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        // A tile smaller than this area (px²) is not drawn at all.
        visibleMin: 4,
        // One cursor for the whole series: every tile drills, or none does.
        cursor: o.clickable ? "pointer" : "default",
        // The gaps between tiles are the paper the chart sits on.
        itemStyle: { borderColor: ctx.theme.surface, borderWidth: 2, gapWidth: 2, borderRadius: 3 },
        label: {
          ...treemapLabel(ctx, {
            showValues: true,
            color: CHART_LABEL_ON_DARK,
            fontSize: 11,
            fontWeight: 600,
            valueFontSize: 10,
            valueColor: CHART_LABEL_ON_DARK_MUTED,
          }),
          // Anchored at the tile's leading top corner — the right one in RTL.
          position: o.isRtl ? "insideTopRight" : "insideTopLeft",
          align: o.isRtl ? "right" : "left",
          padding: [6, 6],
        },
        data,
      },
    ],
  };
}
