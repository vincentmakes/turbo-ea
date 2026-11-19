/**
 * What the pair bars and the pair history need from the catalogue: names, hues, groups and
 * history rows. Shared by the card's Licensing section and the Licensing report's card rows.
 */
import type { TFunction } from "i18next";
import { catalogueHues } from "@/features/reports/costColors";
import { fieldLabel } from "@/hooks/useResolveLabel";
import { shortFiscalYear } from "@/lib/costItems";
import { formatPct, pairKey, pairLabel, statusColor } from "@/lib/licenses";
import type { LicenseMetricItem, LicenseMetricResult, YearLicenses } from "@/types";
import type { PairGroup } from "./pairBarsOption";
import type { PairHistoryRow } from "./pairHistoryOption";

/** A hue per type by sort order inside its metric, archived included, so it is stable across years. */
export function pairHues(
  catalogue: LicenseMetricItem[],
  categorical: readonly string[],
  other: string,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of catalogue) {
    const keys = [...m.types].sort((a, b) => a.sort_order - b.sort_order).map((x) => x.key);
    for (const [k, color] of catalogueHues(keys, categorical, other)) out.set(pairKey(m.key, k), color);
  }
  return out;
}

/** The metric's label; an archived one carries `suffix`. The key stands in for a metric the catalogue lacks. */
export function metricName(catalogue: LicenseMetricItem[], key: string, locale: string, suffix: string): string {
  const m = catalogue.find((x) => x.key === key);
  if (!m) return key;
  return m.archived ? `${fieldLabel(m, locale)}${suffix}` : fieldLabel(m, locale);
}

export function typeName(
  catalogue: LicenseMetricItem[],
  metric: string,
  key: string,
  locale: string,
  suffix: string,
): string {
  const x = catalogue.find((m) => m.key === metric)?.types.find((tp) => tp.key === key);
  if (!x) return key;
  return x.archived ? `${fieldLabel(x, locale)}${suffix}` : fieldLabel(x, locale);
}

/** `Metric: Type`, with `suffix` once when either is archived. */
export function pairName(
  catalogue: LicenseMetricItem[],
  metric: string,
  key: string,
  locale: string,
  suffix: string,
): string {
  const m = catalogue.find((x) => x.key === metric);
  const x = m?.types.find((tp) => tp.key === key);
  if (!m || !x) return `${metric}: ${key}`;
  return `${pairLabel(m, x, locale)}${m.archived || x.archived ? suffix : ""}`;
}

export interface PairGroupOptions {
  catalogue: LicenseMetricItem[];
  locale: string;
  /** The `cards` namespace's translate function. */
  t: TFunction;
  suffix: string;
  /** The Forecast year: licensed counts only, no status. */
  forecast: boolean;
  colorOf: (metric: string, key: string) => string;
}

/** One group per metric, for `PairBars`. */
export function buildPairGroups(
  metrics: Pick<LicenseMetricResult, "metric" | "status" | "types">[],
  o: PairGroupOptions,
): PairGroup[] {
  return metrics.map((m) => ({
    metric: m.metric,
    label: metricName(o.catalogue, m.metric, o.locale, o.suffix),
    status: o.forecast ? "" : o.t(`licensing.status.${m.status}`),
    statusColor: o.forecast ? null : statusColor(m.status),
    pairs: m.types.map((r) => {
      // No percentage in the Forecast, with no actual, or when licensed is 0 and so is the use.
      const hasPct = !o.forecast && r.actual != null && (r.pct != null || r.no_licence);
      return {
        key: pairKey(m.metric, r.key),
        label: typeName(o.catalogue, m.metric, r.key, o.locale, o.suffix),
        licensed: r.licensed,
        actual: o.forecast ? null : r.actual,
        color: o.colorOf(m.metric, r.key),
        status: o.forecast ? o.t("licensing.licensedOnly") : o.t(`licensing.status.${r.status}`),
        statusColor: statusColor(r.status),
        pct: hasPct ? formatPct(r.pct, r.no_licence, o.t) : "",
      };
    }),
  }));
}

/** One pair over the years of a card's licenses; a year without the pair is `null`, not zero. */
export function pairHistoryRows(years: YearLicenses[], metric: string, key: string): PairHistoryRow[] {
  return years.map((y) => {
    const r = y.metrics.find((m) => m.metric === metric)?.types.find((tp) => tp.key === key);
    return {
      year: shortFiscalYear(y.fiscal_year),
      licensed: r?.licensed ?? null,
      actual: r?.actual ?? null,
      forecast: y.is_forecast,
    };
  });
}
