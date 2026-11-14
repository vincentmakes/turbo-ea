/**
 * Cumulative spend charts for the PPM Budget & Costs tab.
 *
 * Three views over data the tab already holds — no extra round-trip:
 *   1. cumulative CapEx / OpEx for one fiscal year (togglable), against dotted
 *      per-category budget lines;
 *   2. the same year combined into a single total, against the total budget;
 *   3. cumulative CapEx / OpEx across the whole project.
 *
 * All maths lives in `costChartData.ts` so it is testable without a DOM; this
 * file is presentation only.
 */
import { useMemo, useState, useEffect, useId } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Collapse from "@mui/material/Collapse";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import EChart, { EXPORT_DPR } from "@/components/charts/EChart";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import { useCurrency } from "@/hooks/useCurrency";
import { useFiscalYearStart } from "@/hooks/useFiscalYearStart";
import { fiscalYearLabel } from "@/lib/fiscalYear";
import { PPM_COST_COLORS } from "@/theme/tokens";
import type { PpmCostLine, PpmBudgetLine } from "@/types";
import {
  availableFiscalYears,
  budgetTotals,
  fiscalYearOptions,
  buildCumulativeSeries,
  countUndated,
  currentFiscalYear,
  fiscalYearMonths,
  projectMonthRange,
  type MonthPoint,
  type FiscalYearChoice,
} from "./costChartData";
import {
  loadCostChartPrefs,
  saveCostChartPrefs,
  resolveFiscalYear,
} from "./costChartPrefs";
import {
  buildCumulativeOption,
  categoryReferences,
  monthAxisLabels,
  type BudgetReference,
  type CumulativeLine,
} from "./cumulativeChartOption";

export interface PpmCostChartsProps {
  costLines: PpmCostLine[];
  budgetLines: PpmBudgetLine[];
  /**
   * For a page that is read, not worked in (the Initiative Report): no
   * fiscal-year picker, no collapse toggle, always expanded, and the stored
   * view preference is never written nor read for the collapse.
   */
  readOnly?: boolean;
  /**
   * With `readOnly`, the fiscal year the first two charts show (default: the
   * stored choice, resolved as on the tab; a year with no data here falls back
   * to the current one). Ignored otherwise: the picker decides.
   */
  fiscalYear?: FiscalYearChoice;
}

const CHART_HEIGHT = 260;
/** Three stacked charts at 260px is most of a phone screen; shrink on xs. */
const CHART_HEIGHT_SX = { xs: 200, sm: CHART_HEIGHT };

export default function PpmCostCharts({
  costLines,
  budgetLines,
  readOnly = false,
  fiscalYear,
}: PpmCostChartsProps) {
  const { t, i18n } = useTranslation("ppm");
  const theme = useTheme();
  const { fmt, fmtShort } = useCurrency();
  const { month: fyStart } = useFiscalYearStart();
  const headingId = useId();

  const [prefs] = useState(loadCostChartPrefs);
  const [pickedFy, setFyChoice] = useState<FiscalYearChoice>(prefs.fiscalYear);
  const [toggledOpen, setExpanded] = useState(prefs.expanded);
  // Read-only: the year handed in (else the stored one), always open.
  const fyChoice = readOnly ? (fiscalYear ?? pickedFy) : pickedFy;
  const expanded = readOnly || toggledOpen;

  useEffect(() => {
    // A read-only view changes nothing, so it records nothing.
    if (readOnly) return;
    saveCostChartPrefs({ fiscalYear: pickedFy, expanded: toggledOpen });
  }, [readOnly, pickedFy, toggledOpen]);

  // `today` is read once per render rather than per helper call so every chart
  // on screen agrees on where "now" is.
  const today = useMemo(() => new Date(), []);
  const currentFy = useMemo(() => currentFiscalYear(today, fyStart), [today, fyStart]);

  const years = useMemo(
    () => availableFiscalYears(costLines, budgetLines, fyStart),
    [costLines, budgetLines, fyStart],
  );

  // Newest first, with the current year in its natural slot.
  const yearOptions = useMemo(
    () => fiscalYearOptions(years, currentFy),
    [years, currentFy],
  );

  // A year stored from another initiative may have no data here; fall back to
  // the current fiscal year rather than rendering an empty chart.
  const activeFy = useMemo(
    () => resolveFiscalYear(fyChoice, years, currentFy),
    [fyChoice, years, currentFy],
  );

  // The current year renders as the "current" entry, and a stale stored year
  // has no entry at all — either would leave the Select without a match.
  const selectValue: string | number =
    typeof fyChoice === "number" && yearOptions.includes(fyChoice) && fyChoice !== currentFy
      ? fyChoice
      : fyChoice === "all"
        ? "all"
        : "current";

  const fyMonths = useMemo(
    () =>
      activeFy === "all" ? projectMonthRange(costLines) : fiscalYearMonths(activeFy, fyStart),
    [activeFy, costLines, fyStart],
  );

  const fySeries = useMemo(
    () => buildCumulativeSeries({ costLines, months: fyMonths, today }),
    [costLines, fyMonths, today],
  );

  const fyBudget = useMemo(
    () => budgetTotals(budgetLines, activeFy),
    [budgetLines, activeFy],
  );

  const projectMonths = useMemo(() => projectMonthRange(costLines), [costLines]);
  const projectSeries = useMemo(
    () => buildCumulativeSeries({ costLines, months: projectMonths, today }),
    [costLines, projectMonths, today],
  );
  const projectBudget = useMemo(() => budgetTotals(budgetLines, "all"), [budgetLines]);

  const undated = useMemo(() => countUndated(costLines), [costLines]);

  // The two cost categories keep one palette wherever they are drawn (`PPM_COST_COLORS`).
  const { capex: capexColor, opex: opexColor } = PPM_COST_COLORS[theme.palette.mode];

  // Each chart's lines and budget references, memoised: `CumulativeChart`
  // builds its option from them in a `useMemo`, and a fresh array on every
  // render here would rebuild that option — and redraw the chart — each time.
  const categoryLines = useMemo<CumulativeLine[]>(
    () => [
      { key: "capex", name: t("cumulativeCapex"), color: capexColor },
      { key: "opex", name: t("cumulativeOpex"), color: opexColor },
    ],
    [t, capexColor, opexColor],
  );
  const totalLines = useMemo<CumulativeLine[]>(
    () => [{ key: "total", name: t("cumulativeSpend"), color: capexColor }],
    [t, capexColor],
  );
  const budgetNames = useMemo(
    () => ({ capex: t("capexBudgetLine"), opex: t("opexBudgetLine") }),
    [t],
  );
  const fyCategoryReferences = useMemo(
    () => categoryReferences(fyBudget, budgetNames, { capex: capexColor, opex: opexColor }),
    [fyBudget, budgetNames, capexColor, opexColor],
  );
  const fyTotalReferences = useMemo<BudgetReference[]>(
    () =>
      fyBudget.total > 0
        ? [{ value: fyBudget.total, name: t("totalBudgetLine"), color: capexColor }]
        : [],
    [fyBudget, t, capexColor],
  );
  const projectReferences = useMemo(
    () => categoryReferences(projectBudget, budgetNames, { capex: capexColor, opex: opexColor }),
    [projectBudget, budgetNames, capexColor, opexColor],
  );

  // Nothing to plot at all — leave the tab as it was rather than showing an
  // empty frame.
  if (costLines.length === 0 && budgetLines.length === 0) return null;

  const yearLabel = (fy: number) => fiscalYearLabel(fy, fyStart, t);
  // A read-only page is for printing: its charts draw at the export scale so
  // the PDF stays sharp. The tab keeps the screen's own scale, so it looks
  // exactly as before (a 2x canvas downsampled on a 1x screen anti-aliases
  // its lines and labels differently).
  const chartProps = {
    fmt,
    fmtShort,
    locale: i18n.language,
    emptyLabel: t("noChartData"),
    devicePixelRatio: readOnly ? EXPORT_DPR : undefined,
  };

  return (
    // The Initiative Report's deck may cut this card between its chart rows
    // (`data-export-keep` on each, its heading held with the first by
    // `data-export-heading`), so the charts stay full width on a slide.
    // Print keeps the card whole (print.css), and knows neither marker.
    <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
      <Box
        data-export-heading
        display="flex"
        alignItems="center"
        gap={1.5}
        flexWrap="wrap"
        mb={expanded ? 2 : 0}
      >
        <Typography variant="subtitle1" fontWeight={600} id={headingId}>
          {t("spendOverTime")}
        </Typography>
        {readOnly && (
          // No picker on a read-only page: say which year the first two charts show.
          <Chip
            data-testid="cost-charts-fiscal-year"
            size="small"
            variant="outlined"
            icon={<MaterialSymbol icon="calendar_month" size={16} />}
            label={activeFy === "all" ? t("allFiscalYears") : yearLabel(activeFy)}
          />
        )}
        <Box flexGrow={1} />
        {!readOnly && expanded && (
          <FormControl size="small" sx={{ minWidth: { xs: 120, sm: 160 } }}>
            <Select
              value={selectValue}
              onChange={(e) => {
                const v = e.target.value;
                setFyChoice(v === "all" || v === "current" ? v : Number(v));
              }}
              inputProps={{ "aria-label": t("fiscalYear") }}
            >
              <MenuItem value="all">{t("allFiscalYears")}</MenuItem>
              {yearOptions.map((y) => (
                // The current year carries the "current" sentinel, so the saved
                // preference keeps following today as years roll over.
                <MenuItem key={y} value={y === currentFy ? "current" : y}>
                  {yearLabel(y)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        {!readOnly && (
          <IconButton
            size="small"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={t("spendOverTime")}
          >
            <MaterialSymbol icon={expanded ? "expand_less" : "expand_more"} size={20} />
          </IconButton>
        )}
      </Box>

      <Collapse in={expanded} unmountOnExit>
        <Box data-export-keep display="flex" gap={2} flexWrap="wrap">
          {/* ── 1. By category, one fiscal year ── */}
          <Box flex="1 1 380px" minWidth={0}>
            <Typography variant="body2" fontWeight={600} mb={0.5} id={`${headingId}-cat`}>
              {t("cumulativeByCategory")}
            </Typography>
            <CumulativeChart
              data={fySeries}
              labelledBy={`${headingId}-cat`}
              lines={categoryLines}
              references={fyCategoryReferences}
              {...chartProps}
            />
          </Box>

          {/* ── 2. Combined, one fiscal year ── */}
          <Box flex="1 1 380px" minWidth={0}>
            <Typography variant="body2" fontWeight={600} mb={0.5} id={`${headingId}-total`}>
              {t("cumulativeTotal")}
            </Typography>
            <CumulativeChart
              data={fySeries}
              labelledBy={`${headingId}-total`}
              lines={totalLines}
              references={fyTotalReferences}
              {...chartProps}
            />
          </Box>
        </Box>

        {/* ── 3. Whole project ── */}
        <Box data-export-keep mt={2}>
          <Typography variant="body2" fontWeight={600} mb={0.5} id={`${headingId}-proj`}>
            {t("projectCumulative")}
          </Typography>
          <CumulativeChart
            data={projectSeries}
            labelledBy={`${headingId}-proj`}
            lines={categoryLines}
            references={projectReferences}
            {...chartProps}
          />
        </Box>

        {undated > 0 && (
          <Typography variant="caption" color="text.secondary" display="block" mt={1}>
            {t("undatedExcluded", { count: undated })}
          </Typography>
        )}
      </Collapse>
    </Paper>
  );
}

/* ── Shared chart body ───────────────────────────────────────────────── */

function CumulativeChart(props: {
  data: MonthPoint[];
  lines: CumulativeLine[];
  references: BudgetReference[];
  labelledBy: string;
  fmt: { format: (v: number) => string };
  fmtShort: (v: number) => string;
  locale: string;
  emptyLabel: string;
  /** The canvas backing-store scale; the screen's when absent. */
  devicePixelRatio?: number;
}) {
  const { data, lines, references, labelledBy, fmt, fmtShort, locale, emptyLabel } = props;
  const theme = useEChartsTheme();

  // Short month names, year-qualified on a multi-year axis.
  const labels = useMemo(() => monthAxisLabels(data, locale), [data, locale]);

  const option = useMemo(() => {
    const { isRtl, ...chrome } = theme;
    return buildCumulativeOption(data, labels, lines, references, {
      chrome,
      isRtl,
      format: (v) => fmt.format(v),
      formatShort: fmtShort,
    });
  }, [data, labels, lines, references, theme, fmt, fmtShort]);

  // No month at all, or none reached yet: nothing to draw.
  if (!data.some((p) => p.total !== null)) {
    return (
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        sx={{
          height: CHART_HEIGHT_SX,
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {emptyLabel}
        </Typography>
      </Box>
    );
  }

  // The chart container is the image, named by the heading above it.
  return (
    // Stryker disable next-line ObjectLiteral: a responsive height; jsdom evaluates no media query, so no test can read it
    <Box sx={{ height: CHART_HEIGHT_SX }}>
      <EChart option={option} labelledBy={labelledBy} devicePixelRatio={props.devicePixelRatio} />
    </Box>
  );
}
