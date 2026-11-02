import { useTranslation } from "react-i18next";
import LinearProgress from "@mui/material/LinearProgress";
import type { EventEntry } from "@/types";
import RecentActivity from "../RecentActivity";
import SectionPaper, { EmptyState } from "../workspace/SectionPaper";
import { DASHBOARD_KPI_COLORS } from "@/theme/tokens";

interface Props {
  events: EventEntry[];
  loading: boolean;
}

export default function SystemActivitySection({ events, loading }: Props) {
  const { t } = useTranslation("common");
  return (
    <SectionPaper
      icon="schedule"
      iconColor={DASHBOARD_KPI_COLORS.activity}
      title={t("dashboard.admin.systemActivity")}
    >
      {loading ? (
        <LinearProgress />
      ) : events.length === 0 ? (
        <EmptyState message={t("dashboard.admin.empty.activity")} />
      ) : (
        <RecentActivity events={events} maxRows={10} />
      )}
    </SectionPaper>
  );
}
