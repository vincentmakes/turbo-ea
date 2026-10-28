/**
 * Configure one widget: its title, and for a generic KPI or chart the query
 * behind it (card type, grouping, measure, relation for a sankey) and how it
 * is drawn. A live preview renders the real widget with the draft, so what
 * the admin sees is what the dashboard will show. Save is offered only for a
 * draft the backend accepts (`widgetConfigModel.draftProblem`).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { hasPermission } from "@/components/RequirePermission";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useReadableCardTypes } from "@/hooks/useReadableCardTypes";
import { useFieldLabel, useRelationLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import type { DashboardChartKind, DashboardMetric, DashboardQuery, DashboardWidget } from "@/types";
import { DashboardSourcesProvider } from "../DashboardSources";
import { fieldOfDimension } from "../dashboardQuery";
import { WIDGET_REGISTRY } from "../widgets/registry";
import WidgetFrame from "../widgets/WidgetFrame";
import {
  ACTIVITY_FILTERS,
  APPROVAL_STATUSES,
  LIFECYCLE_PHASES,
  MAX_ACTIVITY_ROWS,
  availableChartKinds,
  configKind,
  dimensionOptions,
  draftFromWidget,
  draftProblem,
  numericFields,
  readableRelationTypes,
  widgetFromDraft,
  type ConfigDraft,
} from "./widgetConfigModel";

interface Props {
  open: boolean;
  /** The widget being configured (a fresh one when adding). */
  widget: DashboardWidget | null;
  mode: "create" | "edit";
  onClose: () => void;
  onSave: (widget: DashboardWidget) => void;
}

const METRICS: DashboardMetric[] = ["count", "sum", "avg"];
const NONE = "";

export default function WidgetConfigDialog({ open, widget, mode, onClose, onSave }: Props) {
  const { t } = useTranslation("common");
  if (!widget) return null;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth disableRestoreFocus>
      <DialogTitle>
        {mode === "create" ? t("dashboard.config.createTitle") : t("dashboard.config.editTitle")}
      </DialogTitle>
      {open && <ConfigForm key={widget.id} widget={widget} mode={mode} onClose={onClose} onSave={onSave} />}
    </Dialog>
  );
}

function ConfigForm({
  widget,
  mode,
  onClose,
  onSave,
}: {
  widget: DashboardWidget;
  mode: "create" | "edit";
  onClose: () => void;
  onSave: (widget: DashboardWidget) => void;
}) {
  const { t } = useTranslation("common");
  const user = useOptionalAuthUser();
  const kind = configKind(widget) ?? "title";
  const [draft, setDraft] = useState<ConfigDraft>(() => draftFromWidget(widget));

  const readable = useReadableCardTypes("module");
  const cardTypes = useMemo(() => readable.filter((ct) => !ct.is_hidden), [readable]);
  const { relationTypes } = useMetamodel();
  const typeLabel = useTypeLabel();
  const fieldLabel = useFieldLabel();
  const relationLabel = useRelationLabel();
  const canViewCosts = hasPermission(user?.permissions, "costs.view");

  const relations = useMemo(
    () => readableRelationTypes(relationTypes, new Set(cardTypes.map((ct) => ct.key))),
    [relationTypes, cardTypes],
  );
  const chartKinds = availableChartKinds(relations.length > 0);

  const query = draft.query;
  const selectedType = cardTypes.find((ct) => ct.key === query.card_type);
  const dimensions = dimensionOptions(selectedType);
  const metricFields = numericFields(selectedType, canViewCosts);

  // Drop a choice the new card type no longer offers.
  useEffect(() => {
    setDraft((d) => {
      const q = { ...d.query };
      let changed = false;
      for (const key of ["group_by", "group_by_2"] as const) {
        if (q[key] && !dimensions.includes(q[key] as string)) {
          q[key] = null;
          changed = true;
        }
      }
      if (q.metric_field && !metricFields.some((f) => f.key === q.metric_field)) {
        q.metric_field = null;
        changed = true;
      }
      if (q.subtype && !(selectedType?.subtypes ?? []).some((s) => s.key === q.subtype)) {
        q.subtype = null;
        changed = true;
      }
      return changed ? { ...d, query: q } : d;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on the type only; the lists derive from it
  }, [query.card_type, canViewCosts]);

  const setQuery = (patch: Partial<DashboardQuery>) => setDraft((d) => ({ ...d, query: { ...d.query, ...patch } }));
  const set = <K extends keyof ConfigDraft>(key: K, value: ConfigDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const problem = draftProblem(kind, draft);
  const preview = useMemo(
    () => (problem ? null : widgetFromDraft(widget, kind, draft)),
    [problem, widget, kind, draft],
  );

  const dimensionLabel = (dim: string) => {
    const fieldKey = fieldOfDimension(dim);
    if (fieldKey) {
      const field = (selectedType?.fields_schema ?? [])
        .flatMap((s) => s.fields ?? [])
        .find((f) => f.key === fieldKey);
      return field ? fieldLabel(field) : fieldKey;
    }
    return t(`dashboard.query.dimension.${dim}`);
  };

  const isChart = kind === "chart";
  const isSankey = isChart && draft.chart === "sankey";
  const isGauge = isChart && draft.chart === "gauge";
  const showQuery = kind === "kpi" || isChart;
  const showGrouping = isChart && !isSankey && !isGauge;

  const select = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    options: { value: string; label: string }[],
    extra: { required?: boolean; disabled?: boolean; testId?: string; helperText?: ReactNode } = {},
  ) => (
    <TextField
      select
      size="small"
      fullWidth
      label={label}
      value={value}
      required={extra.required}
      disabled={extra.disabled}
      helperText={extra.helperText}
      onChange={(e) => onChange(e.target.value)}
      slotProps={{ htmlInput: { "data-testid": extra.testId } }}
    >
      {options.map((o) => (
        <MenuItem key={o.value || "__none"} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </TextField>
  );

  const anyOption = { value: NONE, label: t("dashboard.config.anyValue") };

  return (
    <>
      <DialogContent dividers>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: showQuery ? "1fr 1fr" : "1fr" }, gap: 3 }}>
          <Stack spacing={2}>
            <TextField
              size="small"
              fullWidth
              label={t("dashboard.config.title")}
              value={draft.title}
              placeholder={t("dashboard.config.titlePlaceholder")}
              onChange={(e) => set("title", e.target.value)}
              helperText={t("dashboard.config.titleHelp")}
            />

            {isChart &&
              select(
                t("dashboard.config.chartKind"),
                draft.chart,
                (v) => set("chart", v as DashboardChartKind),
                chartKinds.map((k) => ({ value: k, label: t(`dashboard.query.chart.${k}`) })),
                { testId: "config-chart-kind" },
              )}

            {isSankey &&
              select(
                t("dashboard.config.relationType"),
                query.relation_type ?? NONE,
                (v) => setQuery({ relation_type: v || null }),
                relations.map((rt) => {
                  const source = cardTypes.find((ct) => ct.key === rt.source_type_key);
                  const target = cardTypes.find((ct) => ct.key === rt.target_type_key);
                  return {
                    value: rt.key,
                    label: `${typeLabel(source)} → ${relationLabel(rt)} → ${typeLabel(target)}`,
                  };
                }),
                { required: true, testId: "config-relation-type" },
              )}

            {showQuery && !isSankey && (
              <>
                {select(
                  t("dashboard.config.cardType"),
                  query.card_type ?? NONE,
                  (v) => setQuery({ card_type: v || null }),
                  [
                    { value: NONE, label: t("dashboard.config.allCardTypes") },
                    ...cardTypes.map((ct) => ({ value: ct.key, label: typeLabel(ct) })),
                  ],
                  { testId: "config-card-type" },
                )}

                {showGrouping &&
                  select(
                    t("dashboard.config.dimension"),
                    query.group_by ?? NONE,
                    (v) => setQuery({ group_by: v || null }),
                    dimensions.map((d) => ({ value: d, label: dimensionLabel(d) })),
                    { required: true, testId: "config-dimension" },
                  )}

                {showGrouping &&
                  draft.chart === "heatmap" &&
                  select(
                    t("dashboard.config.secondDimension"),
                    query.group_by_2 ?? NONE,
                    (v) => setQuery({ group_by_2: v || null }),
                    dimensions
                      .filter((d) => d !== query.group_by)
                      .map((d) => ({ value: d, label: dimensionLabel(d) })),
                    { required: true, testId: "config-dimension-2" },
                  )}

                <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                  {select(
                    t("dashboard.config.metric"),
                    query.metric ?? "count",
                    (v) =>
                      setQuery(
                        v === "count"
                          ? { metric: null, metric_field: null }
                          : { metric: v as DashboardMetric },
                      ),
                    METRICS.map((m) => ({ value: m, label: t(`dashboard.query.metric.${m}`) })),
                    { testId: "config-metric" },
                  )}
                  {select(
                    t("dashboard.config.metricField"),
                    query.metric_field ?? NONE,
                    (v) => setQuery({ metric_field: v || null }),
                    metricFields.map((f) => ({ value: f.key, label: fieldLabel(f) })),
                    {
                      disabled: !query.metric || query.metric === "count" || metricFields.length === 0,
                      required: !!query.metric && query.metric !== "count",
                      testId: "config-metric-field",
                    },
                  )}
                </Box>

                <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                  {select(
                    t("dashboard.config.approvalFilter"),
                    query.approval_status ?? NONE,
                    (v) => setQuery({ approval_status: v || null }),
                    [
                      anyOption,
                      ...APPROVAL_STATUSES.map((s) => ({ value: s, label: t(`status.${s.toLowerCase()}`) })),
                    ],
                    { testId: "config-approval" },
                  )}
                  {select(
                    t("dashboard.config.lifecycleFilter"),
                    query.lifecycle_phase ?? NONE,
                    (v) => setQuery({ lifecycle_phase: v || null }),
                    [anyOption, ...LIFECYCLE_PHASES.map((p) => ({ value: p, label: t(`lifecycle.${p}`) }))],
                    { testId: "config-lifecycle" },
                  )}
                </Box>
              </>
            )}

            {kind === "kpi" && (
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                {select(
                  t("dashboard.kpi.goodDirection"),
                  draft.goodDirection,
                  (v) => set("goodDirection", v === "down" ? "down" : "up"),
                  [
                    { value: "up", label: t("dashboard.kpi.goodDirection.up") },
                    { value: "down", label: t("dashboard.kpi.goodDirection.down") },
                  ],
                  { testId: "config-good-direction" },
                )}
                {select(
                  t("dashboard.config.format"),
                  draft.format,
                  (v) => set("format", v === "percent" ? "percent" : "number"),
                  [
                    { value: "number", label: t("dashboard.kpi.format.number") },
                    { value: "percent", label: t("dashboard.kpi.format.percent") },
                  ],
                  { testId: "config-format" },
                )}
              </Box>
            )}

            {isChart && !isSankey && (
              <TextField
                size="small"
                type="number"
                fullWidth
                label={isGauge ? t("dashboard.config.gaugeMax") : t("dashboard.config.limit")}
                value={draft.max}
                onChange={(e) => set("max", e.target.value)}
                slotProps={{ htmlInput: { min: 1, "data-testid": "config-max" } }}
              />
            )}

            {isChart && !isSankey && !isGauge && draft.chart !== "heatmap" && (
              <FormControlLabel
                control={<Switch checked={draft.drill} onChange={(e) => set("drill", e.target.checked)} />}
                label={t("dashboard.config.drill")}
              />
            )}

            {kind === "activity" && (
              <>
                <TextField
                  size="small"
                  type="number"
                  fullWidth
                  label={t("dashboard.config.maxRows")}
                  value={draft.maxRows}
                  onChange={(e) => set("maxRows", e.target.value)}
                  slotProps={{ htmlInput: { min: 1, max: MAX_ACTIVITY_ROWS, "data-testid": "config-max-rows" } }}
                />
                {select(
                  t("dashboard.config.activityFilter"),
                  draft.activityFilter,
                  (v) => set("activityFilter", v as ConfigDraft["activityFilter"]),
                  ACTIVITY_FILTERS.map((f) => ({ value: f, label: t(`dashboard.activity.filter.${f}`) })),
                  { testId: "config-activity-filter" },
                )}
              </>
            )}

            {problem && (
              <Alert severity="info" data-testid="config-problem">
                {t(`dashboard.config.problem.${problem}`)}
              </Alert>
            )}
          </Stack>

          {showQuery && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                {t("dashboard.config.preview")}
              </Typography>
              <Box data-testid="config-preview" sx={{ height: kind === "kpi" ? 140 : 300, display: "flex" }}>
                {preview ? (
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <DashboardSourcesProvider widgets={[preview]}>
                      <WidgetFrame widget={preview} editing={false}>
                        <PreviewBody widget={preview} />
                      </WidgetFrame>
                    </DashboardSourcesProvider>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary" sx={{ m: "auto", textAlign: "center" }}>
                    {t("dashboard.config.previewInvalid")}
                  </Typography>
                )}
              </Box>
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("actions.cancel")}</Button>
        <Button
          variant="contained"
          disabled={!!problem}
          onClick={() => onSave(widgetFromDraft(widget, kind, draft))}
        >
          {mode === "create" ? t("actions.add") : t("actions.apply")}
        </Button>
      </DialogActions>
    </>
  );
}

function PreviewBody({ widget }: { widget: DashboardWidget }) {
  const Component = WIDGET_REGISTRY[widget.type].Component;
  return <Component widget={widget} />;
}
