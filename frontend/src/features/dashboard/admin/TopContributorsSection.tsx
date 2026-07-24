import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import SectionPaper, { EmptyState } from "../workspace/SectionPaper";

export interface ContributorRow {
  user_id: string;
  display_name: string;
  email: string;
  event_count: number;
}

interface Props {
  rows: ContributorRow[];
  loading: boolean;
}

export default function TopContributorsSection({ rows, loading }: Props) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const max = Math.max(1, ...rows.map((r) => r.event_count));

  return (
    <SectionPaper
      icon="emoji_events"
      iconColor="#f5a623"
      title={t("dashboard.admin.topContributors")}
    >
      {loading ? (
        <LinearProgress />
      ) : rows.length === 0 ? (
        <EmptyState message={t("dashboard.admin.empty.contributors")} />
      ) : (
        <Box>
          {rows.map((r) => (
            <Box
              key={r.user_id}
              onClick={() => navigate("/admin/users")}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                py: 0.75,
                px: 1,
                borderRadius: 1,
                cursor: "pointer",
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {r.display_name}
                </Typography>
                <Box
                  sx={{
                    height: 4,
                    bgcolor: "action.hover",
                    borderRadius: 2,
                    mt: 0.5,
                    overflow: "hidden",
                  }}
                >
                  <Box
                    sx={{
                      width: `${(r.event_count / max) * 100}%`,
                      height: "100%",
                      bgcolor: "primary.main",
                    }}
                  />
                </Box>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                {t("dashboard.admin.eventsCount", { count: r.event_count })}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </SectionPaper>
  );
}
