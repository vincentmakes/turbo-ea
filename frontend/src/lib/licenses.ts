import type { TFunction } from "i18next";
import { STATUS_COLORS } from "@/theme/tokens";
import { fieldLabel } from "@/hooks/useResolveLabel";
import type { LicenseMetricItem, LicenseTypeItem, LicenseStatus, LicenseTypeStatus } from "@/types";

/** Card types that hold licenses (mirrors `LICENSE_TYPES` in the backend). */
export const LICENSE_TYPES: readonly string[] = ["Application", "ITComponent"];

export const isLicenseType = (typeKey: string): boolean => LICENSE_TYPES.includes(typeKey);

/** Highest priority first. */
export const STATUS_ORDER: readonly LicenseStatus[] = [
  "over",
  "approaching",
  "no_actual_data",
  "compliant",
];

/** The report's translation key (`reports` namespace) of each status. */
export const STATUS_LABEL_KEY: Record<LicenseStatus, string> = {
  over: "licensing.statusOver",
  approaching: "licensing.statusApproaching",
  no_actual_data: "licensing.statusNoActualData",
  compliant: "licensing.statusCompliant",
};

export function statusColor(s: LicenseStatus | LicenseTypeStatus): string {
  if (s === "over") return STATUS_COLORS.error;
  if (s === "approaching") return STATUS_COLORS.warning;
  if (s === "compliant") return STATUS_COLORS.success;
  return STATUS_COLORS.neutral;
}

/** `120 %`, the "no license" text for licensed 0 with actual > 0, or a dash with nothing to show. */
export function formatPct(pct: number | null, noLicence: boolean, t: TFunction): string {
  if (noLicence) return t("cards:licensing.noLicense");
  return pct == null ? "—" : `${pct} %`;
}

/** A (metric, type) pair as one string, e.g. `users:admin`. */
export const pairKey = (metric: string, type: string): string => `${metric}:${type}`;

/**
 * What a card can still be given in a year: the active metrics with their active types, the
 * pairs the year already holds (`held`, as `pairKey`s) left out, a metric with no type left
 * dropped. Add must never offer a held pair: writing it would overwrite that cell.
 */
export function addableCatalogue(
  catalogue: LicenseMetricItem[],
  held: ReadonlySet<string>,
): LicenseMetricItem[] {
  return catalogue
    .filter((m) => !m.archived)
    .map((m) => ({ ...m, types: m.types.filter((x) => !x.archived && !held.has(pairKey(m.key, x.key))) }))
    .filter((m) => m.types.length > 0);
}

/** `Users: Admin`, each part resolved from its own translations. */
export const pairLabel = (metric: LicenseMetricItem, type: LicenseTypeItem, locale: string): string =>
  `${fieldLabel(metric, locale)}: ${fieldLabel(type, locale)}`;
