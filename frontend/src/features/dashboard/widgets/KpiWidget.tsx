/**
 * A KPI tile. Either a named preset — the homepage's historical tiles, read
 * from the dashboard's shared sources and drawn exactly as before (the
 * Overview tiles with their trend arrow, the My Workspace and Admin tiles as
 * `MetricCard`s) — or a generic query KPI (`config.query`), which reads
 * `GET /dashboards/kpi` and shows its trend against the oldest snapshot in
 * the comparison window.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import MetricCard from "@/features/reports/MetricCard";
import { useApiQuery } from "@/hooks/useApiQuery";
import { DASHBOARD_KPI_COLORS } from "@/theme/tokens";
import type { DashboardKpi, DashboardQuery, KpiTrend } from "@/types";
import TrendIndicator from "../TrendIndicator";
import { useDashboardSource } from "../DashboardSources";
import { withQuery } from "../dashboardQuery";
import { formatKpiValue, kpiPreset, qualityColor, type KpiFormat, type KpiPresetKey } from "./kpiPresets";
import { widgetTitle, type WidgetProps } from "./widgetMeta";
import { useWidgetEditing } from "./WidgetFrame";

interface TileTrend {
  deltaPct: number | null;
  deltaAbs?: number | null;
  goodDirection: "up" | "down";
  comparisonDays: number;
}

interface TileProps {
  icon: string;
  iconColor: string;
  label: string;
  value: string | number;
  trend?: TileTrend | null;
  loading?: boolean;
  error?: boolean;
}

/**
 * The Overview's tile: icon + label, trend top-right, big number, window
 * caption. In customize mode the frame's toolbar takes a row of the tile's
 * height, so the tile tightens its padding and number instead of clipping
 * the caption.
 */
function KpiTile({ icon, iconColor, label, value, trend, loading, error }: TileProps) {
  const { t } = useTranslation("common");
  const compact = useWidgetEditing();
  return (
    <Card sx={{ flex: 1, height: "100%", overflow: "hidden" }} data-compact={compact || undefined}>
      <CardContent sx={{ p: compact ? 1.25 : 2, "&:last-child": { pb: compact ? 1.25 : 2 } }}>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            mb: compact ? 0.5 : 1,
            gap: 1,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
            <MaterialSymbol icon={icon} size={24} color={iconColor} />
            <Typography variant="subtitle2" color="text.secondary" noWrap>
              {label}
            </Typography>
          </Box>
          {trend && (
            <TrendIndicator deltaPct={trend.deltaPct} deltaAbs={trend.deltaAbs} goodDirection={trend.goodDirection} />
          )}
        </Box>
        {loading ? (
          <LinearProgress sx={{ my: 2 }} />
        ) : (
          <Typography variant={compact ? "h5" : "h4"} fontWeight={700}>
            {error ? "—" : value}
          </Typography>
        )}
        {error && (
          <Typography variant="caption" color="error">
            {t("errors.generic")}
          </Typography>
        )}
        {trend && !error && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: compact ? 0 : 0.5 }}>
            {t("dashboard.trend.vsDays", { count: trend.comparisonDays })}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

/** Stretches a `MetricCard` to the grid cell. */
function MetricBox({ children }: { children: ReactNode }) {
  return <Box sx={{ display: "flex", flex: 1, minHeight: 0, height: "100%" }}>{children}</Box>;
}

const OVERVIEW_TILES: Record<
  "total_cards" | "avg_data_quality" | "approved_count" | "broken_count",
  { icon: string; color: string; good: "up" | "down"; abs: boolean }
> = {
  total_cards: { icon: "inventory_2", color: DASHBOARD_KPI_COLORS.total, good: "up", abs: true },
  avg_data_quality: { icon: "pie_chart", color: DASHBOARD_KPI_COLORS.completion, good: "up", abs: false },
  approved_count: { icon: "verified", color: DASHBOARD_KPI_COLORS.approved, good: "up", abs: true },
  broken_count: { icon: "warning", color: DASHBOARD_KPI_COLORS.broken, good: "down", abs: true },
};

type OverviewMetric = keyof typeof OVERVIEW_TILES;

function OverviewKpi({ metric, label }: { metric: OverviewMetric; label: string }) {
  const { data, loading, error } = useDashboardSource("reports.dashboard");
  const tile = OVERVIEW_TILES[metric];
  let value: string | number = 0;
  if (data) {
    if (metric === "total_cards") value = data.total_cards;
    else if (metric === "avg_data_quality") value = `${data.avg_data_quality}%`;
    else if (metric === "approved_count") value = data.approval_statuses["APPROVED"] || 0;
    else value = data.approval_statuses["BROKEN"] || 0;
  }
  const trends = data?.trends;
  const kpi: KpiTrend | undefined = trends?.[metric];
  return (
    <KpiTile
      icon={tile.icon}
      iconColor={tile.color}
      label={label}
      value={value}
      loading={loading && !data}
      error={!!error && !data}
      trend={
        trends && kpi
          ? {
              deltaPct: kpi.delta_pct,
              deltaAbs: tile.abs ? kpi.delta_abs : undefined,
              goodDirection: tile.good,
              comparisonDays: trends.comparison_days,
            }
          : null
      }
    />
  );
}

const WORKSPACE_TILES: Record<
  "favorites" | "stakeholder_cards" | "open_todos" | "pending_surveys",
  { icon: string; color: string; field: "favorite_count" | "stakeholder_card_count" | "open_todo_count" | "pending_survey_count" }
> = {
  favorites: { icon: "cards_star", color: DASHBOARD_KPI_COLORS.favorites, field: "favorite_count" },
  stakeholder_cards: { icon: "groups", color: DASHBOARD_KPI_COLORS.stakeholders, field: "stakeholder_card_count" },
  open_todos: { icon: "task_alt", color: DASHBOARD_KPI_COLORS.todos, field: "open_todo_count" },
  pending_surveys: { icon: "poll", color: DASHBOARD_KPI_COLORS.surveys, field: "pending_survey_count" },
};

function WorkspaceKpi({ metric, label }: { metric: keyof typeof WORKSPACE_TILES; label: string }) {
  const { data } = useDashboardSource("my_workspace");
  const tile = WORKSPACE_TILES[metric];
  return (
    <MetricBox>
      <MetricCard icon={tile.icon} iconColor={tile.color} label={label} value={data?.[tile.field] ?? 0} />
    </MetricBox>
  );
}

type AdminMetric = "active_users" | "cards_without_stakeholders" | "overdue_todos" | "stuck_approvals";

function AdminKpi({ metric, label }: { metric: AdminMetric; label: string }) {
  const { t } = useTranslation("common");
  const { data } = useDashboardSource("admin_dashboard");
  const k = data?.kpis;
  const n = (v: number | undefined) => v ?? 0;
  let card: ReactNode;
  switch (metric) {
    case "active_users":
      card = (
        <MetricCard
          icon="trending_up"
          iconColor={DASHBOARD_KPI_COLORS.activeUsers}
          label={label}
          value={`${n(k?.active_users_30d)} / ${n(k?.total_users)}`}
          subtitle={t("dashboard.admin.metric.activeUsersSubtitle")}
        />
      );
      break;
    case "cards_without_stakeholders":
      card = (
        <MetricCard
          icon="person_off"
          iconColor={DASHBOARD_KPI_COLORS.noStakeholders}
          label={label}
          value={n(k?.cards_without_stakeholders)}
        />
      );
      break;
    case "overdue_todos":
      card = (
        <MetricCard
          icon="schedule"
          iconColor={DASHBOARD_KPI_COLORS.overdue}
          label={label}
          value={n(k?.overdue_todos_total)}
          subtitle={
            n(k?.unassigned_todo_count) > 0
              ? t("dashboard.admin.metric.unassignedTodos", { count: n(k?.unassigned_todo_count) })
              : undefined
          }
        />
      );
      break;
    case "stuck_approvals":
      card = (
        <MetricCard
          icon="hourglass_bottom"
          iconColor={DASHBOARD_KPI_COLORS.stuck}
          label={label}
          value={n(k?.stuck_approvals)}
          subtitle={
            n(k?.broken_total) > 0
              ? t("dashboard.admin.metric.brokenApprovals", { count: n(k?.broken_total) })
              : undefined
          }
        />
      );
      break;
  }
  return <MetricBox>{card}</MetricBox>;
}

function QualityKpi({ label }: { label: string }) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const { data } = useDashboardSource("data_quality");
  const pct = data?.overall_data_quality ?? 0;
  return (
    <MetricBox>
      <MetricCard
        icon="verified"
        iconColor={qualityColor(pct)}
        label={label}
        value={`${pct}%`}
        subtitle={t("dashboard.admin.metric.overallQualityLink")}
        onClick={() => navigate("/reports/data-quality")}
      />
    </MetricBox>
  );
}

function QueryKpi({
  query,
  label,
  goodDirection,
  format,
  icon,
}: {
  query: DashboardQuery;
  label: string;
  goodDirection: "up" | "down";
  format: KpiFormat;
  icon: string;
}) {
  const { data, loading, error } = useApiQuery<DashboardKpi>(withQuery("/dashboards/kpi", query));
  const trend = data?.trend;
  return (
    <KpiTile
      icon={icon}
      iconColor={DASHBOARD_KPI_COLORS.total}
      label={label}
      value={formatKpiValue(data?.value, format)}
      loading={loading && !data}
      error={!!error && !data}
      trend={
        trend
          ? {
              deltaPct: trend.delta_pct,
              // A point change of a percentage says nothing the % change does not.
              deltaAbs: format === "percent" ? undefined : trend.delta_abs,
              goodDirection,
              comparisonDays: trend.comparison_days,
            }
          : null
      }
    />
  );
}

export default function KpiWidget({ widget }: WidgetProps) {
  const { t } = useTranslation("common");
  const label = widgetTitle(widget, t);
  const config = widget.config ?? {};
  const preset = kpiPreset(config.metric);
  if (preset) {
    const metric = config.metric as KpiPresetKey;
    if (preset.family === "overview") return <OverviewKpi metric={metric as OverviewMetric} label={label} />;
    if (preset.family === "workspace") {
      return <WorkspaceKpi metric={metric as keyof typeof WORKSPACE_TILES} label={label} />;
    }
    if (metric === "overall_quality") return <QualityKpi label={label} />;
    return <AdminKpi metric={metric as AdminMetric} label={label} />;
  }
  const query = config.query as DashboardQuery | undefined;
  if (query && typeof query === "object") {
    return (
      <QueryKpi
        query={query}
        label={label}
        goodDirection={config.good_direction === "down" ? "down" : "up"}
        format={config.format === "percent" ? "percent" : "number"}
        icon={typeof config.icon === "string" && config.icon ? config.icon : "monitoring"}
      />
    );
  }
  return (
    <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
      {t("dashboard.widgets.notConfigured")}
    </Typography>
  );
}
