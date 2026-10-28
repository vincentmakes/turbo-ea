/**
 * The configuration dialog's model, without React: which form a widget gets,
 * the draft it edits, what makes a draft invalid, and the config a valid
 * draft saves. The rules mirror the backend's `query_problem` /
 * `widget_config_problem` (`backend/app/services/dashboard_query.py`,
 * `dashboard_service.py`), so Save is only offered for a config the server
 * accepts.
 */
import type {
  CardType,
  DashboardChartKind,
  DashboardQuery,
  DashboardWidget,
  FieldDef,
  RelationType,
} from "@/types";
import { kpiPreset } from "../widgets/kpiPresets";
import { CHART_KINDS, readChartConfig } from "../widgets/chartConfig";

/** Which form a widget's configure button opens, or null for none. */
export type ConfigKind = "title" | "kpi" | "chart" | "activity";

export function configKind(widget: Pick<DashboardWidget, "type" | "config">): ConfigKind | null {
  switch (widget.type) {
    case "kpi":
      return kpiPreset(widget.config?.metric) ? "title" : "kpi";
    case "chart":
      return "chart";
    case "recent_activity":
      return "activity";
    default:
      return null;
  }
}

export const STATIC_DIMENSIONS = [
  "type",
  "subtype",
  "approval_status",
  "lifecycle_phase",
  "data_quality_bucket",
  "created_month",
] as const;

/** Dimensions that only mean something inside one card type. */
export function needsCardType(dimension: string | null | undefined): boolean {
  return !!dimension && (dimension === "subtype" || dimension.startsWith("field:"));
}

export const APPROVAL_STATUSES = ["DRAFT", "APPROVED", "BROKEN", "REJECTED"] as const;
export const LIFECYCLE_PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"] as const;
export const ACTIVITY_FILTERS = ["all", "cards", "approvals", "relations", "comments"] as const;
export const MAX_ACTIVITY_ROWS = 50;
export const MAX_TITLE_LENGTH = 120;

const NUMERIC_TYPES = new Set(["number", "cost", "percentage"]);
const DIMENSION_FIELD_TYPES = new Set(["single_select", "boolean"]);

function fieldsOf(type: CardType | undefined): FieldDef[] {
  return (type?.fields_schema ?? []).flatMap((section) => section.fields ?? []);
}

/** A type's fields a chart can group by: single selects and booleans. */
export function dimensionFields(type: CardType | undefined): FieldDef[] {
  return fieldsOf(type).filter((f) => DIMENSION_FIELD_TYPES.has(f.type));
}

/** A type's fields a metric can add up: numbers, percentages, and costs for cost readers. */
export function numericFields(type: CardType | undefined, canViewCosts: boolean): FieldDef[] {
  return fieldsOf(type).filter((f) => NUMERIC_TYPES.has(f.type) && (canViewCosts || f.type !== "cost"));
}

/** The dimensions on offer for a card type (or for every type when none is chosen). */
export function dimensionOptions(type: CardType | undefined): string[] {
  const out: string[] = STATIC_DIMENSIONS.filter((d) => {
    if (d === "subtype") return !!type && (type.subtypes ?? []).length > 0;
    return true;
  });
  for (const field of dimensionFields(type)) out.push(`field:${field.key}`);
  return out;
}

/** A relation type whose both ends the viewer may read. */
export function readableRelationTypes(relationTypes: RelationType[], readableTypeKeys: Set<string>): RelationType[] {
  return relationTypes.filter(
    (rt) => !rt.is_hidden && readableTypeKeys.has(rt.source_type_key) && readableTypeKeys.has(rt.target_type_key),
  );
}

/** The chart kinds on offer: a sankey needs a relation type to draw. */
export function availableChartKinds(hasRelationTypes: boolean): DashboardChartKind[] {
  return CHART_KINDS.filter((k) => k !== "sankey" || hasRelationTypes);
}

export interface ConfigDraft {
  title: string;
  query: DashboardQuery;
  chart: DashboardChartKind;
  drill: boolean;
  /** Text of the numeric `max` input ("" = none). */
  max: string;
  goodDirection: "up" | "down";
  format: "number" | "percent";
  /** Text of the activity row count input. */
  maxRows: string;
  activityFilter: (typeof ACTIVITY_FILTERS)[number];
}

export function draftFromWidget(widget: DashboardWidget): ConfigDraft {
  const config = widget.config ?? {};
  const chart = readChartConfig(config);
  const kpiQuery = config.query && typeof config.query === "object" ? (config.query as DashboardQuery) : {};
  const filter = ACTIVITY_FILTERS.includes(config.filter as ConfigDraft["activityFilter"])
    ? (config.filter as ConfigDraft["activityFilter"])
    : "all";
  return {
    title: widget.title ?? "",
    query: { ...(widget.type === "kpi" ? kpiQuery : chart.query) },
    chart: chart.chart,
    drill: chart.drill,
    max: chart.max !== undefined ? String(chart.max) : "",
    goodDirection: config.good_direction === "down" ? "down" : "up",
    format: config.format === "percent" ? "percent" : "number",
    maxRows: typeof config.max_rows === "number" ? String(config.max_rows) : "12",
    activityFilter: filter,
  };
}

const blank = (v: unknown) => v === undefined || v === null || v === "";

/**
 * The query a draft saves, cleaned for its kind: empty values dropped, the
 * default `metric=count` left out, and whatever the chart kind cannot use
 * removed (a gauge has no grouping, only a heatmap a second one, a sankey
 * only its relation type).
 */
export function cleanQuery(query: DashboardQuery, kind: "kpi" | "chart", chart: DashboardChartKind): DashboardQuery {
  const q: DashboardQuery = {};
  for (const [key, value] of Object.entries(query)) {
    if (!blank(value)) (q as Record<string, unknown>)[key] = value;
  }
  if (q.metric === "count") delete q.metric;
  if (!q.metric) delete q.metric_field;
  if (kind === "kpi" || chart === "gauge") {
    delete q.group_by;
    delete q.group_by_2;
    delete q.relation_type;
  } else if (chart === "sankey") {
    // A sankey counts linked pairs; each side groups by type (the backend
    // default). Every other filter conflicts with the relation type.
    return q.relation_type ? { relation_type: q.relation_type } : {};
  } else {
    delete q.relation_type;
    if (chart !== "heatmap") delete q.group_by_2;
  }
  return q;
}

/** The i18n key (under `dashboard.config.problem.`) of the first rule a draft breaks, or null. */
export function draftProblem(kind: ConfigKind, draft: ConfigDraft): string | null {
  if (draft.title.trim().length > MAX_TITLE_LENGTH) return "titleTooLong";
  if (kind === "title") return null;
  if (kind === "activity") {
    const rows = Number(draft.maxRows);
    return Number.isInteger(rows) && rows >= 1 && rows <= MAX_ACTIVITY_ROWS ? null : "maxRowsRange";
  }
  const q = cleanQuery(draft.query, kind, draft.chart);
  if (kind === "chart" && draft.chart === "sankey") {
    return q.relation_type ? null : "relationTypeRequired";
  }
  if (kind === "chart" && draft.chart !== "gauge") {
    if (!q.group_by) return "dimensionRequired";
    if (draft.chart === "heatmap") {
      if (!q.group_by_2) return "secondDimensionRequired";
      if (q.group_by_2 === q.group_by) return "sameDimension";
    }
  }
  if (q.metric && !q.metric_field) return "metricFieldRequired";
  if (!q.card_type && (needsCardType(q.group_by) || needsCardType(q.group_by_2) || q.metric_field || q.subtype)) {
    return "cardTypeRequired";
  }
  if (kind === "chart" && draft.max.trim() !== "") {
    const max = Number(draft.max);
    if (!Number.isFinite(max) || max <= 0) return "maxPositive";
  }
  return null;
}

/** The widget a valid draft saves. */
export function widgetFromDraft(widget: DashboardWidget, kind: ConfigKind, draft: ConfigDraft): DashboardWidget {
  const title = draft.title.trim() || null;
  const base = widget.config ?? {};
  let config: Record<string, unknown>;
  switch (kind) {
    case "title":
      config = { ...base };
      break;
    case "activity":
      config = { ...base, max_rows: Number(draft.maxRows), filter: draft.activityFilter };
      break;
    case "kpi":
      config = {
        query: cleanQuery(draft.query, "kpi", draft.chart),
        good_direction: draft.goodDirection,
        format: draft.format,
      };
      if (typeof base.icon === "string") config.icon = base.icon;
      break;
    case "chart": {
      const query = cleanQuery(draft.query, "chart", draft.chart);
      config = { query, chart: draft.chart, drill: draft.drill };
      if (draft.max.trim() !== "") config.max = Number(draft.max);
      // A built-in chart names itself by an i18n key; keep it only while the
      // chart still shows what that name says.
      const original = readChartConfig(base);
      if (
        typeof base.title_key === "string" &&
        original.chart === draft.chart &&
        JSON.stringify(cleanQuery(original.query, "chart", original.chart)) === JSON.stringify(query)
      ) {
        config.title_key = base.title_key;
      }
      if (typeof base.series === "string") config.series = base.series;
      break;
    }
  }
  return { ...widget, title, config };
}
