/**
 * The Cost report's Sankey, as an ECharts option. Pure: `CostReport.tsx` hands
 * in the nodes and links the page keeps (cost items -> groups -> cards) and the
 * chart chrome, and gets back the option `EChart` draws.
 *
 * A node is a bar coloured by its kind (`costSankeyNodeColor`): a cost item in
 * the brand blue, a group, or a card in its card type's colour. ECharts needs a
 * unique `name` per node, so the node id is the name and the label formatter
 * maps it back to the card's own name, shortened to `MAX_LABEL`. Labels of the
 * last column sit right of its bars, in the room `sankeyInset` keeps for them.
 */
import type { EChartsCoreOption } from "echarts/core";
import type { EChartsChrome } from "@/components/charts/echartsTheme";
import { base, escapeHtml, tooltip, type ChartChromeContext } from "@/components/charts/chrome";
import { sankeyInset } from "@/features/dashboard/charts/buildOption";
import { CARD_TYPE_COLORS, CATEGORICAL_COLORS, DEFAULT_LAYER_COLOR, STATUS_COLORS } from "@/theme";
import { costCardIdentityHtml, costCardRichStyle, type CostCardIdentity } from "./costCardIdentity";

const MAX_LABEL = 24;

/** A node's colour by kind: cost item, group, or the card's type. */
export function costSankeyNodeColor(type: string): string {
  if (type === "CostItem") return STATUS_COLORS.neutral;
  if (type === "Group") return CATEGORICAL_COLORS[7];
  return CARD_TYPE_COLORS[type as keyof typeof CARD_TYPE_COLORS] ?? DEFAULT_LAYER_COLOR;
}

export interface CostSankeyNodeIn extends CostCardIdentity {
  id: string;
  name: string;
  type: string;
  /** The node's fill; the kind's colour when absent. */
  color?: string;
  /** A card's type label, appended to its label and named in the tooltip. */
  typeLabel?: string;
}

export interface CostSankeyLinkIn {
  /** Index into the nodes. */
  source: number;
  target: number;
  value: number;
}

export interface CostSankeyOptions {
  chrome: EChartsChrome;
  isRtl: boolean;
  /** A cost as the workspace's currency prints it. */
  format: (v: number) => string;
  /** Height of the laid-out node, in pixels, when available. */
  nodeHeight?: (dataIndex: number) => number | undefined;
}

/** Read the real node height while ECharts formats the label. */
export function chartSankeyNodeHeight(chart: object | null | undefined, dataIndex: number): number | undefined {
  try {
    const model = chart as { getModel(): { getSeriesByIndex(i: number): { getData(): { getItemLayout(i: number): { dy?: unknown } | undefined } } | undefined } | null } | null | undefined;
    const height = model?.getModel()?.getSeriesByIndex(0)?.getData().getItemLayout(dataIndex)?.dy;
    return typeof height === "number" ? height : undefined;
  } catch {
    return undefined;
  }
}

/** A name shortened to `MAX_LABEL` characters, with an ellipsis. */
export function shortenSankeyLabel(name: string): string {
  return name.length > MAX_LABEL ? `${name.slice(0, MAX_LABEL - 1)}…` : name;
}

/** What a node prints: its name, shortened, then its type for a card. */
function nodeLabel(n: CostSankeyNodeIn): string {
  return n.typeLabel ? `${shortenSankeyLabel(n.name)} · ${n.typeLabel}` : shortenSankeyLabel(n.name);
}

/** The Sankey of the kept nodes and links. */
export function buildCostSankeyOption(
  nodes: CostSankeyNodeIn[],
  links: CostSankeyLinkIn[],
  o: CostSankeyOptions,
): EChartsCoreOption {
  const ctx: ChartChromeContext = { theme: o.chrome, isRtl: o.isRtl, valueFormatter: o.format };
  const nameOf = new Map(nodes.map((n) => [n.id, n.typeLabel ? `${n.name} · ${n.typeLabel}` : n.name]));
  const labelOf = new Map(nodes.map((n) => [n.id, nodeLabel(n)]));
  const nodeOf = new Map(nodes.map((n) => [n.id, n]));
  const identities = nodes.map(costCardRichStyle);
  const identityOf = new Map(nodes.map((n, i) => [n.id, identities[i] ? "cardIdentity" : undefined]));
  // The last column's labels sit right of its bars: keep room for them.
  const hasOutgoing = new Set(links.map((l) => nodes[l.source].id));
  const inset = sankeyInset(
    nodes.filter((n) => !hasOutgoing.has(n.id)).map(nodeLabel),
  );
  const arrow = o.isRtl ? "←" : "→";
  return {
    ...base(ctx),
    tooltip: tooltip(ctx, {
      trigger: "item",
      formatter: (p: {
        dataType?: string;
        name?: string;
        value?: number;
        data?: { source?: string; target?: string };
      }) => {
        const v = escapeHtml(o.format(Number(p.value ?? 0)));
        if (p.dataType === "edge" && p.data) {
          const from = escapeHtml(nameOf.get(p.data.source ?? "") ?? "");
          const to = escapeHtml(nameOf.get(p.data.target ?? "") ?? "");
          return `${from} ${arrow} ${to}: ${v}`;
        }
        return `${costCardIdentityHtml(nodeOf.get(p.name ?? "") ?? {})}${escapeHtml(nameOf.get(p.name ?? "") ?? "")}: ${v}`;
      },
    }),
    series: [
      {
        type: "sankey",
        left: 8,
        right: inset,
        top: 8,
        bottom: 8,
        nodeWidth: 14,
        nodeGap: 12,
        draggable: false,
        emphasis: { focus: "adjacency" },
        label: {
          color: ctx.theme.textPrimary,
          fontSize: 12,
          rich: { cardIcon: { fontFamily: "Material Symbols Outlined", fontSize: 10 } },
          formatter: (p: { name?: string; dataIndex?: number }) => {
            const height = o.nodeHeight?.(p.dataIndex ?? -1);
            const key = height !== undefined && height < 20 ? undefined : identityOf.get(p.name ?? "");
            const node = nodeOf.get(p.name ?? "");
            return `${key ? `{${key}|${node?.logo_updated_at ? " " : node?.typeIcon ?? ""}}${node?.logo_updated_at ? `{cardIcon|${node.typeIcon ?? ""}}` : ""} ` : ""}${labelOf.get(p.name ?? "") ?? ""}`;
          },
        },
        lineStyle: { color: "source", opacity: 0.45, curveness: 0.5 },
        itemStyle: { borderColor: ctx.theme.surface, borderWidth: 1 },
        data: nodes.map((n, i) => ({
          name: n.id,
          itemStyle: { color: n.color ?? costSankeyNodeColor(n.type) },
          ...(identities[i] && { label: { rich: { cardIdentity: identities[i] } } }),
        })),
        links: links.map((l) => ({
          source: nodes[l.source].id,
          target: nodes[l.target].id,
          value: l.value,
        })),
      },
    ],
  };
}
