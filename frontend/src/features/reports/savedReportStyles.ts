import type { TFunction } from "i18next";
import {
  CARD_TYPE_COLORS,
  CATEGORICAL_COLORS,
  EOL_WARNING_COLOR,
  LIFECYCLE_PHASE_COLORS,
  MULTIPLE_VALUE_COLOR,
  RAG_COLORS,
  REPORT_ICON_COLORS,
  STATUS_COLORS,
  brand,
} from "@/theme/tokens";

export const REPORT_TYPE_STYLE: Record<string, { icon: string; color: string; path: string }> = {
  portfolio: { icon: "dashboard", color: brand.primary, path: "/reports/portfolio" },
  "flexible-portfolio": {
    icon: "dashboard_customize",
    color: brand.primary,
    path: "/reports/flexible-portfolio",
  },
  "capability-map": { icon: "grid_view", color: CARD_TYPE_COLORS.BusinessCapability, path: "/reports/capability-map" },
  lifecycle: { icon: "timeline", color: LIFECYCLE_PHASE_COLORS.active, path: "/reports/lifecycle" },
  dependencies: { icon: "hub", color: CATEGORICAL_COLORS[3], path: "/reports/dependencies" },
  cost: { icon: "payments", color: CATEGORICAL_COLORS[1], path: "/reports/cost" },
  matrix: { icon: "table_chart", color: CATEGORICAL_COLORS[1], path: "/reports/matrix" },
  "data-quality": { icon: "verified", color: REPORT_ICON_COLORS.dataQuality, path: "/reports/data-quality" },
  eol: { icon: "update", color: EOL_WARNING_COLOR, path: "/reports/eol" },
};

/** The tile colour of a saved report an installed extension contributes. */
export const EXTENSION_REPORT_COLOR = MULTIPLE_VALUE_COLOR;
/** The tile colour of a saved report whose type this build does not know. */
export const UNKNOWN_REPORT_COLOR = STATUS_COLORS.neutral;

export const VISIBILITY_STYLE: Record<string, { icon: string; color: string }> = {
  private: { icon: "lock", color: REPORT_ICON_COLORS.privateReport },
  public: { icon: "public", color: RAG_COLORS.green },
  shared: { icon: "group", color: brand.primary },
};

export function getReportTypeLabels(t: TFunction): Record<string, string> {
  return {
    portfolio: t("reports:saved.typePortfolio"),
    "flexible-portfolio": t("reports:saved.typeFlexiblePortfolio"),
    "capability-map": t("reports:saved.typeCapabilityMap"),
    lifecycle: t("reports:saved.typeLifecycle"),
    dependencies: t("reports:saved.typeDependencies"),
    cost: t("reports:saved.typeCost"),
    matrix: t("reports:saved.typeMatrix"),
    "data-quality": t("reports:saved.typeDataQuality"),
    eol: t("reports:saved.typeEol"),
  };
}

export function getVisibilityLabels(t: TFunction): Record<string, string> {
  return {
    private: t("reports:saved.visibilityPrivate"),
    public: t("reports:saved.visibilityPublic"),
    shared: t("reports:saved.visibilityShared"),
  };
}
