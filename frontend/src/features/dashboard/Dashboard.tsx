import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  LinearProgress,
  Typography,
} from "@mui/material";
import { MaterialSymbol } from "../../components/MaterialSymbol";
import { api } from "../../api/client";
import { useEventStream } from "../../hooks/useEventStream";
import { FACT_SHEET_TYPE_LABELS, FACT_SHEET_TYPE_ICONS } from "../../types/fact-sheet";

interface KPICard {
  label: string;
  value: number | string;
  icon: string;
  trend: number | null;
  color: string;
}

interface HealthScore {
  label: string;
  score: number;
  color: string;
}

interface TypeBreakdown {
  type: string;
  count: number;
  active: number;
  archived: number;
}

interface DashboardData {
  kpis: KPICard[];
  health_scores: HealthScore[];
  type_breakdown: TypeBreakdown[];
  lifecycle_distribution: Record<string, number>;
  recent_changes_count: number;
  completeness_avg: number;
}

interface RecentEvent {
  id: string;
  type: string;
  entity_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

const LIFECYCLE_COLORS: Record<string, string> = {
  plan: "#9e9e9e",
  phase_in: "#1565c0",
  active: "#2e7d32",
  phase_out: "#ed6c02",
  end_of_life: "#d32f2f",
  undefined: "#bdbdbd",
};

const LIFECYCLE_LABELS: Record<string, string> = {
  plan: "Plan",
  phase_in: "Phase In",
  active: "Active",
  phase_out: "Phase Out",
  end_of_life: "End of Life",
  undefined: "Undefined",
};

const HEALTH_COLORS: Record<string, string> = {
  green: "#2e7d32",
  yellow: "#ed6c02",
  red: "#d32f2f",
};

const KPI_COLORS: Record<string, string> = {
  primary: "#1976d2",
  info: "#0288d1",
  secondary: "#9c27b0",
  warning: "#ed6c02",
  success: "#2e7d32",
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);

  const loadData = useCallback(async () => {
    try {
      const data = await api.get<DashboardData>("/reports/dashboard");
      setDashboard(data);
    } catch {
      // fallback
    }
  }, []);

  const loadRecentEvents = useCallback(async () => {
    try {
      const data = await api.get<{ items: RecentEvent[] }>("/events", {
        limit: "10",
      });
      setRecentEvents(data.items);
    } catch {
      // events may be empty on first load
    }
  }, []);

  useEffect(() => {
    loadData();
    loadRecentEvents();
  }, [loadData, loadRecentEvents]);

  useEventStream(
    useCallback(
      (event) => {
        setRecentEvents((prev) => [event as RecentEvent, ...prev.slice(0, 9)]);
        loadData();
      },
      [loadData]
    )
  );

  const lifecycleTotal = dashboard
    ? Object.values(dashboard.lifecycle_distribution).reduce((s, v) => s + v, 0)
    : 0;

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4">Executive Dashboard</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Enterprise architecture health at a glance.
        </Typography>
      </Box>

      {/* KPI Cards */}
      {dashboard && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {dashboard.kpis.map((kpi) => (
            <Grid key={kpi.label} item xs={12} sm={6} md={2.4}>
              <Card sx={{ height: "100%" }}>
                <CardContent sx={{ display: "flex", alignItems: "center", gap: 2, py: 2 }}>
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: 2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: `${KPI_COLORS[kpi.color] || KPI_COLORS.primary}14`,
                    }}
                  >
                    <MaterialSymbol
                      icon={kpi.icon}
                      size={28}
                      color={KPI_COLORS[kpi.color] || KPI_COLORS.primary}
                    />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                      {kpi.value}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {kpi.label}
                    </Typography>
                  </Box>
                  {kpi.trend !== null && kpi.trend !== 0 && (
                    <Chip
                      icon={
                        <MaterialSymbol
                          icon={kpi.trend > 0 ? "trending_up" : "trending_down"}
                          size={14}
                        />
                      }
                      label={`${kpi.trend > 0 ? "+" : ""}${kpi.trend}%`}
                      size="small"
                      color={kpi.trend > 0 ? "success" : "error"}
                      sx={{ height: 22, fontSize: "0.65rem" }}
                    />
                  )}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Health Scores + Lifecycle Distribution + Type Breakdown */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {/* Health Scores */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
                Health Scores
              </Typography>
              {dashboard?.health_scores.map((hs) => (
                <Box key={hs.label} sx={{ mb: 2 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                    <Typography variant="body2">{hs.label}</Typography>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 700, color: HEALTH_COLORS[hs.color] }}
                    >
                      {hs.score}%
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={hs.score}
                    sx={{
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: "#e0e0e0",
                      "& .MuiLinearProgress-bar": {
                        backgroundColor: HEALTH_COLORS[hs.color],
                        borderRadius: 4,
                      },
                    }}
                  />
                </Box>
              ))}
            </CardContent>
          </Card>
        </Grid>

        {/* Lifecycle Distribution */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
                Lifecycle Distribution
              </Typography>
              {dashboard &&
                Object.entries(dashboard.lifecycle_distribution).map(([phase, count]) => (
                  <Box key={phase} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        backgroundColor: LIFECYCLE_COLORS[phase] || "#bdbdbd",
                        flexShrink: 0,
                      }}
                    />
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      {LIFECYCLE_LABELS[phase] || phase}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600, mr: 1 }}>
                      {count}
                    </Typography>
                    <Box sx={{ width: 80 }}>
                      <LinearProgress
                        variant="determinate"
                        value={lifecycleTotal > 0 ? (count / lifecycleTotal) * 100 : 0}
                        sx={{
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: "#e0e0e0",
                          "& .MuiLinearProgress-bar": {
                            backgroundColor: LIFECYCLE_COLORS[phase] || "#bdbdbd",
                            borderRadius: 3,
                          },
                        }}
                      />
                    </Box>
                  </Box>
                ))}
            </CardContent>
          </Card>
        </Grid>

        {/* Type Breakdown */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
                Inventory by Type
              </Typography>
              {dashboard?.type_breakdown.map((tb) => (
                <Box
                  key={tb.type}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mb: 1,
                    cursor: "pointer",
                    borderRadius: 1,
                    p: 0.5,
                    "&:hover": { backgroundColor: "action.hover" },
                  }}
                  onClick={() => navigate(`/fact-sheets?type=${tb.type}`)}
                >
                  <MaterialSymbol
                    icon={FACT_SHEET_TYPE_ICONS[tb.type as keyof typeof FACT_SHEET_TYPE_ICONS] || "circle"}
                    size={18}
                  />
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {FACT_SHEET_TYPE_LABELS[tb.type as keyof typeof FACT_SHEET_TYPE_LABELS] || tb.type}
                  </Typography>
                  <Chip
                    label={tb.active}
                    size="small"
                    sx={{ height: 20, fontSize: "0.7rem", fontWeight: 600 }}
                  />
                </Box>
              ))}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Quick Actions + Recent Activity */}
      <Grid container spacing={2}>
        {/* Quick Actions */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
                Quick Actions
              </Typography>
              {[
                { label: "View Landscape Report", icon: "landscape", path: "/landscape-report" },
                { label: "View Matrix Report", icon: "grid_on", path: "/matrix-report" },
                { label: "Export CSV", icon: "download", path: "/settings" },
                { label: "Capability Map", icon: "map", path: "/capability-map" },
                { label: "Tech Radar", icon: "radar", path: "/tech-radar" },
                { label: "Initiative Board", icon: "view_kanban", path: "/initiative-board" },
              ].map((action) => (
                <Box
                  key={action.path}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    py: 1,
                    px: 1,
                    borderRadius: 1,
                    cursor: "pointer",
                    "&:hover": { backgroundColor: "action.hover" },
                  }}
                  onClick={() => navigate(action.path)}
                >
                  <MaterialSymbol icon={action.icon} size={20} color="#666" />
                  <Typography variant="body2">{action.label}</Typography>
                </Box>
              ))}
            </CardContent>
          </Card>
        </Grid>

        {/* Recent Activity */}
        <Grid item xs={12} md={8}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
                Recent Activity
              </Typography>
              {recentEvents.length === 0 ? (
                <Typography color="text.secondary">
                  No recent activity. Create your first fact sheet to get started.
                </Typography>
              ) : (
                recentEvents.map((event) => (
                  <Box
                    key={event.id}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      py: 1,
                      borderBottom: "1px solid",
                      borderColor: "divider",
                      "&:last-child": { borderBottom: "none" },
                    }}
                  >
                    <Chip
                      label={event.type.replace(".", " ")}
                      size="small"
                      color={
                        event.type.includes("created")
                          ? "success"
                          : event.type.includes("deleted")
                            ? "error"
                            : "default"
                      }
                      sx={{ minWidth: 120 }}
                    />
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      {(event.payload?.name as string) || event.entity_type}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(event.created_at).toLocaleString()}
                    </Typography>
                  </Box>
                ))
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
