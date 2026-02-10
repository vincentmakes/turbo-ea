import { useState, useEffect } from "react";
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
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type { DashboardData } from "@/types";

export default function Dashboard() {
  const navigate = useNavigate();
  const { types } = useMetamodel();
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    api.get<DashboardData>("/reports/dashboard").then(setData);
  }, []);

  if (!data) return <LinearProgress />;

  const typeCards = types.filter((t) => (data.by_type[t.key] ?? 0) > 0 || ["Application", "BusinessCapability", "ITComponent", "Initiative"].includes(t.key));

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 3 }}>
        Dashboard
      </Typography>

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

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Fact Sheets by Type
              </Typography>
              {typeCards.map((t) => (
                <Box
                  key={t.key}
                  sx={{
                    display: "flex", alignItems: "center", gap: 1.5, py: 1,
                    cursor: "pointer", "&:hover": { bgcolor: "#f5f5f5" }, borderRadius: 1, px: 1,
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

        <Grid item xs={12} md={6}>
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
