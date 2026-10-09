import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import LinearProgress from "@mui/material/LinearProgress";
import { api } from "@/api/client";
import type { EventEntry } from "@/types";
import RecentActivity from "../RecentActivity";
import SectionPaper, { EmptyState } from "./SectionPaper";

export default function RecentActivityOnMyCardsSection() {
  const { t } = useTranslation("common");
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<EventEntry[]>([]);

  useEffect(() => {
    api
      .get<EventEntry[]>("/events/my-cards")
      .then(setEvents)
      // A failed load leaves the empty list the section starts with.
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <SectionPaper
      icon="schedule"
      iconColor="#5e35b1"
      title={t("dashboard.workspace.recentActivity")}
    >
      {loading ? (
        <LinearProgress />
      ) : events.length === 0 ? (
        <EmptyState message={t("dashboard.workspace.empty.activity")} />
      ) : (
        <RecentActivity events={events} maxRows={8} />
      )}
    </SectionPaper>
  );
}
