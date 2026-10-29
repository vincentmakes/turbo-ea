/**
 * What the "Add widget" drawer offers: every widget type, plus the built-in
 * KPI tiles and charts as ready-made entries so one an admin removed can be
 * put back. Pure — the drawer renders it, the tests pin it.
 */
import { hasPermission } from "@/components/RequirePermission";
import type { DashboardWidget, WidgetType } from "@/types";
import { KPI_PRESETS, KPI_PRESET_KEYS } from "../widgets/kpiPresets";
import { seriesLabelKey, type ModuleSourceName } from "../widgets/sourceSeries";
import {
  NO_MODULES,
  WIDGET_META,
  WIDGET_TYPE_KEYS,
  widgetModule,
  widgetPermission,
  type DashboardModules,
  type WidgetFamily,
} from "../widgets/widgetMeta";

export interface CatalogueEntry {
  /** Stable id: `<type>` or `<type>:<preset>`. */
  id: string;
  type: WidgetType;
  family: WidgetFamily;
  labelKey: string;
  icon: string;
  /** The new widget's config. */
  config: Record<string, unknown>;
  /** Opens the configuration dialog before it is added. */
  needsConfig: boolean;
  /** At most one per dashboard. */
  single: boolean;
}

/** The homepage's four historical charts, offered ready-made. */
export const CHART_PRESETS: { id: string; config: Record<string, unknown> }[] = [
  {
    id: "cards_by_type",
    config: { query: { group_by: "type" }, chart: "bar", drill: true, title_key: "dashboard.cardsByType" },
  },
  {
    id: "approval_status",
    config: {
      query: { group_by: "approval_status" },
      chart: "donut",
      drill: true,
      title_key: "dashboard.approvalStatusDistribution",
    },
  },
  {
    id: "completion",
    config: {
      query: { group_by: "data_quality_bucket" },
      chart: "column",
      drill: true,
      title_key: "dashboard.completionDistribution",
    },
  },
  {
    id: "lifecycle",
    config: {
      query: { group_by: "lifecycle_phase" },
      chart: "column",
      drill: true,
      title_key: "dashboard.lifecycleOverview",
    },
  },
];

/**
 * Module tiles: one series of a module's report each (`sourceSeries.ts`),
 * offered only while the module is on and the viewer holds its permission.
 * A KPI names itself after its series (a source KPI stores no title key); a
 * chart carries its `title_key`.
 */
export const SOURCE_KPI_PRESETS: { source: ModuleSourceName; series: string; format: "number" | "percent"; icon: string }[] = [
  { source: "risks_metrics", series: "open", format: "number", icon: "report" },
  { source: "risks_metrics", series: "overdue", format: "number", icon: "event_busy" },
  { source: "compliance_overview", series: "score_avg", format: "percent", icon: "verified_user" },
  { source: "ppm_dashboard", series: "at_risk", format: "number", icon: "warning" },
  { source: "bpm_dashboard", series: "without_diagram", format: "number", icon: "account_tree" },
];

export const SOURCE_CHART_PRESETS: {
  source: ModuleSourceName;
  series: string;
  chart: string;
  titleKey: string;
}[] = [
  { source: "risks_metrics", series: "by_level", chart: "donut", titleKey: "dashboard.source.chart.risksByLevel" },
  { source: "risks_metrics", series: "by_status", chart: "column", titleKey: "dashboard.source.chart.risksByStatus" },
  {
    source: "compliance_overview",
    series: "scores",
    chart: "column",
    titleKey: "dashboard.source.chart.complianceByRegulation",
  },
  {
    source: "ppm_dashboard",
    series: "health_schedule",
    chart: "donut",
    titleKey: "dashboard.source.chart.ppmScheduleHealth",
  },
  { source: "bpm_dashboard", series: "by_maturity", chart: "column", titleKey: "dashboard.source.chart.bpmMaturity" },
];

export const FAMILY_ORDER: WidgetFamily[] = ["kpi", "chart", "overview", "workspace", "admin"];

function buildCatalogue(): CatalogueEntry[] {
  const entries: CatalogueEntry[] = [];
  entries.push({
    id: "kpi",
    type: "kpi",
    family: "kpi",
    labelKey: "dashboard.customize.customKpi",
    icon: WIDGET_META.kpi.icon,
    config: { query: {}, good_direction: "up", format: "number" },
    needsConfig: true,
    single: false,
  });
  for (const metric of KPI_PRESET_KEYS) {
    entries.push({
      id: `kpi:${metric}`,
      type: "kpi",
      family: "kpi",
      labelKey: KPI_PRESETS[metric].labelKey,
      icon: WIDGET_META.kpi.icon,
      config: { metric },
      needsConfig: false,
      single: true,
    });
  }
  for (const preset of SOURCE_KPI_PRESETS) {
    entries.push({
      id: `kpi:${preset.source}:${preset.series}`,
      type: "kpi",
      family: "kpi",
      labelKey: seriesLabelKey(preset.source, preset.series),
      icon: preset.icon,
      config: { source: preset.source, series: preset.series, format: preset.format },
      needsConfig: false,
      single: true,
    });
  }
  entries.push({
    id: "chart",
    type: "chart",
    family: "chart",
    labelKey: "dashboard.customize.customChart",
    icon: WIDGET_META.chart.icon,
    config: { query: { group_by: "type" }, chart: "bar", drill: true },
    needsConfig: true,
    single: false,
  });
  for (const preset of CHART_PRESETS) {
    entries.push({
      id: `chart:${preset.id}`,
      type: "chart",
      family: "chart",
      labelKey: preset.config.title_key as string,
      icon: WIDGET_META.chart.icon,
      config: preset.config,
      needsConfig: false,
      single: true,
    });
  }
  for (const preset of SOURCE_CHART_PRESETS) {
    entries.push({
      id: `chart:${preset.source}:${preset.series}`,
      type: "chart",
      family: "chart",
      labelKey: preset.titleKey,
      icon: WIDGET_META.chart.icon,
      config: { source: preset.source, series: preset.series, chart: preset.chart, title_key: preset.titleKey },
      needsConfig: false,
      single: true,
    });
  }
  for (const type of WIDGET_TYPE_KEYS) {
    if (type === "kpi" || type === "chart") continue;
    const meta = WIDGET_META[type];
    entries.push({
      id: type,
      type,
      family: meta.family,
      labelKey: meta.labelKey,
      icon: meta.icon,
      config: type === "recent_activity" ? { max_rows: 12 } : {},
      needsConfig: false,
      single: meta.single,
    });
  }
  return entries;
}

export const CATALOGUE: CatalogueEntry[] = buildCatalogue();

/** Whether a single-instance entry is already on the dashboard. */
export function isAlreadyAdded(entry: CatalogueEntry, widgets: Pick<DashboardWidget, "type" | "config">[]): boolean {
  if (!entry.single) return false;
  return widgets.some((w) => {
    if (w.type !== entry.type) return false;
    // A module tile is the same tile when it reads the same series.
    if (typeof entry.config.source === "string") {
      return w.config?.source === entry.config.source && w.config?.series === entry.config.series;
    }
    if (entry.type === "kpi") return w.config?.metric === entry.config.metric;
    if (entry.type === "chart") return w.config?.title_key === entry.config.title_key;
    return true;
  });
}

/** The entries the viewer may add: those whose widget they could see. */
export function catalogueFor(
  permissions: Record<string, boolean> | undefined,
  modules: DashboardModules = NO_MODULES,
): CatalogueEntry[] {
  return CATALOGUE.filter((entry) => {
    const widget = { type: entry.type, config: entry.config };
    const mod = widgetModule(widget);
    if (mod && !modules[mod]) return false;
    const perm = widgetPermission(widget);
    return perm === undefined || hasPermission(permissions, perm);
  });
}
