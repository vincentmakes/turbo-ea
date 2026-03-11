import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/hooks/useCurrency";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveLabel } from "@/hooks/useResolveLabel";
import type { Card, PpmStatusReport, PpmCostLine, PpmBudgetLine } from "@/types";

const RAG_COLORS: Record<string, string> = {
  onTrack: "#4caf50",
  atRisk: "#ff9800",
  offTrack: "#f44336",
};

const BUDGET_BAR = "#5c6bc0";
const OVER_BUDGET = "#b71c1c";

interface Props {
  card: Card;
  latestReport: PpmStatusReport | null;
  costLines: PpmCostLine[];
  budgetLines: PpmBudgetLine[];
}

/** Format a number in compact "k" notation */
function fmtK(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(Math.round(n));
}

/** Reusable budget vs actual bar */
function BudgetBar({
  label,
  budget,
  actual,
  currency,
}: {
  label: string;
  budget: number;
  actual: number;
  currency: string;
}) {
  const pct = budget > 0 ? Math.min((actual / budget) * 100, 100) : 0;
  const over = actual > budget && budget > 0;
  const barColor = over ? OVER_BUDGET : BUDGET_BAR;
  const useK = Math.abs(budget) >= 1_000 || Math.abs(actual) >= 1_000;
  const unit = useK ? `k${currency}` : currency;
  const aVal = useK ? fmtK(actual) : String(Math.round(actual));
  const pVal = useK ? fmtK(budget) : String(Math.round(budget));

  return (
    <Box sx={{ mb: 1.5 }}>
      <Box display="flex" justifyContent="space-between" alignItems="baseline" mb={0.25}>
        <Typography variant="body2" fontWeight={500}>
          {label}
        </Typography>
        <Typography
          variant="caption"
          sx={{ color: over ? OVER_BUDGET : "text.secondary" }}
        >
          {aVal}/{pVal} {unit}
          {budget > 0 && ` (${Math.round((actual / budget) * 100)}%)`}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          height: 10,
          borderRadius: 5,
          bgcolor: "action.hover",
          "& .MuiLinearProgress-bar": {
            bgcolor: barColor,
            borderRadius: 5,
          },
        }}
      />
    </Box>
  );
}

export default function PpmOverviewTab({
  card,
  latestReport,
  costLines,
  budgetLines,
}: Props) {
  const { t } = useTranslation("ppm");
  const { fmt, currency } = useCurrency();
  const { getType } = useMetamodel();
  const rl = useResolveLabel();
  const attrs = card.attributes || {};

  // Budget totals (from budget lines)
  const totalBudget = budgetLines.reduce((s, bl) => s + bl.amount, 0);
  const capexBudget = budgetLines
    .filter((b) => b.category === "capex")
    .reduce((s, b) => s + b.amount, 0);
  const opexBudget = budgetLines
    .filter((b) => b.category === "opex")
    .reduce((s, b) => s + b.amount, 0);

  // Actual totals (from cost lines)
  const totalActual = costLines.reduce((s, cl) => s + cl.actual, 0);
  const capexActual = costLines
    .filter((c) => c.category === "capex")
    .reduce((s, c) => s + c.actual, 0);
  const opexActual = costLines
    .filter((c) => c.category === "opex")
    .reduce((s, c) => s + c.actual, 0);

  const variance = totalBudget - totalActual;

  const typeConfig = getType(card.type);

  // Resolve a select field value to its translated label
  const resolveOption = (fieldKey: string, value: unknown): string => {
    if (!value || typeof value !== "string") return "\u2014";
    for (const section of typeConfig?.fields_schema || []) {
      for (const field of section.fields || []) {
        if (field.key === fieldKey && field.options) {
          const opt = field.options.find((o: { key: string }) => o.key === value);
          if (opt) return rl(opt.label, opt.translations);
        }
      }
    }
    return value;
  };

  // Resolve subtype to translated label
  const resolveSubtype = (subtype: string | null | undefined): string | null => {
    if (!subtype || !typeConfig?.subtypes) return subtype || null;
    const st = typeConfig.subtypes.find((s: { key: string }) => s.key === subtype);
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

      {/* Budget Summary KPIs */}
      <Grid item xs={12} md={6}>
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={600} mb={2}>
            {t("financials")}
          </Typography>
          <Box display="flex" gap={4}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("totalBudget")}
              </Typography>
              <Typography variant="h6" fontWeight={600}>
                {fmt.format(totalBudget)}
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
                color={variance < 0 ? "error" : "success.main"}
              >
                {fmt.format(variance)}
              </Typography>
            </Box>
          </Box>
        </Paper>
      </Grid>

      {/* Budget vs Actual Bars */}
      <Grid item xs={12} md={6}>
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={600} mb={2}>
            {t("budgetAndCosts")}
          </Typography>
          <BudgetBar
            label={t("totalBudget")}
            budget={totalBudget}
            actual={totalActual}
            currency={currency}
          />
          <BudgetBar
            label={t("capex")}
            budget={capexBudget}
            actual={capexActual}
            currency={currency}
          />
          <BudgetBar
            label={t("opex")}
            budget={opexBudget}
            actual={opexActual}
            currency={currency}
          />
        </Paper>
      </Grid>

      {/* Timeline + Status */}
      <Grid item xs={12} md={6}>
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={600} mb={1}>
            {t("timeline")}
          </Typography>
          <Box display="flex" gap={3} mb={2}>
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
                  <Chip
                    label={resolveSubtype(card.subtype)}
                    size="small"
                    variant="outlined"
                  />
                </Box>
              </Box>
            )}
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("initiativeStatus")}
            </Typography>
            <Typography variant="body2">
              {resolveOption("initiativeStatus", attrs.initiativeStatus)}
            </Typography>
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
