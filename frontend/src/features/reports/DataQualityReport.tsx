import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Alert from "@mui/material/Alert";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Legend } from "recharts";
import ReportShell from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";
import MetricCard from "./MetricCard";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useCardSubtypeLabel } from "@/hooks/useCardSubtypeLabel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useIsRtl } from "@/hooks/useIsRtl";
import { makeRtlAxisTick, rtlLegendItemStyle, mirrorChartMargin } from "@/lib/rechartsRtl";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import ReportCardListPanel, { type ReportCardListItem } from "./ReportCardListPanel";
import { buildInventoryFlagUrl, buildInventorySliceUrl } from "./portfolioInventoryLink";
import {
  bandColor,
  bandOf,
  DATA_QUALITY_BANDS,
  type DataQualityBand,
} from "@/lib/dataQualityBands";
import { useApiQuery } from "@/hooks/useApiQuery";
import { api } from "@/api/client";

interface TypeStat {
  type: string;
  total: number;
  complete: number;
  partial: number;
  minimal: number;
  avg_data_quality: number;
}

interface WorstItem {
  id: string;
  name: string;
  type: string;
  data_quality: number;
  updated_at: string | null;
}

interface DQData {
  overall_data_quality: number;
  total_items: number;
  with_lifecycle: number;
  orphaned: number;
  stale: number;
  by_type: TypeStat[];
  worst_items: WorstItem[];
}

interface DQCard {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  data_quality: number;
  updated_at: string | null;
}

interface DQCardsResponse {
  total: number;
  items: DQCard[];
}

/**
 * The slice of the dashboard the side panel is showing. `band` is one segment
 * of a stacked bar, `type` a whole bar, `flag` an orphaned/stale KPI tile.
 */
type DQScope =
  | { kind: "band"; typeKey: string; band: DataQualityBand }
  | { kind: "type"; typeKey: string }
  | { kind: "flag"; flag: "orphaned" | "stale" };

// Derived from the shared band definitions rather than restated, so the
// report's segments cannot drift from the inventory's chips of the same name.
const QUALITY_COLORS = Object.fromEntries(
  DATA_QUALITY_BANDS.map((b) => [b.key, b.color]),
) as Record<DataQualityBand, string>;

const BAND_LABEL_KEY: Record<DataQualityBand, string> = {
  complete: "dataQuality.complete",
  partial: "dataQuality.partial",
  minimal: "dataQuality.minimal",
};

function scopePath(scope: DQScope): string {
  const params = new URLSearchParams();
  if (scope.kind === "band") {
    params.set("type", scope.typeKey);
    params.set("band", scope.band);
  } else if (scope.kind === "type") {
    params.set("type", scope.typeKey);
  } else {
    params.set("scope", scope.flag);
  }
  return `/reports/data-quality/cards?${params.toString()}`;
}

function dataQualityColor(v: number): string {
  return bandColor(v);
}

function dataQualityLabelKey(v: number): string {
  return BAND_LABEL_KEY[bandOf(v)];
}

export default function DataQualityReport() {
  const { t } = useTranslation(["reports", "common"]);
  const theme = useTheme();
  const isRtl = useIsRtl();
  // The category axis reserves a fixed pixel gutter, so on a phone it has to
  // shrink or the bars get squeezed into whatever is left over.
  const isNarrow = useMediaQuery(theme.breakpoints.down("sm"));
  const axisWidth = isNarrow ? 96 : 150;
  const tickFontSize = isNarrow ? 11 : 12;
  const axisTick = { fontSize: tickFontSize, fill: theme.palette.text.secondary };
  const rtlAxisTick = makeRtlAxisTick(theme.palette.text.secondary, tickFontSize);
  const { formatDate } = useDateFormat();
  const { types } = useMetamodel();
  const typeLabel = useTypeLabel();
  const subtypeLabel = useCardSubtypeLabel();
  const saved = useSavedReport("data-quality");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() => saved.setSaveDialogOpen(true));
  const [data, setData] = useState<DQData | null>(null);
  const [sidePanelCardId, setSidePanelCardId] = useState<string | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  // Which slice the side panel is showing; null keeps `useApiQuery` idle.
  const [scope, setScope] = useState<DQScope | null>(null);

  // Keyed on user-controlled state, so it must go through the request hook —
  // a bare api.get in an effect lets a stale segment's response land last and
  // fill the panel with cards the header says you are not looking at (#882).
  const { data: panelData, loading: panelLoading } = useApiQuery<DQCardsResponse>(
    scope ? scopePath(scope) : null,
  );

  // Load saved report config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    if (cfg) {
      if (cfg.view) setView(cfg.view as "chart" | "table");
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({ view });

  // Auto-persist config to localStorage
  useEffect(() => {
    saved.persistConfig(getConfig());
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset all parameters to defaults
  const handleReset = useCallback(() => {
    saved.resetAll();
    setView("chart");
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get<DQData>("/reports/data-quality").then(setData);
  }, []);

  // Same handoff the portfolio drawer makes: the aggregate panel steps aside
  // for the single-card panel rather than stacking two drawers.
  const handlePanelItemClick = useCallback((id: string) => {
    setScope(null);
    setSidePanelCardId(id);
  }, []);

  /** Guarded because Recharts' click payload is only as reliable as the datum
   * it was built from — a click that cannot name its type opens nothing. */
  const openBand = useCallback((typeKey: string | undefined, band: DataQualityBand) => {
    if (typeKey) setScope({ kind: "band", typeKey, band });
  }, []);

  if (data === null)
    return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>;

  const lifecyclePct = data.total_items > 0 ? ((data.with_lifecycle / data.total_items) * 100).toFixed(0) : "0";
  const orphanedPct = data.total_items > 0 ? ((data.orphaned / data.total_items) * 100).toFixed(0) : "0";
  const stalePct = data.total_items > 0 ? ((data.stale / data.total_items) * 100).toFixed(0) : "0";

  // Chart data for stacked bar
  const completeLabel = t("dataQuality.complete");
  const partialLabel = t("dataQuality.partial");
  const minimalLabel = t("dataQuality.minimal");
  const chartData = data.by_type.map((bt) => ({
    name: (() => { const tp = types.find((tp) => tp.key === bt.type); return typeLabel(tp) || bt.type; })(),
    type: bt.type,
    [completeLabel]: bt.complete,
    [partialLabel]: bt.partial,
    [minimalLabel]: bt.minimal,
    avg: bt.avg_data_quality,
    total: bt.total,
  }));

  const labelForType = (key: string) => typeLabel(types.find((tp) => tp.key === key)) || key;

  // ---- Side panel ----------------------------------------------------
  const panelTitle = (() => {
    if (!scope) return "";
    if (scope.kind === "band") {
      return `${labelForType(scope.typeKey)} · ${t(BAND_LABEL_KEY[scope.band])}`;
    }
    if (scope.kind === "type") return labelForType(scope.typeKey);
    return scope.flag === "orphaned" ? t("dataQuality.orphaned") : t("dataQuality.stale");
  })();

  const panelItems: ReportCardListItem[] = (panelData?.items ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    secondary: [
      subtypeLabel(item.type, item.subtype) || labelForType(item.type),
      `${Math.round(item.data_quality)}%`,
    ].join(" · "),
    dotColor: dataQualityColor(item.data_quality),
  }));

  // Band and type slices land grouped by quality with the clicked band
  // expanded; the flag tiles land on their own inventory filter.
  const panelInventoryHref = !scope
    ? undefined
    : scope.kind === "flag"
      ? buildInventoryFlagUrl(scope.flag)
      : buildInventorySliceUrl({
          cardType: scope.typeKey,
          mode: { kind: "quality" },
          group:
            scope.kind === "band"
              ? { key: scope.band, label: t(BAND_LABEL_KEY[scope.band]) }
              : null,
        });

  const panelTotal = panelData?.total ?? 0;
  const shown = panelItems.length;

  // Alerts
  const alerts: { severity: "error" | "warning" | "info"; msg: string }[] = [];
  if (data.orphaned > 5) alerts.push({ severity: "warning", msg: t("dataQuality.orphanedAlert", { count: data.orphaned }) });
  if (data.stale > 5) alerts.push({ severity: "warning", msg: t("dataQuality.staleAlert", { count: data.stale }) });
  if (data.overall_data_quality < 50) alerts.push({ severity: "error", msg: t("dataQuality.overallAlert", { pct: data.overall_data_quality }) });

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
    if (!active || !payload) return null;
    const total = payload.reduce((s, p) => s + p.value, 0);
    return (
      <Paper sx={{ p: 1.5 }} elevation={3}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{label}</Typography>
        <Typography variant="caption" display="block" color="text.secondary">{t("dataQuality.totalItemsLabel", { count: total })}</Typography>
        {payload.map((p) => (
          <Box key={p.name} sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: p.color }} />
            <Typography variant="caption">{p.name}: {p.value} ({total > 0 ? ((p.value / total) * 100).toFixed(0) : 0}%)</Typography>
          </Box>
        ))}
      </Paper>
    );
  };

  return (
    <ReportShell
      title={t("dataQuality.title")}
      icon="verified"
      iconColor="#2e7d32"
      paginateRowSelector="[data-export-row]"
      view={view}
      onViewChange={setView}
      chartRef={chartRef}
      onSaveReport={captureAndSave}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      onReset={handleReset}
    >
      {/* Alerts */}
      {alerts.length > 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 2 }}>
          {alerts.map((a, i) => (
            <Alert key={i} severity={a.severity} variant="outlined" sx={{ py: 0 }}>
              {a.msg}
            </Alert>
          ))}
        </Box>
      )}

      {/* KPI strip */}
      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <MetricCard
          label={t("dataQuality.overallQuality")}
          value={`${data.overall_data_quality}%`}
          icon="speed"
          iconColor={dataQualityColor(data.overall_data_quality)}
          color={dataQualityColor(data.overall_data_quality)}
        />
        <MetricCard
          label={t("dataQuality.totalItems")}
          value={data.total_items}
          icon="inventory_2"
        />
        <MetricCard
          label={t("dataQuality.withLifecycle")}
          value={`${lifecyclePct}%`}
          subtitle={`${data.with_lifecycle} of ${data.total_items}`}
          icon="schedule"
          iconColor="#1976d2"
        />
        <MetricCard
          label={t("dataQuality.orphaned")}
          value={data.orphaned}
          subtitle={t("dataQuality.percentOfTotal", { pct: orphanedPct })}
          icon="link_off"
          iconColor={data.orphaned > 5 ? "#e65100" : theme.palette.text.secondary}
          onClick={() => setScope({ kind: "flag", flag: "orphaned" })}
        />
        <MetricCard
          label={t("dataQuality.stale")}
          value={data.stale}
          subtitle={t("dataQuality.percentOfTotal", { pct: stalePct })}
          icon="update_disabled"
          iconColor={data.stale > 5 ? "#e65100" : theme.palette.text.secondary}
          onClick={() => setScope({ kind: "flag", flag: "stale" })}
        />
      </Box>

      {view === "chart" ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {/* Stacked bar chart by type */}
          <Paper variant="outlined" sx={{ p: 2 }} data-export-row>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
              {t("dataQuality.completenessByType")}
            </Typography>
            <ResponsiveContainer width="100%" height={Math.max(250, chartData.length * 50)}>
              {/* No margin on the label side: Recharts draws the category axis
                  in its own `width` band *after* the margin, so a margin there
                  is dead space added on top of the axis gutter. */}
              <BarChart data={chartData} layout="vertical" margin={mirrorChartMargin({ left: 0, right: 16, top: 5, bottom: 5 }, isRtl)}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={theme.palette.divider} />
                <XAxis type="number" reversed={isRtl} tick={axisTick} />
                <YAxis type="category" dataKey="name" width={axisWidth} orientation={isRtl ? "right" : "left"} tick={isRtl ? rtlAxisTick : axisTick} />
                <RTooltip cursor={{ fill: theme.palette.action.hover }} content={<CustomTooltip />} />
                <Legend formatter={(value: string) => <span style={rtlLegendItemStyle(isRtl, theme.palette.text.primary)}>{value}</span>} />
                {/* Recharts hands the clicked datum to the Bar's onClick, so
                    each segment resolves its own type key; the band comes from
                    which Bar was clicked. */}
                <Bar
                  dataKey={completeLabel}
                  stackId="a"
                  fill={QUALITY_COLORS.complete}
                  radius={[0, 0, 0, 0]}
                  cursor="pointer"
                  onClick={(entry: { type?: string }) => openBand(entry?.type, "complete")}
                />
                <Bar
                  dataKey={partialLabel}
                  stackId="a"
                  fill={QUALITY_COLORS.partial}
                  cursor="pointer"
                  onClick={(entry: { type?: string }) => openBand(entry?.type, "partial")}
                />
                <Bar
                  dataKey={minimalLabel}
                  stackId="a"
                  fill={QUALITY_COLORS.minimal}
                  radius={isRtl ? [4, 0, 0, 4] : [0, 4, 4, 0]}
                  cursor="pointer"
                  onClick={(entry: { type?: string }) => openBand(entry?.type, "minimal")}
                />
              </BarChart>
            </ResponsiveContainer>
          </Paper>

          {/* Per-type data quality bars */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
              {t("dataQuality.avgCompletionByType")}
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              {data.by_type.map((bt) => {
                const found = types.find((tp) => tp.key === bt.type);
                const label = typeLabel(found) || bt.type;
                return (
                  <Box
                    key={bt.type}
                    data-export-row
                    onClick={() => setScope({ kind: "type", typeKey: bt.type })}
                    sx={{
                      cursor: "pointer",
                      borderRadius: 1,
                      p: 0.5,
                      mx: -0.5,
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  >
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500, fontSize: 13 }}>{label}</Typography>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Chip size="small" label={t("dataQuality.items", { count: bt.total })} variant="outlined" sx={{ height: 20, fontSize: 10 }} />
                        <Typography
                          variant="caption"
                          sx={{ fontWeight: 700, color: dataQualityColor(bt.avg_data_quality), minWidth: 36, textAlign: "right" }}
                        >
                          {bt.avg_data_quality}%
                        </Typography>
                      </Box>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={bt.avg_data_quality}
                      sx={{
                        height: 8,
                        borderRadius: 4,
                        bgcolor: "action.selected",
                        "& .MuiLinearProgress-bar": {
                          bgcolor: dataQualityColor(bt.avg_data_quality),
                          borderRadius: 4,
                        },
                      }}
                    />
                  </Box>
                );
              })}
            </Box>
          </Paper>
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {/* Type breakdown table */}
          <Paper variant="outlined" sx={{ overflow: "auto" }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, p: 2, pb: 0 }}>
              {t("dataQuality.byType")}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("common:labels.type")}</TableCell>
                  <TableCell align="right">{t("cost.total")}</TableCell>
                  <TableCell align="right">{t("dataQuality.complete")}</TableCell>
                  <TableCell align="right">{t("dataQuality.partial")}</TableCell>
                  <TableCell align="right">{t("dataQuality.minimal")}</TableCell>
                  <TableCell align="right">{t("dataQuality.avgCompletion")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.by_type.map((bt) => (
                  <TableRow key={bt.type} hover>
                    {/* Same slices as the chart's bar and its segments, so the
                        two views drill into identical panels. */}
                    <TableCell
                      sx={{ fontWeight: 500, cursor: "pointer" }}
                      onClick={() => setScope({ kind: "type", typeKey: bt.type })}
                    >
                      {labelForType(bt.type)}
                    </TableCell>
                    <TableCell align="right">{bt.total}</TableCell>
                    {DATA_QUALITY_BANDS.map((band) => (
                      <TableCell
                        key={band.key}
                        align="right"
                        sx={{ color: QUALITY_COLORS[band.key], cursor: "pointer" }}
                        onClick={() => openBand(bt.type, band.key)}
                      >
                        {bt[band.key]}
                      </TableCell>
                    ))}
                    <TableCell align="right">
                      <Chip
                        size="small"
                        label={`${bt.avg_data_quality}%`}
                        sx={{
                          bgcolor: dataQualityColor(bt.avg_data_quality),
                          color: "#fff",
                          fontWeight: 700,
                          height: 22,
                          fontSize: 11,
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>

          {/* Worst offenders */}
          <Paper variant="outlined" sx={{ overflow: "auto" }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, p: 2, pb: 0 }}>
              {t("dataQuality.lowestQuality")}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("common:labels.name")}</TableCell>
                  <TableCell>{t("common:labels.type")}</TableCell>
                  <TableCell align="right">{t("dataQuality.completion")}</TableCell>
                  <TableCell>{t("common:labels.status")}</TableCell>
                  <TableCell>{t("dataQuality.lastUpdated")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.worst_items.map((item) => (
                  <TableRow
                    key={item.id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => setSidePanelCardId(item.id)}
                  >
                    <TableCell sx={{ fontWeight: 500 }}>{item.name}</TableCell>
                    <TableCell>
                      <Chip size="small" label={(() => { const tp = types.find((tp) => tp.key === item.type); return typeLabel(tp) || item.type; })()} variant="outlined" sx={{ height: 22, fontSize: 11 }} />
                    </TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, justifyContent: "flex-end" }}>
                        <LinearProgress
                          variant="determinate"
                          value={item.data_quality}
                          sx={{
                            width: 60,
                            height: 6,
                            borderRadius: 3,
                            bgcolor: "action.selected",
                            "& .MuiLinearProgress-bar": {
                              bgcolor: dataQualityColor(item.data_quality),
                              borderRadius: 3,
                            },
                          }}
                        />
                        <Typography variant="caption" sx={{ fontWeight: 600, minWidth: 30, textAlign: "right" }}>
                          {item.data_quality}%
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={t(dataQualityLabelKey(item.data_quality))}
                        sx={{
                          bgcolor: dataQualityColor(item.data_quality),
                          color: "#fff",
                          height: 20,
                          fontSize: 10,
                          fontWeight: 600,
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {item.updated_at ? formatDate(item.updated_at) : "—"}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </Box>
      )}

      {/* Legend */}
      <Box sx={{ mt: 2, display: "flex", gap: 2, flexWrap: "wrap" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: QUALITY_COLORS.complete }} />
          <Typography variant="caption" color="text.secondary">{t("dataQuality.completeLegend")}</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: QUALITY_COLORS.partial }} />
          <Typography variant="caption" color="text.secondary">{t("dataQuality.partialLegend")}</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: QUALITY_COLORS.minimal }} />
          <Typography variant="caption" color="text.secondary">{t("dataQuality.minimalLegend")}</Typography>
        </Box>
      </Box>
      <ReportCardListPanel
        open={scope !== null}
        title={panelTitle}
        items={panelItems}
        loading={panelLoading}
        metrics={[{ value: panelTotal, label: t("common:labels.cards") }]}
        emptyLabel={t("dataQuality.noCardsInSegment")}
        truncatedLabel={
          panelTotal > shown ? t("dataQuality.showingOf", { shown, total: panelTotal }) : undefined
        }
        inventoryHref={panelInventoryHref}
        onItemClick={handlePanelItemClick}
        onClose={() => setScope(null)}
      />
      <CardDetailSidePanel
        cardId={sidePanelCardId}
        open={!!sidePanelCardId}
        onClose={() => setSidePanelCardId(null)}
      />
      <SaveReportDialog
        open={saved.saveDialogOpen}
        onClose={() => saved.setSaveDialogOpen(false)}
        reportType="data-quality"
        config={getConfig()}
        thumbnail={thumbnail}
      />
    </ReportShell>
  );
}
