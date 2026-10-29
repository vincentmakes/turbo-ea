/**
 * The built-in KPI tiles a `kpi` widget can show by name (`config.metric`),
 * and what each one needs: the shared payload it reads and the permission
 * that payload's endpoint enforces. Pure data — the registry and the KPI
 * widget both read it.
 */
import { DASHBOARD_KPI_COLORS } from "@/theme/tokens";
import { MODULE_SOURCE_PATHS, type ModuleSourceName } from "./sourceSeries";

/** A shared payload: the homepage's own reports, or a module's (`sourceSeries.ts`). */
export type SourceName = "reports.dashboard" | "my_workspace" | "admin_dashboard" | "data_quality" | ModuleSourceName;

export type KpiFamily = "overview" | "workspace" | "admin";

export interface KpiPreset {
  family: KpiFamily;
  labelKey: string;
  sources: SourceName[];
  permission?: string;
}

const overview = (labelKey: string): KpiPreset => ({
  family: "overview",
  labelKey,
  sources: ["reports.dashboard"],
  permission: "reports.ea_dashboard",
});
const workspace = (labelKey: string): KpiPreset => ({
  family: "workspace",
  labelKey,
  sources: ["my_workspace"],
});
const admin = (labelKey: string, sources: SourceName[] = ["admin_dashboard"]): KpiPreset => ({
  family: "admin",
  labelKey,
  sources,
  permission: "admin.users",
});

export const KPI_PRESETS = {
  total_cards: overview("dashboard.totalCards"),
  avg_data_quality: overview("dashboard.avgCompletion"),
  approved_count: overview("status.approved"),
  broken_count: overview("status.broken"),
  favorites: workspace("dashboard.workspace.metric.favorites"),
  stakeholder_cards: workspace("dashboard.workspace.metric.stakeholderCards"),
  open_todos: workspace("dashboard.workspace.metric.openTodos"),
  pending_surveys: workspace("dashboard.workspace.metric.pendingSurveys"),
  active_users: admin("dashboard.admin.metric.activeUsers"),
  cards_without_stakeholders: admin("dashboard.admin.metric.cardsWithoutStakeholders"),
  overdue_todos: admin("dashboard.admin.metric.overdueTodos"),
  stuck_approvals: admin("dashboard.admin.metric.stuckApprovals"),
  overall_quality: admin("dashboard.admin.metric.overallQuality", ["data_quality"]),
} as const satisfies Record<string, KpiPreset>;

export type KpiPresetKey = keyof typeof KPI_PRESETS;

export const KPI_PRESET_KEYS = Object.keys(KPI_PRESETS) as KpiPresetKey[];

export function kpiPreset(metric: unknown): KpiPreset | null {
  return typeof metric === "string" && Object.prototype.hasOwnProperty.call(KPI_PRESETS, metric)
    ? KPI_PRESETS[metric as KpiPresetKey]
    : null;
}

/** Endpoint of each shared source. */
export const SOURCE_PATHS: Record<SourceName, string> = {
  "reports.dashboard": "/reports/dashboard",
  my_workspace: "/reports/my-workspace",
  admin_dashboard: "/reports/admin-dashboard",
  data_quality: "/reports/data-quality",
  ...MODULE_SOURCE_PATHS,
};

export const SOURCE_NAMES = Object.keys(SOURCE_PATHS) as SourceName[];

export type KpiFormat = "number" | "percent";

export function formatKpiValue(value: number | null | undefined, format: KpiFormat = "number"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return format === "percent" ? `${rounded}%` : rounded;
}

export function qualityColor(pct: number): string {
  if (pct >= 75) return DASHBOARD_KPI_COLORS.qualityGood;
  if (pct >= 50) return DASHBOARD_KPI_COLORS.qualityFair;
  return DASHBOARD_KPI_COLORS.qualityPoor;
}

export type KpiSecondary = "share_of_total" | "base_count";

/** The secondary figure of a narrowed count: "12 % of 340" or "of 340". */
export function secondaryCaption(
  secondary: KpiSecondary | undefined,
  value: number | undefined,
  base: number | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
  if (!secondary || typeof base !== "number" || !Number.isFinite(base)) return null;
  if (secondary === "base_count") return t("dashboard.kpi.ofBase", { base });
  const pct = base > 0 && typeof value === "number" ? Math.round((value / base) * 100) : 0;
  return t("dashboard.kpi.shareOfBase", { pct, base });
}
