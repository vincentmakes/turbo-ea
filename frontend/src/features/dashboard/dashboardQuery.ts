/**
 * Pure helpers shared by the dashboard widgets: the query string a generic
 * chart / KPI widget sends, and where a click on one of its marks leads.
 */
import type { DashboardQuery } from "@/types";

/**
 * The query string of a `DashboardQuery` — entries sorted by key, empty
 * values dropped, `metric=count` dropped (it is the default). Byte-identical
 * to the backend's `metric_key`, which is what a KPI snapshot row is keyed
 * on, so the same widget always reads the same history.
 */
export function toQueryString(query: DashboardQuery | null | undefined): string {
  if (!query) return "";
  const entries = Object.entries(query)
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
  switch (dimension) {
    case "type":
      return `/inventory?type=${enc(key)}`;
    case "approval_status":
      return `/inventory?approval_status=${enc(key)}`;
    case "lifecycle_phase":
      return "/reports/lifecycle";
    case "data_quality_bucket":
      return "/reports/data-quality";
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
