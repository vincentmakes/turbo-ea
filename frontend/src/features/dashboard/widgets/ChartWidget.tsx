/**
 * The generic chart widget: a `DashboardQuery` aggregated by the backend
 * (`GET /dashboards/query`, or `/dashboards/kpi-history` for a KPI's line),
 * drawn with ECharts. Labels and colours are resolved here from the
 * metamodel and the tokens; the option itself is built by the pure
 * `buildOption`. A click on a mark drills to the inventory or report behind
 * it when the widget has `drill` on.
 */
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useFieldLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import type { DashboardKeyRow, DashboardQueryRow } from "@/types";
import EChart, { type EChartClickParams } from "../charts/EChart";
import { buildOption, hasDrawableRows, orderRows, OTHER_KEY } from "../charts/buildOption";
import { dimensionResolver } from "../charts/dimensions";
import { useEChartsTheme } from "../charts/echartsTheme";
import { drillUrl } from "../dashboardQuery";
import { PART_TO_WHOLE, chartPath, normalizeChartResult, readChartConfig } from "./chartConfig";
import { widgetTitle, type WidgetProps } from "./widgetMeta";

export default function ChartWidget({ widget }: WidgetProps) {
  const { t, i18n } = useTranslation("common");
  const navigate = useNavigate();
  const theme = useEChartsTheme();
  const { types } = useMetamodel();
  const typeLabel = useTypeLabel();
  const inlineLabel = useFieldLabel();
  const config = useMemo(() => readChartConfig(widget.config), [widget.config]);
  const title = widgetTitle(widget, t);

  const { data: raw, loading, error } = useApiQuery<unknown>(chartPath(config));
  const result = useMemo(() => normalizeChartResult(raw, config), [raw, config]);

  const deps = useMemo(
    () => ({ types, t, locale: i18n.language, typeLabel, inlineLabel, categorical: theme.categorical }),
    [types, t, i18n.language, typeLabel, inlineLabel, theme.categorical],
  );
  const dim = useMemo(
    () => dimensionResolver(result?.dimension, config.query, deps),
    [result?.dimension, config.query, deps],
  );
  const dim2 = useMemo(
    () => dimensionResolver(result?.dimension2, config.query, deps),
    [result?.dimension2, config.query, deps],
  );

  const rows = useMemo<DashboardQueryRow[]>(() => {
    if (!result) return [];
    if (config.chart === "gauge") return [{ key: "total", value: result.total }];
    if (config.chart === "sankey" || config.chart === "heatmap") return result.rows;
    const keyed = result.rows.filter((r): r is DashboardKeyRow => "key" in r);
    // A part-to-whole chart without colours of its own folds past the palette.
    const max =
      config.max ??
      (PART_TO_WHOLE.includes(config.chart) && !dim.colorByCategory ? theme.categorical.length : undefined);
    return orderRows(result.dimension, keyed, max);
  }, [result, config.chart, config.max, dim.colorByCategory, theme.categorical.length]);

  const metric = config.query.metric ?? "count";
  const drillable = config.drill && !["gauge", "sankey", "heatmap"].includes(config.chart);

  const option = useMemo(
    () =>
      buildOption(config.chart, rows, {
        labels: dim.label,
        labels2: dim2.label,
        colors: dim.color,
        colorByCategory: dim.colorByCategory,
        theme,
        isRtl: theme.isRtl,
        max: config.max,
        seriesName: metric === "count" ? t("labels.cards") : t(`dashboard.query.metric.${metric}`),
        cursor: drillable ? "pointer" : "default",
      }),
    [config.chart, config.max, rows, dim, dim2, theme, metric, t, drillable],
  );

  const handleClick = useCallback(
    (params: EChartClickParams) => {
      if (!drillable) return;
      const key = (params.data as { key?: unknown } | undefined)?.key;
      if (typeof key !== "string" || key === OTHER_KEY) return;
      const url = drillUrl(result?.dimension, key, config.query);
      if (url) navigate(url);
    },
    [drillable, result?.dimension, config.query, navigate],
  );

  if (error && !raw) {
    return (
      <Alert severity="error" variant="outlined" sx={{ py: 0 }}>
        {error.message || t("errors.generic")}
      </Alert>
    );
  }
  if (loading && !raw) return <LinearProgress sx={{ my: 2 }} />;

  if (!hasDrawableRows(config.chart, rows)) {
    return (
      <Typography variant="body2" color="text.secondary">
        {result?.dimension === "type" ? t("dashboard.noCardsYet") : t("emptyStates.noData")}
      </Typography>
    );
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <EChart option={option} onClick={handleClick} ariaLabel={title} />
      </Box>
    </Box>
  );
}
