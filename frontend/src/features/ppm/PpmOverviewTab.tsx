import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import LinkifiedText from "@/components/LinkifiedText";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import { useTranslation } from "react-i18next";
import { useTheme } from "@mui/material/styles";
import { useCurrency } from "@/hooks/useCurrency";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveLabel } from "@/hooks/useResolveLabel";
import { useCardSubtypeLabel } from "@/hooks/useCardSubtypeLabel";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useDateFormat } from "@/hooks/useDateFormat";
import { KPI_VALUE_SX } from "./ppmStyles";
import DerivedValue from "./DerivedValue";
import { financialTotals } from "./derivedFinancials";
import { compactAmount } from "./ppmPortfolioFormat";
import { BudgetBar, CompletionRing, HealthDot } from "./ppmVisuals";
import type {
  Card,
  PpmStatusReport,
  PpmCostLine,
  PpmBudgetLine,
  PpmRollupOut,
} from "@/types";

interface Props {
  card: Card;
  latestReport: PpmStatusReport | null;
  costLines: PpmCostLine[];
  budgetLines: PpmBudgetLine[];
  /** The initiatives beneath this one (`null` while unknown or unreadable). */
  rollup: PpmRollupOut | null;
}

/** The "beneath this initiative" block under the Financials bars. */
const BENEATH_SX = { mt: 2, pt: 1.5, borderTop: 1, borderColor: "divider" };

export default function PpmOverviewTab({
  card,
  latestReport,
  costLines,
  budgetLines,
  rollup,
}: Props) {
  const { t } = useTranslation("ppm");
  const theme = useTheme();
  const { fmt, currency } = useCurrency();
  // The KPI figures read in k / M so the derived glyph beside them cannot wrap them.
  const kpiAmount = (n: number) => compactAmount(n, currency, fmt.format);
  const { getType } = useMetamodel();
  const rl = useResolveLabel();
  const subtypeLabel = useCardSubtypeLabel();
  const { formatDate } = useDateFormat();
  const attrs = card.attributes || {};
  const budgetBarColor = theme.palette.primary.main;
  const overBudgetColor = theme.palette.error.dark;

  // Initiative completion. Ordered per initiative, and never the previous
  // initiative's figure while the next one loads.
  const { data: completion, error: completionError } = useApiQuery<{
    completion: number;
    wbs_count: number;
  }>(`/ppm/initiatives/${card.id}/completion`, { keepPreviousData: false });
  const completionPct = completion?.completion;
  // Stryker disable next-line ConditionalExpression,LogicalOperator: completionPct is read off completion, so the two are undefined together
  const completionLoading = completion === undefined || completionPct === undefined;

  // What the initiatives beneath this one add up to: read live by the page,
  // shown beside this initiative's own figures and in place of a side it has
  // no lines of its own for — never added to them. Absent while loading and
  // on failure: it is a secondary figure, not worth an error.
  const showBeneath = !!rollup && rollup.descendant_count > 0;
  const fmtSpanDate = (d: string | null) => (d ? formatDate(d) : "\u2014");

  // Each side is this initiative's own lines, or the initiatives' beneath it
  // when it has none of that kind (see derivedFinancials).
  const totals = financialTotals(budgetLines, costLines, rollup);
  const count = rollup?.descendant_count;
  const budgetTip = totals.budget.derived ? t("derivedBudgetTooltip", { count }) : undefined;
  const actualTip = totals.actual.derived ? t("derivedActualTooltip", { count }) : undefined;
  const varianceTip = [budgetTip, actualTip].filter(Boolean).join(" \u00b7 ") || undefined;
  const variance = totals.budget.total - totals.actual.total;

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
        {completionError ? (
          <Alert severity="error">
            {completionError.message || t("common:errors.generic")}
          </Alert>
        ) : completionLoading ? (
          <LinearProgress />
        ) : completion.wbs_count === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("noWbsItems")}
          </Typography>
        ) : (
          <Box display="flex" alignItems="center" gap={2}>
            <CompletionRing value={completionPct} />
            <Box>
              <Typography variant="body2" color="text.secondary">
                {t("completionDesc")}
              </Typography>
            </Box>
          </Box>
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
              <DerivedValue tip={budgetTip}>{kpiAmount(totals.budget.total)}</DerivedValue>
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("totalActual")}
            </Typography>
            <Typography variant="h6" fontWeight={600} sx={KPI_VALUE_SX}>
              <DerivedValue tip={actualTip}>{kpiAmount(totals.actual.total)}</DerivedValue>
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
              <DerivedValue tip={varianceTip}>{kpiAmount(variance)}</DerivedValue>
            </Typography>
          </Box>
        </Box>
        <BudgetBar
          label={t("budgetBarTotal")}
          budget={totals.budget.total}
          actual={totals.actual.total}
          currency={currency}
          barColor={budgetBarColor}
          overColor={overBudgetColor}
          derivedBudget={totals.budget.derived}
          derivedActual={totals.actual.derived}
        />
        <BudgetBar
          label={t("capex")}
          budget={totals.budget.capex}
          actual={totals.actual.capex}
          currency={currency}
          barColor={budgetBarColor}
          overColor={overBudgetColor}
          derivedBudget={totals.budget.derived}
          derivedActual={totals.actual.derived}
        />
        <BudgetBar
          label={t("opex")}
          budget={totals.budget.opex}
          actual={totals.actual.opex}
          currency={currency}
          barColor={budgetBarColor}
          overColor={overBudgetColor}
          derivedBudget={totals.budget.derived}
          derivedActual={totals.actual.derived}
        />
        {showBeneath && (
          <Box data-testid="ppm-beneath" sx={BENEATH_SX}>
            <Typography variant="body2" fontWeight={600}>
              {t("beneathThisInitiative", { count: rollup.descendant_count })}
            </Typography>
            {/* When both sides are already the figures beneath, the KPIs say it. */}
            {!(totals.budget.derived && totals.actual.derived) && (
              <Typography variant="body2" color="text.secondary">
                {t("beneathFigures", {
                  budget: fmt.format(rollup.total_planned),
                  actual: fmt.format(rollup.total_actual),
                })}
              </Typography>
            )}
            {(rollup.start_date || rollup.end_date) && (
              <Typography variant="body2" color="text.secondary">
                {t("beneathSpan", {
                  from: fmtSpanDate(rollup.start_date),
                  to: fmtSpanDate(rollup.end_date),
                })}
              </Typography>
            )}
          </Box>
        )}
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
              {attrs.startDate ? formatDate(attrs.startDate as string) : "\u2014"}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("endDate")}
            </Typography>
            <Typography variant="body2">
              {attrs.endDate ? formatDate(attrs.endDate as string) : "\u2014"}
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
            {t("common:labels.description")}
          </Typography>
          <Typography
            variant="body2"
            sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          >
            <LinkifiedText text={card.description} />
          </Typography>
        </Paper>
      )}
    </Box>
  );
}
