/**
 * A status report's health ratings: their RAG colour and their name in
 * words. One definition for the Overview, the Status Reports tab and the
 * Initiative Report.
 */
import { useTranslation } from "react-i18next";
import { RAG_COLORS, STATUS_COLORS } from "@/theme/tokens";

/** A status report's health rating → its RAG colour. */
export const HEALTH_DOT_COLORS: Record<string, string> = {
  onTrack: RAG_COLORS.green,
  atRisk: RAG_COLORS.amber,
  offTrack: RAG_COLORS.red,
};

/** The colour of a health rating; neutral for none or an unknown one. */
export function healthColor(value: string | null | undefined): string {
  // Stryker disable next-line StringLiteral: no health is keyed by the empty string, nor by any other filler
  return HEALTH_DOT_COLORS[value || ""] || STATUS_COLORS.neutral;
}

/**
 * Names a health rating in words ("On Track"), so a state is never told by
 * colour alone; "No Report" when there is none.
 */
export function useHealthRatingLabel(): (value: string | null | undefined) => string {
  const { t } = useTranslation("ppm");
  return (value) => (value ? t(`health_${value}`, { defaultValue: value }) : t("health_noReport"));
}
