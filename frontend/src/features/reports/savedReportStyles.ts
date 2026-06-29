import type { TFunction } from "i18next";

export const REPORT_TYPE_STYLE: Record<string, { icon: string; color: string; path: string }> = {
  portfolio: { icon: "dashboard", color: "#1976d2", path: "/reports/portfolio" },
  "flexible-portfolio": {
    icon: "dashboard_customize",
    color: "#1976d2",
    path: "/reports/flexible-portfolio",
  },
  "capability-map": { icon: "grid_view", color: "#003399", path: "/reports/capability-map" },
  lifecycle: { icon: "timeline", color: "#2e7d32", path: "/reports/lifecycle" },
  dependencies: { icon: "hub", color: "#e65100", path: "/reports/dependencies" },
  cost: { icon: "payments", color: "#6a1b9a", path: "/reports/cost" },
  matrix: { icon: "table_chart", color: "#6a1b9a", path: "/reports/matrix" },
  "data-quality": { icon: "verified", color: "#00695c", path: "/reports/data-quality" },
  eol: { icon: "update", color: "#bf360c", path: "/reports/eol" },
  custom: { icon: "auto_awesome", color: "#1976d2", path: "/reports/custom" },
};

export const VISIBILITY_STYLE: Record<string, { icon: string; color: string }> = {
  private: { icon: "lock", color: "#757575" },
  public: { icon: "public", color: "#2e7d32" },
  shared: { icon: "group", color: "#1565c0" },
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
    custom: t("reports:saved.typeCustom"),
  };
}

export function getVisibilityLabels(t: TFunction): Record<string, string> {
  return {
    private: t("reports:saved.visibilityPrivate"),
    public: t("reports:saved.visibilityPublic"),
    shared: t("reports:saved.visibilityShared"),
  };
}
