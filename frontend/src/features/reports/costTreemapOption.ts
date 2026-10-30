/**
 * The Cost report's treemap, as an ECharts option. Pure: `CostReport.tsx`
 * hands in each panel's cards (already sorted by cost, largest first) and the
 * chart chrome, and gets back the option `EChart` draws.
 *
 * One tile per card, sized by its cost and filled from a fixed run of blues by
 * its position, so the largest card always leads in the darkest blue. Each
 * tile carries the card's `id` and `name`, which is what a click hands back to
 * the page (drill into the card, or open its side panel). The tooltip names
 * the card, its cost and — when the panel totals anything — its share of the
 * panel's own total, so a drilled level with one panel per source reads each
 * share against its own scale.
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

/** The tile fills, by position: index 0 is the most expensive card. */
export const COST_TREEMAP_COLORS: readonly string[] = [
  "#1565c0",
  "#1976d2",
  "#1e88e5",
  "#2196f3",
  "#42a5f5",
  "#64b5f6",
  "#90caf9",
  "#bbdefb",
  "#0d47a1",
  "#1565c0",
];

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
}

/** A tile's datum as the option carries it — and as a click hands it back. */
export interface CostTreemapDatum {
  name: string;
  value: number;
  id?: string;
  index: number;
  itemStyle: { color: string };
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
  const data: CostTreemapDatum[] = items.map((d) => ({
    name: d.name,
    value: d.cost,
    id: d.id,
    index: d.index,
    itemStyle: { color: treemapColor(d.index) },
  }));
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
        itemStyle: { borderColor: "#fff", borderWidth: 2, gapWidth: 2, borderRadius: 3 },
        label: {
          ...treemapLabel(ctx, {
            showValues: true,
            color: "#fff",
            fontSize: 11,
            fontWeight: 600,
            valueFontSize: 10,
            valueColor: "rgba(255,255,255,0.8)",
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
