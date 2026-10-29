/**
 * The generic chart widget. It draws either a `DashboardQuery` aggregated by
 * the backend (`GET /dashboards/query`, or `/dashboards/kpi-history` for a
 * KPI's line) or one series of a module's shared report (`config.source`,
 * read through the dashboard's shared sources). Labels and colours are
 * resolved here from the metamodel, the module vocabularies and the tokens;
 * the option itself is built by the pure `buildOption`. A click on a mark
 * drills to the card, inventory or report behind it when `drill` is on.
 *
 * A sankey names each side through its own end of the relation type — the
 * two ends are different types whose fields may share a key.
 */
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import type { EChartsCoreOption } from "echarts/core";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useComplianceRegulations } from "@/hooks/useComplianceRegulations";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useFieldLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import { fiscalYearLabel } from "@/lib/fiscalYear";
import type { DashboardCellRow, DashboardKeyRow, DashboardQuery, DashboardQueryRow } from "@/types";
import EChart, { type EChartClickParams } from "../charts/EChart";
import {
  buildOption,
  defaultValueFormatter,
  foldGrid,
  foldModeOf,
  foldRows,
  hasDrawableRows,
  orderRows,
  OTHER_KEY,
} from "../charts/buildOption";
import { dimensionResolver, sideTypes, type ResolverDeps } from "../charts/dimensions";
import { useEChartsTheme } from "../charts/echartsTheme";
import { useDashboardSource } from "../DashboardSources";
import { drillUrl } from "../dashboardQuery";
import { queryErrorMessage } from "../queryProblems";
import {
  PART_TO_WHOLE,
  chartPath,
  isPercentMeasure,
  normalizeChartResult,
  readChartConfig,
  type ChartConfig,
} from "./chartConfig";
import { extractSeries, seriesLabelKey, sourceSeriesResolver } from "./sourceSeries";
import { widgetTitle, type WidgetProps } from "./widgetMeta";

export default function ChartWidget({ widget }: WidgetProps) {
  const config = useMemo(() => readChartConfig(widget.config), [widget.config]);
  if (config.source === "compliance_overview") return <ComplianceSourceChart widget={widget} config={config} />;
  if (config.source) return <SourceChart widget={widget} config={config} />;
  return <QueryChart widget={widget} config={config} />;
}

interface ChartProps extends WidgetProps {
  config: ChartConfig;
}

/** The labels and colours every resolver needs. */
function useResolverDeps(cardLabels?: Record<string, string>): ResolverDeps {
  const { t, i18n } = useTranslation("common");
  const theme = useEChartsTheme();
  const { types } = useMetamodel();
  const typeLabel = useTypeLabel();
  const inlineLabel = useFieldLabel();
  return useMemo(
    () => ({ types, t, locale: i18n.language, typeLabel, inlineLabel, categorical: theme.categorical, cardLabels }),
    [types, t, i18n.language, typeLabel, inlineLabel, theme.categorical, cardLabels],
  );
}

const percentFormatter = (v: number) => `${defaultValueFormatter(v)}%`;

/**
 * What a gauge reads against: a rate on 0–100 in `%`, or a count / sum
 * against its target ("of N"), with its bands and reading direction. Empty
 * for every other kind.
 */
function useGaugeContext(config: ChartConfig) {
  const { t } = useTranslation("common");
  const { types } = useMetamodel();
  return useMemo(() => {
    if (config.chart !== "gauge") return {};
    const percent = isPercentMeasure(config, types);
    return {
      unit: percent ? "%" : undefined,
      thresholds: config.thresholds,
      goodDirection: config.goodDirection,
      targetLabel:
        !percent && config.max !== undefined
          ? t("dashboard.config.ofTarget", { target: defaultValueFormatter(config.max) })
          : undefined,
      valueFormatter: percent ? percentFormatter : undefined,
    };
  }, [config, types, t]);
}

/** Loading, error and empty states around the chart, and the caption under it. */
function ChartBody({
  option,
  onClick,
  title,
  loading,
  error,
  drawable,
  emptyText,
  caption,
}: {
  option: EChartsCoreOption;
  onClick?: (params: EChartClickParams) => void;
  title: string;
  loading: boolean;
  error: string | null;
  drawable: boolean;
  emptyText: string;
  caption?: string | null;
}) {
  if (error) {
    return (
      <Alert severity="error" variant="outlined" sx={{ py: 0 }}>
        {error}
      </Alert>
    );
  }
  if (loading) return <LinearProgress sx={{ my: 2 }} />;
  if (!drawable) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyText}
      </Typography>
    );
  }
  return (
    <Box sx={{ flex: 1, minHeight: 0, height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <EChart option={option} onClick={onClick} ariaLabel={title} />
      </Box>
      {caption && (
        <Typography variant="caption" color="text.secondary" data-testid="chart-caption" sx={{ display: "block", mt: 0.5 }}>
          {caption}
        </Typography>
      )}
    </Box>
  );
}

function QueryChart({ widget, config }: ChartProps) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const theme = useEChartsTheme();
  const { relationTypes } = useMetamodel();
  const title = widgetTitle(widget, t);
  const query = config.query;
  const isSankey = config.chart === "sankey";

  const { data: raw, loading, error } = useApiQuery<unknown>(chartPath(config));
  const result = useMemo(() => normalizeChartResult(raw, config), [raw, config]);
  const deps = useResolverDeps(result?.labels);

  // A sankey's sides are the relation type's two ends, each grouped by its
  // own dimension (`type` when none is set).
  const sides = useMemo(
    () => sideTypes(isSankey ? relationTypes.find((rt) => rt.key === query.relation_type) : null),
    [isSankey, relationTypes, query.relation_type],
  );
  const dimension = result?.dimension ?? (isSankey ? "type" : null);
  const dimension2 = result?.dimension2 ?? (isSankey ? "type" : null);
  const dim = useMemo(
    () => dimensionResolver(dimension, query, deps, isSankey ? sides.source : undefined),
    [dimension, query, deps, isSankey, sides.source],
  );
  const dim2 = useMemo(
    () => dimensionResolver(dimension2, query, deps, isSankey ? sides.target : undefined),
    [dimension2, query, deps, isSankey, sides.target],
  );

  const rows = useMemo<DashboardQueryRow[]>(() => {
    if (!result) return [];
    if (config.chart === "gauge") return [{ key: "total", value: result.total }];
    if (isSankey || config.chart === "heatmap") return result.rows;
    if (config.chart === "stacked_column") {
      return foldGrid(
        result.rows.filter((r): r is DashboardCellRow => "x" in r && "y" in r),
        config.max,
        foldModeOf(query.metric),
      );
    }
    const keyed = result.rows.filter((r): r is DashboardKeyRow => "key" in r);
    // A part-to-whole chart without colours of its own folds past the palette.
    const max =
      config.max ??
      (PART_TO_WHOLE.includes(config.chart) && !dim.colorByCategory ? theme.categorical.length : undefined);
    return orderRows(result.dimension, keyed, max, foldModeOf(query.metric));
  }, [result, config.chart, config.max, isSankey, dim.colorByCategory, theme.categorical.length, query.metric]);

  const metric = query.metric ?? "count";
  const drillable = config.drill && !["gauge", "heatmap"].includes(config.chart);
  const gauge = useGaugeContext(config);

  const option = useMemo(
    () =>
      buildOption(config.chart, rows, {
        labels: dim.label,
        labels2: dim2.label,
        colors: dim.color,
        colors2: isSankey || config.chart === "stacked_column" ? dim2.color : undefined,
        colorByCategory: dim.colorByCategory,
        theme,
        isRtl: theme.isRtl,
        max: config.max,
        seriesName: metric === "count" ? t("labels.cards") : t(`dashboard.query.metric.${metric}`),
        valueFormatter: metric === "share" ? percentFormatter : undefined,
        cursor: drillable ? "pointer" : "default",
        showValues: config.showValues,
        ...gauge,
      }),
    [config.chart, config.max, config.showValues, rows, dim, dim2, isSankey, theme, metric, t, drillable, gauge],
  );

  const handleClick = useCallback(
    (params: EChartClickParams) => {
      if (!drillable) return;
      const data = params.data as { key?: unknown; side?: unknown } | undefined;
      const key = data?.key;
      if (typeof key !== "string" || key === OTHER_KEY) return;
      let url: string | null;
      if (isSankey) {
        // Only a node drills (a flow joins two cards, not one); each side
        // reads its own dimension inside its own card type.
        if (data?.side !== "source" && data?.side !== "target") return;
        const source = data.side === "source";
        const sideQuery: DashboardQuery = { ...query, card_type: source ? sides.source : sides.target };
        url = drillUrl(source ? dimension : dimension2, key, sideQuery);
      } else {
        url = drillUrl(result?.dimension, key, query);
      }
      if (url) navigate(url);
    },
    [drillable, isSankey, query, sides, dimension, dimension2, result?.dimension, navigate],
  );

  const fiscalLine =
    result?.fiscalYear != null
      ? t("dashboard.config.fiscalYear", {
          year: fiscalYearLabel(result.fiscalYear, result.fiscalYearStart ?? 1, t),
        })
      : null;
  // A card-keyed result keeps its largest cards: the rest are merged into
  // Other for a count or sum, and dropped for an average or share.
  const folded = result?.folded;
  const foldLine = folded
    ? t(metric === "avg" || metric === "share" ? "dashboard.chart.foldedDropped" : "dashboard.chart.folded", {
        count: folded.cards,
        top: folded.top,
      })
    : null;
  const caption = [fiscalLine, foldLine].filter(Boolean).join(" · ") || null;

  return (
    <ChartBody
      option={option}
      onClick={handleClick}
      title={title}
      loading={loading && !raw}
      error={error && !raw ? queryErrorMessage(error, t) : null}
      drawable={hasDrawableRows(config.chart, rows)}
      emptyText={result?.dimension === "type" ? t("dashboard.noCardsYet") : t("emptyStates.noData")}
      caption={caption}
    />
  );
}

function ComplianceSourceChart(props: ChartProps) {
  const { t } = useTranslation("admin");
  const { byKey } = useComplianceRegulations();
  // The admin-managed label first, then the built-in one, then the key —
  // the compliance scanner's own resolution.
  const regulationLabel = useCallback(
    (key: string) => byKey[key]?.label ?? t(`compliance_regulation_${key}`, { defaultValue: key }),
    [byKey, t],
  );
  return <SourceChart {...props} regulationLabel={regulationLabel} />;
}

function SourceChart({
  widget,
  config,
  regulationLabel,
}: ChartProps & { regulationLabel?: (key: string) => string }) {
  const { t } = useTranslation("common");
  const theme = useEChartsTheme();
  const title = widgetTitle(widget, t);
  const source = config.source!;
  const series = config.series ?? "";
  const { data, loading, error } = useDashboardSource(source);
  const deps = useResolverDeps();
  const gauge = useGaugeContext(config);
  const resolver = useMemo(
    () => sourceSeriesResolver(source, series, { ...deps, regulationLabel }),
    [source, series, deps, regulationLabel],
  );

  const rows = useMemo<DashboardQueryRow[]>(() => {
    const extracted = extractSeries(source, series, data);
    if (!extracted) return [];
    if (extracted.shape === "single") return [{ key: series, value: extracted.value }];
    const max =
      config.max ??
      (PART_TO_WHOLE.includes(config.chart) && !resolver.colorByCategory ? theme.categorical.length : undefined);
    return foldRows(extracted.rows, max);
  }, [source, series, data, config.max, config.chart, resolver.colorByCategory, theme.categorical.length]);

  const option = useMemo(
    () =>
      buildOption(config.chart, rows, {
        labels: resolver.label,
        colors: resolver.color,
        colorByCategory: resolver.colorByCategory,
        theme,
        isRtl: theme.isRtl,
        max: config.max,
        seriesName: t(seriesLabelKey(source, series)),
        showValues: config.showValues,
        ...gauge,
      }),
    [config.chart, config.max, config.showValues, rows, resolver, theme, t, source, series, gauge],
  );

  return (
    <ChartBody
      option={option}
      title={title}
      loading={loading && !data}
      error={error && !data ? queryErrorMessage(error, t) : null}
      drawable={hasDrawableRows(config.chart, rows)}
      emptyText={t("emptyStates.noData")}
    />
  );
}
