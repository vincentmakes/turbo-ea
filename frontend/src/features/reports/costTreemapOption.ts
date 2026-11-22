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
 * fills come from the page's colour plan and label colours are tokens (
 * `CHART_LABEL_ON_DARK*` in `@/theme/tokens`).
 *
 * A tile prints only what fits it. ECharts truncates each label line to the
 * tile's width and drops the ellipsis once fewer than two characters fit, so
 * left to itself a small tile reads "$42" for a $42,000 card, or "$95,…" in a
 * tall narrow one. ECharts has no per-line "fit or vanish", but it lays every
 * tile out before it formats the tile's label, so the label formatter asks
 * the page for the tile's rectangle (`tileRect`, read from the live chart)
 * and prints nothing, the name alone, or the name and the cost by fixed
 * width and height thresholds (`tileLabelTier`), the ones the treemap has
 * always used.
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
import {
  CHART_LABEL_ON_DARK,
  CHART_LABEL_ON_DARK_MUTED,
  CHART_LABEL_ON_LIGHT,
  COST_DELTA_DOWN,
  COST_DELTA_DOWN_ON_LIGHT,
  COST_DELTA_UP,
  COST_DELTA_UP_ON_LIGHT,
} from "@/theme/tokens";
import { inkOn } from "./costColors";
import { costCardIdentityHtml, costCardRichStyle, type CostCardIdentity } from "./costCardIdentity";


/** One card on the treemap; `index` is its position by cost, largest first. */
export interface CostTreemapItem extends CostCardIdentity {
  /** Absent for a row that names no card — its tile is inert. */
  id?: string;
  name: string;
  cost: number;
  index: number;
  /**
   * Change against the current fiscal year's cost, as a signed ratio: absent
   * when no year is picked (no badge), null when the card has no current-year
   * cost to diff against ("new").
   */
  deltaPct?: number | null;
  /** The tile's fill. */
  color: string;
  /** The card type's label, printed under the name and named in the tooltip. */
  typeLabel?: string;
}

/** A group of cards: a framed block in the treemap, titled with its name. */
export interface CostTreemapGroup {
  /** The group's key as a click hands it back (`__others__` for the folded groups). */
  key: string;
  name: string;
  /** The frame's fill. */
  color: string;
  cost: number;
  /** Position of the group by cost, largest first — picks the group's colour. */
  index: number;
  /** The group's cards, largest first. */
  items: CostTreemapItem[];
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
   * The rectangle ECharts laid the tile with `dataIndex` out in, read while
   * it renders the tile's label; undefined (or undefined for that index)
   * while the chart cannot say, and then the tile prints its name and cost.
   */
  tileRect?: (dataIndex: number) => { width: number; height: number } | undefined;
  /** The word for a card with no current-year cost to diff against. */
  deltaNew?: string;
  /** Cards drawn in framed groups instead of as a flat run of tiles. */
  groups?: CostTreemapGroup[];
}

/**
 * A tile prints its name only when wider and taller than this (px) — the
 * thresholds the treemap has always used.
 */
export const TILE_NAME_MIN = { width: 50, height: 30 } as const;

/**
 * A tile prints its cost under the name only when wider and taller than this
 * (px) — the thresholds the treemap has always used.
 */
export const TILE_VALUE_MIN = { width: 70, height: 45 } as const;

/** What a tile prints: nothing, its name, or its name and cost. */
export type TileLabelTier = "none" | "name" | "full";

/** What a tile of `width` × `height` px prints: nothing, its name, or its name and cost. */
export function tileLabelTier(width: number, height: number): TileLabelTier {
  if (width > TILE_VALUE_MIN.width && height > TILE_VALUE_MIN.height) return "full";
  if (width > TILE_NAME_MIN.width && height > TILE_NAME_MIN.height) return "name";
  return "none";
}

/** The label params ECharts hands a treemap label formatter — the part it reads. */
export interface TileLabelParams {
  dataIndex?: number;
  name?: string;
  value?: unknown;
  data?: { deltaPct?: number | null; typeLabel?: string; typeIcon?: string; logo_updated_at?: string | null; identityKey?: string };
}

/** The change badge of a tile, as rich text: "▲ +12%", "▼ -3%" or "▲ new"; "" when none. */
export function deltaBadge(deltaPct: number | null | undefined, deltaNew: string): string {
  if (deltaPct === undefined) return "";
  if (deltaPct === null) return `{up|▲ ${deltaNew}}`;
  const pct = Math.round(deltaPct * 100);
  return deltaPct >= 0 ? `{up|▲ +${pct}%}` : `{down|▼ ${pct}%}`;
}

/**
 * The series label formatter: each tile's text by the rectangle ECharts laid
 * it out in. A tile whose rectangle is unknown prints its name and cost.
 */
export function tileLabelFormatter(
  o: Pick<CostTreemapOptions, "format" | "tileRect" | "deltaNew">,
): (p: TileLabelParams) => string {
  return (p) => {
    const r = o.tileRect?.(p.dataIndex ?? -1);
    const tier = r ? tileLabelTier(r.width, r.height) : "full";
    if (tier === "none") return "";
    const identity = p.data?.identityKey ? `{${p.data.identityKey}|${p.data.logo_updated_at ? " " : p.data.typeIcon ?? ""}}${p.data.logo_updated_at ? `{cardIcon|${p.data.typeIcon ?? ""}}` : ""} ` : "";
    const name = identity + (p.name ?? "");
    if (tier === "name") return name;
    const badge = deltaBadge(p.data?.deltaPct, o.deltaNew ?? "");
    const type = p.data?.typeLabel ? `\n{type|${p.data.typeLabel}}` : "";
    return `${name}${type}\n{value|${o.format(Number(p.value ?? 0))}}${badge && ` ${badge}`}`;
  };
}

/**
 * The slice of ECharts' model a treemap tile's rectangle is read through.
 * It is internal: `getModel` is private in ECharts' public typings and the
 * series data behind it (with `getItemLayout`) is not exported from them, so
 * the access is typed this narrowly rather than as `any`.
 */
interface TreemapLayoutModel {
  getModel(): {
    getSeriesByIndex(i: number):
      | { getData(): { getItemLayout(i: number): { width?: unknown; height?: unknown } | null | undefined } }
      | null
      | undefined;
  } | null;
}

/**
 * The rectangle a live treemap chart laid the tile with `dataIndex` out in —
 * what a label formatter running inside its render reads (`tileRect`). Every
 * step is guarded: no chart yet, a disposed one, or ECharts' internals no
 * longer answering give undefined, and the tile prints its name and cost.
 * `costTreemapOption.render.test.ts` pins that it answers on the installed
 * ECharts.
 */
export function chartTileRect(
  chart: object | null | undefined,
  dataIndex: number,
): { width: number; height: number } | undefined {
  try {
    const l = (chart as TreemapLayoutModel | null | undefined)
      ?.getModel()
      ?.getSeriesByIndex(0)
      ?.getData()
      .getItemLayout(dataIndex);
    return l && typeof l.width === "number" && typeof l.height === "number"
      ? { width: l.width, height: l.height }
      : undefined;
  } catch {
    return undefined;
  }
}

/** A tile's datum as the option carries it — and as a click hands it back. */
export interface CostTreemapDatum extends CostCardIdentity {
  name: string;
  value: number;
  id?: string;
  index: number;
  itemStyle: { color: string };
  deltaPct?: number | null;
  /** The group the card sits in, when the report is grouped. */
  group?: string;
  typeLabel?: string;
  identityKey?: string;
  /** Present on a light tile only: dark ink and the badge colours that read on light. */
  label?: { color?: string; rich: Record<string, unknown> };
}

/** A group's datum: its frame, holding its cards. */
export interface CostTreemapGroupDatum {
  key: string;
  name: string;
  upperLabel?: { color: string };
  value: number;
  children: CostTreemapDatum[];
  itemStyle: { color: string; borderColor: string; borderWidth: number; gapWidth: number };
}

/** The hover tooltip of one tile: its name, its cost and, against a non-zero total, its share. */
export function costTooltipHtml(
  d: { name: string; cost: number; group?: string; typeLabel?: string } & CostCardIdentity,
  o: Pick<CostTreemapOptions, "format" | "panelTotal" | "percentOfTotal">,
): string {
  let html = `<div style="font-weight:700">${costCardIdentityHtml(d)}${escapeHtml(d.name)}</div>`;
  if (d.group) html += `<div style="font-size:12px;opacity:.7">${escapeHtml(d.group)}</div>`;
  if (d.typeLabel) html += `<div style="font-size:12px;opacity:.7">${escapeHtml(d.typeLabel)}</div>`;
  html += `<div style="font-size:12px">${escapeHtml(o.format(d.cost))}</div>`;
  if (o.panelTotal > 0) {
    const pct = ((d.cost / o.panelTotal) * 100).toFixed(1);
    html += `<div style="font-size:12px;opacity:.7">${escapeHtml(o.percentOfTotal(pct))}</div>`;
  }
  return html;
}

/** The label's rich styles for one ink: the cost line, the type line and the two change badges. */
function richStyles(ink: string, up: string, down: string): Record<string, unknown> {
  return {
    value: { color: ink, fontSize: 10, lineHeight: 16 },
    type: { color: ink, fontSize: 10, lineHeight: 14 },
    up: { color: up, fontSize: 10, fontWeight: 700 },
    down: { color: down, fontSize: 10, fontWeight: 700 },
  };
}

/** The treemap of one panel's cards. */
export function buildCostTreemapOption(items: CostTreemapItem[], o: CostTreemapOptions): EChartsCoreOption {
  // The chrome's figures read in the report's currency.
  const ctx: ChartChromeContext = { theme: o.chrome, isRtl: o.isRtl, valueFormatter: o.format };
  // A light tile reads in dark ink; the series label (white) serves every dark one.
  const lightLabel = {
    color: CHART_LABEL_ON_LIGHT,
    rich: richStyles(CHART_LABEL_ON_LIGHT, COST_DELTA_UP_ON_LIGHT, COST_DELTA_DOWN_ON_LIGHT),
  };
  const leaf = (d: CostTreemapItem, group?: string): CostTreemapDatum => {
    const color = d.color;
    const identity = costCardRichStyle(d);
    const identityKey = identity ? "cardIdentity" : undefined;
    const light = inkOn(color) === CHART_LABEL_ON_LIGHT;
    return {
      name: d.name,
      value: d.cost,
      id: d.id,
      index: d.index,
      itemStyle: { color },
      ...(d.deltaPct !== undefined && { deltaPct: d.deltaPct }),
      ...(group !== undefined && { group }),
      ...(d.typeLabel !== undefined && { typeLabel: d.typeLabel }),
      ...(identityKey && { identityKey, typeIcon: d.typeIcon, logo_updated_at: d.logo_updated_at }),
      ...((light || identity) && { label: {
        ...(light ? lightLabel : {}),
        rich: { ...(light ? lightLabel.rich : {}), ...(identity && { cardIdentity: identity }) },
      } }),
    };
  };
  // Grouped: each group is a frame holding its cards, which take the frame's colour.
  const data: (CostTreemapDatum | CostTreemapGroupDatum)[] = o.groups
    ? o.groups
        .map((g) => ({
          key: g.key,
          name: g.name,
          value: g.cost,
          children: g.items.filter((d) => d.cost > 0).map((d) => leaf(d, g.name)),
          upperLabel: { color: inkOn(g.color) },
          itemStyle: {
            color: g.color,
            borderColor: ctx.theme.surface,
            borderWidth: 4,
            gapWidth: 2,
          },
        }))
        .filter((g) => g.children.length > 0)
    : items.filter((d) => d.cost > 0).map((d) => leaf(d));
  const tileLabel = treemapLabel(ctx, {
    showValues: true,
    color: CHART_LABEL_ON_DARK,
    fontSize: 11,
    fontWeight: 600,
    valueFontSize: 10,
    valueColor: CHART_LABEL_ON_DARK_MUTED,
  }) as { rich: Record<string, unknown> };
  return {
    ...base(ctx),
    tooltip: tooltip(ctx, {
      trigger: "item",
      formatter: (p: { data?: CostTreemapDatum | CostTreemapGroupDatum } | undefined) => {
        const d = p?.data;
        if (!d) return "";
        const group = "group" in d ? d.group : undefined;
        const typeLabel = "typeLabel" in d ? d.typeLabel : undefined;
        return costTooltipHtml({ ...d, cost: d.value, group, typeLabel }, o);
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
          // The chrome's tile label for its styling (colours, sizes, the
          // truncation and the cost line's rich style); the text itself
          // comes from the tile's own rectangle.
          ...tileLabel,
          formatter: tileLabelFormatter(o),
          // The change badge reads on the tile's blue in a lighter green or red.
          rich: {
            ...tileLabel.rich,
            cardIcon: { fontFamily: "Material Symbols Outlined", fontSize: 10 },
            type: { color: CHART_LABEL_ON_DARK_MUTED, fontSize: 10, lineHeight: 14 },
            up: { color: COST_DELTA_UP, fontSize: 10, fontWeight: 700 },
            down: { color: COST_DELTA_DOWN, fontSize: 10, fontWeight: 700 },
          },
          // Anchored at the tile's leading top corner — the right one in RTL.
          position: o.isRtl ? "insideTopRight" : "insideTopLeft",
          align: o.isRtl ? "right" : "left",
          padding: [6, 6],
        },
        // A group's title sits in a strip over the frame, above its cards.
        ...(o.groups && {
          upperLabel: {
            show: true,
            height: 18,
            color: CHART_LABEL_ON_DARK,
            fontSize: 11,
            fontWeight: 600,
            overflow: "truncate",
            align: o.isRtl ? "right" : "left",
            padding: [0, 6],
          },
        }),
        data,
      },
    ],
  };
}
