/**
 * The configuration dialog's model, without React: which form a widget gets,
 * the draft it edits, what makes a draft invalid, and the config a valid
 * draft saves. The rules mirror the backend's `query_problem` /
 * `widget_config_problem` (`backend/app/services/dashboard_query.py`,
 * `dashboard_service.py`) — every code listed in `queryProblems.ts` — so
 * Save is only offered for a config the server accepts.
 */
import { isEolType } from "@/lib/eol";
import type {
  CardType,
  DashboardChartKind,
  LeaderboardRankBy,
  DashboardQuery,
  DashboardWidget,
  FieldDef,
  RelationType,
} from "@/types";
import {
  fieldOfDimension,
  flagList,
  normalizeFlags,
  phaseOfDimension,
  relationOfDimension,
  toQueryString,
} from "../dashboardQuery";
import { kpiPreset } from "../widgets/kpiPresets";
import {
  LEADERBOARD_MAX_ROWS,
  LEADERBOARD_MIN_CARDS,
  readLeaderboardConfig,
} from "../widgets/leaderboardConfig";
import {
  CHART_KINDS,
  PERCENT_SERIES,
  TWO_DIMENSION_KINDS,
  VALUE_LABEL_KINDS,
  isPercentMeasure,
  readChartConfig,
} from "../widgets/chartConfig";
import { isModuleSource, seriesShape } from "../widgets/sourceSeries";

/** Which form a widget's configure button opens, or null for none. */
export type ConfigKind = "title" | "kpi" | "chart" | "activity" | "source" | "leaderboard";

export function configKind(widget: Pick<DashboardWidget, "type" | "config">): ConfigKind | null {
  switch (widget.type) {
    case "kpi":
      if (kpiPreset(widget.config?.metric)) return "title";
      return isModuleSource(widget.config?.source) ? "source" : "kpi";
    case "chart":
      return isModuleSource(widget.config?.source) ? "source" : "chart";
    case "recent_activity":
      return "activity";
    case "quality_leaderboard":
      return "leaderboard";
    default:
      return null;
  }
}

/**
 * Every dimension the backend accepts that needs no metamodel key. The dialog
 * offers fewer (`dimensionOptions`): `stakeholders` and the plan / phase-in /
 * phase-out months are still accepted, so a widget saved with one keeps
 * rendering, but they are no longer on the menu.
 */
export const STATIC_DIMENSIONS = [
  "type",
  "subtype",
  "approval_status",
  "lifecycle_phase",
  "data_quality_bucket",
  "created_month",
] as const;

/** One row per card of the chosen card type (and either end of a sankey). */
export const CARD_DIMENSION = "card";

/** The lifecycle months on offer: when cards go live and when they reach end of life. */
export const PHASE_MONTH_DIMENSIONS = ["phase_month:active", "phase_month:endOfLife"] as const;

/** How the dimension menu is grouped, in order. */
export type DimensionGroup = "card" | "dates" | "fields" | "related" | "health";
export const DIMENSION_GROUPS: DimensionGroup[] = ["card", "dates", "fields", "related", "health"];

/** The menu group a dimension sits in. */
export function dimensionGroup(dimension: string): DimensionGroup {
  if (dimension === "created_month" || dimension.startsWith("phase_month:")) return "dates";
  if (dimension.startsWith("field:")) return "fields";
  if (dimension.startsWith("related:")) return "related";
  if (dimension === "eol_coverage") return "health";
  return "card";
}

/** How the measure menu is grouped: a field of the type, or a measure computed from the card. */
export type MeasureGroup = "fields" | "computed";

export function measureGroup(measure: string): MeasureGroup {
  return measure.startsWith("@") ? "computed" : "fields";
}

export const APPROVAL_STATUSES = ["DRAFT", "APPROVED", "BROKEN", "REJECTED"] as const;
export const LIFECYCLE_PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"] as const;
export const ACTIVITY_FILTERS = ["all", "cards", "approvals", "relations", "comments"] as const;
export const MAX_ACTIVITY_ROWS = 50;
export const MAX_TITLE_LENGTH = 120;
/** The longest query string the backend keys a KPI snapshot on (`metric_key`). */
export const MAX_QUERY_LENGTH = 300;

/**
 * Health and governance flags that need no relation type — every one the
 * backend accepts. The dialog offers `OFFERED_FLAGS`; the others are retired
 * from the menu but kept on a widget that already has them.
 */
export const STATIC_FLAGS = [
  "orphaned",
  "stale",
  "with_stakeholders",
  "without_stakeholders",
  "eol_linked",
  "eol_manual",
  "eol_missing",
] as const;
/** The flags on the menu, each with a one-line description (`dashboard.query.flagHelp.*`). */
export const OFFERED_FLAGS = ["orphaned", "stale", "without_stakeholders", "eol_missing"] as const;
const EOL_FLAGS = new Set(["eol_linked", "eol_manual", "eol_missing"]);
/** A has / lacks a relation flag (`related:<side>` / `unrelated:<side>`). */
const RELATION_FLAG = /^(related|unrelated):(.+)$/;

/**
 * Measures computed from a card rather than read from one of its fields.
 * `@age_days` is still accepted (a stored widget keeps rendering) but no
 * longer offered.
 */
export const DATA_QUALITY_MEASURE = "@data_quality";
export const AGE_MEASURE = "@age_days";
export const RELATIONS_MEASURE = "@relations:";

/** Dimensions that only mean something inside one card type. */
export function needsCardType(dimension: string | null | undefined): boolean {
  return (
    !!dimension && (dimension === "subtype" || dimension.startsWith("field:") || dimension.startsWith("related:"))
  );
}

/** Whether a measure needs a card type (a field of it, or a relation of it). */
export function measureNeedsCardType(field: string | null | undefined): boolean {
  if (!field) return false;
  return !field.startsWith("@") || field.startsWith(RELATIONS_MEASURE);
}

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

// ── Relation sides ───────────────────────────────────────────────────────

/** `<rt>`, `<rt>__out` or `<rt>__in` split into its relation type and direction. */
export function parseSideKey(sideKey: string): { rt: string; dir: "out" | "in" | null } {
  if (sideKey.endsWith("__out")) return { rt: sideKey.slice(0, -5), dir: "out" };
  if (sideKey.endsWith("__in")) return { rt: sideKey.slice(0, -4), dir: "in" };
  return { rt: sideKey, dir: null };
}

/**
 * How a card type names one relation type it sits on: the bare key when it
 * is one end of a cross-type relation, the `__out` / `__in` pair on a
 * self-referencing one (the `sideKey` convention of `lib/relationSort.ts`),
 * nothing when it is neither end.
 */
export function relationSideKeys(rt: RelationType, typeKey: string): string[] {
  if (rt.source_type_key === typeKey && rt.target_type_key === typeKey) return [`${rt.key}__out`, `${rt.key}__in`];
  if (rt.source_type_key === typeKey || rt.target_type_key === typeKey) return [rt.key];
  return [];
}

/**
 * The problem with a relation side key for a card type, or null — the
 * backend's `resolve_side`: an unknown or hidden relation type, or one the
 * type is not an end of (`unknownRelationType`); a bare key on a
 * self-referencing relation (`relationSideRequired`); a suffix on a
 * cross-type one (`badSuffix` — each context reports it under its own code).
 */
export function relationSideProblem(
  sideKey: string,
  typeKey: string,
  relationTypes: RelationType[],
): "unknownRelationType" | "relationSideRequired" | "badSuffix" | null {
  const exact = relationTypes.find((r) => r.key === sideKey);
  const { rt: rtKey, dir } = exact ? { rt: sideKey, dir: null } : parseSideKey(sideKey);
  const rt = exact ?? relationTypes.find((r) => r.key === rtKey);
  if (!rt || rt.is_hidden) return "unknownRelationType";
  if (rt.source_type_key === rt.target_type_key) {
    if (typeKey !== rt.source_type_key) return "unknownRelationType";
    return dir === null ? "relationSideRequired" : null;
  }
  if (dir !== null) return "badSuffix";
  if (typeKey !== rt.source_type_key && typeKey !== rt.target_type_key) return "unknownRelationType";
  return null;
}

/** The relation types a card type sits on, as side keys. */
function sideKeysFor(type: CardType | undefined, relationTypes: RelationType[]): string[] {
  if (!type) return [];
  return relationTypes.filter((rt) => !rt.is_hidden).flatMap((rt) => relationSideKeys(rt, type.key));
}

// ── Options ──────────────────────────────────────────────────────────────

/**
 * The dimensions on offer for a card type (or for every type when none is
 * chosen), in menu order: the card's own properties (each card once a type is
 * chosen), the dates, the type's fields, its related cards, its health.
 */
export function dimensionOptions(type: CardType | undefined, relationTypes: RelationType[] = []): string[] {
  const out: string[] = ["type"];
  if (type && (type.subtypes ?? []).length > 0) out.push("subtype");
  if (type) out.push(CARD_DIMENSION);
  out.push("approval_status", "lifecycle_phase", "data_quality_bucket");
  out.push("created_month", ...PHASE_MONTH_DIMENSIONS);
  for (const field of dimensionFields(type)) out.push(`field:${field.key}`);
  for (const side of sideKeysFor(type, relationTypes)) out.push(`related:${side}`);
  // EOL data exists only on the EOL types (`lib/eol.ts`).
  if (type && isEolType(type.key)) out.push("eol_coverage");
  return out;
}

/**
 * The dimensions a chart kind can group by. A heatmap or stacked columns
 * never takes `card`: the backend does not fold a grid, so one row per card
 * would be unbounded (and `card` is never a second grouping).
 */
export function chartDimensionOptions(dimensions: string[], chart: DashboardChartKind): string[] {
  return TWO_DIMENSION_KINDS.includes(chart) ? dimensions.filter((d) => d !== CARD_DIMENSION) : dimensions;
}

/** What the second grouping of a heatmap or stacked columns can be: anything but the first, or `card`. */
export function secondDimensionOptions(dimensions: string[], first: string | null | undefined): string[] {
  return dimensions.filter((d) => d !== CARD_DIMENSION && d !== first);
}

/** What one side of a sankey can group by: that side's type's own fields, and its cards. */
export function sankeySideOptions(
  rt: RelationType | undefined,
  side: "source" | "target",
  types: CardType[],
): string[] {
  if (!rt) return [];
  const typeKey = side === "source" ? rt.source_type_key : rt.target_type_key;
  const type = types.find((ct) => ct.key === typeKey);
  const out = ["type"];
  if ((type?.subtypes ?? []).length > 0) out.push("subtype");
  out.push("approval_status", "lifecycle_phase", "data_quality_bucket");
  for (const field of dimensionFields(type)) out.push(`field:${field.key}`);
  out.push("card");
  return out;
}

/** What a sum or average can measure: the type's numeric fields, then the computed measures. */
export function measureOptions(
  type: CardType | undefined,
  canViewCosts: boolean,
  relationTypes: RelationType[] = [],
): string[] {
  const out = numericFields(type, canViewCosts).map((f) => f.key);
  for (const side of sideKeysFor(type, relationTypes)) out.push(`${RELATIONS_MEASURE}${side}`);
  out.push(DATA_QUALITY_MEASURE);
  return out;
}

/**
 * What a gauge can measure — a rate or a total against a target: an average
 * only of a rate (a percentage field, the data quality), a sum of anything
 * else numeric. A count or a share takes no field.
 */
export function gaugeMeasureOptions(
  type: CardType | undefined,
  canViewCosts: boolean,
  metric: string | null | undefined,
  relationTypes: RelationType[] = [],
): string[] {
  const numeric = numericFields(type, canViewCosts);
  if (metric === "avg") {
    return [...numeric.filter((f) => f.type === "percentage").map((f) => f.key), DATA_QUALITY_MEASURE];
  }
  const out = numeric.filter((f) => f.type !== "percentage").map((f) => f.key);
  for (const side of sideKeysFor(type, relationTypes)) out.push(`${RELATIONS_MEASURE}${side}`);
  return out;
}

/** Whether an EOL flag can mean something for a card type (EOL data exists only on the EOL types). */
function eolApplies(flag: string, type: CardType | undefined): boolean {
  return !EOL_FLAGS.has(flag) || !type || isEolType(type.key);
}

/** The flags on offer for a card type: EOL flags only where EOL data can exist. */
export function flagOptions(type: CardType | undefined): string[] {
  return OFFERED_FLAGS.filter((f) => eolApplies(f, type));
}

/**
 * Whether a flag already on a widget survives a change of card type: an
 * offered flag that applies, a retired one that still does (the backend
 * still accepts it, so it is never dropped behind the admin's back), and any
 * relation flag (checked against the type on its own).
 */
export function keepsFlag(flag: string, type: CardType | undefined): boolean {
  if (RELATION_FLAG.test(flag)) return true;
  return (STATIC_FLAGS as readonly string[]).includes(flag) && eolApplies(flag, type);
}

/** The relation side keys a "has / lacks a relation" filter can use for a card type. */
export function relationPresenceOptions(type: CardType | undefined, relationTypes: RelationType[]): string[] {
  return sideKeysFor(type, relationTypes);
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

/** The chart kinds a module series can be drawn as: one number on a gauge, rows on the rest. */
export function sourceChartKinds(series: string): DashboardChartKind[] {
  if (seriesShape(series) === "single") return ["gauge"];
  return CHART_KINDS.filter((k) => k !== "gauge" && k !== "sankey" && !TWO_DIMENSION_KINDS.includes(k));
}

// ── Draft ────────────────────────────────────────────────────────────────

export type KpiSecondaryChoice = "" | "share_of_total" | "base_count";

export interface RelationPresence {
  /** A relation side key, or null for no relation filter. */
  rt: string | null;
  /** Has (`related:`) or lacks (`unrelated:`) such a relation. */
  has: boolean;
}

export interface ConfigDraft {
  title: string;
  query: DashboardQuery;
  chart: DashboardChartKind;
  drill: boolean;
  /** Print each mark's figure on the chart (offered on `VALUE_LABEL_KINDS` only). */
  showValues: boolean;
  /** Text of the numeric `max` input ("" = none). */
  max: string;
  goodDirection: "up" | "down";
  /** Text of a gauge's lower band edge ("" = none). */
  thresholdWarn: string;
  /** Text of a gauge's upper band edge ("" = none). */
  thresholdGood: string;
  format: "number" | "percent";
  /** Text of the activity (or leaderboard) row count input. */
  maxRows: string;
  /** How the leaderboard ranks people. */
  rankBy: LeaderboardRankBy;
  /** Text of the leaderboard's minimum-cards input. */
  minCards: string;
  /** The leaderboard's card-type and role key filters (empty = all). */
  leaderboardTypes: string[];
  leaderboardRoles: string[];
  /** Count only the roles that fill the data-quality stakeholder slot. */
  countingRolesOnly: boolean;
  activityFilter: (typeof ACTIVITY_FILTERS)[number];
  /** Flags other than the relation-presence one. */
  flags: string[];
  relationPresence: RelationPresence;
  sparkline: boolean;
  secondary: KpiSecondaryChoice;
}

/** Split a query's flags into the plain list and the first relation-presence flag. */
export function splitFlags(flags: string | null | undefined): { flags: string[]; relationPresence: RelationPresence } {
  const list = flagList(flags);
  const index = list.findIndex((f) => RELATION_FLAG.test(f));
  if (index < 0) return { flags: list, relationPresence: { rt: null, has: true } };
  const m = RELATION_FLAG.exec(list[index])!;
  return {
    flags: list.filter((_, i) => i !== index),
    relationPresence: { rt: m[2], has: m[1] === "related" },
  };
}

/** The relation-presence filter as a flag, or null. */
export function presenceFlag(presence: RelationPresence): string | null {
  return presence.rt ? `${presence.has ? "related" : "unrelated"}:${presence.rt}` : null;
}

/** The draft's query with its flags folded back in (canonical). */
export function draftQuery(draft: ConfigDraft): DashboardQuery {
  const flag = presenceFlag(draft.relationPresence);
  const flags = normalizeFlags([...draft.flags, ...(flag ? [flag] : [])]);
  return { ...draft.query, flags: flags || null };
}

export function draftFromWidget(widget: DashboardWidget): ConfigDraft {
  const config = widget.config ?? {};
  const chart = readChartConfig(config);
  const kpiQuery = config.query && typeof config.query === "object" ? (config.query as DashboardQuery) : {};
  const filter = ACTIVITY_FILTERS.includes(config.filter as ConfigDraft["activityFilter"])
    ? (config.filter as ConfigDraft["activityFilter"])
    : "all";
  const query: DashboardQuery = { ...(widget.type === "kpi" ? kpiQuery : chart.query) };
  const { flags, relationPresence } = splitFlags(query.flags);
  delete query.flags;
  const leaderboard = readLeaderboardConfig(config);
  const defaultRows = widget.type === "quality_leaderboard" ? leaderboard.maxRows : 12;
  return {
    title: widget.title ?? "",
    query,
    chart: chart.chart,
    drill: chart.drill,
    showValues: chart.showValues,
    max: chart.max !== undefined ? String(chart.max) : "",
    goodDirection: config.good_direction === "down" ? "down" : "up",
    thresholdWarn: chart.thresholds ? String(chart.thresholds[0]) : "",
    thresholdGood: chart.thresholds ? String(chart.thresholds[1]) : "",
    format: config.format === "percent" ? "percent" : "number",
    maxRows: typeof config.max_rows === "number" ? String(config.max_rows) : String(defaultRows),
    rankBy: leaderboard.rankBy,
    minCards: typeof config.min_cards === "number" ? String(config.min_cards) : String(leaderboard.minCards),
    leaderboardTypes: leaderboard.cardTypes,
    leaderboardRoles: leaderboard.roles,
    countingRolesOnly: leaderboard.countingRolesOnly,
    activityFilter: filter,
    flags,
    relationPresence,
    sparkline: config.sparkline === true,
    secondary: config.secondary === "share_of_total" || config.secondary === "base_count" ? config.secondary : "",
  };
}

const blank = (v: unknown) => v === undefined || v === null || v === "";

/** The keys a sankey keeps: its relation, its two sides and the filters that apply to both ends. */
const SANKEY_KEYS = ["relation_type", "group_by", "group_by_2", "approval_status", "lifecycle_phase", "flags"] as const;

/**
 * The query a draft saves, cleaned for its kind: empty values dropped, the
 * default `metric=count` left out, flags canonical, and whatever the chart
 * kind cannot use removed (a gauge has no grouping, only a heatmap or stacked
 * columns a second one, a sankey only its relation, sides and filters — a
 * side left on the default `type` is not stored).
 */
export function cleanQuery(query: DashboardQuery, kind: "kpi" | "chart", chart: DashboardChartKind): DashboardQuery {
  const q: DashboardQuery = {};
  for (const [key, value] of Object.entries(query)) {
    if (!blank(value)) (q as Record<string, unknown>)[key] = value;
  }
  if (q.flags !== undefined) {
    const flags = normalizeFlags(q.flags);
    if (flags) q.flags = flags;
    else delete q.flags;
  }
  if (q.metric === "count") delete q.metric;
  if (!q.metric || q.metric === "share") delete q.metric_field;
  if (kind === "kpi" || chart === "gauge") {
    delete q.group_by;
    delete q.group_by_2;
    delete q.relation_type;
  } else if (chart === "sankey") {
    const out: DashboardQuery = {};
    for (const key of SANKEY_KEYS) {
      if (q[key] !== undefined) (out as Record<string, unknown>)[key] = q[key];
    }
    if (out.group_by === "type") delete out.group_by;
    if (out.group_by_2 === "type") delete out.group_by_2;
    return out.relation_type ? out : {};
  } else {
    delete q.relation_type;
    if (!TWO_DIMENSION_KINDS.includes(chart)) delete q.group_by_2;
  }
  return q;
}

/** Whether a draft filters on anything the Filters section edits. */
export function hasFilters(draft: ConfigDraft): boolean {
  return !!(
    draft.query.approval_status ||
    draft.query.lifecycle_phase ||
    draft.flags.length > 0 ||
    draft.relationPresence.rt
  );
}

/** Whether a query is narrowed by a filter `share` and `base` are measured against. */
export function isNarrowed(query: DashboardQuery): boolean {
  return !!(query.approval_status || query.lifecycle_phase || normalizeFlags(query.flags));
}

/** Whether a KPI's secondary figure can be shown: a narrowed count has a base. */
export function secondaryApplies(query: DashboardQuery): boolean {
  return (!query.metric || query.metric === "count") && isNarrowed(query);
}

/** The metamodel `draftProblem` checks keys against; without it only the shape is checked. */
export interface ProblemContext {
  types: CardType[];
  relationTypes: RelationType[];
}

const PHASE_PREFIX = "phase_month:";

/** Whether the backend knows a dimension (a bad phase is `unknownPhase`, checked first). */
function isDimension(dimension: string): boolean {
  if ((STATIC_DIMENSIONS as readonly string[]).includes(dimension)) return true;
  if (dimension === "eol_coverage" || dimension === "stakeholders" || dimension === "card") return true;
  if (relationOfDimension(dimension) !== null) return true;
  if (dimension.startsWith(PHASE_PREFIX)) return (LIFECYCLE_PHASES as readonly string[]).includes(phaseOfDimension(dimension) ?? "");
  return fieldOfDimension(dimension) !== null;
}

/** Whether an `@` measure is one the backend computes. */
function isMeasure(field: string): boolean {
  return (
    field === DATA_QUALITY_MEASURE ||
    field === AGE_MEASURE ||
    (field.startsWith(RELATIONS_MEASURE) && field.length > RELATIONS_MEASURE.length)
  );
}

/** `flags_problem`: an unknown flag, or two that can never hold together. */
function flagsProblem(flags: string[]): string | null {
  if (flags.some((f) => !(STATIC_FLAGS as readonly string[]).includes(f) && !RELATION_FLAG.test(f))) {
    return "unknownFlag";
  }
  if (flags.includes("with_stakeholders") && flags.includes("without_stakeholders")) return "flagsConflict";
  if (flags.filter((f) => EOL_FLAGS.has(f)).length > 1) return "flagsConflict";
  const present = new Set<string>();
  const absent = new Set<string>();
  for (const f of flags) {
    const m = RELATION_FLAG.exec(f);
    if (m) (m[1] === "related" ? present : absent).add(m[2]);
  }
  for (const side of present) if (absent.has(side)) return "flagsConflict";
  return null;
}

/** Every relation side the query names outside `relation_type`, with the code a bad suffix reports. */
function relationSpecs(q: DashboardQuery): { side: string; badSuffix: string }[] {
  const out: { side: string; badSuffix: string }[] = [];
  for (const dim of [q.group_by, q.group_by_2]) {
    const side = relationOfDimension(dim);
    if (side) out.push({ side, badSuffix: "unknownDimension" });
  }
  if (q.metric_field?.startsWith(RELATIONS_MEASURE) && q.metric_field.length > RELATIONS_MEASURE.length) {
    out.push({ side: q.metric_field.slice(RELATIONS_MEASURE.length), badSuffix: "unknownField" });
  }
  for (const f of flagList(q.flags)) {
    const m = RELATION_FLAG.exec(f);
    if (m) out.push({ side: m[2], badSuffix: "unknownFlag" });
  }
  return out;
}

const FIELD_METRICS = new Set(["sum", "avg"]);

/**
 * `query_problem` (`backend/app/services/dashboard_query.py`), in its order,
 * over the query the draft would send.
 */
export function queryProblem(q: DashboardQuery): string | null {
  for (const dim of [q.group_by, q.group_by_2]) {
    if (!dim) continue;
    if (dim.startsWith(PHASE_PREFIX) && !(LIFECYCLE_PHASES as readonly string[]).includes(phaseOfDimension(dim) ?? "")) {
      return "unknownPhase";
    }
    if (!isDimension(dim)) return "unknownDimension";
  }
  const metric = q.metric || "count";
  if (FIELD_METRICS.has(metric) && !q.metric_field) return "metricFieldRequired";
  if (!FIELD_METRICS.has(metric) && q.metric_field) return "metricFieldUnused";
  const field = q.metric_field ?? "";
  if (field.startsWith("@") && !isMeasure(field)) return "unknownField";
  const flags = flagsProblem(flagList(q.flags));
  if (flags) return flags;
  const namesSide = relationSpecs(q).length > 0;
  if (q.relation_type) {
    if (q.card_type || q.subtype || metric !== "count" || namesSide) return "relationTypeConflict";
  } else {
    if (q.group_by_2 && !q.group_by) return "dimensionRequired";
    if (q.group_by_2 === CARD_DIMENSION) return "cardDimensionNotSecond";
    if (q.group_by === CARD_DIMENSION && !q.card_type) return "cardDimensionNeedsCardType";
    if (namesSide && !q.card_type) return "relatedNeedsCardType";
    const needsType =
      needsCardType(q.group_by) ||
      needsCardType(q.group_by_2) ||
      (field !== "" && !field.startsWith("@")) ||
      !!q.subtype;
    if (needsType && !q.card_type) return "cardTypeRequired";
  }
  if (metric === "share" && !isNarrowed(q)) return "shareNeedsFilter";
  if (toQueryString(q).length > MAX_QUERY_LENGTH) return "queryTooLong";
  return null;
}

/** The metamodel half (`resolve_query`): relation sides and a sankey side's fields. */
function metamodelProblem(q: DashboardQuery, ctx: ProblemContext): string | null {
  if (q.relation_type) {
    const rt = ctx.relationTypes.find((r) => r.key === q.relation_type);
    if (!rt) return "unknownRelationType";
    for (const [dim, side] of [
      [q.group_by, "source"],
      [q.group_by_2, "target"],
    ] as const) {
      if (dim && !sankeySideOptions(rt, side, ctx.types).includes(dim)) {
        return fieldOfDimension(dim) ? "unknownField" : "unknownDimension";
      }
    }
    return null;
  }
  for (const { side, badSuffix } of relationSpecs(q)) {
    const p = relationSideProblem(side, q.card_type ?? "", ctx.relationTypes);
    if (p === "badSuffix") return badSuffix;
    if (p) return p;
  }
  return null;
}

function positiveMax(max: string): boolean {
  if (max.trim() === "") return true;
  const n = Number(max);
  return Number.isFinite(n) && n > 0;
}

/**
 * Whether a gauge draft measures a rate on the fixed 0–100 scale (no target):
 * a share, the average data quality or of a percentage field, or a module
 * score. A percentage field is recognised only with the metamodel at hand.
 */
export function gaugeIsPercent(
  kind: ConfigKind,
  draft: ConfigDraft,
  ctx?: Pick<ProblemContext, "types">,
  widget?: Pick<DashboardWidget, "type" | "config">,
): boolean {
  if (kind === "source") return PERCENT_SERIES.has(String(widget?.config?.series ?? ""));
  return isPercentMeasure({ query: cleanQuery(draftQuery(draft), "chart", "gauge") }, ctx?.types ?? []);
}

/** A gauge's band edges as typed: both empty, or two ascending numbers within the scale. */
export function thresholdsOf(draft: ConfigDraft): [number, number] | null | "invalid" {
  const warn = draft.thresholdWarn.trim();
  const good = draft.thresholdGood.trim();
  if (warn === "" && good === "") return null;
  if (warn === "" || good === "") return "invalid";
  const pair: [number, number] = [Number(warn), Number(good)];
  return pair.every(Number.isFinite) ? pair : "invalid";
}

/**
 * A gauge's own rules: a count or sum reads against a Target, which must be
 * set and positive; the bands, when set, are two ascending numbers within
 * the scale (0–100 for a rate, else the target) — the backend's
 * `invalid_thresholds`.
 */
function gaugeProblem(draft: ConfigDraft, percent: boolean): string | null {
  if (!percent) {
    if (draft.max.trim() === "") return "targetRequired";
    if (!positiveMax(draft.max)) return "maxPositive";
  }
  const bands = thresholdsOf(draft);
  if (bands === null) return null;
  const scale = percent ? 100 : Number(draft.max);
  if (bands === "invalid" || !(bands[0] >= 0 && bands[0] < bands[1] && bands[1] <= scale)) {
    return "invalidThresholds";
  }
  return null;
}

const isIntWithin = (text: string, bounds: { min: number; max: number }) => {
  const value = Number(text);
  return text.trim() !== "" && Number.isInteger(value) && value >= bounds.min && value <= bounds.max;
};

/** A leaderboard draft's problem: the backend's `_leaderboard_problem` bounds. */
function leaderboardProblem(draft: ConfigDraft): string | null {
  if (!isIntWithin(draft.minCards, LEADERBOARD_MIN_CARDS)) return "leaderboardMinCards";
  if (!isIntWithin(draft.maxRows, LEADERBOARD_MAX_ROWS)) return "leaderboardMaxRows";
  return null;
}

/** The i18n key (under `dashboard.config.problem.`) of the first rule a draft breaks, or null. */
export function draftProblem(
  kind: ConfigKind,
  draft: ConfigDraft,
  ctx?: ProblemContext,
  widget?: Pick<DashboardWidget, "type" | "config">,
): string | null {
  if (draft.title.trim().length > MAX_TITLE_LENGTH) return "titleTooLong";
  if (kind === "title") return null;
  if (kind === "activity") {
    const rows = Number(draft.maxRows);
    return Number.isInteger(rows) && rows >= 1 && rows <= MAX_ACTIVITY_ROWS ? null : "maxRowsRange";
  }
  if (kind === "leaderboard") return leaderboardProblem(draft);
  if (kind === "source") {
    const series = typeof widget?.config?.series === "string" ? widget.config.series : "";
    if (widget?.type === "chart") {
      if (TWO_DIMENSION_KINDS.includes(draft.chart) || draft.chart === "sankey") return "sourceChartKind";
      if (!sourceChartKinds(series).includes(draft.chart)) return "seriesShapeMismatch";
      if (draft.chart === "gauge") return gaugeProblem(draft, gaugeIsPercent(kind, draft, ctx, widget));
    }
    return positiveMax(draft.max) ? null : "maxPositive";
  }

  const q = cleanQuery(draftQuery(draft), kind, draft.chart);
  const structural = queryProblem(q);
  if (structural) return structural;
  if (ctx) {
    const meta = metamodelProblem(q, ctx);
    if (meta) return meta;
  }
  if (kind === "chart") {
    if (draft.chart === "sankey") {
      if (!q.relation_type) return "relationTypeRequired";
    } else if (draft.chart !== "gauge") {
      if (!q.group_by) return "dimensionRequired";
      if (TWO_DIMENSION_KINDS.includes(draft.chart)) {
        if (!q.group_by_2) {
          return draft.chart === "heatmap" ? "secondDimensionRequired" : "stackedColumnNeedsTwoDimensions";
        }
        if (q.group_by_2 === q.group_by) return "sameDimension";
      }
    }
    if (draft.chart === "gauge") return gaugeProblem(draft, gaugeIsPercent(kind, draft, ctx));
    if (!positiveMax(draft.max)) return "maxPositive";
  }
  return null;
}

/**
 * A gauge's scale and bands on a saved config: a target (`max`) only on a
 * count or sum, the thresholds when set, the reading direction. Nothing of
 * the kind on any other chart.
 */
function applyGauge(config: Record<string, unknown>, draft: ConfigDraft, percent: boolean): void {
  delete config.thresholds;
  delete config.good_direction;
  if (draft.chart !== "gauge") return;
  if (percent) delete config.max;
  const bands = thresholdsOf(draft);
  if (Array.isArray(bands)) config.thresholds = bands;
  config.good_direction = draft.goodDirection;
}

/**
 * `show_values` on a saved chart config: written only when switched on for a
 * kind that can print values, removed otherwise — so a config that never
 * used it saves byte-identical, and switching to a line drops it.
 */
function applyShowValues(config: Record<string, unknown>, draft: ConfigDraft): void {
  if (draft.showValues && VALUE_LABEL_KINDS.has(draft.chart)) config.show_values = true;
  else delete config.show_values;
}

/** The widget a valid draft saves (`ctx` tells a percentage field's gauge from a target gauge). */
export function widgetFromDraft(
  widget: DashboardWidget,
  kind: ConfigKind,
  draft: ConfigDraft,
  ctx?: Pick<ProblemContext, "types">,
): DashboardWidget {
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
    case "leaderboard":
      // Keys only, never ids: the filters are card-type and role keys.
      config = {
        rank_by: draft.rankBy,
        min_cards: Number(draft.minCards),
        counting_roles_only: draft.countingRolesOnly,
        max_rows: Number(draft.maxRows),
      };
      if (draft.leaderboardTypes.length > 0) config.card_types = [...draft.leaderboardTypes];
      if (draft.leaderboardRoles.length > 0) config.roles = [...draft.leaderboardRoles];
      break;
    case "source":
      config = { ...base };
      if (widget.type === "chart") {
        config.chart = draft.chart;
        if (draft.max.trim() !== "") config.max = Number(draft.max);
        else delete config.max;
        applyGauge(config, draft, gaugeIsPercent(kind, draft, ctx, widget));
        applyShowValues(config, draft);
      }
      break;
    case "kpi": {
      const query = cleanQuery(draftQuery(draft), "kpi", draft.chart);
      config = {
        query,
        good_direction: draft.goodDirection,
        format: draft.format,
      };
      if (draft.sparkline) config.sparkline = true;
      if (draft.secondary && secondaryApplies(query)) config.secondary = draft.secondary;
      if (typeof base.icon === "string") config.icon = base.icon;
      break;
    }
    case "chart": {
      const query = cleanQuery(draftQuery(draft), "chart", draft.chart);
      config = { query, chart: draft.chart, drill: draft.drill };
      if (draft.max.trim() !== "") config.max = Number(draft.max);
      applyGauge(config, draft, gaugeIsPercent(kind, draft, ctx));
      applyShowValues(config, draft);
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
