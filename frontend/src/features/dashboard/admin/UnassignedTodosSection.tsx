import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { useDateFormat } from "@/hooks/useDateFormat";
import SectionPaper, { EmptyState } from "../workspace/SectionPaper";

export interface OverdueTodoRow {
  id: string;
  title: string;
  due_date: string | null;
  card_id: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
}

interface Props {
  rows: OverdueTodoRow[];
  unassignedCount: number;
  loading: boolean;
}

export default function UnassignedTodosSection({ rows, unassignedCount, loading }: Props) {
  const { t } = useTranslation("common");
  const { formatDate } = useDateFormat();
  const navigate = useNavigate();

  return (
    <SectionPaper
      icon="assignment_late"
      iconColor="#d32f2f"
      title={t("dashboard.admin.overdueTodos")}
    >
      {loading ? (
        <LinearProgress />
      ) : (
        <Box>
          {unassignedCount > 0 && (
            <Box sx={{ mb: 1, px: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {t("dashboard.admin.unassignedSummary", { count: unassignedCount })}
              </Typography>
            </Box>
          )}
          {rows.length === 0 ? (
            <EmptyState message={t("dashboard.admin.empty.overdueTodos")} />
          ) : (
            rows.map((r) => (
              <Box
                key={r.id}
                onClick={() => r.card_id && navigate(`/cards/${r.card_id}`)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  py: 0.75,
                  px: 1,
                  borderRadius: 1,
                  cursor: r.card_id ? "pointer" : "default",
                  "&:hover": r.card_id ? { bgcolor: "action.hover" } : {},
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {r.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {r.assignee_name ?? t("dashboard.admin.noAssignee")}
                  </Typography>
                </Box>
                {r.due_date && (
                  <Typography
                    variant="caption"
                    sx={{ flexShrink: 0, color: "#d32f2f", fontWeight: 600 }}
                  >
                    {formatDate(r.due_date)}
                  </Typography>
                )}
              </Box>
            ))
          )}
        </Box>
      )}
    </SectionPaper>
  );
}
