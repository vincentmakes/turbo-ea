/**
 * Shared risk-matrix color helpers used by the Risk Register matrix and the
 * TurboLens Security overview matrix.
 *
 * Colors are derived from the semantic risk level (critical/high/medium/low)
 * produced by the same 4×4 probability × impact table as the backend
 * `_LEVEL_MATRIX` in `backend/app/services/risk_service.py`. The Security
 * matrix is 5×5 with an extra "unknown" row/column — those cells fall
 * through to a neutral grey.
 */
import type { RiskImpact, RiskLevel, RiskProbability } from "@/types";

const LEVEL_MATRIX: Record<RiskProbability, Record<RiskImpact, RiskLevel>> = {
  very_high: { critical: "critical", high: "critical", medium: "high", low: "medium" },
  high: { critical: "critical", high: "high", medium: "high", low: "medium" },
  medium: { critical: "high", high: "high", medium: "medium", low: "low" },
  low: { critical: "medium", high: "medium", medium: "low", low: "low" },
};

const PROBABILITY_KEYS: ReadonlySet<string> = new Set([
  "very_high",
  "high",
  "medium",
  "low",
]);
const IMPACT_KEYS: ReadonlySet<string> = new Set(["critical", "high", "medium", "low"]);

/**
 * Derive the semantic risk level for a (probability, impact/severity) pair.
 * Returns `null` when either axis is missing or uses the "unknown" sentinel
 * that only the Security matrix supports.
 */
export function deriveLevelFromPair(
  probability: string | null | undefined,
  impact: string | null | undefined,
): RiskLevel | null {
  if (!probability || !impact) return null;
  if (!PROBABILITY_KEYS.has(probability) || !IMPACT_KEYS.has(impact)) return null;
  return LEVEL_MATRIX[probability as RiskProbability][impact as RiskImpact];
}

/**
 * Background color for a matrix cell, keyed off the derived risk level.
 *
 * The color always reflects the cell's severity (probability × impact),
 * regardless of whether the cell currently holds any risks. This matches the
 * reference TurboLens Security matrix, where every cell is tinted by its
 * intrinsic risk level so the heatmap is readable even for an empty landscape.
 *
 * Only cells with an `unknown` / missing axis fall back to grey.
 */
export function riskLevelBackground(level: RiskLevel | null): string {
  switch (level) {
    case "critical":
      return "rgba(211, 47, 47, 0.28)";
    case "high":
      return "rgba(245, 124, 0, 0.24)";
    case "medium":
      return "rgba(251, 192, 45, 0.22)";
    case "low":
      return "rgba(56, 142, 60, 0.18)";
    default:
      return "rgba(117, 117, 117, 0.12)";
  }
}

/** Swatch color used by the legend — always renders at full saturation. */
export function riskLevelSwatch(level: RiskLevel): string {
  switch (level) {
    case "critical":
      return "rgba(211, 47, 47, 0.7)";
    case "high":
      return "rgba(245, 124, 0, 0.7)";
    case "medium":
      return "rgba(251, 192, 45, 0.75)";
    case "low":
      return "rgba(56, 142, 60, 0.6)";
  }
}
