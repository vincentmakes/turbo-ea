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
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useCurrency } from "@/hooks/useCurrency";
import { useChartTheme } from "@/hooks/useChartTheme";
import { useIsRtl } from "@/hooks/useIsRtl";
import { useFiscalYearStart } from "@/hooks/useFiscalYearStart";
import {
  makeRtlAxisTick,
  rtlLegendItemStyle,
  rtlTooltipStyle,
  mirrorChartMargin,
} from "@/lib/rechartsRtl";
import type { PpmCostLine, PpmBudgetLine } from "@/types";
import {
  availableFiscalYears,
  budgetTotals,
  fiscalYearOptions,
  buildCumulativeSeries,
  countUndated,
  fiscalYearFor,
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

interface Props {
  costLines: PpmCostLine[];
  budgetLines: PpmBudgetLine[];
}

const CHART_HEIGHT = 260;
/** Dotted budget reference lines, distinct from the solid actuals. */
const BUDGET_DASH = "6 4";

export default function PpmCostCharts({ costLines, budgetLines }: Props) {
  const { t, i18n } = useTranslation("ppm");
  const theme = useTheme();
  const { fmt, fmtShort } = useCurrency();
  const chart = useChartTheme();
  const isRtl = useIsRtl();
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
  const currentFy = useMemo(() => {
    // Local parts, not toISOString(): buildCumulativeSeries places "now" with
    // local getMonth(), and a UTC-derived month would disagree with it near a
    // month boundary.
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
    return fiscalYearFor(iso, fyStart) ?? today.getFullYear();
  }, [today, fyStart]);

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

  // Nothing to plot at all — leave the tab as it was rather than showing an
  // empty frame.
  if (costLines.length === 0 && budgetLines.length === 0) return null;

  const yearLabel = (fy: number) => (fyStart === 1 ? `FY ${fy}` : `FY ${fy - 1}–${fy}`);

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
      <Box display="flex" alignItems="center" gap={1.5} flexWrap="wrap" mb={expanded ? 2 : 0}>
        <Typography variant="subtitle1" fontWeight={600} id={headingId}>
          {t("spendOverTime")}
        </Typography>
        <Box flexGrow={1} />
        {expanded && (
          <FormControl size="small" sx={{ minWidth: 160 }}>
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
              lines={[
                { key: "capex", name: t("cumulativeCapex"), color: capexColor },
                { key: "opex", name: t("cumulativeOpex"), color: opexColor },
              ]}
              references={[
                ...(fyBudget.capex > 0
                  ? [{ value: fyBudget.capex, name: t("capexBudgetLine"), color: capexColor }]
                  : []),
                ...(fyBudget.opex > 0
                  ? [{ value: fyBudget.opex, name: t("opexBudgetLine"), color: opexColor }]
                  : []),
              ]}
              {...{ theme: chart, isRtl, fmt, fmtShort, locale: i18n.language, emptyLabel: t("noChartData") }}
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
              lines={[{ key: "total", name: t("cumulativeSpend"), color: capexColor }]}
              references={
                fyBudget.total > 0
                  ? [{ value: fyBudget.total, name: t("totalBudgetLine"), color: capexColor }]
                  : []
              }
              {...{ theme: chart, isRtl, fmt, fmtShort, locale: i18n.language, emptyLabel: t("noChartData") }}
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
            lines={[
              { key: "capex", name: t("cumulativeCapex"), color: capexColor },
              { key: "opex", name: t("cumulativeOpex"), color: opexColor },
            ]}
            references={[
              ...(projectBudget.capex > 0
                ? [{ value: projectBudget.capex, name: t("capexBudgetLine"), color: capexColor }]
                : []),
              ...(projectBudget.opex > 0
                ? [{ value: projectBudget.opex, name: t("opexBudgetLine"), color: opexColor }]
                : []),
            ]}
            {...{ theme: chart, isRtl, fmt, fmtShort, locale: i18n.language, emptyLabel: t("noChartData") }}
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

interface LineSpec {
  key: "capex" | "opex" | "total";
  name: string;
  color: string;
}

interface RefSpec {
  value: number;
  name: string;
  color: string;
}

function CumulativeChart(props: {
  data: MonthPoint[];
  lines: LineSpec[];
  references: RefSpec[];
  labelledBy: string;
  theme: ReturnType<typeof useChartTheme>;
  isRtl: boolean;
  fmt: { format: (v: number) => string };
  fmtShort: (v: number) => string;
  locale: string;
  emptyLabel: string;
}) {
  const { data, lines, references, labelledBy, theme, isRtl, fmt, fmtShort, locale, emptyLabel } =
    props;

  // Append the year whenever the range crosses a calendar boundary, so
  // "Jan" is never ambiguous on a multi-year axis.
  const multiYear = useMemo(() => new Set(data.map((d) => d.year)).size > 1, [data]);
  const labelFor = useMemo(() => {
    const monthFmt = new Intl.DateTimeFormat(locale, { month: "short" });
    return (p: MonthPoint) => {
      // Day 1 at noon: safe from any timezone rolling the date backwards.
      const label = monthFmt.format(new Date(p.year, p.month - 1, 1, 12));
      return multiYear ? `${label} '${String(p.year).slice(-2)}` : label;
    };
  }, [locale, multiYear]);

  const chartData = useMemo(
    () => data.map((p) => ({ ...p, label: labelFor(p) })),
    [data, labelFor],
  );

  const hasAnyPoint = data.some((p) => p.total !== null);
  if (chartData.length === 0 || !hasAnyPoint) {
    return (
      <Box
        height={CHART_HEIGHT}
        display="flex"
        alignItems="center"
        justifyContent="center"
        sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}
      >
        <Typography variant="body2" color="text.secondary">
          {emptyLabel}
        </Typography>
      </Box>
    );
  }

  const rtlTick = makeRtlAxisTick(theme.axisTick.fill, theme.axisTick.fontSize);

  return (
    <Box height={CHART_HEIGHT} aria-labelledby={labelledBy} role="img">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={mirrorChartMargin({ top: 8, right: 16, bottom: 0, left: 8 }, isRtl)}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
          <XAxis
            dataKey="label"
            tick={theme.axisTick}
            tickLine={false}
            reversed={isRtl}
            interval="preserveStartEnd"
            minTickGap={12}
          />
          <YAxis
            tick={isRtl ? rtlTick : theme.axisTick}
            tickLine={false}
            // Measured from the rendered ticks (Recharts 3.7): a fixed width
            // clipped long labels once costs ran to millions, since fmtShort
            // only abbreviates to thousands ("$12000k", "CHF12000k").
            width="auto"
            orientation={isRtl ? "right" : "left"}
            tickFormatter={(v: number) => fmtShort(v)}
          />
          <Tooltip
            {...theme.tooltipProps}
            contentStyle={{ ...theme.tooltipProps.contentStyle, ...rtlTooltipStyle(isRtl) }}
            formatter={(value: number | string | undefined) =>
              typeof value === "number" ? fmt.format(value) : (value ?? "")
            }
          />
          <Legend
            formatter={(value: string) => (
              <span style={rtlLegendItemStyle(isRtl, theme.axisTick.fill)}>{value}</span>
            )}
          />
          {references.map((r) => (
            <ReferenceLine
              key={`${r.name}-${r.value}`}
              y={r.value}
              stroke={r.color}
              strokeDasharray={BUDGET_DASH}
              strokeOpacity={0.8}
              ifOverflow="extendDomain"
              // Budget lines get no legend entry, so label them in place —
              // otherwise a dotted line is unidentifiable.
              label={{
                value: r.name,
                position: isRtl ? "insideTopLeft" : "insideTopRight",
                fill: r.color,
                fontSize: 11,
              }}
            />
          ))}
          {lines.map((l) => (
            <Line
              key={l.key}
              type="monotone"
              dataKey={l.key}
              name={l.name}
              stroke={l.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}
