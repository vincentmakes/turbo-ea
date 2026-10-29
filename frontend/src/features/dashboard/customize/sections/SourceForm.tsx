/**
 * A module widget (a series of the risks, compliance, PPM or BPM report):
 * the series it reads is fixed by the catalogue entry; a chart can change its
 * kind (among those that fit the series' shape) and how many categories it
 * shows and whether its bars or columns print their figures — or, as a gauge, its target and bands (a module score is a rate on
 * the fixed 0–100 scale).
 */
import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { DashboardChartKind, DashboardWidget } from "@/types";
import { PERCENT_SERIES } from "../../widgets/chartConfig";
import { seriesLabelKey } from "../../widgets/sourceSeries";
import { GaugeFields, ShowValuesSwitch } from "./PresentationSection";
import { sourceChartKinds } from "../widgetConfigModel";
import SelectField from "./SelectField";
import type { DraftProps } from "./types";

interface Props extends Omit<DraftProps, "setQuery"> {
  widget: DashboardWidget;
}

export default function SourceForm({ widget, draft, set }: Props) {
  const { t } = useTranslation("common");
  const source = String(widget.config?.source ?? "");
  const series = String(widget.config?.series ?? "");
  const isChart = widget.type === "chart";
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary" data-testid="config-source-series">
        {t("dashboard.config.sourceSeries", { series: t(seriesLabelKey(source, series)) })}
      </Typography>
      {isChart && (
        <SelectField
          label={t("dashboard.config.chartKind")}
          value={draft.chart}
          onChange={(v) => set("chart", v as DashboardChartKind)}
          options={sourceChartKinds(series).map((k) => ({ value: k, label: t(`dashboard.query.chart.${k}`) }))}
          testId="config-chart-kind"
        />
      )}
      {isChart && draft.chart === "gauge" && (
        <GaugeFields draft={draft} set={set} percent={PERCENT_SERIES.has(series)} />
      )}
      {isChart && draft.chart !== "gauge" && (
        <TextField
          size="small"
          type="number"
          fullWidth
          label={t("dashboard.config.limit")}
          value={draft.max}
          onChange={(e) => set("max", e.target.value)}
          slotProps={{ htmlInput: { min: 1, "data-testid": "config-max" } }}
        />
      )}
      {isChart && <ShowValuesSwitch draft={draft} set={set} />}
    </Stack>
  );
}
