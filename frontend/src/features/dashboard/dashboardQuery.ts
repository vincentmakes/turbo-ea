/**
 * Pure helpers shared by the dashboard widgets: the query string a generic
 * chart / KPI widget sends, and where a click on one of its marks leads.
 */
import type { DashboardQuery } from "@/types";

/**
 * The canonical form of a flag list — split on commas, trimmed, empties and
 * duplicates dropped, sorted, joined with ",". The backend's validator
 * canonicalises `flags` the same way, so a query's `metric_key` never depends
 * on the order an admin picked the flags in.
 */
export function normalizeFlags(list: readonly string[] | string | null | undefined): string {
  if (list === null || list === undefined) return "";
  const parts = (typeof list === "string" ? [list] : list)
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter((item) => item !== "");
  return Array.from(new Set(parts)).sort().join(",");
}

/** The flags of a query as a list (canonical order). */
export function flagList(flags: string | null | undefined): string[] {
  const canonical = normalizeFlags(flags);
  return canonical ? canonical.split(",") : [];
}

/**
 * The query string of a `DashboardQuery` — entries sorted by key, empty
 * values dropped, `metric=count` dropped (it is the default), `flags` in
 * their canonical form. Byte-identical to the backend's `metric_key`, which
 * is what a KPI snapshot row is keyed on, so the same widget always reads the
 * same history.
 */
export function toQueryString(query: DashboardQuery | null | undefined): string {
  if (!query) return "";
  const entries = Object.entries(query)
    .map(([key, value]) => [key, key === "flags" ? normalizeFlags(value as string | null) : value] as const)
    .filter(([key, value]) => {
      if (value === undefined || value === null || value === "") return false;
      if (key === "metric" && value === "count") return false;
      return true;
    })
    .map(([key, value]) => [key, String(value)] as [string, string])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return new URLSearchParams(entries).toString();
}

/** Alias: the snapshot key of a KPI query is its query string. */
export const metricKey = toQueryString;

/** `path?qs`, or the bare path when the query is empty. */
export function withQuery(path: string, query: DashboardQuery | null | undefined, extra?: string): string {
  const qs = [toQueryString(query), extra].filter(Boolean).join("&");
  return qs ? `${path}?${qs}` : path;
}

/** The field key of a `field:<key>` dimension, or null. */
export function fieldOfDimension(dimension: string | null | undefined): string | null {
  if (!dimension || !dimension.startsWith("field:")) return null;
  const key = dimension.slice("field:".length);
  return key || null;
}

/** The relation-type side key of a `related:<rt>` dimension, or null. */
export function relationOfDimension(dimension: string | null | undefined): string | null {
  if (!dimension || !dimension.startsWith("related:")) return null;
  const key = dimension.slice("related:".length);
  return key || null;
}

/** The lifecycle phase of a `phase_month:<phase>` dimension, or null. */
export function phaseOfDimension(dimension: string | null | undefined): string | null {
  if (!dimension || !dimension.startsWith("phase_month:")) return null;
  const phase = dimension.slice("phase_month:".length);
  return phase || null;
}

/** Whether a dimension's keys are card ids (named through the response's `labels`). */
export function isCardKeyed(dimension: string | null | undefined): boolean {
  return dimension === "card" || relationOfDimension(dimension) !== null;
}

/** Keys of a card-keyed dimension that are not a card. */
const NOT_A_CARD = new Set(["", "none", "__other__"]);

/**
 * Where a click on a chart mark goes, or null when the dimension has no
 * natural destination. Reproduces the homepage's historical click-throughs
 * (type and approval status into the inventory, lifecycle and completion into
 * their reports).
 */
export function drillUrl(
  dimension: string | null | undefined,
  key: string | null | undefined,
  query: DashboardQuery | null | undefined,
): string | null {
  if (!dimension || key === null || key === undefined || key === "") return null;
  const enc = encodeURIComponent;
  if (isCardKeyed(dimension)) {
    // A card-keyed mark is one card; the "no related card" and folded rows
    // are not.
    return NOT_A_CARD.has(key) ? null : `/cards/${enc(key)}`;
  }
  if (phaseOfDimension(dimension)) return "/reports/lifecycle";
  switch (dimension) {
    case "type":
      return `/inventory?type=${enc(key)}`;
    case "approval_status":
      return `/inventory?approval_status=${enc(key)}`;
    case "lifecycle_phase":
      return "/reports/lifecycle";
    case "data_quality_bucket":
    case "eol_coverage":
      return "/reports/data-quality";
    case "stakeholders":
      // The inventory has no stakeholder filter; land on the cards in scope.
      return query?.card_type ? `/inventory?type=${enc(query.card_type)}` : "/inventory";
    case "subtype":
      // The inventory's subtype filter only means something inside one type.
      return query?.card_type
        ? `/inventory?type=${enc(query.card_type)}&subtype=${enc(key)}`
        : null;
    default: {
      // The inventory reads attribute filters as `attr_<field>=<value>`.
      const field = fieldOfDimension(dimension);
      if (field && query?.card_type) {
        return `/inventory?type=${enc(query.card_type)}&attr_${enc(field)}=${enc(key)}`;
      }
      return null;
    }
  }
}
