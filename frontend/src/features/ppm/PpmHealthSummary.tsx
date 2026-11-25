import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import type { PmlInitiativeSchedule } from "@/types";
import { HealthDot } from "./ppmVisuals";

interface Props {
  report: Pick<PmlInitiativeSchedule, "schedule_health" | "scope_health"> | null | undefined;
  costHealth?: string | null;
}

export default function PpmHealthSummary({ report, costHealth }: Props) {
  const { t } = useTranslation("ppm");
  if (!report) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t("noReportsYet")}
      </Typography>
    );
  }
  return (
    <Box display="flex" gap={{ xs: 1.5, sm: 4 }} flexWrap="wrap">
      {report.schedule_health && <HealthDot value={report.schedule_health} label={t("health_schedule")} />}
      {costHealth && <HealthDot value={costHealth} label={t("health_cost")} />}
      {report.scope_health && <HealthDot value={report.scope_health} label={t("health_scope")} />}
    </Box>
  );
}
