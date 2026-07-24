import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import SectionPaper, { EmptyState, ViewAllLink } from "./SectionPaper";

interface MySurveyItem {
  survey_id: string;
  survey_name: string;
  pending_count: number;
  items: { response_id: string; card_id: string; card_name: string | null }[];
}

const MAX_VISIBLE = 5;

export default function MyPendingSurveysSection() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [surveys, setSurveys] = useState<MySurveyItem[]>([]);

  useEffect(() => {
    api
      .get<MySurveyItem[]>("/surveys/my")
      .then((rows) => setSurveys(rows.slice(0, MAX_VISIBLE)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <SectionPaper
      icon="poll"
      iconColor="#7b1fa2"
      title={t("dashboard.workspace.myPendingSurveys")}
      action={<ViewAllLink to="/todos?tab=surveys" label={t("dashboard.workspace.viewAll")} />}
    >
      {loading ? (
        <LinearProgress />
      ) : surveys.length === 0 ? (
        <EmptyState message={t("dashboard.workspace.empty.surveys")} />
      ) : (
        <Box>
          {surveys.map((s) => {
            const firstItem = s.items[0];
            const target = firstItem
              ? `/surveys/${s.survey_id}/respond/${firstItem.card_id}`
              : "/todos?tab=surveys";
            return (
              <Box
                key={s.survey_id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  py: 0.75,
                  px: 1,
                  borderRadius: 1,
                  cursor: "pointer",
                  "&:hover": { bgcolor: "action.hover" },
                }}
                onClick={() => navigate(target)}
              >
                <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                  {s.survey_name}
                </Typography>
                <Chip size="small" label={s.pending_count} color="secondary" />
              </Box>
            );
          })}
        </Box>
      )}
    </SectionPaper>
  );
}
