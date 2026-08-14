/**
 * Data-quality bands — the single vocabulary shared by the inventory filter,
 * the inventory group-by axis and the Data Quality report.
 *
 * The report has always bucketed cards as Complete (>=80) / Partial (40-79) /
 * Minimal (<40), while the inventory facet used to be a *minimum threshold*
 * with different cut points (80 / 50 / 0, where "Poor" meant <50 and "Medium"
 * meant >=50 and therefore swallowed the complete cards too). Two vocabularies
 * for one metric made "Partial" unexpressible in the inventory and made the
 * report's segments impossible to deep-link. The bands below are the report's,
 * and they are now what the inventory filters and groups by as well; the
 * backend's `_DQ_BAND_BOUNDS` in `api/v1/reports.py` mirrors them.
 */

export type DataQualityBand = "complete" | "partial" | "minimal";

export interface DataQualityBandDef {
  key: DataQualityBand;
  /** Inclusive lower bound. */
  min: number;
  /** Exclusive upper bound; null means unbounded. */
  max: number | null;
  tKey: string;
  color: string;
}

export const DATA_QUALITY_BANDS: readonly DataQualityBandDef[] = [
  { key: "complete", min: 80, max: null, tKey: "filter.dataQualityComplete", color: "#4caf50" },
  { key: "partial", min: 40, max: 80, tKey: "filter.dataQualityPartial", color: "#ff9800" },
  { key: "minimal", min: 0, max: 40, tKey: "filter.dataQualityMinimal", color: "#f44336" },
];

const BAND_KEYS = new Set<string>(DATA_QUALITY_BANDS.map((b) => b.key));

export function isDataQualityBand(value: unknown): value is DataQualityBand {
  return typeof value === "string" && BAND_KEYS.has(value);
}

/** The band a score falls in. Treats a missing score as 0, exactly as the
 * dashboard and the grid do, so an unscored card is never bandless. */
export function bandOf(dataQuality: number | null | undefined): DataQualityBand {
  const value = dataQuality ?? 0;
  if (value >= 80) return "complete";
  if (value >= 40) return "partial";
  return "minimal";
}

const COLOR_BY_BAND = Object.fromEntries(
  DATA_QUALITY_BANDS.map((b) => [b.key, b.color]),
) as Record<DataQualityBand, string>;

/**
 * The colour a score is drawn in — the inventory grid bar, the card-detail
 * pill, a portal's score, the report's segments.
 *
 * Every one of those used to inline its own `>= 80 ? green : >= 50 ? orange`
 * ladder, which is how the grid ended up painting a 45% card red while the
 * report painted it orange. Deriving from the band table means a score can
 * only ever have one colour.
 */
export function bandColor(dataQuality: number | null | undefined): string {
  return COLOR_BY_BAND[bandOf(dataQuality)];
}

/**
 * Legacy `dataQualityMin` thresholds → bands.
 *
 * The old filter was a minimum, so "50" meant "50 and above" — which spans
 * both the partial and complete bands. Mapping it to `["complete","partial"]`
 * keeps a restored view showing the same rows it showed before; narrowing it to
 * partial alone would silently hide cards the user had been looking at.
 */
const LEGACY_MIN_TO_BANDS: Record<number, DataQualityBand[]> = {
  80: ["complete"],
  50: ["complete", "partial"],
  0: ["minimal"],
};

/**
 * Read a persisted quality filter in either shape.
 *
 * Three stores hold one: the `turboea_inventory` localStorage prefs, a saved
 * bookmark's JSONB `filters` payload, and the URL. Bookmarks in particular are
 * rows already sitting in customers' databases carrying the old
 * `dataQualityMin` number, so every read path has to come through here or those
 * saved views come back with no quality filter at all.
 */
export function normalizeDataQualityFilter(source: unknown): DataQualityBand[] {
  if (!source || typeof source !== "object") return [];
  const raw = source as { dataQualityBands?: unknown; dataQualityMin?: unknown };

  if (Array.isArray(raw.dataQualityBands)) {
    return raw.dataQualityBands.filter(isDataQualityBand);
  }
  if (typeof raw.dataQualityMin === "number") {
    return LEGACY_MIN_TO_BANDS[raw.dataQualityMin] ?? [];
  }
  return [];
}
