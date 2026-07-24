import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { useDateFormat } from "@/hooks/useDateFormat";
import SectionPaper, { EmptyState, ViewAllLink } from "../workspace/SectionPaper";

export interface IdleUserRow {
  user_id: string;
  display_name: string;
  email: string;
  last_login: string | null;
  role: string;
}

interface Props {
  rows: IdleUserRow[];
  pendingSsoInvitations: number;
  loading: boolean;
}

export default function IdleUsersSection({ rows, pendingSsoInvitations, loading }: Props) {
  const { t } = useTranslation("common");
  const { formatDate } = useDateFormat();
  const navigate = useNavigate();

  return (
    <SectionPaper
      icon="bedtime"
      iconColor="#9e9e9e"
      title={t("dashboard.admin.idleUsers")}
      action={<ViewAllLink to="/admin/users" label={t("dashboard.workspace.viewAll")} />}
    >
      {loading ? (
        <LinearProgress />
      ) : (
        <Box>
          {pendingSsoInvitations > 0 && (
            <Box sx={{ mb: 1, px: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {t("dashboard.admin.pendingSsoInvitations", { count: pendingSsoInvitations })}
              </Typography>
            </Box>
          )}
          {rows.length === 0 ? (
            <EmptyState message={t("dashboard.admin.empty.idleUsers")} />
          ) : (
            rows.map((r) => (
              <Box
                key={r.user_id}
                onClick={() => navigate("/admin/users")}
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
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {r.display_name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {r.email}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {r.last_login
                    ? formatDate(r.last_login)
                    : t("dashboard.admin.neverLoggedIn")}
                </Typography>
              </Box>
            ))
          )}
        </Box>
      )}
    </SectionPaper>
  );
}
