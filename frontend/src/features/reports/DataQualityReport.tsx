import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@mui/material/styles";
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
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { useResolveMetaLabel } from "@/hooks/useResolveLabel";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
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

const QUALITY_COLORS = {
  complete: "#4caf50",
  partial: "#ff9800",
  minimal: "#f44336",
};

function dataQualityColor(v: number): string {
  if (v >= 80) return "#4caf50";
  if (v >= 40) return "#ff9800";
  return "#f44336";
}

function dataQualityLabelKey(v: number): string {
  if (v >= 80) return "dataQuality.complete";
  if (v >= 40) return "dataQuality.partial";
  return "dataQuality.minimal";
}

export default function DataQualityReport() {
  const { t } = useTranslation(["reports", "common"]);
  const theme = useTheme();
  const { types } = useMetamodel();
  const rml = useResolveMetaLabel();
  const saved = useSavedReport("data-quality");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() => saved.setSaveDialogOpen(true));
  const [data, setData] = useState<DQData | null>(null);
  const [sidePanelCardId, setSidePanelCardId] = useState<string | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");

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
    name: (() => { const tp = types.find((tp) => tp.key === bt.type); return rml(tp?.label ?? "", tp?.translations, "label") || bt.type; })(),
    type: bt.type,
    [completeLabel]: bt.complete,
    [partialLabel]: bt.partial,
    [minimalLabel]: bt.minimal,
    avg: bt.avg_data_quality,
    total: bt.total,
  }));

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
        />
        <MetricCard
          label={t("dataQuality.stale")}
          value={data.stale}
          subtitle={t("dataQuality.percentOfTotal", { pct: stalePct })}
          icon="update_disabled"
          iconColor={data.stale > 5 ? "#e65100" : theme.palette.text.secondary}
        />
      </Box>

      {view === "chart" ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {/* Stacked bar chart by type */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
              {t("dataQuality.completenessByType")}
            </Typography>
            <ResponsiveContainer width="100%" height={Math.max(250, chartData.length * 50)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 120, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={theme.palette.divider} />
                <XAxis type="number" tick={{ fontSize: 12, fill: theme.palette.text.secondary }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12, fill: theme.palette.text.secondary }} />
                <RTooltip cursor={{ fill: theme.palette.action.hover }} content={<CustomTooltip />} />
                <Legend formatter={(value: string) => <span style={{ color: theme.palette.text.primary }}>{value}</span>} />
                <Bar dataKey={completeLabel} stackId="a" fill={QUALITY_COLORS.complete} radius={[0, 0, 0, 0]} />
                <Bar dataKey={partialLabel} stackId="a" fill={QUALITY_COLORS.partial} />
                <Bar dataKey={minimalLabel} stackId="a" fill={QUALITY_COLORS.minimal} radius={[0, 4, 4, 0]} />
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
                const label = rml(found?.label ?? "", found?.translations, "label") || bt.type;
                return (
                  <Box key={bt.type}>
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
                    <TableCell sx={{ fontWeight: 500 }}>{(() => { const tp = types.find((tp) => tp.key === bt.type); return rml(tp?.label ?? "", tp?.translations, "label") || bt.type; })()}</TableCell>
                    <TableCell align="right">{bt.total}</TableCell>
                    <TableCell align="right" sx={{ color: QUALITY_COLORS.complete }}>{bt.complete}</TableCell>
                    <TableCell align="right" sx={{ color: QUALITY_COLORS.partial }}>{bt.partial}</TableCell>
                    <TableCell align="right" sx={{ color: QUALITY_COLORS.minimal }}>{bt.minimal}</TableCell>
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
                      <Chip size="small" label={(() => { const tp = types.find((tp) => tp.key === item.type); return rml(tp?.label ?? "", tp?.translations, "label") || item.type; })()} variant="outlined" sx={{ height: 22, fontSize: 11 }} />
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
                        {item.updated_at ? new Date(item.updated_at).toLocaleDateString() : "—"}
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
