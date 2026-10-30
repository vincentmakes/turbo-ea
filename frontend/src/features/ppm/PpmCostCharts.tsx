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
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Collapse from "@mui/material/Collapse";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import EChart from "@/components/charts/EChart";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import { useCurrency } from "@/hooks/useCurrency";
import { shortMonth } from "@/hooks/useDateFormat";
import { useFiscalYearStart } from "@/hooks/useFiscalYearStart";
import { fiscalYearLabel } from "@/lib/fiscalYear";
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
  type BudgetReference,
  type CumulativeLine,
} from "./cumulativeChartOption";

interface Props {
  costLines: PpmCostLine[];
  budgetLines: PpmBudgetLine[];
}

const CHART_HEIGHT = 260;
/** Three stacked charts at 260px is most of a phone screen; shrink on xs. */
const CHART_HEIGHT_SX = { xs: 200, sm: CHART_HEIGHT };

export default function PpmCostCharts({ costLines, budgetLines }: Props) {
  const { t, i18n } = useTranslation("ppm");
  const theme = useTheme();
  const { fmt, fmtShort } = useCurrency();
  const { month: fyStart } = useFiscalYearStart();
  const headingId = useId();

  const [prefs] = useState(loadCostChartPrefs);
  const [fyChoice, setFyChoice] = useState<FiscalYearChoice>(prefs.fiscalYear);
  const [expanded, setExpanded] = useState(prefs.expanded);

  useEffect(() => {
    saveCostChartPrefs({ fiscalYear: fyChoice, expanded });
  }, [fyChoice, expanded]);

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

  const capexColor = theme.palette.primary.main;
  const opexColor = theme.palette.secondary.main;

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
  const fyCategoryReferences = useMemo(
    () => categoryReferences(fyBudget, t("capexBudgetLine"), t("opexBudgetLine"), capexColor, opexColor),
    [fyBudget, t, capexColor, opexColor],
  );
  const fyTotalReferences = useMemo<BudgetReference[]>(
    () =>
      fyBudget.total > 0
        ? [{ value: fyBudget.total, name: t("totalBudgetLine"), color: capexColor }]
        : [],
    [fyBudget, t, capexColor],
  );
  const projectReferences = useMemo(
    () =>
      categoryReferences(projectBudget, t("capexBudgetLine"), t("opexBudgetLine"), capexColor, opexColor),
    [projectBudget, t, capexColor, opexColor],
  );

  // Nothing to plot at all — leave the tab as it was rather than showing an
  // empty frame.
  if (costLines.length === 0 && budgetLines.length === 0) return null;

  const yearLabel = (fy: number) => fiscalYearLabel(fy, fyStart, t);

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
      <Box display="flex" alignItems="center" gap={1.5} flexWrap="wrap" mb={expanded ? 2 : 0}>
        <Typography variant="subtitle1" fontWeight={600} id={headingId}>
          {t("spendOverTime")}
        </Typography>
        <Box flexGrow={1} />
        {expanded && (
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
        <IconButton
          size="small"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={t("spendOverTime")}
        >
          <MaterialSymbol icon={expanded ? "expand_less" : "expand_more"} size={20} />
        </IconButton>
      </Box>

      <Collapse in={expanded} unmountOnExit>
        <Box display="flex" gap={2} flexWrap="wrap">
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
              {...{ fmt, fmtShort, locale: i18n.language, emptyLabel: t("noChartData") }}
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
              {...{ fmt, fmtShort, locale: i18n.language, emptyLabel: t("noChartData") }}
            />
          </Box>
        </Box>

        {/* ── 3. Whole project ── */}
        <Box mt={2}>
          <Typography variant="body2" fontWeight={600} mb={0.5} id={`${headingId}-proj`}>
            {t("projectCumulative")}
          </Typography>
          <CumulativeChart
            data={projectSeries}
            labelledBy={`${headingId}-proj`}
            lines={categoryLines}
            references={projectReferences}
            {...{ fmt, fmtShort, locale: i18n.language, emptyLabel: t("noChartData") }}
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

/** The dotted CapEx and OpEx budget lines, each only when that budget is set. */
function categoryReferences(
  budget: { capex: number; opex: number },
  capexName: string,
  opexName: string,
  capexColor: string,
  opexColor: string,
): BudgetReference[] {
  return [
    ...(budget.capex > 0 ? [{ value: budget.capex, name: capexName, color: capexColor }] : []),
    ...(budget.opex > 0 ? [{ value: budget.opex, name: opexName, color: opexColor }] : []),
  ];
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
}) {
  const { data, lines, references, labelledBy, fmt, fmtShort, locale, emptyLabel } = props;
  const theme = useEChartsTheme();

  // Append the year whenever the range crosses a calendar boundary, so
  // "Jan" is never ambiguous on a multi-year axis.
  const multiYear = useMemo(() => new Set(data.map((d) => d.year)).size > 1, [data]);
  // `shortMonth` pins the Gregorian calendar (the months are Gregorian ones:
  // `ar-SA` would otherwise name Hijri months), strips the bidi marks and
  // survives a bad locale tag — the same month names as every formatted date.
  const labelFor = useMemo(
    () => (p: MonthPoint) => {
      // Day 1 at noon: safe from any timezone rolling the date backwards.
      const label = shortMonth(new Date(p.year, p.month - 1, 1, 12), locale);
      return multiYear ? `${label} '${String(p.year).slice(-2)}` : label;
    },
    [locale, multiYear],
  );

  const labels = useMemo(() => data.map(labelFor), [data, labelFor]);

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
      <EChart option={option} labelledBy={labelledBy} />
    </Box>
  );
}
