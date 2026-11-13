/**
 * An initiative's report: one read-only page of what its tabs show — the
 * overview, the status reports, budget and costs, the risks and the schedule —
 * printed with the standard report print button, in landscape like every other
 * report.
 *
 * It is built from the app's own pieces and nothing else: `ReportShell` for the
 * title bar, the print header and the print button; `MetricCard` strips;
 * `SectionPaper` cards; the tabs' own building blocks (`HealthDot`,
 * `BudgetBar`, `StatusReportCard`, `PpmCostCharts`, the cost tables, the risk
 * chips, `PpmRiskMatrix`, `PpmScheduleTimeline`); MUI tables. The toolbar's
 * chips choose the sections, remembered per browser (`loadReportSections`);
 * showing only Risk Management is the risk report. `print.css` scopes its page
 * break rules to `.ppm-project-report`.
 */
import { lazy, Suspense, useState, type ReactNode } from "react";
import { Link as RouterLink, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { api, ApiError } from "@/api/client";
import LinkifiedText from "@/components/LinkifiedText";
import MaterialSymbol from "@/components/MaterialSymbol";
import SectionPaper from "@/features/dashboard/workspace/SectionPaper";
import MetricCard from "@/features/reports/MetricCard";
import ReportShell, { type PrintParam } from "@/features/reports/ReportShell";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { useCardSubtypeLabel } from "@/hooks/useCardSubtypeLabel";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useFiscalYearStart } from "@/hooks/useFiscalYearStart";
import { useMetamodel } from "@/hooks/useMetamodel";
import { usePageSection, usePageSubject } from "@/hooks/usePageTitle";
import { useOptionLabel } from "@/hooks/useResolveLabel";
import { CARD_TYPE_COLORS, iconSize } from "@/theme/tokens";
import type {
  Card,
  PpmBudgetLine,
  PpmCostLine,
  PpmRisk,
  PpmRollupOut,
  PpmStatusReport,
  PpmTask,
  PpmWbs,
} from "@/types";
import { groupBudgetLines, groupCostLines } from "./costTableGroups";
import DerivedValue from "./DerivedValue";
import { derivedYearGroups, financialTotals } from "./derivedFinancials";
import { BudgetTable, CostTable } from "./PpmCostTables";
import PpmRiskMatrix from "./PpmRiskMatrix";
import PpmScheduleTimeline from "./PpmScheduleTimeline";
import StatusReportCard, { ReportHealth } from "./StatusReportCard";
import { useHealthRatingLabel } from "./ppmHealth";
import { compactAmount } from "./ppmPortfolioFormat";
import {
  REPORT_SECTIONS,
  loadReportSections,
  orderedSections,
  riskStatusCounts,
  saveReportSections,
  type ReportSection,
} from "./ppmReportModel";
import { RiskScoreChip, RiskStatusChip } from "./ppmRiskChips";
import { bandColor, riskSummary, sortRisksForPrint } from "./ppmRiskModel";
import { BudgetBar, HealthDot } from "./ppmVisuals";

// Lazy, as on the Budget & Costs tab: ECharts stays out of the route chunk
// until a section that draws a chart is on screen.
const PpmCostCharts = lazy(() => import("./PpmCostCharts"));

/** Each section's label (the initiative tab it mirrors) and its glyph. */
const SECTION_META: Record<ReportSection, { labelKey: string; icon: string }> = {
  overview: { labelKey: "overview", icon: "dashboard" },
  reports: { labelKey: "statusReports", icon: "summarize" },
  costs: { labelKey: "budgetAndCosts", icon: "payments" },
  risks: { labelKey: "riskManagement", icon: "shield" },
  schedule: { labelKey: "pdfSchedule", icon: "view_timeline" },
};

interface Completion {
  completion: number;
  wbs_count: number;
}

interface ReportData {
  card: Card;
  reports: PpmStatusReport[];
  costLines: PpmCostLine[];
  budgetLines: PpmBudgetLine[];
  risks: PpmRisk[];
  /** Secondary reads: `null` when they could not be read. */
  rollup: PpmRollupOut | null;
  completion: Completion | null;
  wbs: PpmWbs[] | null;
  tasks: PpmTask[] | null;
}

/** A secondary read: its failure degrades its part of the page, never the page. */
const orNull = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

/** A MUI table's header row, as §3.6 has it. */
const HEAD_ROW_SX = { bgcolor: "action.hover" } as const;
/** Free text keeps the author's line breaks and never overflows its cell. */
const FREE_TEXT_SX = { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } as const;
/** A strip of `MetricCard`s, as the other reports lay them out. */
const STRIP_SX = { display: "flex", gap: 2, flexWrap: "wrap", mb: 2 } as const;

export default function PpmProjectReport() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation(["ppm", "common"]);
  const { getType } = useMetamodel();
  const subtypeLabel = useCardSubtypeLabel();
  const statusLabel = useInitiativeStatusLabel();
  const { formatDate, formatDateTime } = useDateFormat();

  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sections, setSections] = useState<ReportSection[]>(loadReportSections);

  usePageSubject(data?.card.name);
  usePageSection(t("pdfDocumentTitle"));

  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (!id) return;
      setLoading(true);
      setError("");
      setData(null);
      const base = `/ppm/initiatives/${id}`;
      try {
        const [card, reports, costLines, budgetLines, risks, rollup, completion, wbs, tasks] =
          await Promise.all([
            api.get<Card>(`/cards/${id}`, { signal }),
            api.get<PpmStatusReport[]>(`${base}/reports`, { signal }),
            api.get<PpmCostLine[]>(`${base}/costs`, { signal }),
            api.get<PpmBudgetLine[]>(`${base}/budgets`, { signal }),
            api.get<PpmRisk[]>(`${base}/risks`, { signal }),
            orNull(api.get<PpmRollupOut>(`${base}/rollup`, { signal })),
            orNull(api.get<Completion>(`${base}/completion`, { signal })),
            orNull(api.get<PpmWbs[]>(`${base}/wbs`, { signal })),
            orNull(api.get<PpmTask[]>(`${base}/tasks`, { signal })),
          ]);
        if (!isCurrent()) return;
        setData({
          card,
          reports,
          costLines,
          budgetLines,
          risks,
          rollup,
          completion,
          wbs,
          tasks,
        });
      } catch (e) {
        if (!isCurrent()) return;
        if (e instanceof ApiError && e.status === 403) setError(t("common:errors.forbidden"));
        else if (e instanceof ApiError && e.status === 404) setError(t("common:errors.notFound"));
        else setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [id],
  );

  const backLink = (
    <Tooltip title={t("reportBackToInitiative")}>
      <IconButton
        size="small"
        component={RouterLink}
        to={`/ppm/${id}`}
        aria-label={t("reportBackToInitiative")}
      >
        <MaterialSymbol icon="arrow_back" size={20} />
      </IconButton>
    </Tooltip>
  );

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight={240}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !data) {
    return (
      <Box>
        <Box mb={2}>{backLink}</Box>
        <Alert severity="error">{error || t("common:errors.notFound")}</Alert>
      </Box>
    );
  }

  const { card } = data;
  const typeConfig = getType(card.type);
  const attrs = card.attributes || {};

  const dateOf = (v: unknown) => (typeof v === "string" && v ? formatDate(v) : "");

  const printParams: PrintParam[] = [
    { label: t("subtype"), value: card.subtype ? subtypeLabel(card.type, card.subtype) : "" },
    { label: t("initiativeStatus"), value: statusLabel(card) },
    { label: t("startDate"), value: dateOf(attrs.startDate) },
    { label: t("endDate"), value: dateOf(attrs.endDate) },
    { label: t("reportPrinted"), value: formatDateTime(new Date()) },
  ];

  const toggle = (section: ReportSection) => {
    const next = sections.includes(section)
      ? sections.filter((s) => s !== section)
      : orderedSections([...sections, section]);
    setSections(next);
    saveReportSections(next);
  };

  const toolbar = (
    <Box
      role="group"
      aria-label={t("pdfSections")}
      sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}
    >
      <Typography variant="body2" color="text.secondary">
        {t("pdfSections")}
      </Typography>
      {REPORT_SECTIONS.map((s) => {
        const on = sections.includes(s);
        return (
          <Chip
            key={s}
            size="small"
            icon={<MaterialSymbol icon={SECTION_META[s].icon} size={iconSize.xs} />}
            label={t(SECTION_META[s].labelKey)}
            color={on ? "primary" : "default"}
            variant={on ? "filled" : "outlined"}
            aria-pressed={on}
            onClick={() => toggle(s)}
          />
        );
      })}
    </Box>
  );

  const typeIcon = typeConfig?.icon || "rocket_launch";
  const typeColor = typeConfig?.color || CARD_TYPE_COLORS.Initiative;

  return (
    <ReportShell
      title={card.name}
      icon={typeIcon}
      iconColor={typeColor}
      hasTableToggle={false}
      disableExport
      disableSavedReportsLink
      actions={backLink}
      toolbar={toolbar}
      printParams={printParams}
    >
      <Box className="ppm-project-report">
        {sections.length === 0 && (
          <Typography
            variant="body2"
            color="text.secondary"
            align="center"
            sx={{ py: 6 }}
            data-testid="report-no-sections"
          >
            {t("reportNoSections")}
          </Typography>
        )}
        {sections.includes("overview") && <OverviewSection data={data} />}
        {sections.includes("reports") && <ReportsSection reports={data.reports} />}
        {sections.includes("costs") && <CostsSection data={data} />}
        {sections.includes("risks") && <RisksSection risks={data.risks} />}
        {sections.includes("schedule") && <ScheduleSection wbs={data.wbs} tasks={data.tasks} />}
      </Box>
    </ReportShell>
  );
}

// ─── Frame ──────────────────────────────────────────────────────────────────

/**
 * The initiative's status in words: the translated label of its
 * `initiativeStatus` option, the stored value when the option is unknown, ""
 * when there is none.
 */
function useInitiativeStatusLabel(): (card: Card) => string {
  const { getType } = useMetamodel();
  const optionLabel = useOptionLabel();
  return (card) => {
    const value = card.attributes?.initiativeStatus;
    if (!value || typeof value !== "string") return "";
    for (const section of getType(card.type)?.fields_schema || []) {
      for (const field of section.fields || []) {
        if (field.key !== "initiativeStatus") continue;
        const opt = field.options?.find((o) => o.key === value);
        if (opt) return optionLabel(opt);
      }
    }
    return value;
  };
}

/** One section: its heading with the section's glyph, then its cards. */
function Section({ section, children }: { section: ReportSection; children: ReactNode }) {
  const { t } = useTranslation("ppm");
  const meta = SECTION_META[section];
  return (
    <Box component="section" data-report-section={section} sx={{ mb: 4 }}>
      <Box
        className="ppm-report-heading"
        sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}
      >
        <MaterialSymbol icon={meta.icon} size={iconSize.lg} color="primary.main" />
        <Typography variant="h6" component="h2" fontWeight={600}>
          {t(meta.labelKey)}
        </Typography>
      </Box>
      {children}
    </Box>
  );
}

/** A section with nothing to show says so, in an outlined card. */
function EmptySection({ text }: { text: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="body2" color="text.secondary" align="center">
        {text}
      </Typography>
    </Paper>
  );
}

/** A table's heading above it, as the Budget & Costs tab heads its tables. */
function TableHeading({ children }: { children: ReactNode }) {
  return (
    <Typography variant="subtitle1" fontWeight={600} mb={1}>
      {children}
    </Typography>
  );
}

// ─── Money ──────────────────────────────────────────────────────────────────

/**
 * The figures this page shows for an initiative's money: every amount on a
 * tile reads in one rule (`compactAmount`, the tabs' KPI rule), and each
 * derived side carries its tooltip text, which the page also prints.
 */
function useMoney(data: ReportData) {
  const { t } = useTranslation("ppm");
  const { fmt, currency } = useCurrency();
  const totals = financialTotals(data.budgetLines, data.costLines, data.rollup);
  const count = data.rollup?.descendant_count;
  const budgetNote = totals.budget.derived ? t("derivedBudgetTooltip", { count }) : undefined;
  const actualNote = totals.actual.derived ? t("derivedActualTooltip", { count }) : undefined;
  const varianceNote = [budgetNote, actualNote].filter(Boolean).join(" · ") || undefined;
  return {
    totals,
    count,
    budgetNote,
    actualNote,
    varianceNote,
    variance: totals.budget.total - totals.actual.total,
    amount: (n: number) => compactAmount(n, currency, fmt.format),
    currency,
    fmt,
  };
}

/**
 * The derivation of every derived figure above, in words: the tab says it in
 * a tooltip, which a printed page cannot show.
 */
function DerivedNotes({ notes }: { notes: (string | undefined)[] }) {
  const shown = notes.filter((n): n is string => !!n);
  if (shown.length === 0) return null;
  return (
    <Box data-testid="report-derived-notes" sx={{ mt: -1, mb: 2 }}>
      {shown.map((note) => (
        <Box key={note} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <MaterialSymbol icon="subdirectory_arrow_right" size={iconSize.xs} color="text.secondary" />
          <Typography variant="caption" color="text.secondary">
            {note}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/** The variance tile's colour: the number is a verdict. */
function useVarianceColor(variance: number): string {
  const theme = useTheme();
  return variance < 0 ? theme.palette.error.main : theme.palette.success.main;
}

// ─── Overview ───────────────────────────────────────────────────────────────

function OverviewSection({ data }: { data: ReportData }) {
  const { t } = useTranslation(["ppm", "common"]);
  const theme = useTheme();
  const { formatDate } = useDateFormat();
  const subtypeLabel = useCardSubtypeLabel();
  const ratingLabel = useHealthRatingLabel();
  const statusLabel = useInitiativeStatusLabel();
  const money = useMoney(data);
  const varianceColor = useVarianceColor(money.variance);
  const { card, rollup, completion } = data;
  const attrs = card.attributes || {};
  const latest = data.reports[0] ?? null;
  const { totals } = money;

  const completionValue =
    completion && completion.wbs_count > 0 ? `${Math.round(completion.completion)}%` : "—";
  const completionNote = !completion
    ? undefined
    : completion.wbs_count > 0
      ? t("completionDesc")
      : t("noWbsItems");

  const status = statusLabel(card) || "—";
  const dateText = (v: unknown) => (typeof v === "string" && v ? formatDate(v) : "—");

  const bar = (label: string, budget: number, actual: number) => (
    <BudgetBar
      label={label}
      budget={budget}
      actual={actual}
      currency={money.currency}
      barColor={theme.palette.primary.main}
      overColor={theme.palette.error.dark}
      derivedBudget={totals.budget.derived}
      derivedActual={totals.actual.derived}
    />
  );
  const showBeneath = !!rollup && rollup.descendant_count > 0;
  const spanDate = (d: string | null) => (d ? formatDate(d) : "—");

  return (
    <Section section="overview">
      <Box className="ppm-report-tiles" sx={STRIP_SX}>
        <MetricCard
          label={t("totalBudget")}
          icon="savings"
          value={<DerivedValue tip={money.budgetNote}>{money.amount(totals.budget.total)}</DerivedValue>}
        />
        <MetricCard
          label={t("totalActual")}
          icon="payments"
          value={<DerivedValue tip={money.actualNote}>{money.amount(totals.actual.total)}</DerivedValue>}
        />
        <MetricCard
          label={t("variance")}
          icon="balance"
          color={varianceColor}
          iconColor={varianceColor}
          value={<DerivedValue tip={money.varianceNote}>{money.amount(money.variance)}</DerivedValue>}
        />
        <MetricCard
          label={t("completion")}
          icon="donut_large"
          value={completionValue}
          subtitle={completionNote}
        />
      </Box>
      <DerivedNotes notes={[money.budgetNote, money.actualNote]} />

      <Box
        className="ppm-report-cards"
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" },
          gap: 2,
        }}
      >
        <SectionPaper icon="monitor_heart" title={t("healthSummary")}>
          {latest ? (
            <Box display="flex" flexDirection="column" gap={1.5} data-testid="report-health">
              <HealthDot
                value={latest.schedule_health}
                label={t("health_schedule")}
                rating={ratingLabel(latest.schedule_health)}
              />
              <HealthDot
                value={latest.cost_health}
                label={t("health_cost")}
                rating={ratingLabel(latest.cost_health)}
              />
              <HealthDot
                value={latest.scope_health}
                label={t("health_scope")}
                rating={ratingLabel(latest.scope_health)}
              />
              <Typography variant="caption" color="text.secondary">
                {t("reportLatestOn", { date: formatDate(latest.report_date) })}
              </Typography>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t("noReportsYet")}
            </Typography>
          )}
        </SectionPaper>

        <SectionPaper icon="account_balance_wallet" title={t("financials")}>
          {bar(t("budgetBarTotal"), totals.budget.total, totals.actual.total)}
          {bar(t("capex"), totals.budget.capex, totals.actual.capex)}
          {bar(t("opex"), totals.budget.opex, totals.actual.opex)}
          {showBeneath && (
            <Box
              data-testid="report-beneath"
              sx={{ mt: 2, pt: 1.5, borderTop: 1, borderColor: "divider" }}
            >
              <Typography variant="body2" fontWeight={600}>
                {t("beneathThisInitiative", { count: rollup.descendant_count })}
              </Typography>
              {!(totals.budget.derived && totals.actual.derived) && (
                <Typography variant="body2" color="text.secondary">
                  {t("beneathFigures", {
                    budget: money.fmt.format(rollup.total_planned),
                    actual: money.fmt.format(rollup.total_actual),
                  })}
                </Typography>
              )}
              {(rollup.start_date || rollup.end_date) && (
                <Typography variant="body2" color="text.secondary">
                  {t("beneathSpan", {
                    from: spanDate(rollup.start_date),
                    to: spanDate(rollup.end_date),
                  })}
                </Typography>
              )}
            </Box>
          )}
        </SectionPaper>

        <SectionPaper icon="event" title={t("timeline")}>
          <Box display="flex" gap={3} mb={2} flexWrap="wrap">
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("startDate")}
              </Typography>
              <Typography variant="body2">{dateText(attrs.startDate)}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("endDate")}
              </Typography>
              <Typography variant="body2">{dateText(attrs.endDate)}</Typography>
            </Box>
            {card.subtype && (
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">
                  {t("subtype")}
                </Typography>
                <Box mt={0.5}>
                  <Chip
                    label={subtypeLabel(card.type, card.subtype)}
                    size="small"
                    variant="outlined"
                    sx={{ maxWidth: "100%" }}
                  />
                </Box>
              </Box>
            )}
          </Box>
          <Typography variant="caption" color="text.secondary">
            {t("initiativeStatus")}
          </Typography>
          <Typography variant="body2">{status}</Typography>
        </SectionPaper>

        {card.description && (
          <Box sx={{ gridColumn: { md: "1 / -1" } }}>
            <SectionPaper icon="notes" title={t("common:labels.description")}>
              <Typography variant="body2" sx={FREE_TEXT_SX}>
                <LinkifiedText text={card.description} />
              </Typography>
            </SectionPaper>
          </Box>
        )}
      </Box>
    </Section>
  );
}

// ─── Status reports ─────────────────────────────────────────────────────────

function ReportsSection({ reports }: { reports: PpmStatusReport[] }) {
  const { t } = useTranslation("ppm");
  const { formatDate } = useDateFormat();
  if (reports.length === 0) {
    return (
      <Section section="reports">
        <EmptySection text={t("noReportsYet")} />
      </Section>
    );
  }
  const [latest, ...earlier] = reports;
  return (
    <Section section="reports">
      <TableHeading>{t("pdfLatestReport")}</TableHeading>
      <Box className="ppm-report-latest">
        <StatusReportCard report={latest} variant="outlined" showRatings />
      </Box>
      {earlier.length > 0 && (
        <>
          <TableHeading>{t("pdfEarlierReports")}</TableHeading>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small" data-testid="report-earlier-table">
              <TableHead>
                <TableRow sx={HEAD_ROW_SX}>
                  <TableCell>{t("reportDate")}</TableCell>
                  <TableCell>{t("reporter")}</TableCell>
                  <TableCell>{t("healthSummary")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {earlier.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{formatDate(r.report_date)}</TableCell>
                    <TableCell>{r.reporter?.display_name ?? "—"}</TableCell>
                    <TableCell>
                      <ReportHealth report={r} showRating />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Section>
  );
}

// ─── Budget & costs ─────────────────────────────────────────────────────────

function CostsSection({ data }: { data: ReportData }) {
  const { t } = useTranslation("ppm");
  const { month: fyStart } = useFiscalYearStart();
  const money = useMoney(data);
  const varianceColor = useVarianceColor(money.variance);
  const { totals } = money;
  const { budgetLines, costLines, rollup } = data;
  const pair = (actual: number, budget: number) => ({
    value: money.amount(actual),
    subtitle: t("pdfOfBudget", { amount: money.amount(budget) }),
  });
  const capex = pair(totals.actual.capex, totals.budget.capex);
  const opex = pair(totals.actual.opex, totals.budget.opex);

  return (
    <Section section="costs">
      <Box className="ppm-report-tiles" sx={STRIP_SX}>
        <MetricCard
          label={t("totalBudget")}
          icon="savings"
          value={<DerivedValue tip={money.budgetNote}>{money.amount(totals.budget.total)}</DerivedValue>}
        />
        <MetricCard
          label={t("totalActual")}
          icon="payments"
          value={<DerivedValue tip={money.actualNote}>{money.amount(totals.actual.total)}</DerivedValue>}
        />
        <MetricCard
          label={t("variance")}
          icon="balance"
          color={varianceColor}
          iconColor={varianceColor}
          value={<DerivedValue tip={money.varianceNote}>{money.amount(money.variance)}</DerivedValue>}
        />
        <MetricCard
          label={t("capex")}
          icon="account_balance"
          value={<DerivedValue tip={money.actualNote}>{capex.value}</DerivedValue>}
          subtitle={capex.subtitle}
        />
        <MetricCard
          label={t("opex")}
          icon="receipt_long"
          value={<DerivedValue tip={money.actualNote}>{opex.value}</DerivedValue>}
          subtitle={opex.subtitle}
        />
      </Box>
      <DerivedNotes notes={[money.budgetNote, money.actualNote]} />

      <Suspense fallback={null}>
        <PpmCostCharts readOnly costLines={costLines} budgetLines={budgetLines} />
      </Suspense>

      <TableHeading>{t("plannedBudget")}</TableHeading>
      <BudgetTable
        readOnly
        expandAll
        groups={groupBudgetLines(budgetLines)}
        derived={
          totals.budget.derived
            ? { rows: derivedYearGroups(rollup, "budget"), totals: totals.budget }
            : null
        }
        derivedCount={money.count}
      />
      <TableHeading>{t("costItems")}</TableHeading>
      <CostTable
        readOnly
        expandAll
        groups={groupCostLines(costLines, fyStart)}
        derived={
          totals.actual.derived
            ? { rows: derivedYearGroups(rollup, "cost"), totals: totals.actual }
            : null
        }
        derivedCount={money.count}
      />
    </Section>
  );
}

// ─── Risks ──────────────────────────────────────────────────────────────────

function RisksSection({ risks }: { risks: PpmRisk[] }) {
  const { t } = useTranslation("ppm");
  if (risks.length === 0) {
    return (
      <Section section="risks">
        <EmptySection text={t("noRisks")} />
      </Section>
    );
  }
  const summary = riskSummary(risks);
  const highColor = summary.high > 0 ? bandColor("high") : undefined;
  return (
    <Section section="risks">
      <Box className="ppm-report-tiles" sx={STRIP_SX}>
        <MetricCard label={t("totalRisks")} icon="shield" value={summary.total} />
        <MetricCard label={t("riskStatusOpen")} icon="pending_actions" value={summary.open} />
        <MetricCard
          label={t("highRisks")}
          icon="error"
          value={summary.high}
          color={highColor}
          iconColor={highColor}
        />
      </Box>

      <Box
        className="ppm-report-cards"
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "2fr 1fr" },
          gap: 2,
          mb: 2,
        }}
      >
        <SectionPaper icon="grid_on" title={t("pdfHeatMapTitle")}>
          <PpmRiskMatrix risks={risks} />
        </SectionPaper>
        <SectionPaper icon="traffic" title={t("pdfByStatus")}>
          <Box display="flex" flexDirection="column" gap={1} data-testid="report-risk-status">
            {riskStatusCounts(risks).map(({ status, count }) => (
              <Box key={status} display="flex" alignItems="center" justifyContent="space-between">
                <RiskStatusChip status={status} />
                <Typography variant="body2" fontWeight={600}>
                  {count}
                </Typography>
              </Box>
            ))}
          </Box>
        </SectionPaper>
      </Box>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small" data-testid="report-risk-table">
          <TableHead>
            <TableRow sx={HEAD_ROW_SX}>
              <TableCell>{t("riskGridColumnRisk")}</TableCell>
              <TableCell>{t("riskScore")}</TableCell>
              <TableCell>{t("riskStatus")}</TableCell>
              <TableCell>{t("riskOwner")}</TableCell>
              <TableCell>{t("mitigation")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortRisksForPrint(risks).map((r) => (
              <TableRow key={r.id} sx={{ verticalAlign: "top" }}>
                <TableCell sx={{ width: "34%" }}>
                  <Typography variant="body2" fontWeight={600}>
                    {r.title}
                  </Typography>
                  {r.description && (
                    <Typography variant="body2" color="text.secondary" sx={FREE_TEXT_SX}>
                      <LinkifiedText text={r.description} />
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <RiskScoreChip risk={r} />
                </TableCell>
                <TableCell>
                  <RiskStatusChip status={r.status} />
                </TableCell>
                <TableCell>{r.owner_name || "—"}</TableCell>
                <TableCell sx={{ width: "34%" }}>
                  <Typography variant="body2" sx={FREE_TEXT_SX}>
                    {r.mitigation ? <LinkifiedText text={r.mitigation} /> : "—"}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Section>
  );
}

// ─── Schedule ───────────────────────────────────────────────────────────────

function ScheduleSection({ wbs, tasks }: { wbs: PpmWbs[] | null; tasks: PpmTask[] | null }) {
  const { t } = useTranslation(["ppm", "common"]);
  if (wbs === null || tasks === null) {
    return (
      <Section section="schedule">
        <Alert severity="error">{t("common:errors.generic")}</Alert>
      </Section>
    );
  }
  return (
    <Section section="schedule">
      {wbs.length === 0 && tasks.length === 0 ? (
        <EmptySection text={t("pdfNoneRecorded")} />
      ) : (
        <PpmScheduleTimeline wbs={wbs} tasks={tasks} />
      )}
    </Section>
  );
}
