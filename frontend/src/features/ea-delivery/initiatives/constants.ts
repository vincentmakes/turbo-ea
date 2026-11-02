import { brand, HEALTH_COLORS, RAG_COLORS, STATUS_COLORS } from "@/theme/tokens";

export const SOAW_STATUS_COLORS: Record<string, "default" | "warning" | "success" | "info"> = {
  draft: "default",
  in_review: "warning",
  approved: "success",
  signed: "info",
};

export const INITIATIVE_STATUS_COLORS: Record<string, string> = {
  onTrack: HEALTH_COLORS.good,
  atRisk: HEALTH_COLORS.warn,
  offTrack: RAG_COLORS.red,
  onHold: STATUS_COLORS.neutral,
  completed: brand.primary,
};
