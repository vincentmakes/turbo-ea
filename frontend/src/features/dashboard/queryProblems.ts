/**
 * The backend's dashboard error codes (`dashboard_query.query_problem`,
 * `dashboard_service.widget_config_problem`) and the message each one shows.
 * The configuration dialog reaches the same keys through `draftProblem`
 * before it ever sends a query; this map covers a stored widget whose query
 * the server refuses (a field removed from the metamodel since, a module
 * turned off) so its tile says what is wrong instead of echoing a code.
 */
import type { TFunction } from "i18next";

/** Backend code → key under `dashboard.config.problem.`. */
export const BACKEND_PROBLEMS: Record<string, string> = {
  unknown_dimension: "unknownDimension",
  card_dimension_needs_card_type: "cardDimensionNeedsCardType",
  card_dimension_not_second: "cardDimensionNotSecond",
  relation_side_required: "relationSideRequired",
  related_needs_card_type: "relatedNeedsCardType",
  unknown_flag: "unknownFlag",
  flags_conflict: "flagsConflict",
  share_needs_filter: "shareNeedsFilter",
  query_too_long: "queryTooLong",
  metric_field_required: "metricFieldRequired",
  metric_field_unused: "metricFieldUnused",
  card_type_required: "cardTypeRequired",
  heatmap_needs_two_dimensions: "secondDimensionRequired",
  stacked_column_needs_two_dimensions: "stackedColumnNeedsTwoDimensions",
  sankey_needs_relation_type: "relationTypeRequired",
  chart_needs_query_or_source: "chartNeedsQueryOrSource",
  series_shape_mismatch: "seriesShapeMismatch",
  unknown_source: "unknownSource",
  unknown_series: "unknownSeries",
  unknown_phase: "unknownPhase",
  unknown_field: "unknownField",
  unknown_relation_type: "unknownRelationType",
  relation_type_conflict: "relationTypeConflict",
  group_by_2_requires_group_by: "dimensionRequired",
  kpi_needs_metric_query_or_source: "kpiNeedsMetricQueryOrSource",
  invalid_sparkline: "invalidSparkline",
  invalid_secondary: "invalidSecondary",
  source_chart_kind: "sourceChartKind",
  invalid_thresholds: "invalidThresholds",
  invalid_good_direction: "invalidGoodDirection",
  invalid_show_values: "invalidShowValues",
};

// Longest first, so a code that contains another is matched whole.
const CODES = Object.keys(BACKEND_PROBLEMS).sort((a, b) => b.length - a.length);

/** The problem key a failed request names, or null. */
export function problemOfError(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { message?: unknown; detail?: unknown };
  const detail = e.detail as { code?: unknown } | undefined;
  const texts = [
    typeof e.message === "string" ? e.message : "",
    typeof detail?.code === "string" ? detail.code : "",
    typeof e.detail === "string" ? e.detail : "",
  ];
  for (const code of CODES) {
    const pattern = new RegExp(`(^|[^a-z_])${code}($|[^a-z_])`);
    if (texts.some((text) => pattern.test(text))) return BACKEND_PROBLEMS[code];
  }
  return null;
}

/** What a widget whose request failed says. */
export function queryErrorMessage(err: unknown, t: TFunction): string {
  const problem = problemOfError(err);
  if (problem) return t(`dashboard.config.problem.${problem}`);
  const message = err instanceof Error ? err.message : "";
  return message || t("errors.generic");
}
