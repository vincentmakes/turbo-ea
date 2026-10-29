/**
 * How the widget is drawn. A chart: its kind, how many categories it shows
 * (a gauge's maximum; for card-keyed groupings also how many cards the server
 * keeps before folding the rest into "Other") and whether a click opens the
 * matching cards. A KPI: whether a rise is good, how the number reads, a
 * 30-day sparkline and a secondary figure measured against the unfiltered
 * count.
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import type { DashboardChartKind } from "@/types";
import type { KpiSecondaryChoice } from "../widgetConfigModel";
import SelectField from "./SelectField";
import type { DraftProps } from "./types";

interface Props extends DraftProps {
  kind: "kpi" | "chart";
  chartKinds: DashboardChartKind[];
  /** Whether the KPI's query can carry a secondary figure (a narrowed count). */
  secondaryAvailable: boolean;
}

export default function PresentationSection({ draft, set, kind, chartKinds, secondaryAvailable }: Props) {
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
      <TextField
        size="small"
        type="number"
        fullWidth
        label={isGauge ? t("dashboard.config.gaugeMax") : t("dashboard.config.limit")}
        value={draft.max}
        onChange={(e) => set("max", e.target.value)}
        slotProps={{ htmlInput: { min: 1, "data-testid": "config-max" } }}
      />
      {!isGauge && draft.chart !== "heatmap" && (
        <FormControlLabel
          control={<Switch checked={draft.drill} onChange={(e) => set("drill", e.target.checked)} />}
          label={t("dashboard.config.drill")}
        />
      )}
    </Stack>
  );
}
