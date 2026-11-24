import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { useDateFormat } from "@/hooks/useDateFormat";
import type { PmlInitiativeSchedule } from "@/types";
import { dateRangeBar, portfolioWindowIncludingDates } from "./ppmPortfolioModel";
import { getQuarters } from "./ppmPortfolioFormat";
import { HealthDot } from "./ppmVisuals";
import { useHealthRatingLabel } from "./ppmHealth";

interface Props {
  schedule: PmlInitiativeSchedule | undefined;
  name: string;
  showDates?: boolean;
  now?: Date;
}

export default function PpmInitiativeTimeline({
  schedule,
  name,
  showDates = true,
  now = new Date(),
}: Props) {
  const { t } = useTranslation("ppm");
  const { formatDate } = useDateFormat();
  const rating = useHealthRatingLabel();
  if (!schedule) return null;
  const dates = [
    schedule.plan_start_date,
    schedule.plan_end_date,
    schedule.actual_start_date,
    schedule.actual_end_date,
  ];
  const window = portfolioWindowIncludingDates(now, dates);
  const months =
    (window.end.getFullYear() - window.start.getFullYear()) * 12 +
    window.end.getMonth() -
    window.start.getMonth() +
    1;
  const quarters = getQuarters(window.start, months);
  const rows = [
    {
      key: "plan",
      label: t("planTrack"),
      start: schedule.plan_start_date,
      end: schedule.plan_end_date,
      derived: schedule.plan_derived,
    },
    {
      key: "actual",
      label: t("actualTrack"),
      start: schedule.actual_start_date,
      end: schedule.actual_end_date,
      derived: false,
    },
  ];
  const values = [
    {
      label: schedule.start_label || t("startDate"),
      value: schedule.start_date,
      visible: "start_date" in schedule,
    },
    {
      label: schedule.actual_start_label || t("actualStart"),
      value: schedule.actual_start_date,
      visible: "actual_start_date" in schedule,
    },
    {
      label: schedule.end_label || t("endDate"),
      value: schedule.end_date,
      visible: "end_date" in schedule,
    },
    {
      label: schedule.actual_end_label || t("actualEnd"),
      value: schedule.actual_end_date,
      visible: "actual_end_date" in schedule,
    },
  ];
  return (
    <Box>
      {showDates && (
        <Box display="flex" gap={3} flexWrap="wrap" mb={2}>
          {values
            .filter(({ visible }) => visible)
            .map(({ label, value }, index) => (
              <Box key={index}>
                <Typography variant="caption" color="text.secondary">
                  {label}
                </Typography>
                <Typography variant="body2">{value ? formatDate(value) : "—"}</Typography>
              </Box>
            ))}
        </Box>
      )}
      <Typography variant="body2" fontWeight={600}>
        {name}
      </Typography>
      <Box
        role="region"
        aria-label={t("summaryTimeline")}
        tabIndex={0}
        sx={{ overflowX: "auto" }}
      >
        <Box sx={{ minWidth: Math.max(520, 64 + quarters.length * 56) }}>
          <Box display="flex" alignItems="center" gap={1}>
            <Box sx={{ width: 55 }} />
            <Box sx={{ flex: 1, position: "relative", height: 22 }}>
              {quarters.map((quarter) => {
                const left = Math.max(
                  0,
                  ((quarter.start.getTime() - window.start.getTime()) / window.ms) * 100,
                );
                return (
                  <Typography
                    variant="caption"
                    key={quarter.label}
                    sx={{ position: "absolute", left: left + "%", whiteSpace: "nowrap" }}
                  >
                    {quarter.label}
                  </Typography>
                );
              })}
            </Box>
          </Box>
          {rows.map(({ key, label, start, end, derived }) => {
            const bar = dateRangeBar(start, end, window);
            const text = [start, end]
              .filter(Boolean)
              .map((value) => formatDate(value!))
              .join(" – ");
            return (
              <Box key={key} display="flex" alignItems="center" gap={1}>
                <Typography variant="caption" sx={{ width: 55 }}>
                  {label}
                </Typography>
                <Box
                  sx={{ height: 20, flex: 1, position: "relative", bgcolor: "action.hover" }}
                  aria-label={label + (text ? ": " + text : "")}
                >
                  {bar && (
                    <Box
                      data-testid={bar.width === 0 ? key + "-marker" : key + "-bar"}
                      title={text}
                      sx={{
                        position: "absolute",
                        left: bar.left + "%",
                        width: bar.width === 0 ? 4 : bar.width + "%",
                        height: 10,
                        top: 5,
                        bgcolor: derived
                          ? "transparent"
                          : key === "plan"
                            ? "primary.main"
                            : "secondary.main",
                        border: derived ? 1 : 0,
                        borderColor: "primary.main",
                        borderRadius: bar.borderRadius,
                      }}
                    />
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
      <Box display="flex" gap={2} flexWrap="wrap" mt={1}>
        {schedule.schedule_health && (
          <HealthDot
            label={t("onTime")}
            value={schedule.schedule_health}
            rating={rating(schedule.schedule_health)}
          />
        )}
        {schedule.cost_health && (
          <HealthDot
            label={t("onCost")}
            value={schedule.cost_health}
            rating={rating(schedule.cost_health)}
          />
        )}
        {schedule.scope_health && (
          <HealthDot
            label={t("onScope")}
            value={schedule.scope_health}
            rating={rating(schedule.scope_health)}
          />
        )}
      </Box>
    </Box>
  );
}
