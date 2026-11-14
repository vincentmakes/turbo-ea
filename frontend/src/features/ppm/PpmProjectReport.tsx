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
import { lazy, Suspense, useRef, useState, type ReactNode } from "react";
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
import type { ReportExportData, ReportExportSection } from "@/features/reports/reportExport";
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
  REPORT_EXPORT_ROWS,
  REPORT_SECTIONS,
  exportableSections,
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

// Stryker disable all: the page's static layout (flex rows, grids, spacing, cell widths, responsive columns); jsdom lays nothing out and evaluates no media query, so no test can observe it
/** The section chips' row. */
const TOOLBAR_SX = { display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" } as const;
/** The "no section is shown" line. */
const NO_SECTIONS_SX = { py: 6 } as const;
/** One section, and its heading row. */
const SECTION_SX = { mb: 4 } as const;
const SECTION_HEADING_SX = { display: "flex", alignItems: "center", gap: 1, mb: 2 } as const;
/** The outlined card an empty section shows. */
const EMPTY_SECTION_SX = { p: 3 } as const;
/** The derived-figure notes under a tile strip, and one note's row. */
const DERIVED_NOTES_SX = { mt: -1, mb: 2 } as const;
const DERIVED_NOTE_SX = { display: "flex", alignItems: "center", gap: 0.5 } as const;
/** The overview's card grid: one column on a phone, three from md. */
const OVERVIEW_GRID_SX = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" },
  gap: 2,
} as const;
/** The "beneath this initiative" block under the budget bars. */
const BENEATH_SX = { mt: 2, pt: 1.5, borderTop: 1, borderColor: "divider" } as const;
/** The subtype's column and its chip, which never overflow the card. */
const SUBTYPE_BOX_SX = { minWidth: 0 } as const;
const SUBTYPE_CHIP_SX = { maxWidth: "100%" } as const;
/** A card of the overview's grid that spans the whole row from md. */
const FULL_ROW_SX = { gridColumn: { md: "1 / -1" } } as const;
/** A date cell never breaks. */
const DATE_CELL_SX = { whiteSpace: "nowrap" } as const;
/** The risks' card grid: one column on a phone, matrix and statuses from md. */
const RISK_GRID_SX = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", md: "2fr 1fr" },
  gap: 2,
  mb: 2,
} as const;
/** A risk row's cells align to the top; its two free-text cells share the width. */
const RISK_ROW_SX = { verticalAlign: "top" } as const;
const RISK_TEXT_CELL_SX = { width: "34%" } as const;
// Stryker restore all

export default function PpmProjectReport() {
  const { id } = useParams<{ id: string }>();
  // Stryker disable next-line StringLiteral: equivalent: every common key here is written "common:…" and all namespaces are bundled at init, so the "common" entry changes no lookup (the "ppm" entry is pinned by every visible-text test)
  const { t } = useTranslation(["ppm", "common"]);
  const { getType } = useMetamodel();
  const subtypeLabel = useCardSubtypeLabel();
  const statusLabel = useInitiativeStatusLabel();
  const { formatDate, formatDateTime } = useDateFormat();

  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  // Stryker disable next-line StringLiteral: equivalent: loading starts true and the effect clears error before it can clear loading, so the initial error is never rendered
  const [error, setError] = useState("");
  const [sections, setSections] = useState<ReportSection[]>(loadReportSections);
  const chartRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();

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
        // Stryker disable next-line StringLiteral: equivalent: an empty error falls back to the same "common:errors.notFound" text where it is rendered
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

  // What the initiative is; the print header adds when it was printed, the
  // deck says when it was generated on its own.
  const cardParams: PrintParam[] = [
    { label: t("subtype"), value: card.subtype ? subtypeLabel(card.type, card.subtype) : "" },
    { label: t("initiativeStatus"), value: statusLabel(card) },
    { label: t("startDate"), value: dateOf(attrs.startDate) },
    { label: t("endDate"), value: dateOf(attrs.endDate) },
  ];
  const printParams: PrintParam[] = [
    ...cardParams,
    { label: t("reportPrinted"), value: formatDateTime(new Date()) },
  ];

  const deckSections = exportableSections(sections, {
    reports: data.reports.length,
    costLines:
      data.budgetLines.length +
      data.costLines.length +
      (data.rollup?.has_budget_lines || data.rollup?.has_cost_lines ? 1 : 0),
    risks: data.risks.length,
    scheduleItems: data.wbs && data.tasks ? data.wbs.length + data.tasks.length : null,
  });

  /**
   * The PowerPoint deck: a title slide, then each section shown and not empty
   * on its own slide(s), a picture of the section's body under its name.
   */
  const buildExportData = (): ReportExportData => ({
    title: card.name,
    filterSummary: cardParams.filter((p) => p.value),
    sheets: [],
    // The page's surface behind each picture: in the dark theme its text is light.
    background: theme.palette.background.paper,
    // Every section in the deck is on the page: it is shown and not empty.
    sections: deckSections.map(
      (s): ReportExportSection => ({
        title: t(SECTION_META[s].labelKey),
        node: chartRef.current!.querySelector<HTMLElement>(
          `[data-report-section="${s}"] > [data-report-section-body]`,
        )!,
        paginateRowSelector: REPORT_EXPORT_ROWS,
      }),
    ),
  });

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
      sx={TOOLBAR_SX}
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
      // Stryker disable next-line BooleanLiteral: equivalent: with no onViewChange no toggle is drawn, exportFormats never allows xlsx, and the view stays "chart", so the pptx item shows either way
      hasTableToggle={false}
      chartRef={chartRef}
      // Stryker disable next-line ArrayDeclaration: equivalent for the empty list: any list without "pptx" or "xlsx" offers no export (the ["pptx"] branch is pinned by the export tests)
      exportFormats={deckSections.length > 0 ? ["pptx"] : []}
      buildExportData={buildExportData}
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
            sx={NO_SECTIONS_SX}
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
    // Stryker disable next-line ArrayDeclaration: equivalent: a stand-in section has no fields, so the loop finds nothing, as with no section
    for (const section of getType(card.type)?.fields_schema || []) {
      // Stryker disable next-line ArrayDeclaration: equivalent: a stand-in field has no key, so it is skipped, as with no field
      for (const field of section.fields || []) {
        if (field.key !== "initiativeStatus") continue;
        const opt = field.options?.find((o) => o.key === value);
        if (opt) return optionLabel(opt);
      }
    }
    return value;
  };
}

/**
 * One section: its heading with the section's glyph, then its body. The deck
 * pictures the body alone (`data-report-section-body`): its slide is headed
 * with the section's name already.
 */
function Section({ section, children }: { section: ReportSection; children: ReactNode }) {
  const { t } = useTranslation("ppm");
  const meta = SECTION_META[section];
  return (
    <Box component="section" data-report-section={section} sx={SECTION_SX}>
      <Box className="ppm-report-heading" sx={SECTION_HEADING_SX}>
        <MaterialSymbol icon={meta.icon} size={iconSize.lg} color="primary.main" />
        <Typography variant="h6" component="h2" fontWeight={600}>
          {t(meta.labelKey)}
        </Typography>
      </Box>
      <Box data-report-section-body>{children}</Box>
    </Box>
  );
}

/** A section with nothing to show says so, in an outlined card. */
function EmptySection({ text }: { text: string }) {
  return (
    <Paper variant="outlined" sx={EMPTY_SECTION_SX}>
      <Typography variant="body2" color="text.secondary" align="center">
        {text}
      </Typography>
    </Paper>
  );
}

/**
 * A table's heading above it, as the Budget & Costs tab heads its tables. In
 * the deck it never ends a slide (`data-export-heading`).
 */
function TableHeading({ children }: { children: ReactNode }) {
  return (
    <Typography variant="subtitle1" fontWeight={600} mb={1} data-export-heading>
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
    <Box data-testid="report-derived-notes" sx={DERIVED_NOTES_SX}>
      {shown.map((note) => (
        <Box key={note} sx={DERIVED_NOTE_SX}>
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
  // Stryker disable next-line StringLiteral: equivalent: its one common key is written "common:labels.description" and all namespaces are bundled at init (the "ppm" entry is pinned by the overview tests)
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
      <Box className="ppm-report-tiles" data-export-row sx={STRIP_SX}>
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

      <Box className="ppm-report-cards" sx={OVERVIEW_GRID_SX}>
        <SectionPaper data-export-row icon="monitor_heart" title={t("healthSummary")}>
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

        <SectionPaper data-export-row icon="account_balance_wallet" title={t("financials")}>
          {bar(t("budgetBarTotal"), totals.budget.total, totals.actual.total)}
          {bar(t("capex"), totals.budget.capex, totals.actual.capex)}
          {bar(t("opex"), totals.budget.opex, totals.actual.opex)}
          {showBeneath && (
            <Box data-testid="report-beneath" sx={BENEATH_SX}>
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

        <SectionPaper data-export-row icon="event" title={t("timeline")}>
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
              <Box sx={SUBTYPE_BOX_SX}>
                <Typography variant="caption" color="text.secondary">
                  {t("subtype")}
                </Typography>
                <Box mt={0.5}>
                  <Chip
                    label={subtypeLabel(card.type, card.subtype)}
                    size="small"
                    variant="outlined"
                    sx={SUBTYPE_CHIP_SX}
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
          <Box data-export-row sx={FULL_ROW_SX}>
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
      <Box className="ppm-report-latest" data-export-keep>
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
                    <TableCell sx={DATE_CELL_SX}>{formatDate(r.report_date)}</TableCell>
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
      <Box className="ppm-report-tiles" data-export-row sx={STRIP_SX}>
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
            ? // Stryker disable next-line StringLiteral: equivalent: derivedYearGroups reads every side but "budget" as the actuals, so "" reads them too
              { rows: derivedYearGroups(rollup, "cost"), totals: totals.actual }
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
      <Box className="ppm-report-tiles" data-export-row sx={STRIP_SX}>
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

      <Box className="ppm-report-cards" sx={RISK_GRID_SX}>
        <SectionPaper data-export-row icon="grid_on" title={t("pdfHeatMapTitle")}>
          <PpmRiskMatrix risks={risks} />
        </SectionPaper>
        <SectionPaper data-export-row icon="traffic" title={t("pdfByStatus")}>
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
              <TableRow key={r.id} sx={RISK_ROW_SX}>
                <TableCell sx={RISK_TEXT_CELL_SX}>
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
                <TableCell sx={RISK_TEXT_CELL_SX}>
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
  // Stryker disable next-line StringLiteral: equivalent: its one common key is written "common:errors.generic" and all namespaces are bundled at init (the "ppm" entry is pinned by the schedule tests)
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
