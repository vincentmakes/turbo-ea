/**
 * A KPI tile. Either a named preset — the homepage's historical tiles, read
 * from the dashboard's shared sources (the Overview tiles with their trend
 * arrow, the My Workspace and Admin tiles with their subtitles) — a generic
 * query KPI (`config.query`), which reads
 * `GET /dashboards/kpi` and shows its trend against the oldest snapshot in
 * the comparison window (plus, when configured, a 30-day sparkline and a
 * secondary figure from the query's `base`) — or one number of a module's
 * report (`config.source` + `config.series`), which has no history and so no
 * trend.
 *
 * Every one of them is drawn by `KpiTile`, the one component that carries the
 * customize-mode controls: the widget frame draws no header or card around a
 * tile, so the tile looks the same in customize mode as on the live
 * dashboard, plus the drag handle and the buttons in its own top row.
 */
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useApiQuery } from "@/hooks/useApiQuery";
import { fiscalYearLabel } from "@/lib/fiscalYear";
import { DASHBOARD_KPI_COLORS } from "@/theme/tokens";
import type { DashboardKpi, DashboardKpiHistory, DashboardQuery, KpiTrend } from "@/types";
import TrendIndicator from "../TrendIndicator";
import EChart from "@/components/charts/EChart";
import { buildSparkline } from "../charts/buildOption";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import { useDashboardSource } from "../DashboardSources";
import { withQuery } from "../dashboardQuery";
import { queryErrorMessage } from "../queryProblems";
import {
  formatKpiValue,
  kpiPreset,
  qualityColor,
  secondaryCaption,
  type KpiFormat,
  type KpiPresetKey,
  type KpiSecondary,
} from "./kpiPresets";
import { SOURCE_ICONS, extractSeries, isSourceSeries, type ModuleSourceName } from "./sourceSeries";
import { widgetTitle, type WidgetProps } from "./widgetMeta";
import { DRAG_HANDLE_CLASS, useWidgetControls, useWidgetEditing } from "./WidgetFrame";

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
  /** The error's own message (defaults to the generic one). */
  errorText?: string;
  /** A line under the number saying what it counts (the admin tiles'). */
  subtitle?: string;
  /** Extra lines under the number: the secondary figure, the fiscal year. */
  captions?: string[];
  /** A small line under the number. */
  sparkline?: ReactNode;
  /** Makes the tile a drill-down (the overall quality tile); off while arranging. */
  onClick?: () => void;
}

/**
 * The dashboard's KPI tile: icon + label, trend top-right, big number, then
 * the subtitle, captions, sparkline and trend window. In customize mode it
 * stays exactly that, plus the frame's controls in its top row — the drag
 * handle before the icon (the whole icon + label group drags), the configure
 * and remove buttons in the trend's place (the frame draws the customize-mode
 * shadow around it). A drill-down tile does not navigate while
 * arranging: a drag released on the tile, or a click on a button, would
 * otherwise open its report.
 */
function KpiTile({
  icon,
  iconColor,
  label,
  value,
  trend,
  loading,
  error,
  errorText,
  subtitle,
  captions,
  sparkline,
  onClick,
}: TileProps) {
  const { t } = useTranslation("common");
  const editing = useWidgetEditing();
  const controls = useWidgetControls();
  const click = editing ? undefined : onClick;
  return (
    <Card
      onClick={click}
      sx={{
        flex: 1,
        height: "100%",
        overflow: "hidden",
        ...(click && {
          cursor: "pointer",
          transition: "background-color 120ms",
          "&:hover": { bgcolor: "action.hover" },
        }),
      }}
    >
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 1, gap: 1 }}>
          <Box
            className={controls ? DRAG_HANDLE_CLASS : undefined}
            sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, ...(controls && { cursor: "grab" }) }}
          >
            {controls?.handle}
            <MaterialSymbol icon={icon} size={24} color={iconColor} />
            <Typography variant="subtitle2" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
              {label}
            </Typography>
          </Box>
          {(trend || controls) && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
              {/* While arranging, the buttons take the trend's place: with both,
                  a three-column tile has no room left for its own label. */}
              {trend && !controls && (
                <TrendIndicator
                  deltaPct={trend.deltaPct}
                  deltaAbs={trend.deltaAbs}
                  goodDirection={trend.goodDirection}
                />
              )}
              {controls && (
                // The 28 px buttons overhang the 24 px row instead of growing it,
                // so the tile keeps its live height.
                <Box data-testid="kpi-actions" sx={{ display: "flex", alignItems: "center", my: -0.5 }}>
                  {controls.actions}
                </Box>
              )}
            </Box>
          )}
        </Box>
        {loading ? (
          <LinearProgress sx={{ my: 2 }} />
        ) : (
          <Typography variant="h4" fontWeight={700}>
            {error ? "—" : value}
          </Typography>
        )}
        {error && (
          <Typography variant="caption" color="error">
            {errorText || t("errors.generic")}
          </Typography>
        )}
        {!error && !loading && subtitle && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }} data-testid="kpi-subtitle">
            {subtitle}
          </Typography>
        )}
        {!error &&
          !loading &&
          captions?.map((caption) => (
            <Typography key={caption} variant="caption" color="text.secondary" sx={{ display: "block" }} data-testid="kpi-caption">
              {caption}
            </Typography>
          ))}
        {!error && !loading && sparkline}
        {trend && !error && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
            {t("dashboard.trend.vsDays", { count: trend.comparisonDays })}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
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
  return <KpiTile icon={tile.icon} iconColor={tile.color} label={label} value={data?.[tile.field] ?? 0} />;
}

type AdminMetric = "active_users" | "cards_without_stakeholders" | "overdue_todos" | "stuck_approvals";

function AdminKpi({ metric, label }: { metric: AdminMetric; label: string }) {
  const { t } = useTranslation("common");
  const { data } = useDashboardSource("admin_dashboard");
  const k = data?.kpis;
  const n = (v: number | undefined) => v ?? 0;
  switch (metric) {
    case "active_users":
      return (
        <KpiTile
          icon="trending_up"
          iconColor={DASHBOARD_KPI_COLORS.activeUsers}
          label={label}
          value={`${n(k?.active_users_30d)} / ${n(k?.total_users)}`}
          subtitle={t("dashboard.admin.metric.activeUsersSubtitle")}
        />
      );
    case "cards_without_stakeholders":
      return (
        <KpiTile
          icon="person_off"
          iconColor={DASHBOARD_KPI_COLORS.noStakeholders}
          label={label}
          value={n(k?.cards_without_stakeholders)}
        />
      );
    case "overdue_todos":
      return (
        <KpiTile
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
    case "stuck_approvals":
      return (
        <KpiTile
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
  }
}

function QualityKpi({ label }: { label: string }) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const { data } = useDashboardSource("data_quality");
  const pct = data?.overall_data_quality ?? 0;
  return (
    <KpiTile
      icon="verified"
      iconColor={qualityColor(pct)}
      label={label}
      value={`${pct}%`}
      subtitle={t("dashboard.admin.metric.overallQualityLink")}
      onClick={() => navigate("/reports/data-quality")}
    />
  );
}

/** A 30-day line under a query KPI; nothing until there are two points to join. */
function KpiSparkline({ points }: { points: { date: string; value: number }[] }) {
  const theme = useEChartsTheme();
  const option = useMemo(() => buildSparkline(points, { theme, isRtl: theme.isRtl }), [points, theme]);
  if (points.length < 2) return null;
  return (
    <Box sx={{ height: 32, mt: 0.5 }} data-testid="kpi-sparkline">
      <EChart option={option} />
    </Box>
  );
}

function QueryKpi({
  query,
  label,
  goodDirection,
  format,
  icon,
  sparkline,
  secondary,
}: {
  query: DashboardQuery;
  label: string;
  goodDirection: "up" | "down";
  format: KpiFormat;
  icon: string;
  sparkline: boolean;
  secondary?: KpiSecondary;
}) {
  const { t } = useTranslation("common");
  const { data, loading, error } = useApiQuery<DashboardKpi>(withQuery("/dashboards/kpi", query));
  // The history is asked for only when the tile shows it.
  const history = useApiQuery<DashboardKpiHistory>(
    sparkline ? withQuery("/dashboards/kpi-history", query, "days=30") : null,
  );
  const points = useMemo(() => history.data?.points ?? [], [history.data]);
  const trend = data?.trend;
  // A share is a percentage whatever the tile was set to show.
  const shown: KpiFormat = query.metric === "share" ? "percent" : format;
  const captions = [
    secondaryCaption(secondary, data?.value, data?.base, t),
    typeof data?.fiscal_year === "number"
      ? t("dashboard.config.fiscalYear", { year: fiscalYearLabel(data.fiscal_year, data.fiscal_year_start ?? 1, t) })
      : null,
  ].filter((c): c is string => !!c);
  return (
    <KpiTile
      icon={icon}
      iconColor={DASHBOARD_KPI_COLORS.total}
      label={label}
      value={formatKpiValue(data?.value, shown)}
      loading={loading && !data}
      error={!!error && !data}
      errorText={error ? queryErrorMessage(error, t) : undefined}
      captions={captions}
      sparkline={sparkline && points.length >= 2 ? <KpiSparkline points={points} /> : null}
      trend={
        trend
          ? {
              deltaPct: trend.delta_pct,
              // A point change of a percentage says nothing the % change does not.
              deltaAbs: shown === "percent" ? undefined : trend.delta_abs,
              goodDirection,
              comparisonDays: trend.comparison_days,
            }
          : null
      }
    />
  );
}

/** One number of a module's report. No history is kept for it, so no trend. */
function SourceKpi({
  source,
  series,
  label,
  format,
}: {
  source: ModuleSourceName;
  series: string;
  label: string;
  format: KpiFormat;
}) {
  const { t } = useTranslation("common");
  const { data, loading, error } = useDashboardSource(source);
  const extracted = extractSeries(source, series, data);
  const value = extracted?.shape === "single" ? extracted.value : undefined;
  return (
    <KpiTile
      icon={SOURCE_ICONS[source]}
      iconColor={DASHBOARD_KPI_COLORS.total}
      label={label}
      value={formatKpiValue(value, format)}
      loading={loading && !data}
      error={!!error && !data}
      errorText={error ? queryErrorMessage(error, t) : undefined}
      trend={null}
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
  const format: KpiFormat = config.format === "percent" ? "percent" : "number";
  if (isSourceSeries(config.source, config.series)) {
    return (
      <SourceKpi
        source={config.source as ModuleSourceName}
        series={config.series as string}
        label={label}
        format={format}
      />
    );
  }
  const query = config.query as DashboardQuery | undefined;
  if (query && typeof query === "object") {
    return (
      <QueryKpi
        query={query}
        label={label}
        goodDirection={config.good_direction === "down" ? "down" : "up"}
        format={format}
        icon={typeof config.icon === "string" && config.icon ? config.icon : "monitoring"}
        sparkline={config.sparkline === true}
        secondary={
          config.secondary === "share_of_total" || config.secondary === "base_count" ? config.secondary : undefined
        }
      />
    );
  }
  return (
    <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
      {t("dashboard.widgets.notConfigured")}
    </Typography>
  );
}
