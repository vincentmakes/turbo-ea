/**
 * BpmDashboard — Tabbed landing page for BPM module.
 * Tab 0: Process Navigator (Process House)
 * Tab 1: Dashboard KPIs, charts, and quick links to processes.
 */
import { useState, useEffect } from "react";
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
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { BpmDashboardData } from "@/types";
import ProcessNavigator from "./ProcessNavigator";
import BpmReportsContent from "./BpmReportPage";

const COLORS = ["#1976d2", "#607d8b", "#9c27b0", "#4caf50", "#ff9800", "#f44336"];

const MATURITY_COLORS: Record<string, string> = {
  initial: "#d32f2f",
  managed: "#ff9800",
  defined: "#fbc02d",
  measured: "#66bb6a",
  optimized: "#2e7d32",
};

const RISK_COLORS: Record<string, string> = {
  low: "#4caf50",
  medium: "#ff9800",
  high: "#f44336",
  critical: "#b71c1c",
};

/* ── Dashboard content (tab 1) ── */
function BpmDashboardContent() {
  const navigate = useNavigate();
  const [data, setData] = useState<BpmDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<BpmDashboardData>("/reports/bpm/dashboard")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LinearProgress />;
  if (!data) return <Typography>Failed to load BPM dashboard.</Typography>;

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
          All Processes
        </Button>
      </Box>

      {/* KPI Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}>
          <Card>
            <CardContent sx={{ textAlign: "center" }}>
              <Typography variant="h3" color="primary">{data.total_processes}</Typography>
              <Typography variant="body2" color="text.secondary">Total Processes</Typography>
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
                Diagram Coverage ({data.diagram_coverage.with_diagram}/{data.diagram_coverage.total})
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
              <Typography variant="body2" color="text.secondary">High Risk</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Card>
            <CardContent sx={{ textAlign: "center" }}>
              <Typography variant="h3" color="error.main">
                {data.by_risk.critical || 0}
              </Typography>
              <Typography variant="body2" color="text.secondary">Critical Risk</Typography>
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
              <Typography variant="subtitle2" gutterBottom>By Process Type</Typography>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                    {typeData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Maturity Bar */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>Maturity Distribution</Typography>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={maturityData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" name="Processes">
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
              <Typography variant="subtitle2" gutterBottom>Automation Level</Typography>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={automationData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" name="Processes" fill="#1976d2" />
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
            <Typography variant="subtitle2" gutterBottom>Top Risk Processes</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Process</TableCell>
                  <TableCell>Risk</TableCell>
                  <TableCell>Maturity</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.top_risk_processes.map((p) => (
                  <TableRow
                    key={p.id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => navigate(`/fact-sheets/${p.id}`)}
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
    </Box>
  );
}

/* ── Tabbed shell ── */
const BPM_TAB_PARAM = "tab";

export default function BpmDashboard() {
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
            Business Process Management
          </Typography>
        </Box>
        <Tabs value={tabIndex} onChange={handleTabChange}>
          <Tab
            label="Process Navigator"
            icon={<MaterialSymbol icon="account_tree" size={18} />}
            iconPosition="start"
            sx={{ minHeight: 42, textTransform: "none" }}
          />
          <Tab
            label="Dashboard"
            icon={<MaterialSymbol icon="dashboard" size={18} />}
            iconPosition="start"
            sx={{ minHeight: 42, textTransform: "none" }}
          />
          <Tab
            label="Reports"
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
