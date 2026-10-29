/**
 * The query of a KPI or a (non-sankey) chart: the card type, what it groups
 * by (and by what next, for a heatmap or stacked columns), and what it
 * measures — a count, a share of the unfiltered count, or a sum / average of
 * a numeric field or a computed measure (`@relations:`, `@data_quality`).
 * Both menus are grouped under headings (`dimensionGroup`, `measureGroup`).
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import type { CardType, DashboardMetric } from "@/types";
import { dimensionGroup, measureGroup, secondDimensionOptions } from "../widgetConfigModel";
import SelectField from "./SelectField";
import type { DraftProps } from "./types";
import { useConfigLabels } from "./useConfigLabels";

const NONE = "";
const METRICS: DashboardMetric[] = ["count", "sum", "avg", "share"];

interface Props extends DraftProps {
  cardTypes: CardType[];
  dimensions: string[];
  measures: string[];
  /** Show the grouping selects (a chart other than a gauge). */
  grouping: boolean;
  /** Show the second grouping (heatmap, stacked columns). */
  secondGrouping: boolean;
}

export default function QuerySection({ draft, setQuery, cardTypes, dimensions, measures, grouping, secondGrouping }: Props) {
  const { t } = useTranslation("common");
  const typeLabel = useTypeLabel();
  const labels = useConfigLabels();
  const query = draft.query;
  const typeKey = query.card_type ?? null;
  const metric = query.metric ?? "count";
  const needsField = metric === "sum" || metric === "avg";
  const dimensionOption = (d: string) => ({
    value: d,
    label: labels.dimension(d, typeKey),
    group: t(`dashboard.config.group.${dimensionGroup(d)}`),
  });

  return (
    <Stack spacing={2}>
      <SelectField
        label={t("dashboard.config.cardType")}
        value={query.card_type ?? NONE}
        onChange={(v) => setQuery({ card_type: v || null })}
        options={[
          { value: NONE, label: t("dashboard.config.allCardTypes") },
          ...cardTypes.map((ct) => ({ value: ct.key, label: typeLabel(ct) })),
        ]}
        testId="config-card-type"
      />
      {grouping && (
        <SelectField
          label={t("dashboard.config.dimension")}
          value={query.group_by ?? NONE}
          onChange={(v) => setQuery({ group_by: v || null })}
          options={dimensions.map(dimensionOption)}
          required
          testId="config-dimension"
        />
      )}
      {grouping && secondGrouping && (
        <SelectField
          label={t("dashboard.config.secondDimension")}
          value={query.group_by_2 ?? NONE}
          onChange={(v) => setQuery({ group_by_2: v || null })}
          options={secondDimensionOptions(dimensions, query.group_by).map(dimensionOption)}
          required
          testId="config-dimension-2"
        />
      )}
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
        <SelectField
          label={t("dashboard.config.metric")}
          value={metric}
          onChange={(v) =>
            setQuery(
              v === "count" || v === "share"
                ? { metric: v === "share" ? "share" : null, metric_field: null }
                : { metric: v as DashboardMetric },
            )
          }
          options={METRICS.map((m) => ({ value: m, label: t(`dashboard.query.metric.${m}`) }))}
          testId="config-metric"
          helperText={metric === "share" ? t("dashboard.config.shareHelp") : undefined}
        />
        <SelectField
          label={t("dashboard.config.metricField")}
          value={query.metric_field ?? NONE}
          onChange={(v) => setQuery({ metric_field: v || null })}
          options={measures.map((m) => ({
            value: m,
            label: labels.measure(m, typeKey),
            group: t(`dashboard.config.group.${measureGroup(m)}`),
          }))}
          disabled={!needsField}
          required={needsField}
          testId="config-metric-field"
        />
      </Box>
    </Stack>
  );
}
