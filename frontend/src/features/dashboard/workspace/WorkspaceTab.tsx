import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import { api } from "@/api/client";
import MetricCard from "@/features/reports/MetricCard";
import MyFavoritesSection from "./MyFavoritesSection";
import MyRolesSection from "./MyRolesSection";
import MyTodosSection from "./MyTodosSection";
import MyPendingSurveysSection from "./MyPendingSurveysSection";
import NeedsAttentionSection from "./NeedsAttentionSection";
import RecentActivityOnMyCardsSection from "./RecentActivityOnMyCardsSection";
import MyCreatedSection from "./MyCreatedSection";
import MySavedReportsSection from "./MySavedReportsSection";

export interface MyWorkspaceCounters {
  favorite_count: number;
  stakeholder_card_count: number;
  open_todo_count: number;
  pending_survey_count: number;
  attention_count: number;
  overdue_todo_count: number;
  broken_card_count: number;
  created_count: number;
}

const ZERO: MyWorkspaceCounters = {
  favorite_count: 0,
  stakeholder_card_count: 0,
  open_todo_count: 0,
  pending_survey_count: 0,
  attention_count: 0,
  overdue_todo_count: 0,
  broken_card_count: 0,
  created_count: 0,
};

export default function WorkspaceTab() {
  const { t } = useTranslation("common");
  const [counters, setCounters] = useState<MyWorkspaceCounters>(ZERO);

  useEffect(() => {
    api.get<MyWorkspaceCounters>("/reports/my-workspace").then(setCounters).catch(() => {});
  }, []);

  return (
    <Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mb: 3 }}>
        <MetricCard
          icon="cards_star"
          iconColor="#f5a623"
          label={t("dashboard.workspace.metric.favorites")}
          value={counters.favorite_count}
        />
        <MetricCard
          icon="groups"
          iconColor="#1976d2"
          label={t("dashboard.workspace.metric.stakeholderCards")}
          value={counters.stakeholder_card_count}
        />
        <MetricCard
          icon="task_alt"
          iconColor="#43a047"
          label={t("dashboard.workspace.metric.openTodos")}
          value={counters.open_todo_count}
        />
        <MetricCard
          icon="poll"
          iconColor="#7b1fa2"
          label={t("dashboard.workspace.metric.pendingSurveys")}
          value={counters.pending_survey_count}
        />
      </Box>

      {counters.attention_count > 0 && (
        <Box sx={{ mb: 3 }}>
          <NeedsAttentionSection
            overdueTodoCount={counters.overdue_todo_count}
            brokenCardCount={counters.broken_card_count}
          />
        </Box>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <MyFavoritesSection />
        </Grid>
        <Grid item xs={12} md={6}>
          <MySavedReportsSection />
        </Grid>
        <Grid item xs={12} md={6}>
          <MyRolesSection />
        </Grid>
        <Grid item xs={12} md={6}>
          <MyTodosSection />
        </Grid>
        <Grid item xs={12} md={6}>
          <MyPendingSurveysSection />
        </Grid>
        <Grid item xs={12} md={6}>
          <MyCreatedSection createdCount={counters.created_count} />
        </Grid>
        <Grid item xs={12} md={6}>
          <RecentActivityOnMyCardsSection />
        </Grid>
      </Grid>
    </Box>
  );
}
