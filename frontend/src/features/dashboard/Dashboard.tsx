import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Grid from "@mui/material/Grid";
import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import LinearProgress from "@mui/material/LinearProgress";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type { DashboardData } from "@/types";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SEAL_COLORS: Record<string, string> = {
  DRAFT: "#9e9e9e",
  APPROVED: "#4caf50",
  REJECTED: "#f44336",
  BROKEN: "#ff9800",
};

const SEAL_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  BROKEN: "Broken",
};

const COMPLETION_COLORS: Record<string, string> = {
  "0-25": "#f44336",
  "25-50": "#ff9800",
  "50-75": "#2196f3",
  "75-100": "#4caf50",
};

const COMPLETION_LABELS: Record<string, string> = {
  "0-25": "0 - 25%",
  "25-50": "25 - 50%",
  "50-75": "50 - 75%",
  "75-100": "75 - 100%",
};

const LIFECYCLE_PHASES = [
  { key: "plan", label: "Plan", color: "#9e9e9e" },
  { key: "phaseIn", label: "Phase In", color: "#2196f3" },
  { key: "active", label: "Active", color: "#4caf50" },
  { key: "phaseOut", label: "Phase Out", color: "#ff9800" },
  { key: "endOfLife", label: "End of Life", color: "#f44336" },
  { key: "none", label: "Not Set", color: "#e0e0e0" },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const navigate = useNavigate();
  const { types } = useMetamodel();
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    api.get<DashboardData>("/reports/dashboard").then(setData);
  }, []);

  /* ---------- derived chart data ---------- */

  const typeChartData = useMemo(() => {
    if (!data) return [];
    return types
      .filter((t) => (data.by_type[t.key] ?? 0) > 0)
      .map((t) => ({ name: t.label, count: data.by_type[t.key] || 0, color: t.color, key: t.key }))
      .sort((a, b) => b.count - a.count);
  }, [data, types]);

  const sealChartData = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.quality_seals)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: SEAL_LABELS[k] || k, value: v, color: SEAL_COLORS[k] || "#999" }));
  }, [data]);

  const completionChartData = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.completion_distribution).map(([k, v]) => ({
      name: COMPLETION_LABELS[k] || k,
      count: v,
      color: COMPLETION_COLORS[k] || "#999",
    }));
  }, [data]);

  const lifecycleChartData = useMemo(() => {
    if (!data) return [];
    return LIFECYCLE_PHASES.map((p) => ({
      name: p.label,
      count: data.lifecycle_distribution[p.key] || 0,
      color: p.color,
    }));
  }, [data]);

  if (!data) return <LinearProgress />;

  const typeCards = types.filter(
    (t) => (data.by_type[t.key] ?? 0) > 0 || ["Application", "BusinessCapability", "ITComponent", "Initiative"].includes(t.key),
  );

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 3 }}>
        Dashboard
      </Typography>

      {/* -------- KPI summary cards -------- */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <MaterialSymbol icon="inventory_2" size={24} color="#1976d2" />
                <Typography variant="subtitle2" color="text.secondary">Total Fact Sheets</Typography>
              </Box>
              <Typography variant="h4" fontWeight={700}>{data.total_fact_sheets}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <MaterialSymbol icon="pie_chart" size={24} color="#4caf50" />
                <Typography variant="subtitle2" color="text.secondary">Avg Completion</Typography>
              </Box>
              <Typography variant="h4" fontWeight={700}>{data.avg_completion}%</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <MaterialSymbol icon="verified" size={24} color="#2e7d32" />
                <Typography variant="subtitle2" color="text.secondary">Approved Seals</Typography>
              </Box>
              <Typography variant="h4" fontWeight={700}>{data.quality_seals["APPROVED"] || 0}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <MaterialSymbol icon="warning" size={24} color="#f57c00" />
                <Typography variant="subtitle2" color="text.secondary">Broken Seals</Typography>
              </Box>
              <Typography variant="h4" fontWeight={700}>{data.quality_seals["BROKEN"] || 0}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* -------- Row 2: Type bar chart + Quality seal donut -------- */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={7}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Fact Sheets by Type
              </Typography>
              {typeChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={Math.max(typeChartData.length * 38, 200)}>
                  <BarChart data={typeChartData} layout="vertical" margin={{ left: 10, right: 24, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={130}
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                    />
                    <RTooltip />
                    <Bar
                      dataKey="count"
                      name="Count"
                      radius={[0, 4, 4, 0]}
                      cursor="pointer"
                      onClick={(entry: { key?: string }) => {
                        if (entry?.key) navigate(`/inventory?type=${entry.key}`);
                      }}
                    >
                      {typeChartData.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Typography variant="body2" color="text.secondary">No fact sheets yet</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={5}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Quality Seal Distribution
              </Typography>
              {sealChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={sealChartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      paddingAngle={2}
                      label={({ name, value }: { name: string; value: number }) => `${name}: ${value}`}
                    >
                      {sealChartData.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Pie>
                    <RTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <Typography variant="body2" color="text.secondary">No data</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* -------- Row 3: Completion distribution + Lifecycle overview -------- */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Completion Distribution
              </Typography>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={completionChartData} margin={{ left: 0, right: 16, top: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} />
                  <RTooltip />
                  <Bar dataKey="count" name="Fact Sheets" radius={[4, 4, 0, 0]}>
                    {completionChartData.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Lifecycle Overview
              </Typography>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={lifecycleChartData} margin={{ left: 0, right: 16, top: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} />
                  <RTooltip />
                  <Bar dataKey="count" name="Fact Sheets" radius={[4, 4, 0, 0]}>
                    {lifecycleChartData.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* -------- Row 4: Fact Sheet type list + Recent Activity -------- */}
      <Grid container spacing={2}>
        <Grid item xs={12} md={5}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Browse by Type
              </Typography>
              {typeCards.map((t) => (
                <Box
                  key={t.key}
                  sx={{
                    display: "flex", alignItems: "center", gap: 1.5, py: 1,
                    cursor: "pointer", "&:hover": { bgcolor: "action.hover" }, borderRadius: 1, px: 1,
                  }}
                  onClick={() => navigate(`/inventory?type=${t.key}`)}
                >
                  <MaterialSymbol icon={t.icon} size={20} color={t.color} />
                  <Typography variant="body2" sx={{ flex: 1 }}>{t.label}</Typography>
                  <Chip size="small" label={data.by_type[t.key] || 0} />
                </Box>
              ))}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Recent Activity
              </Typography>
              <List dense>
                {data.recent_events.slice(0, 10).map((e) => (
                  <ListItem key={e.id} sx={{ px: 0 }}>
                    <ListItemText
                      primary={
                        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                          <Chip size="small" label={e.event_type.replace(".", " ")} sx={{ fontSize: 11 }} />
                          <Typography variant="body2">{e.user_display_name || "System"}</Typography>
                        </Box>
                      }
                      secondary={e.created_at ? new Date(e.created_at).toLocaleString() : ""}
                    />
                  </ListItem>
                ))}
                {data.recent_events.length === 0 && (
                  <Typography variant="body2" color="text.secondary">No recent activity</Typography>
                )}
              </List>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
