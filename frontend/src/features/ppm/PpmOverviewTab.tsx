import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import CircularProgress from "@mui/material/CircularProgress";
import { useTranslation } from "react-i18next";
import { useTheme } from "@mui/material/styles";
import { useCurrency } from "@/hooks/useCurrency";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveLabel } from "@/hooks/useResolveLabel";
import { useCardSubtypeLabel } from "@/hooks/useCardSubtypeLabel";
import { api } from "@/api/client";
import { KPI_VALUE_SX } from "./ppmStyles";
import type { Card, PpmStatusReport, PpmCostLine, PpmBudgetLine } from "@/types";

const RAG_COLORS: Record<string, string> = {
  onTrack: "#2e7d32",
  atRisk: "#ed6c02",
  offTrack: "#d32f2f",
};

interface Props {
  card: Card;
  latestReport: PpmStatusReport | null;
  costLines: PpmCostLine[];
  budgetLines: PpmBudgetLine[];
}

/** Format a number compactly. Pass `scale` to force a shared magnitude so a
 * budget/actual pair renders against one unit suffix. */
function fmtK(n: number, scale?: Scale): string {
  const s = scale ?? magnitude(n);
  if (s === "M") return (n / 1_000_000).toFixed(1);
  if (s === "k") return (n / 1_000).toFixed(0);
  return String(Math.round(n));
}

type Scale = "M" | "k" | "";

function magnitude(n: number): Scale {
  if (Math.abs(n) >= 1_000_000) return "M";
  if (Math.abs(n) >= 1_000) return "k";
  return "";
}

/** Health RAG dot. Module scope: defined inline it was a fresh component type
 * on every render, remounting the row each time. */
function HealthDot({ value, label }: { value: string; label: string }) {
  return (
    <Box display="flex" alignItems="center" gap={1}>
      <Box
        sx={{
          width: 16,
          height: 16,
          flexShrink: 0,
          borderRadius: "50%",
          bgcolor: RAG_COLORS[value] || "#bdbdbd",
        }}
      />
      <Typography variant="body2">{label}</Typography>
    </Box>
  );
}

/** Reusable budget vs actual bar */
function BudgetBar({
  label,
  budget,
  actual,
  currency,
  barColor,
  overColor,
}: {
  label: string;
  budget: number;
  actual: number;
  currency: string;
  barColor: string;
  overColor: string;
}) {
  const pct = budget > 0 ? Math.min((actual / budget) * 100, 100) : 0;
  const over = actual > budget && budget > 0;
  const color = over ? overColor : barColor;
  // One shared scale for both figures, and a unit suffix that matches it.
  // Deriving them separately rendered a 2.5M budget as "1.7M/2.5M kCHF".
  const scale = magnitude(Math.max(Math.abs(budget), Math.abs(actual)));
  const unit = `${scale}${currency}`;
  const aVal = fmtK(actual, scale);
  const pVal = fmtK(budget, scale);

  return (
    <Box sx={{ mb: 1.5 }}>
      <Box display="flex" justifyContent="space-between" alignItems="baseline" mb={0.25}>
        <Typography variant="body2" fontWeight={500}>
          {label}
        </Typography>
        <Typography
          variant="caption"
          sx={{ color: over ? overColor : "text.secondary" }}
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
            bgcolor: color,
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
  const theme = useTheme();
  const { fmt, currency } = useCurrency();
  const { getType } = useMetamodel();
  const rl = useResolveLabel();
  const subtypeLabel = useCardSubtypeLabel();
  const attrs = card.attributes || {};
  const budgetBarColor = theme.palette.primary.main;
  const overBudgetColor = theme.palette.error.dark;

  // Fetch initiative completion
  const [completionPct, setCompletionPct] = useState<number | null>(null);
  useEffect(() => {
    api
      .get<{ completion: number }>(`/ppm/initiatives/${card.id}/completion`)
      .then((r) => setCompletionPct(r.completion))
      .catch(() => {});
  }, [card.id]);

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
  const resolveSubtype = (subtype: string | null | undefined): string | null =>
    subtypeLabel(card.type, subtype) || null;

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
        gap: 2,
      }}
    >
      {/* Health Summary */}
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={2}>
          {t("healthSummary")}
        </Typography>
        {latestReport ? (
          <Box display="flex" gap={{ xs: 1.5, sm: 4 }} flexWrap="wrap">
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

      {/* Completion KPI */}
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={2}>
          {t("completion")}
        </Typography>
        {completionPct !== null ? (
          <Box display="flex" alignItems="center" gap={2}>
            <Box
              sx={{
                position: "relative",
                display: "inline-flex",
                flexShrink: 0,
              }}
            >
              <CircularProgress
                variant="determinate"
                value={completionPct}
                size={64}
                thickness={5}
                sx={{
                  color:
                    completionPct >= 80
                      ? theme.palette.success.main
                      : completionPct >= 40
                        ? theme.palette.warning.main
                        : theme.palette.error.main,
                }}
              />
              <Box
                sx={{
                  top: 0,
                  left: 0,
                  bottom: 0,
                  right: 0,
                  position: "absolute",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Typography
                  variant="body2"
                  fontWeight={700}
                  color="text.primary"
                >
                  {Math.round(completionPct)}%
                </Typography>
              </Box>
            </Box>
            <Box>
              <Typography variant="body2" color="text.secondary">
                {t("completionDesc")}
              </Typography>
            </Box>
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t("noWbsItems")}
          </Typography>
        )}
      </Paper>

      {/* Financials — KPIs + Budget Bars combined */}
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={2}>
          {t("financials")}
        </Typography>
        {/* auto-fit rather than a breakpoint: this Paper is half-width at md,
            so its width is not monotonic with the viewport and an { xs, md }
            rule would be wrong in the 900-1100px band. */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))",
            columnGap: 3,
            rowGap: 1.5,
            mb: 2.5,
          }}
        >
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("totalBudget")}
            </Typography>
            <Typography variant="h6" fontWeight={600} sx={KPI_VALUE_SX}>
              {fmt.format(totalBudget)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("totalActual")}
            </Typography>
            <Typography variant="h6" fontWeight={600} sx={KPI_VALUE_SX}>
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
              sx={KPI_VALUE_SX}
            >
              {fmt.format(variance)}
            </Typography>
          </Box>
        </Box>
        <BudgetBar
          label={t("budgetBarTotal")}
          budget={totalBudget}
          actual={totalActual}
          currency={currency}
          barColor={budgetBarColor}
          overColor={overBudgetColor}
        />
        <BudgetBar
          label={t("capex")}
          budget={capexBudget}
          actual={capexActual}
          currency={currency}
          barColor={budgetBarColor}
          overColor={overBudgetColor}
        />
        <BudgetBar
          label={t("opex")}
          budget={opexBudget}
          actual={opexActual}
          currency={currency}
          barColor={budgetBarColor}
          overColor={overBudgetColor}
        />
      </Paper>

      {/* Timeline + Status */}
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={600} mb={1}>
          {t("timeline")}
        </Typography>
        <Box display="flex" gap={{ xs: 2, sm: 3 }} mb={2} flexWrap="wrap">
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
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary">
                {t("subtype")}
              </Typography>
              <Box mt={0.5}>
                <Chip
                  label={resolveSubtype(card.subtype)}
                  size="small"
                  variant="outlined"
                  sx={{ maxWidth: "100%" }}
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

      {/* Description */}
      {card.description && (
        <Paper sx={{ p: 2.5, gridColumn: { md: "1 / -1" } }}>
          <Typography variant="subtitle1" fontWeight={600} mb={1}>
            {t("common:description", "Description")}
          </Typography>
          <Typography
            variant="body2"
            sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          >
            {card.description}
          </Typography>
        </Paper>
      )}
    </Box>
  );
}
