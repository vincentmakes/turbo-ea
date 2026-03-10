import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/hooks/useCurrency";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveLabel } from "@/hooks/useResolveLabel";
import type { Card, PpmStatusReport, PpmCostLine } from "@/types";

const RAG_COLORS: Record<string, string> = {
  onTrack: "#4caf50",
  atRisk: "#ff9800",
  offTrack: "#f44336",
};

interface Props {
  card: Card;
  latestReport: PpmStatusReport | null;
  costLines: PpmCostLine[];
}

export default function PpmOverviewTab({ card, latestReport, costLines }: Props) {
  const { t } = useTranslation("ppm");
  const { fmt } = useCurrency();
  const { getType } = useMetamodel();
  const rl = useResolveLabel();
  const attrs = card.attributes || {};

  const totalPlanned = costLines.reduce((s, cl) => s + cl.planned, 0);
  const totalActual = costLines.reduce((s, cl) => s + cl.actual, 0);

  const typeConfig = getType(card.type);

  // Resolve a select field value to its translated label
  const resolveOption = (fieldKey: string, value: unknown): string => {
    if (!value || typeof value !== "string") return "\u2014";
    for (const section of typeConfig?.fields_schema || []) {
      for (const field of section.fields || []) {
        if (field.key === fieldKey && field.options) {
          const opt = field.options.find(
            (o: { key: string }) => o.key === value,
          );
          if (opt) return rl(opt.label, opt.translations);
        }
      }
    }
    return value;
  };

  // Resolve subtype to translated label
  const resolveSubtype = (subtype: string | null | undefined): string | null => {
    if (!subtype || !typeConfig?.subtypes) return subtype || null;
    const st = typeConfig.subtypes.find(
      (s: { key: string }) => s.key === subtype,
    );
    return st ? rl(st.label, st.translations) : subtype;
  };

  const HealthDot = ({ value, label }: { value: string; label: string }) => (
    <Box display="flex" alignItems="center" gap={1}>
      <Box
        sx={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          bgcolor: RAG_COLORS[value] || "#bdbdbd",
        }}
      />
      <Typography variant="body2">{label}</Typography>
    </Box>
  );

  return (
    <Grid container spacing={2}>
      {/* Health Summary */}
      <Grid item xs={12} md={6}>
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={600} mb={2}>
            {t("healthSummary")}
          </Typography>
          {latestReport ? (
            <Box display="flex" gap={4}>
              <HealthDot
                value={latestReport.schedule_health}
                label={t("health_schedule")}
              />
              <HealthDot
                value={latestReport.cost_health}
                label={t("health_cost")}
              />
              <HealthDot
                value={latestReport.scope_health}
                label={t("health_scope")}
              />
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t("noReportsYet")}
            </Typography>
          )}
        </Paper>
      </Grid>

      {/* Financials */}
      <Grid item xs={12} md={6}>
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={600} mb={2}>
            {t("financials")}
          </Typography>
          <Box display="flex" gap={4}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("totalPlanned")}
              </Typography>
              <Typography variant="h6" fontWeight={600}>
                {fmt.format(totalPlanned)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("totalActual")}
              </Typography>
              <Typography variant="h6" fontWeight={600}>
                {fmt.format(totalActual)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("variance")}
              </Typography>
              <Typography
                variant="h6"
                fontWeight={600}
                color={totalActual > totalPlanned ? "error" : "success.main"}
              >
                {fmt.format(totalPlanned - totalActual)}
              </Typography>
            </Box>
          </Box>
        </Paper>
      </Grid>

      {/* Timeline */}
      <Grid item xs={12} md={6}>
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={600} mb={1}>
            {t("timeline")}
          </Typography>
          <Box display="flex" gap={3}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("startDate")}
              </Typography>
              <Typography variant="body2">
                {(attrs.startDate as string) || "\u2014"}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("endDate")}
              </Typography>
              <Typography variant="body2">
                {(attrs.endDate as string) || "\u2014"}
              </Typography>
            </Box>
            {card.subtype && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t("subtype")}
                </Typography>
                <Box mt={0.5}>
                  <Chip label={resolveSubtype(card.subtype)} size="small" variant="outlined" />
                </Box>
              </Box>
            )}
          </Box>
        </Paper>
      </Grid>

      {/* Status */}
      <Grid item xs={12} md={6}>
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={600} mb={1}>
            {t("status")}
          </Typography>
          <Box display="flex" gap={3}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("initiativeStatus")}
              </Typography>
              <Typography variant="body2">
                {resolveOption("initiativeStatus", attrs.initiativeStatus)}
              </Typography>
            </Box>
          </Box>
        </Paper>
      </Grid>

      {/* Description */}
      {card.description && (
        <Grid item xs={12}>
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="subtitle1" fontWeight={600} mb={1}>
              {t("common:description", "Description")}
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
              {card.description}
            </Typography>
          </Paper>
        </Grid>
      )}
    </Grid>
  );
}
