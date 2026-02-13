import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { Survey } from "@/types";

const STATUS_COLORS: Record<string, "default" | "warning" | "success" | "info"> = {
  draft: "default",
  active: "info",
  closed: "success",
};

export default function SurveysAdmin() {
  const navigate = useNavigate();
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(0); // 0=all, 1=draft, 2=active, 3=closed

  const fetchSurveys = async () => {
    setLoading(true);
    try {
      const data = await api.get<Survey[]>("/surveys");
      setSurveys(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load surveys");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSurveys();
  }, []);

  const filtered = tab === 0
    ? surveys
    : surveys.filter((s) =>
        tab === 1 ? s.status === "draft" : tab === 2 ? s.status === "active" : s.status === "closed",
      );

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", mb: 3 }}>
        <MaterialSymbol icon="assignment" size={28} color="#1976d2" />
        <Typography variant="h5" sx={{ ml: 1, fontWeight: 700, flex: 1 }}>
          Surveys
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          sx={{ textTransform: "none" }}
          onClick={() => navigate("/admin/surveys/new")}
        >
          New Survey
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label={`All (${surveys.length})`} />
        <Tab label={`Draft (${surveys.filter((s) => s.status === "draft").length})`} />
        <Tab label={`Active (${surveys.filter((s) => s.status === "active").length})`} />
        <Tab label={`Closed (${surveys.filter((s) => s.status === "closed").length})`} />
      </Tabs>

      {filtered.length === 0 && (
        <Alert severity="info">
          {tab === 0 ? "No surveys yet. Create one to start collecting data from your team." : "No surveys in this category."}
        </Alert>
      )}

      {filtered.map((s) => {
        const total = s.total_responses ?? 0;
        const completed = s.completed_responses ?? 0;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

        return (
          <Card key={s.id} sx={{ mb: 1.5 }}>
            <CardActionArea
              onClick={() =>
                s.status === "draft"
                  ? navigate(`/admin/surveys/${s.id}`)
                  : navigate(`/admin/surveys/${s.id}/results`)
              }
              sx={{ p: 2 }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <MaterialSymbol icon="assignment" size={22} color="#1976d2" />
                <Typography sx={{ fontWeight: 600, flex: 1 }}>{s.name}</Typography>
                <Chip
                  label={s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                  size="small"
                  color={STATUS_COLORS[s.status] ?? "default"}
                />
                <Chip
                  label={s.target_type_key}
                  size="small"
                  variant="outlined"
                />
              </Box>

              {s.description && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {s.description}
                </Typography>
              )}

              {s.status !== "draft" && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <Box sx={{ flex: 1 }}>
                    <LinearProgress
                      variant="determinate"
                      value={pct}
                      sx={{ height: 6, borderRadius: 3 }}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 80 }}>
                    {completed}/{total} responses ({pct}%)
                  </Typography>
                </Box>
              )}

              <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
                {s.creator_name && (
                  <Typography variant="caption" color="text.secondary">
                    By {s.creator_name}
                  </Typography>
                )}
                {s.sent_at && (
                  <Typography variant="caption" color="text.secondary">
                    Sent {new Date(s.sent_at).toLocaleDateString()}
                  </Typography>
                )}
                {s.closed_at && (
                  <Typography variant="caption" color="text.secondary">
                    Closed {new Date(s.closed_at).toLocaleDateString()}
                  </Typography>
                )}
              </Box>
            </CardActionArea>
          </Card>
        );
      })}
    </Box>
  );
}
