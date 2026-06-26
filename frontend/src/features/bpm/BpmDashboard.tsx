/**
 * BpmDashboard — Tabbed landing page for BPM module.
 * Tab 0: Process Navigator (Process House)
 * Tab 1: Dashboard KPIs, charts, and quick links to processes.
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import { api } from "@/api/client";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { brand, SEVERITY_COLORS, STATUS_COLORS } from "@/theme/tokens";
import { useIsRtl } from "@/hooks/useIsRtl";
import { makeRtlAxisTick, rtlLegendItemStyle, rtlTooltipStyle } from "@/lib/rechartsRtl";
import type { BpmDashboardData } from "@/types";
import ProcessNavigator from "./ProcessNavigator";
import BpmReportsContent from "./BpmReportPage";

const COLORS = [
  brand.primary,
  "#607d8b",
  "#9c27b0",
  STATUS_COLORS.success,
  STATUS_COLORS.warning,
  STATUS_COLORS.error,
];

// Maturity is a 5-step CMMI scale; reuses severity hues to convey progression
// from worst (red) to best (deep green).
const MATURITY_COLORS: Record<string, string> = {
  initial: SEVERITY_COLORS.critical,
  managed: SEVERITY_COLORS.high,
  defined: SEVERITY_COLORS.medium,
  measured: SEVERITY_COLORS.low,
  optimized: "#2e7d32",
};

const RISK_COLORS: Record<string, string> = {
  low: STATUS_COLORS.success,
  medium: STATUS_COLORS.warning,
  high: STATUS_COLORS.error,
  critical: "#b71c1c",
};

/* ── Dashboard content (tab 1) ── */
function BpmDashboardContent() {
  const { t } = useTranslation(["bpm", "common"]);
  const navigate = useNavigate();
  const theme = useTheme();
  const isRtl = useIsRtl();
  const rtlAxisTick = makeRtlAxisTick(theme.palette.text.secondary);
  const [data, setData] = useState<BpmDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidePanelCardId, setSidePanelCardId] = useState<string | null>(null);

  useEffect(() => {
    api.get<BpmDashboardData>("/reports/bpm/dashboard")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LinearProgress />;
  if (!data) return <Typography>{t("dashboard.loadFailed")}</Typography>;

  const typeData = Object.entries(data.by_process_type)
    .filter(([k]) => k !== "unknown")
    .map(([k, v]) => ({ name: k, value: v }));
  const maturityData = Object.entries(data.by_maturity)
    .filter(([k]) => k !== "unknown")
    .map(([k, v]) => ({ name: k, value: v }));
  const automationData = Object.entries(data.by_automation)
    .filter(([k]) => k !== "unknown")
    .map(([name, value]) => ({ name, value }));

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
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={typeData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label
                    style={{ cursor: "pointer" }}
                    onClick={(_data, idx) => {
                      const name = typeData[idx]?.name;
                      if (name) navigate(`/inventory?type=BusinessProcess&attr_processType=${encodeURIComponent(name)}`);
                    }}
                  >
                    {typeData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip cursor={{ fill: theme.palette.action.hover }} contentStyle={{ backgroundColor: theme.palette.background.paper, borderColor: theme.palette.divider, color: theme.palette.text.primary, ...rtlTooltipStyle(isRtl) }} />
                  <Legend formatter={(value: string) => <span style={rtlLegendItemStyle(isRtl, theme.palette.text.primary)}>{value}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Maturity Bar */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>{t("dashboard.maturityDistribution")}</Typography>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={maturityData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                  <XAxis dataKey="name" reversed={isRtl} tick={{ fill: theme.palette.text.secondary }} />
                  <YAxis orientation={isRtl ? "right" : "left"} tick={isRtl ? rtlAxisTick : { fill: theme.palette.text.secondary }} />
                  <Tooltip cursor={{ fill: theme.palette.action.hover }} contentStyle={{ backgroundColor: theme.palette.background.paper, borderColor: theme.palette.divider, color: theme.palette.text.primary, ...rtlTooltipStyle(isRtl) }} />
                  <Bar
                    dataKey="value"
                    name={t("dashboard.processes")}
                    style={{ cursor: "pointer" }}
                    onClick={(_data, idx) => {
                      const name = maturityData[idx]?.name;
                      if (name) navigate(`/inventory?type=BusinessProcess&attr_maturity=${encodeURIComponent(name)}`);
                    }}
                  >
                    {maturityData.map((entry, i) => (
                      <Cell key={i} fill={MATURITY_COLORS[entry.name] || "#9e9e9e"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Automation Bar */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>{t("dashboard.automationLevel")}</Typography>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={automationData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                  <XAxis dataKey="name" reversed={isRtl} tick={{ fill: theme.palette.text.secondary }} />
                  <YAxis orientation={isRtl ? "right" : "left"} tick={isRtl ? rtlAxisTick : { fill: theme.palette.text.secondary }} />
                  <Tooltip cursor={{ fill: theme.palette.action.hover }} contentStyle={{ backgroundColor: theme.palette.background.paper, borderColor: theme.palette.divider, color: theme.palette.text.primary, ...rtlTooltipStyle(isRtl) }} />
                  <Bar
                    dataKey="value"
                    name={t("dashboard.processes")}
                    fill="#1976d2"
                    style={{ cursor: "pointer" }}
                    onClick={(_data, idx) => {
                      const name = automationData[idx]?.name;
                      if (name) navigate(`/inventory?type=BusinessProcess&attr_automationLevel=${encodeURIComponent(name)}`);
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
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
                {data.top_risk_processes.map((p) => (
                  <TableRow
                    key={p.id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => setSidePanelCardId(p.id)}
                  >
                    <TableCell>{p.name}</TableCell>
                    <TableCell>
                      <Chip
                        label={p.risk}
                        size="small"
                        sx={{ bgcolor: RISK_COLORS[p.risk], color: "#fff" }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={p.maturity}
                        size="small"
                        sx={{ bgcolor: MATURITY_COLORS[p.maturity] || "#9e9e9e", color: "#fff" }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
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

export default function BpmDashboard() {
  const { t } = useTranslation(["bpm", "common"]);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get(BPM_TAB_PARAM);
  const tabIndex = tabParam === "dashboard" ? 1 : tabParam === "reports" ? 2 : 0;

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
          <MaterialSymbol icon="route" size={28} color="#1976d2" />
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
