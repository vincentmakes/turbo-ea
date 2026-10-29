/**
 * How the widget is drawn. A chart: its kind, how many categories it shows
 * (for card-keyed groupings also how many cards the server keeps before
 * folding the rest into "Other") and whether a click opens the matching
 * cards, and — on a bar, column, stacked column, treemap or heatmap — whether
 * each mark prints its figure. A gauge instead reads against a scale — fixed 0–100 for a rate, or
 * the Target of a count or sum — with optional bands (`GaugeFields`). A KPI: whether a rise is good, how the number reads, a
 * 30-day sparkline and a secondary figure measured against the unfiltered
 * count.
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { DEFAULT_GAUGE_THRESHOLDS } from "../../charts/buildOption";
import { VALUE_LABEL_KINDS } from "../../widgets/chartConfig";
import type { DashboardChartKind } from "@/types";
import type { KpiSecondaryChoice } from "../widgetConfigModel";
import SelectField from "./SelectField";
import type { DraftProps } from "./types";

interface Props extends DraftProps {
  kind: "kpi" | "chart";
  chartKinds: DashboardChartKind[];
  /** Whether the KPI's query can carry a secondary figure (a narrowed count). */
  secondaryAvailable: boolean;
  /** Whether a gauge measures a rate on the fixed 0–100 scale (no target). */
  percent?: boolean;
}

/**
 * A gauge's scale and bands: the Target of a count or sum (required; a rate
 * has the fixed 0–100 scale and no field), the two band edges and whether a
 * rise is good. The upper edge says what lies above it — good when a rise is
 * good, bad when it is not.
 */
export function GaugeFields({ draft, set, percent }: Pick<DraftProps, "draft" | "set"> & { percent: boolean }) {
  const { t } = useTranslation("common");
  const [warnDefault, goodDefault] = percent ? DEFAULT_GAUGE_THRESHOLDS.map(String) : ["", ""];
  return (
    <Stack spacing={2} data-testid="config-gauge">
      {!percent && (
        <TextField
          size="small"
          type="number"
          fullWidth
          required
          label={t("dashboard.config.target")}
          value={draft.max}
          onChange={(e) => set("max", e.target.value)}
          slotProps={{ htmlInput: { min: 1, "data-testid": "config-max" } }}
        />
      )}
      <Typography variant="caption" color="text.secondary">
        {t("dashboard.config.thresholds")}
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
        <TextField
          size="small"
          type="number"
          label={t("dashboard.config.thresholdWarn")}
          value={draft.thresholdWarn}
          placeholder={warnDefault}
          onChange={(e) => set("thresholdWarn", e.target.value)}
          slotProps={{ htmlInput: { min: 0, "data-testid": "config-threshold-warn" } }}
        />
        <TextField
          size="small"
          type="number"
          label={
            draft.goodDirection === "down" ? t("dashboard.config.thresholdBad") : t("dashboard.config.thresholdGood")
          }
          value={draft.thresholdGood}
          placeholder={goodDefault}
          onChange={(e) => set("thresholdGood", e.target.value)}
          slotProps={{ htmlInput: { min: 0, "data-testid": "config-threshold-good" } }}
        />
      </Box>
      <SelectField
        label={t("dashboard.kpi.goodDirection")}
        value={draft.goodDirection}
        onChange={(v) => set("goodDirection", v === "down" ? "down" : "up")}
        options={[
          { value: "up", label: t("dashboard.kpi.goodDirection.up") },
          { value: "down", label: t("dashboard.kpi.goodDirection.down") },
        ]}
        testId="config-good-direction"
      />
    </Stack>
  );
}

/** "Show values on the chart", for the kinds that can print a figure on each mark. */
export function ShowValuesSwitch({ draft, set }: Pick<DraftProps, "draft" | "set">) {
  const { t } = useTranslation("common");
  if (!VALUE_LABEL_KINDS.has(draft.chart)) return null;
  return (
    <FormControlLabel
      data-testid="config-show-values"
      control={<Switch checked={draft.showValues} onChange={(e) => set("showValues", e.target.checked)} />}
      label={t("dashboard.config.showValues")}
    />
  );
}

export default function PresentationSection({ draft, set, kind, chartKinds, secondaryAvailable, percent = false }: Props) {
  const { t } = useTranslation("common");

  if (kind === "kpi") {
    return (
      <Stack spacing={2}>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          <SelectField
            label={t("dashboard.kpi.goodDirection")}
            value={draft.goodDirection}
            onChange={(v) => set("goodDirection", v === "down" ? "down" : "up")}
            options={[
              { value: "up", label: t("dashboard.kpi.goodDirection.up") },
              { value: "down", label: t("dashboard.kpi.goodDirection.down") },
            ]}
            testId="config-good-direction"
          />
          <SelectField
            label={t("dashboard.config.format")}
            value={draft.format}
            onChange={(v) => set("format", v === "percent" ? "percent" : "number")}
            options={[
              { value: "number", label: t("dashboard.kpi.format.number") },
              { value: "percent", label: t("dashboard.kpi.format.percent") },
            ]}
            testId="config-format"
          />
        </Box>
        <SelectField
          label={t("dashboard.config.secondary")}
          value={secondaryAvailable ? draft.secondary : ""}
          onChange={(v) => set("secondary", v as KpiSecondaryChoice)}
          options={[
            { value: "", label: t("dashboard.config.secondaryNone") },
            { value: "share_of_total", label: t("dashboard.config.secondaryShare") },
            { value: "base_count", label: t("dashboard.config.secondaryBase") },
          ]}
          disabled={!secondaryAvailable}
          helperText={secondaryAvailable ? undefined : t("dashboard.config.secondaryHelp")}
          testId="config-secondary"
        />
        <FormControlLabel
          control={<Switch checked={draft.sparkline} onChange={(e) => set("sparkline", e.target.checked)} />}
          label={t("dashboard.config.sparkline")}
        />
      </Stack>
    );
  }

  const isGauge = draft.chart === "gauge";
  return (
    <Stack spacing={2}>
      <SelectField
        label={t("dashboard.config.chartKind")}
        value={draft.chart}
        onChange={(v) => set("chart", v as DashboardChartKind)}
        options={chartKinds.map((k) => ({ value: k, label: t(`dashboard.query.chart.${k}`) }))}
        testId="config-chart-kind"
      />
      {isGauge ? (
        <GaugeFields draft={draft} set={set} percent={percent} />
      ) : (
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
      {!isGauge && draft.chart !== "heatmap" && (
        <FormControlLabel
          control={<Switch checked={draft.drill} onChange={(e) => set("drill", e.target.checked)} />}
          label={t("dashboard.config.drill")}
        />
      )}
      <ShowValuesSwitch draft={draft} set={set} />
    </Stack>
  );
}
