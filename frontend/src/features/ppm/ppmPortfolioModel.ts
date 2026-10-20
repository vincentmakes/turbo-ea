/**
 * The PPM portfolio board's model, as plain functions: which initiatives a
 * search and a subtype leave on the board and how they group, where each
 * Gantt bar sits in the board's rolling window and what colour it takes, what
 * a cost bar shows, which group totals exist, how a group nests by parent or
 * splits by subtype, which filters belong in the URL, which quarter labels
 * fit, and what the print summary and the XLSX export carry.
 *
 * `PpmPortfolioView.tsx` renders and measures the DOM; this decides. Labels
 * come in as functions, so nothing here touches React, i18n or the API, and
 * each rule is unit-tested on its own (`ppmPortfolioModel.test.ts`).
 */
import type { PrintParam } from "@/features/reports/ReportShell";
import { ALL_LEVELS } from "@/features/reports/portfolioGrouping";
import type { ExportColumn, ReportExportData } from "@/features/reports/reportExport";
import { typeLabel } from "@/hooks/useResolveLabel";
import type { InlineEntityLike } from "@/hooks/useResolveLabel";
import { buildChildIndex } from "@/lib/cardTree";
import { toLocalDate } from "@/lib/dates";
import type {
  PpmPortfolioGroupOption,
  PpmPortfolioItem,
  PpmPortfolioPerson,
} from "@/types";
import { COST_BAR_COLOR, RAG, RAG_LABEL, RAG_NONE, costUnit, fmtK } from "./ppmPortfolioFormat";

/** i18next's `t`, narrowed to the call shape the board uses. */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ------------------------------------------------------------------ */
/*  Values                                                             */
/* ------------------------------------------------------------------ */

/**
 * Cost figures are optional: a web portal can be configured to withhold them,
 * in which case they arrive as null. A withheld figure and an unrecorded one
 * then render alike, which is the honest rendering for both.
 */
export const money = (n: number | null | undefined): number => n ?? 0;

/** The initiative's IT project manager, else whoever is responsible for it. */
export function projectManager(people: PpmPortfolioPerson[]): PpmPortfolioPerson | undefined {
  return (
    people.find((p) => p.role_key === "itProjectManager") ??
    people.find((p) => p.role_key === "responsible")
  );
}

/** The colour of a health dot; no report, or an unknown value, is grey. */
export const ragColor = (value: string | null | undefined): string =>
  (value && RAG[value]) || RAG_NONE;

/** The i18n key naming a health value; no report, or an unknown value, reads "no report". */
export const healthLabelKey = (value: string | null | undefined): string =>
  (value && RAG_LABEL[value]) || "health_noReport";

/** A subtype's display name: an em-dash for none, the raw key when it has no definition. */
export function subtypeName(
  key: string | null | undefined,
  defs: InlineEntityLike[] | undefined,
  label: (def: InlineEntityLike | undefined) => string,
): string {
  if (!key) return "—";
  return label(defs?.find((d) => d.key === key)) || key;
}

/* ------------------------------------------------------------------ */
/*  Cost bars                                                          */
/* ------------------------------------------------------------------ */

export interface CostBarModel {
  overBudget: boolean;
  /** Width of the main fill, in percent of the track, capped at 100. */
  fillPct: number;
  /** Width of the over-budget band behind it, capped at 130. */
  overPct: number;
  unit: string;
  actualText: string;
  plannedText: string;
}

/**
 * What a mini cost bar shows, or null when there is nothing to show (both
 * sides zero). Spend against a zero plan is never "over budget": there is no
 * plan to be over.
 */
export function costBarModel(
  actual: number,
  planned: number,
  currency: string,
): CostBarModel | null {
  if (!planned && !actual) return null;
  const pct = planned > 0 ? (actual / planned) * 100 : 0;
  return {
    overBudget: actual > planned && planned > 0,
    fillPct: Math.min(pct, 100),
    overPct: Math.min(pct, 130),
    unit: costUnit(planned, actual, currency),
    actualText: fmtK(actual),
    plannedText: fmtK(planned),
  };
}

export interface CostTotals {
  capexPlanned: number;
  capexActual: number;
  opexPlanned: number;
  opexActual: number;
}

/** A group's summed costs, or null when all four sums are zero (no totals row). */
export function groupTotals(items: PpmPortfolioItem[]): CostTotals | null {
  const totals: CostTotals = { capexPlanned: 0, capexActual: 0, opexPlanned: 0, opexActual: 0 };
  for (const i of items) {
    totals.capexPlanned += money(i.capex_planned);
    totals.capexActual += money(i.capex_actual);
    totals.opexPlanned += money(i.opex_planned);
    totals.opexActual += money(i.opex_actual);
  }
  const { capexPlanned, capexActual, opexPlanned, opexActual } = totals;
  return capexPlanned || capexActual || opexPlanned || opexActual ? totals : null;
}

/** Whether a mobile card shows its cost row: any of the four figures above zero. */
export const hasAnyCost = (item: PpmPortfolioItem): boolean =>
  money(item.capex_planned) > 0 ||
  money(item.capex_actual) > 0 ||
  money(item.opex_planned) > 0 ||
  money(item.opex_actual) > 0;

/* ------------------------------------------------------------------ */
/*  Timeline                                                           */
/* ------------------------------------------------------------------ */

/** The board's rolling window: six months back to the end of the 14th month ahead. */
export interface PortfolioWindow {
  start: Date;
  end: Date;
  ms: number;
}

export function portfolioWindow(now: Date): PortfolioWindow {
  const start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 14, 0);
  return { start, end, ms: end.getTime() - start.getTime() };
}

/**
 * Where a date sits across the window, in percent clamped to 0–100; null for a
 * missing or unparseable date. The window's bounds are local Dates, so the
 * date-only argument is parsed locally too, or the two baselines disagree
 * (#1016).
 */
export function pctOf(window: PortfolioWindow, dateStr: string | null): number | null {
  const d = toLocalDate(dateStr);
  if (!d) return null;
  return Math.max(0, Math.min(100, ((d.getTime() - window.start.getTime()) / window.ms) * 100));
}

/** Where "now" sits across the window, in percent (not clamped). */
export const nowPct = (window: PortfolioWindow, now: Date): number =>
  ((now.getTime() - window.start.getTime()) / window.ms) * 100;

export interface BarModel {
  left: number;
  width: number;
  color: string;
  borderRadius: string;
}

/**
 * An initiative's Gantt bar, or null when either date is missing. A bar is at
 * least half a percent wide so a one-day initiative stays visible, takes the
 * colour of its schedule health when that is at risk or off track, and loses
 * its rounded corners on a side the window cuts off.
 */
export function barModel(item: PpmPortfolioItem, window: PortfolioWindow): BarModel | null {
  const left = pctOf(window, item.start_date);
  const end = pctOf(window, item.end_date);
  if (left === null || end === null) return null;
  const health = item.latest_report?.schedule_health;
  const color =
    health === "offTrack" ? RAG.offTrack : health === "atRisk" ? RAG.atRisk : COST_BAR_COLOR;
  const l = left <= 0 ? 0 : 8;
  const r = end >= 100 ? 0 : 8;
  return {
    left,
    width: Math.max(end - left, 0.5),
    color,
    borderRadius: `${l}px ${r}px ${r}px ${l}px`,
  };
}

/** One quarter label's horizontal extent, as measured in the browser. */
export interface LabelRect {
  left: number;
  right: number;
}

/**
 * Which quarter labels to show: a label is hidden when it starts within `gap`
 * pixels of the last visible one, or runs past the timeline's right edge.
 */
export function visibleQuarterLabels(
  rects: LabelRect[],
  containerRight: number,
  gap = 4,
): boolean[] {
  let lastRight = -Infinity;
  return rects.map((r) => {
    if (r.left < lastRight + gap || r.right > containerRight) return false;
    lastRight = r.right;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/*  Filters and groups                                                 */
/* ------------------------------------------------------------------ */

/** The distinct subtypes on the board, in first-seen order. */
export const subtypeKeys = (items: PpmPortfolioItem[]): string[] => [
  ...new Set(items.flatMap((i) => (i.subtype ? [i.subtype] : []))),
];

/**
 * Initiatives whose name contains the search, in any case, and — when a
 * subtype is picked — of that subtype.
 */
export function filterItems(
  items: PpmPortfolioItem[],
  search: string,
  subtype: string,
): PpmPortfolioItem[] {
  const s = search.toLowerCase();
  return items.filter(
    (i) => i.name.toLowerCase().includes(s) && (!subtype || i.subtype === subtype),
  );
}

export interface PortfolioGroup {
  name: string;
  items: PpmPortfolioItem[];
}

/** The id of the trailing group that holds initiatives with no group. */
export const UNGROUPED_ID = "__ungrouped";

/**
 * Initiatives grouped by their related card, groups sorted by name, with the
 * ungrouped ones last under `noGroupLabel`. An initiative needs both a group
 * id and a name to join a group.
 */
export function groupItems(
  items: PpmPortfolioItem[],
  noGroupLabel: string,
): [string, PortfolioGroup][] {
  const map = new Map<string, PortfolioGroup>();
  const ungrouped: PpmPortfolioItem[] = [];
  for (const item of items) {
    if (item.group_id && item.group_name) {
      const group = map.get(item.group_id) ?? { name: item.group_name, items: [] };
      group.items.push(item);
      map.set(item.group_id, group);
    } else {
      ungrouped.push(item);
    }
  }
  const result = [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  if (ungrouped.length) result.push([UNGROUPED_ID, { name: noGroupLabel, items: ungrouped }]);
  return result;
}

/** Collapse a group that is open, or open one that is collapsed. */
export function toggleCollapsed(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev);
  if (!next.delete(id)) next.add(id);
  return next;
}

/* ------------------------------------------------------------------ */
/*  Inside a group: hierarchy and subtype sub-groups                   */
/* ------------------------------------------------------------------ */

export { ALL_LEVELS };

/** True when some initiative on the board names a parent that is on it too. */
export const hasHierarchy = (items: PpmPortfolioItem[]): boolean =>
  items.some((i) => !!i.parent_id);

/** One rendered row of a group shown as a tree. */
export interface PortfolioRow {
  item: PpmPortfolioItem;
  /** 0 for a row whose parent is not in the same group. */
  depth: number;
  /** Has children the tree would show, i.e. the row gets a chevron. */
  hasChildren: boolean;
}

/**
 * Each item's parent within `items`, or `null`. A parent outside the set —
 * another group, filtered out, not on the board — makes the item a root, and
 * so does a cycle (impossible through the API, but an import could leave one),
 * which would otherwise make every member of it unreachable from any root.
 */
export function parentsWithin(items: PpmPortfolioItem[]): Map<string, string | null> {
  const declared = new Map(items.map((i) => [i.id, i.parent_id ?? null]));
  const inSet = (id: string | null): id is string => id !== null && declared.has(id);
  const out = new Map<string, string | null>();
  for (const i of items) {
    const parent = i.parent_id ?? null;
    if (!inSet(parent)) {
      out.set(i.id, null);
      continue;
    }
    // Walk up inside the set: reaching the item again means it sits in a cycle.
    const seen = new Set<string>();
    let cursor: string | null = parent;
    let cyclic = false;
    while (inSet(cursor) && !seen.has(cursor)) {
      if (cursor === i.id) {
        cyclic = true;
        break;
      }
      seen.add(cursor);
      cursor = declared.get(cursor) ?? null;
    }
    out.set(i.id, cyclic ? null : parent);
  }
  return out;
}

/** The group's items indexed by parent, each level sorted by name. */
function childrenOf(items: PpmPortfolioItem[]): Map<string | null, PpmPortfolioItem[]> {
  const parents = parentsWithin(items);
  const nodes = new Map(
    items.map((item) => [
      item.id,
      // Stryker disable next-line StringLiteral: TreeCard requires a type and buildChildIndex never reads it
      { id: item.id, name: item.name, type: "Initiative", parent_id: parents.get(item.id), item },
    ]),
  );
  const index = new Map<string | null, PpmPortfolioItem[]>();
  for (const [key, list] of buildChildIndex(nodes)) {
    index.set(
      key,
      list.map((n) => n.item),
    );
  }
  return index;
}

/**
 * A group's initiatives as an indented tree: depth first, siblings by name.
 * A row deeper than `maxDepth` levels is not emitted, and a collapsed parent
 * emits nothing beneath it.
 */
export function treeRows(
  items: PpmPortfolioItem[],
  { collapsed, maxDepth }: { collapsed: Set<string>; maxDepth: number },
): PortfolioRow[] {
  const byParent = childrenOf(items);
  const out: PortfolioRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const item of byParent.get(parent) ?? []) {
      const hasChildren = depth + 1 < maxDepth && (byParent.get(item.id)?.length ?? 0) > 0;
      out.push({ item, depth, hasChildren });
      if (hasChildren && !collapsed.has(item.id)) walk(item.id, depth + 1);
    }
  };
  if (maxDepth > 0) walk(null, 0);
  return out;
}

/** How many levels the deepest chain on the board spans (1 when nothing nests). */
export function maxTreeDepth(items: PpmPortfolioItem[]): number {
  let deepest = 0;
  for (const row of treeRows(items, { collapsed: new Set(), maxDepth: ALL_LEVELS })) {
    deepest = Math.max(deepest, row.depth + 1);
  }
  return deepest;
}

/** Read the depth param: a whole number of levels from 1, else every level. */
export function parseDepth(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : ALL_LEVELS;
}

/** The id a group's sub-group for one subtype gets — distinct from every group and row id. */
export const subGroupId = (groupId: string, subtype: string | null): string =>
  `${groupId}::${subtype ?? ""}`;

/**
 * A group split by subtype: one sub-group per subtype in the metamodel's
 * order, then any subtype the metamodel does not list (first seen first), and
 * the initiatives with no subtype last. Each keeps its items' order.
 */
export function subtypeSubGroups(
  groupId: string,
  items: PpmPortfolioItem[],
  subtypeOrder: string[],
  subtypeLabel: (key: string | null) => string,
): [string, PortfolioGroup][] {
  return bucketBySubtype(items, subtypeOrder).map(([key, list]) => [
    subGroupId(groupId, key),
    { name: subtypeLabel(key), items: list },
  ]);
}

/** The items of a group bucketed by subtype, in sub-group order; `null` is the no-subtype bucket. */
export function bucketBySubtype(
  items: PpmPortfolioItem[],
  subtypeOrder: string[],
): [string | null, PpmPortfolioItem[]][] {
  const buckets = new Map<string | null, PpmPortfolioItem[]>();
  for (const item of items) {
    const key = item.subtype || null;
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }
  const rank = (key: string | null) => {
    if (key === null) return Number.MAX_SAFE_INTEGER;
    const at = subtypeOrder.indexOf(key);
    return at === -1 ? subtypeOrder.length : at;
  };
  return [...buckets.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
}

/** How the rows inside each group are laid out. */
export type GroupLayout =
  | { kind: "flat" }
  | { kind: "hierarchy"; maxDepth: number }
  | { kind: "subtype"; order: string[] };

/** The layout the toggles ask for. The hierarchy wins: the two are exclusive. */
export function groupLayout(
  hierarchy: boolean,
  depth: number,
  bySubtype: boolean,
  subtypeOrder: string[],
): GroupLayout {
  if (hierarchy) return { kind: "hierarchy", maxDepth: depth };
  if (bySubtype) return { kind: "subtype", order: subtypeOrder };
  return { kind: "flat" };
}

export interface FilterState {
  groupBy: string;
  search: string;
  subtype: string;
  initialGroupBy: string;
  initialSubtype: string;
  hierarchy?: boolean;
  /** Levels shown while the hierarchy is on; `ALL_LEVELS` for every level. */
  depth?: number;
  bySubtype?: boolean;
}

/**
 * The URL after a filter change. Only a departure from the opening state is
 * carried — so a portal's configured grouping stays out of the address bar —
 * and an emptied value drops its param rather than writing "", which would
 * read back as unset. Every other param is kept.
 */
export function filterSearchParams(prev: URLSearchParams, s: FilterState): URLSearchParams {
  const next = new URLSearchParams(prev);
  const put = (key: string, value: string, opening?: string) => {
    if (value && value !== opening) next.set(key, value);
    else next.delete(key);
  };
  put("groupBy", s.groupBy, s.initialGroupBy);
  put("search", s.search);
  put("subtype", s.subtype, s.initialSubtype);
  put("hierarchy", s.hierarchy ? "1" : "");
  put("depth", s.hierarchy && s.depth && s.depth !== ALL_LEVELS ? String(s.depth) : "");
  // The two are exclusive, and the hierarchy wins.
  put("bySubtype", s.bySubtype && !s.hierarchy ? "1" : "");
  return next;
}

/** The grouping's display name: the card type's label, or the raw key when it is not offered. */
export function groupTypeLabel(
  options: PpmPortfolioGroupOption[],
  groupBy: string,
  locale: string,
): string {
  const opt = options.find((o) => o.type_key === groupBy);
  return opt
    ? typeLabel({ key: opt.type_key, label: opt.label, translations: opt.translations }, locale)
    : groupBy;
}

/* ------------------------------------------------------------------ */
/*  Print and export                                                   */
/* ------------------------------------------------------------------ */

export interface PrintState {
  groupTypeLabel: string;
  subtype: string;
  search: string;
  layout?: GroupLayout;
}

/** "Level 2", or "All levels" for the uncapped tree. */
export const depthLabel = (depth: number, t: Translate): string =>
  depth === ALL_LEVELS ? t("allLevels") : t("levelN", { n: depth });

/**
 * The parameter summary a printed board carries in place of its dropdowns.
 * The hierarchy and the subtype sub-groups appear only while they are on.
 */
export function buildPrintParams(
  s: PrintState,
  t: Translate,
  subtypeLabel: (key: string) => string,
): PrintParam[] {
  const params: PrintParam[] = [
    { label: t("groupBy"), value: s.groupTypeLabel },
    { label: t("subtype"), value: s.subtype ? subtypeLabel(s.subtype) : "" },
    { label: t("common:actions.search", { defaultValue: "Search" }), value: s.search },
  ];
  if (s.layout?.kind === "hierarchy") {
    params.push({ label: t("showHierarchy"), value: depthLabel(s.layout.maxDepth, t) });
  } else if (s.layout?.kind === "subtype") {
    params.push({ label: t("subGroupBySubtype"), value: t("printOn") });
  }
  return params;
}

/**
 * A group's initiatives in the order the board lists them under `layout`,
 * ignoring what is collapsed (the export carries every row, as it always
 * has) but honouring the depth cap, which decides what is on the board at all.
 */
export function groupRowsInOrder(items: PpmPortfolioItem[], layout: GroupLayout): PpmPortfolioItem[] {
  if (layout.kind === "hierarchy") {
    return treeRows(items, { collapsed: new Set(), maxDepth: layout.maxDepth }).map(
      (r) => r.item,
    );
  }
  if (layout.kind === "subtype") {
    return bucketBySubtype(items, layout.order).flatMap(([, list]) => list);
  }
  return items;
}

export interface ExportInput {
  groups: [string, PortfolioGroup][];
  groupTypeLabel: string;
  printParams: PrintParam[];
  chartNode: HTMLElement | null;
  layout: GroupLayout;
  /** Every initiative on the board, to name a parent the filters left out. */
  allItems: PpmPortfolioItem[];
}

/**
 * Real tabular data for the XLSX export, built from the same grouped,
 * filtered rows the grid renders, so the workbook always matches what is on
 * screen rather than scraping the Gantt bars and mini cost bars out of the
 * DOM. A withheld cost or person exports as an empty cell.
 */
export function buildPortfolioExport(
  input: ExportInput,
  t: Translate,
  subtypeLabel: (key: string) => string,
): ReportExportData {
  const columns: ExportColumn[] = [
    { key: "group", label: input.groupTypeLabel, type: "text" },
    { key: "name", label: t("initiativeName"), type: "text" },
    { key: "subtype", label: t("subtype"), type: "text" },
    { key: "pm", label: t("projectManager"), type: "text" },
    { key: "start", label: t("startDate"), type: "date" },
    { key: "end", label: t("endDate"), type: "date" },
    { key: "schedule", label: t("health_schedule"), type: "text" },
    { key: "cost", label: t("health_cost"), type: "text" },
    { key: "scope", label: t("health_scope"), type: "text" },
    { key: "capexPlanned", label: `${t("capex")} — ${t("planned")}`, type: "currency" },
    { key: "capexActual", label: `${t("capex")} — ${t("actual")}`, type: "currency" },
    { key: "opexPlanned", label: `${t("opex")} — ${t("planned")}`, type: "currency" },
    { key: "opexActual", label: `${t("opex")} — ${t("actual")}`, type: "currency" },
    { key: "lastReport", label: t("lastReport", { defaultValue: "Report" }), type: "date" },
  ];
  const { layout } = input;
  const withParent = layout.kind === "hierarchy";
  if (withParent) columns.splice(2, 0, { key: "parent", label: t("parentColumn"), type: "text" });
  const names = new Map(
    [...input.allItems, ...input.groups.flatMap(([, g]) => g.items)].map((i) => [
      i.id,
      i.name,
    ]),
  );

  const rows: Record<string, unknown>[] = [];
  for (const [, group] of input.groups) {
    for (const item of groupRowsInOrder(group.items, layout)) {
      const rep = item.latest_report;
      rows.push({
        group: group.name,
        name: item.name,
        ...(withParent ? { parent: (item.parent_id && names.get(item.parent_id)) || "" } : {}),
        subtype: item.subtype ? subtypeLabel(item.subtype) : "",
        pm: projectManager(item.stakeholders)?.display_name || "",
        start: item.start_date || "",
        end: item.end_date || "",
        schedule: t(healthLabelKey(rep?.schedule_health)),
        cost: t(healthLabelKey(rep?.cost_health)),
        scope: t(healthLabelKey(rep?.scope_health)),
        capexPlanned: item.capex_planned ?? "",
        capexActual: item.capex_actual ?? "",
        opexPlanned: item.opex_planned ?? "",
        opexActual: item.opex_actual ?? "",
        lastReport: rep ? rep.report_date : "",
      });
    }
  }

  return {
    title: t("title"),
    filterSummary: input.printParams.filter((p) => p.value),
    chartNode: input.chartNode,
    paginateRowSelector: "[data-export-row]",
    sheets: [{ name: t("tabs.portfolio"), columns, rows }],
  };
}
