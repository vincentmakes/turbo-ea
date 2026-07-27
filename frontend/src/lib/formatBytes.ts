/**
 * Human-readable byte sizes.
 *
 * Near-identical private copies of this helper already exist in
 * `ResourcesTab`, `MigrationAdmin` and `HistoryTab`; this is the shared
 * one, used by the repository-wide Resources admin. The numeric part is
 * formatted through `Intl.NumberFormat` so a locale that uses a comma
 * decimal separator (or Eastern Arabic digits) renders correctly, and
 * the unit suffix is passed in by the caller from i18n rather than
 * hard-coded — "KB" is not universal.
 */

const UNIT_KEYS = ["b", "kb", "mb", "gb", "tb"] as const;
export type ByteUnitKey = (typeof UNIT_KEYS)[number];

export interface FormattedBytes {
  /** The scaled numeric part, already locale-formatted. */
  value: string;
  /** Which unit the value is expressed in — look the label up in i18n. */
  unit: ByteUnitKey;
}

/** Split a byte count into a locale-formatted number plus a unit key. */
export function splitBytes(bytes: number | null | undefined): FormattedBytes {
  const n = typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  let index = 0;
  let value = n;
  while (value >= 1024 && index < UNIT_KEYS.length - 1) {
    value /= 1024;
    index += 1;
  }
  // Bytes are always whole; scaled units get one decimal (0 for round values).
  const fractionDigits = index === 0 ? 0 : value >= 100 ? 0 : 1;
  return {
    value: value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: fractionDigits,
    }),
    unit: UNIT_KEYS[index],
  };
}

/**
 * Convenience wrapper for callers that have a unit-label resolver to hand
 * (typically `(unit) => t(\`resources.units.${unit}\`)`).
 */
export function formatBytes(
  bytes: number | null | undefined,
  unitLabel: (unit: ByteUnitKey) => string,
): string {
  const { value, unit } = splitBytes(bytes);
  return `${value} ${unitLabel(unit)}`;
}
