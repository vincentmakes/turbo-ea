import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { MySurveyItem } from "@/types";

export default function MySurveys() {
  const navigate = useNavigate();
  const [surveys, setSurveys] = useState<MySurveyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.get<MySurveyItem[]>("/surveys/my");
        setSurveys(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load surveys");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

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
        <Typography variant="h5" sx={{ ml: 1, fontWeight: 700 }}>
          My Surveys
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {surveys.length === 0 && (
        <Alert severity="info">
          No pending surveys. You're all caught up!
        </Alert>
      )}

      {surveys.map((s) => (
        <Card key={s.survey_id} sx={{ mb: 2 }}>
          <Box sx={{ p: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
              <MaterialSymbol icon="assignment" size={22} color="#1976d2" />
              <Typography sx={{ fontWeight: 600, flex: 1 }}>{s.survey_name}</Typography>
              <Chip
                label={`${s.pending_count} pending`}
                size="small"
                color="warning"
              />
            </Box>

            {s.survey_message && (
              <Card variant="outlined" sx={{ p: 1.5, mb: 2, bgcolor: "grey.50" }}>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                  {s.survey_message}
                </Typography>
              </Card>
            )}

            {s.items.map((item) => (
              <Card key={item.response_id} variant="outlined" sx={{ mb: 1 }}>
                <CardActionArea
                  onClick={() => navigate(`/surveys/${s.survey_id}/respond/${item.fact_sheet_id}`)}
                  sx={{ p: 1.5, display: "flex", justifyContent: "flex-start" }}
                >
                  <MaterialSymbol icon="edit_note" size={20} color="#ed6c02" />
                  <Typography sx={{ ml: 1, fontSize: "0.9rem", flex: 1 }}>
                    {item.fact_sheet_name}
                  </Typography>
                  <Chip label="Respond" size="small" color="primary" variant="outlined" />
                </CardActionArea>
              </Card>
            ))}
          </Box>
        </Card>
      ))}
    </Box>
  );
}
