/**
 * Configure one widget: its title, and for a generic KPI or chart the query
 * behind it and how it is drawn, split into sections — the sankey's relation
 * and sides (`SankeySection`), the card type / grouping / measure
 * (`QuerySection`), the filters (`FiltersSection`), and the presentation
 * (`PresentationSection`); a module widget gets `SourceForm`, the Data quality
 * leaderboard `LeaderboardSection`. A live preview
 * renders the real widget with the draft, so what the admin sees is what the
 * dashboard will show. Save is offered only for a draft the backend accepts
 * (`widgetConfigModel.draftProblem`).
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { hasPermission } from "@/components/RequirePermission";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useReadableCardTypes } from "@/hooks/useReadableCardTypes";
import type { DashboardQuery, DashboardWidget } from "@/types";
import { DashboardSourcesProvider } from "../DashboardSources";
import { useDashboardModules } from "../useDashboardModules";
import { WIDGET_REGISTRY } from "../widgets/registry";
import WidgetFrame from "../widgets/WidgetFrame";
import FiltersSection from "./sections/FiltersSection";
import LeaderboardSection from "./sections/LeaderboardSection";
import PresentationSection from "./sections/PresentationSection";
import QuerySection from "./sections/QuerySection";
import SankeySection from "./sections/SankeySection";
import SelectField from "./sections/SelectField";
import SourceForm from "./sections/SourceForm";
import {
  ACTIVITY_FILTERS,
  MAX_ACTIVITY_ROWS,
  availableChartKinds,
  chartDimensionOptions,
  cleanQuery,
  configKind,
  dimensionOptions,
  draftFromWidget,
  draftProblem,
  draftQuery,
  flagOptions,
  gaugeIsPercent,
  gaugeMeasureOptions,
  keepsFlag,
  measureOptions,
  readableRelationTypes,
  relationPresenceOptions,
  sankeySideOptions,
  secondaryApplies,
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
  const modules = useDashboardModules();
  const kind = configKind(widget) ?? "title";
  const [draft, setDraft] = useState<ConfigDraft>(() => draftFromWidget(widget));

  const readable = useReadableCardTypes("module");
  const cardTypes = useMemo(() => readable.filter((ct) => !ct.is_hidden), [readable]);
  const { types, relationTypes } = useMetamodel();
  const canViewCosts = hasPermission(user?.permissions, "costs.view");

  const relations = useMemo(
    () => readableRelationTypes(relationTypes, new Set(cardTypes.map((ct) => ct.key))),
    [relationTypes, cardTypes],
  );
  const chartKinds = availableChartKinds(relations.length > 0);

  const query = draft.query;
  const isChart = kind === "chart";
  const isSankey = isChart && draft.chart === "sankey";
  const isGauge = isChart && draft.chart === "gauge";
  const selectedType = cardTypes.find((ct) => ct.key === query.card_type);
  const dimensions = chartDimensionOptions(dimensionOptions(selectedType, relations), draft.chart);
  // A gauge measures a rate or a total against a target, never any average.
  const measures = isGauge
    ? gaugeMeasureOptions(selectedType, canViewCosts, query.metric, relations)
    : measureOptions(selectedType, canViewCosts, relations);
  const flagsOffered = flagOptions(selectedType);
  const presenceOptions = isSankey ? [] : relationPresenceOptions(selectedType, relations);
  const sankeyRt = isSankey ? relations.find((rt) => rt.key === query.relation_type) : undefined;

  // Drop a choice the new card type, relation or chart kind no longer offers.
  useEffect(() => {
    setDraft((d) => {
      const q = { ...d.query };
      let changed = false;
      const clear = (key: keyof DashboardQuery) => {
        if (q[key]) {
          q[key] = null;
          changed = true;
        }
      };
      if (isSankey) {
        if (q.group_by && !sankeySideOptions(sankeyRt, "source", types).includes(q.group_by)) clear("group_by");
        if (q.group_by_2 && !sankeySideOptions(sankeyRt, "target", types).includes(q.group_by_2)) clear("group_by_2");
      } else {
        if (q.group_by && !dimensions.includes(q.group_by)) clear("group_by");
        if (q.group_by_2 && !dimensions.includes(q.group_by_2)) clear("group_by_2");
      }
      if (q.metric_field && !measures.includes(q.metric_field)) clear("metric_field");
      if (q.subtype && !(selectedType?.subtypes ?? []).some((s) => s.key === q.subtype)) clear("subtype");
      let { flags, relationPresence } = d;
      // A flag no longer on the menu but still accepted stays (never dropped
      // behind the admin's back); one the new type cannot carry goes.
      const keptFlags = flags.filter((f) => keepsFlag(f, selectedType));
      if (keptFlags.length !== flags.length) {
        flags = keptFlags;
        changed = true;
      }
      if (relationPresence.rt && !presenceOptions.includes(relationPresence.rt)) {
        relationPresence = { rt: null, has: true };
        changed = true;
      }
      return changed ? { ...d, query: q, flags, relationPresence } : d;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on the inputs the option lists derive from
  }, [query.card_type, query.relation_type, query.metric, draft.chart, canViewCosts, relations, types]);

  const setQuery = (patch: Partial<DashboardQuery>) => setDraft((d) => ({ ...d, query: { ...d.query, ...patch } }));
  const set = <K extends keyof ConfigDraft>(key: K, value: ConfigDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const draftProps = { draft, set, setQuery };

  const problem = draftProblem(kind, draft, { types, relationTypes: relations }, widget);
  const preview = useMemo(
    () => (problem ? null : widgetFromDraft(widget, kind, draft, { types })),
    [problem, widget, kind, draft, types],
  );
  const percent = isGauge && gaugeIsPercent(kind, draft, { types });

  const showQuery = kind === "kpi" || isChart;
  const showPreview = showQuery || kind === "source" || kind === "leaderboard";
  const secondaryAvailable = kind === "kpi" && secondaryApplies(cleanQuery(draftQuery(draft), "kpi", draft.chart));
  // A relation-presence filter is a flag on a type; a sankey keeps the
  // static flags only.
  const sankeyFlags = flagOptions(undefined);

  return (
    <>
      <DialogContent dividers>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: showPreview ? "1fr 1fr" : "1fr" }, gap: 3 }}>
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

            {kind === "source" && <SourceForm widget={widget} draft={draft} set={set} />}

            {isChart && (
              <PresentationSection
                {...draftProps}
                kind="chart"
                chartKinds={chartKinds}
                secondaryAvailable={false}
                percent={percent}
              />
            )}

            {isSankey && <SankeySection {...draftProps} relations={relations} types={types} />}

            {showQuery && !isSankey && (
              <QuerySection
                {...draftProps}
                cardTypes={cardTypes}
                dimensions={dimensions}
                measures={measures}
                grouping={isChart && !isGauge}
                secondGrouping={draft.chart === "heatmap" || draft.chart === "stacked_column"}
              />
            )}

            {showQuery && (
              <FiltersSection
                {...draftProps}
                flagOptions={isSankey ? sankeyFlags : flagsOffered}
                presenceOptions={presenceOptions}
              />
            )}

            {kind === "kpi" && (
              <PresentationSection
                {...draftProps}
                kind="kpi"
                chartKinds={[]}
                secondaryAvailable={secondaryAvailable}
              />
            )}

            {kind === "leaderboard" && <LeaderboardSection draft={draft} set={set} cardTypes={cardTypes} />}

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
                <SelectField
                  label={t("dashboard.config.activityFilter")}
                  value={draft.activityFilter}
                  onChange={(v) => set("activityFilter", v as ConfigDraft["activityFilter"])}
                  options={ACTIVITY_FILTERS.map((f) => ({ value: f, label: t(`dashboard.activity.filter.${f}`) }))}
                  testId="config-activity-filter"
                />
              </>
            )}

            {problem && (
              <Alert severity="info" data-testid="config-problem">
                {t(`dashboard.config.problem.${problem}`)}
              </Alert>
            )}
          </Stack>

          {showPreview && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                {t("dashboard.config.preview")}
              </Typography>
              <Box
                data-testid="config-preview"
                sx={{ height: widget.type === "kpi" ? (draft.sparkline ? 170 : 140) : 300, display: "flex" }}
              >
                {preview ? (
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <DashboardSourcesProvider widgets={[preview]} modules={modules}>
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
          onClick={() => onSave(widgetFromDraft(widget, kind, draft, { types }))}
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
