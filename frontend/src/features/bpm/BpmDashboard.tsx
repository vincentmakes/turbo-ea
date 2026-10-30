/**
 * BpmDashboard — Tabbed landing page for BPM module.
 * Tab 0: Process Navigator (Process House)
 * Tab 1: Dashboard KPIs, charts, and quick links to processes.
 */
import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Grid from "@mui/material/Grid";
import Button from "@mui/material/Button";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Chip from "@mui/material/Chip";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import LinearProgress from "@mui/material/LinearProgress";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import { usePageSection } from "@/hooks/usePageTitle";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import EChart, { type EChartClickParams } from "@/components/charts/EChart";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import { api } from "@/api/client";
import type { BpmDashboardData, DashboardKeyRow } from "@/types";
import { useProcessTypeOptions } from "./useProcessTypeOptions";
import { useBpmFieldOptions } from "./useBpmFieldOptions";
import {
  automationColumnOption,
  maturityColor,
  maturityColumnOption,
  processTypePieOption,
  riskColor,
} from "./bpmChartOptions";
import ProcessNavigator from "./ProcessNavigator";
import BpmReportsContent from "./BpmReportPage";

/**
 * A count map as chart rows, without the "unknown" bucket. Given the field's
 * option order, the rows follow it (a key the field does not define comes
 * last, in data order); without one they keep the data order.
 */
function knownRows(counts: Record<string, number>, order?: (key: string) => number): DashboardKeyRow[] {
  const rows = Object.entries(counts)
    .filter(([key]) => key !== "unknown")
    .map(([key, value]) => ({ key, value }));
  return order ? rows.sort((a, b) => order(a.key) - order(b.key)) : rows;
}

/** The stored option key a chart click landed on. */
function clickedKey(p: EChartClickParams): string | undefined {
  return (p.data as { key?: string } | undefined)?.key;
}

/* ── Dashboard content (tab 1) ── */
function BpmDashboardContent() {
  const { t } = useTranslation(["bpm", "common"]);
  const theme = useTheme();
  const navigate = useNavigate();
  const chartTheme = useEChartsTheme();
  const { resolve: resolveProcessType } = useProcessTypeOptions();
  // Every chart follows its field's option order (hidden options keep their
  // place), a key the field does not define last, in data order.
  const { order: processTypeOrder } = useBpmFieldOptions("processType");
  const { resolve: resolveMaturity, order: maturityOrder } = useBpmFieldOptions("maturity");
  const { resolve: resolveAutomation, order: automationOrder } = useBpmFieldOptions("automationLevel");
  const { resolve: resolveRisk } = useBpmFieldOptions("riskLevel");
  const [data, setData] = useState<BpmDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidePanelCardId, setSidePanelCardId] = useState<string | null>(null);

  useEffect(() => {
    api.get<BpmDashboardData>("/reports/bpm/dashboard")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const seriesName = t("dashboard.processes");
  // Built before the loading / failure returns (hooks run every render);
  // empty until the dashboard arrives.
  const charts = useMemo(
    () => ({
      processType: processTypePieOption(knownRows(data?.by_process_type ?? {}, processTypeOrder), {
        chrome: chartTheme,
        isRtl: chartTheme.isRtl,
        label: (key) => resolveProcessType(key).label,
        color: (key) => resolveProcessType(key).color,
        seriesName,
      }),
      maturity: maturityColumnOption(knownRows(data?.by_maturity ?? {}, maturityOrder), {
        chrome: chartTheme,
        isRtl: chartTheme.isRtl,
        label: (key) => resolveMaturity(key).label,
        color: (key) => maturityColor(key, resolveMaturity(key).color),
        seriesName,
      }),
      automation: automationColumnOption(knownRows(data?.by_automation ?? {}, automationOrder), {
        chrome: chartTheme,
        isRtl: chartTheme.isRtl,
        label: (key) => resolveAutomation(key).label,
        seriesName,
      }),
    }),
    [
      data,
      chartTheme,
      resolveProcessType,
      processTypeOrder,
      resolveMaturity,
      maturityOrder,
      resolveAutomation,
      automationOrder,
      seriesName,
    ],
  );

  if (loading) return <LinearProgress />;
  if (!data) return <Typography>{t("dashboard.loadFailed")}</Typography>;

  const drillDown = (attr: string) => (p: EChartClickParams) => {
    const key = clickedKey(p);
    if (key) navigate(`/inventory?type=BusinessProcess&attr_${attr}=${encodeURIComponent(key)}`);
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
        <Button
          variant="outlined"
          onClick={() => navigate("/inventory?type=BusinessProcess")}
          startIcon={<MaterialSymbol icon="list" />}
        >
          {t("dashboard.allProcesses")}
        </Button>
      </Box>

      {/* KPI Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}>
          <Card>
            <CardContent sx={{ textAlign: "center" }}>
              <Typography variant="h3" color="primary">{data.total_processes}</Typography>
              <Typography variant="body2" color="text.secondary">{t("dashboard.totalProcesses")}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Card>
            <CardContent sx={{ textAlign: "center" }}>
              <Typography variant="h3" color="success.main">
                {data.diagram_coverage.percentage}%
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("dashboard.diagramCoverage", { with: data.diagram_coverage.with_diagram, total: data.diagram_coverage.total })}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Card>
            <CardContent sx={{ textAlign: "center" }}>
              <Typography variant="h3" color="warning.main">
                {data.by_risk.high || 0}
              </Typography>
              <Typography variant="body2" color="text.secondary">{t("dashboard.highRisk")}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Card>
            <CardContent sx={{ textAlign: "center" }}>
              <Typography variant="h3" color="error.main">
                {data.by_risk.critical || 0}
              </Typography>
              <Typography variant="body2" color="text.secondary">{t("dashboard.criticalRisk")}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Charts */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {/* Process Type Pie */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>{t("dashboard.byProcessType")}</Typography>
              <Box sx={{ height: 220 }}>
                <EChart
                  option={charts.processType}
                  ariaLabel={t("dashboard.byProcessType")}
                  onClick={drillDown("processType")}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Maturity Bar */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>{t("dashboard.maturityDistribution")}</Typography>
              <Box sx={{ height: 220 }}>
                <EChart
                  option={charts.maturity}
                  ariaLabel={t("dashboard.maturityDistribution")}
                  onClick={drillDown("maturity")}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Automation Bar */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>{t("dashboard.automationLevel")}</Typography>
              <Box sx={{ height: 220 }}>
                <EChart
                  option={charts.automation}
                  ariaLabel={t("dashboard.automationLevel")}
                  onClick={drillDown("automationLevel")}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Top Risk Processes */}
      {data.top_risk_processes.length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="subtitle2" gutterBottom>{t("dashboard.topRiskProcesses")}</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("dashboard.process")}</TableCell>
                  <TableCell>{t("dashboard.risk")}</TableCell>
                  <TableCell>{t("dashboard.maturity")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.top_risk_processes.map((p) => {
                  const risk = resolveRisk(p.risk);
                  const riskBg = riskColor(p.risk, risk.color);
                  const maturity = resolveMaturity(p.maturity);
                  const maturityBg = maturityColor(p.maturity, maturity.color);
                  return (
                    <TableRow
                      key={p.id}
                      hover
                      sx={{ cursor: "pointer" }}
                      onClick={() => setSidePanelCardId(p.id)}
                    >
                      <TableCell>{p.name}</TableCell>
                      <TableCell>
                        <Chip
                          label={risk.label}
                          size="small"
                          sx={{ bgcolor: riskBg, color: theme.palette.getContrastText(riskBg) }}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={maturity.label}
                          size="small"
                          // A light fill (a yellow option, the neutral grey)
                          // takes dark text; white on it was unreadable.
                          sx={{ bgcolor: maturityBg, color: theme.palette.getContrastText(maturityBg) }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <CardDetailSidePanel
        cardId={sidePanelCardId}
        open={!!sidePanelCardId}
        onClose={() => setSidePanelCardId(null)}
      />
    </Box>
  );
}

/* ── Tabbed shell ── */
const BPM_TAB_PARAM = "tab";
// The `bpm`-namespace key each tab renders its label from, in tab-index order.
const BPM_TAB_LABEL_KEYS = ["tabs.processNavigator", "tabs.dashboard", "tabs.reports"];

export default function BpmDashboard() {
  const { t } = useTranslation(["bpm", "common"]);
  const theme = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get(BPM_TAB_PARAM);
  const tabIndex = tabParam === "dashboard" ? 1 : tabParam === "reports" ? 2 : 0;
  usePageSection(t(BPM_TAB_LABEL_KEYS[tabIndex]));

  const handleTabChange = (_: unknown, newValue: number) => {
    const params = new URLSearchParams(searchParams);
    if (newValue === 0) {
      params.delete(BPM_TAB_PARAM);
    } else if (newValue === 1) {
      params.set(BPM_TAB_PARAM, "dashboard");
    } else {
      params.set(BPM_TAB_PARAM, "reports");
    }
    setSearchParams(params, { replace: true });
  };

  return (
    <Box>
      {/* Header + tabs */}
      <Box sx={{ px: { xs: 2, md: 3 }, pt: { xs: 2, md: 2.5 }, borderBottom: 1, borderColor: "divider" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
          <MaterialSymbol icon="route" size={28} color={theme.palette.primary.main} />
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {t("page.title")}
          </Typography>
        </Box>
        <Tabs value={tabIndex} onChange={handleTabChange}>
          <Tab
            label={t("tabs.processNavigator")}
            icon={<MaterialSymbol icon="account_tree" size={18} />}
            iconPosition="start"
            sx={{ minHeight: 42, textTransform: "none" }}
          />
          <Tab
            label={t("tabs.dashboard")}
            icon={<MaterialSymbol icon="dashboard" size={18} />}
            iconPosition="start"
            sx={{ minHeight: 42, textTransform: "none" }}
          />
          <Tab
            label={t("tabs.reports")}
            icon={<MaterialSymbol icon="analytics" size={18} />}
            iconPosition="start"
            sx={{ minHeight: 42, textTransform: "none" }}
          />
        </Tabs>
      </Box>

      {/* Tab content */}
      {tabIndex === 0 && <ProcessNavigator />}
      {tabIndex === 1 && <BpmDashboardContent />}
      {tabIndex === 2 && <BpmReportsContent />}
    </Box>
  );
}
