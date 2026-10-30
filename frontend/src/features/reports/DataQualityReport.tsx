import { useEffect, useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Alert from "@mui/material/Alert";
import ReportShell from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";
import MetricCard from "./MetricCard";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useCardSubtypeLabel } from "@/hooks/useCardSubtypeLabel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import { useDateFormat } from "@/hooks/useDateFormat";
import EChart, { EXPORT_DPR } from "@/components/charts/EChart";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import ReportCardListPanel, { type ReportCardListItem } from "./ReportCardListPanel";
import {
  buildStackedBarOption,
  stackedBarHeight,
  type StackedBarRow,
} from "./dataQualityChartOption";
import {
  buildInventoryEolUrl,
  buildInventoryFlagUrl,
  buildInventorySliceUrl,
  INVENTORY_EMPTY_VALUE,
} from "./portfolioInventoryLink";
import {
  bandColor,
  bandOf,
  DATA_QUALITY_BANDS,
  isDataQualityBand,
  type DataQualityBand,
} from "@/lib/dataQualityBands";
import { useApiQuery } from "@/hooks/useApiQuery";
import { api } from "@/api/client";
import { EOL_COVERAGE_COLORS } from "@/theme";
import { EOL_COVERAGE_BUCKETS, type EolCoverageBucket } from "@/lib/eol";

interface TypeStat {
  type: string;
  total: number;
  complete: number;
  partial: number;
  minimal: number;
  avg_data_quality: number;
}

interface WorstItem {
  id: string;
  name: string;
  type: string;
  data_quality: number;
  updated_at: string | null;
}

/** One EOL-capable card type's coverage, split by where it came from. */
interface EolCoverage {
  type: string;
  /** Linked to an endoflife.date product cycle. */
  linked: number;
  /** Only a hand-entered End of Life date. */
  manual: number;
  /** Neither — nobody has recorded an end of life for these. */
  missing: number;
  total: number;
}

interface DQData {
  overall_data_quality: number;
  total_items: number;
  with_lifecycle: number;
  orphaned: number;
  stale: number;
  /** EOL coverage per EOL-capable card type, for the chart at the foot. */
  eol_coverage: EolCoverage[];
  by_type: TypeStat[];
  worst_items: WorstItem[];
}

interface DQCard {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  data_quality: number;
  updated_at: string | null;
}

interface DQCardsResponse {
  total: number;
  items: DQCard[];
}

/** A clicked datum's segment, when it names one of the EOL coverage chart's three buckets. */
function isEolBucket(value: unknown): value is EolCoverageBucket {
  return typeof value === "string" && (EOL_COVERAGE_BUCKETS as readonly string[]).includes(value);
}

/** What a clicked segment carries: its card type and which segment it is. */
interface SegmentDatum {
  type?: string;
  segment?: string;
}

/**
 * The slice of the dashboard the side panel is showing. `band` is one segment
 * of a stacked bar, `type` a whole bar, `flag` an orphaned/stale KPI tile, and
 * `eol` one segment of the EOL coverage chart at the foot.
 */
type DQScope =
  | { kind: "band"; typeKey: string; band: DataQualityBand }
  | { kind: "type"; typeKey: string }
  | { kind: "flag"; flag: "orphaned" | "stale" }
  | { kind: "eol"; typeKey: string; bucket: EolCoverageBucket };

// Derived from the shared band definitions rather than restated, so the
// report's segments cannot drift from the inventory's chips of the same name.
/**
 * EOL coverage segments. Deliberately not the EOL *status* palette from
 * `@/lib/eol`: those colours mean "how urgent is this component's end of
 * life", and this chart answers a different question — whether anything is
 * recorded at all — so borrowing red/amber would read as risk where none has
 * been established.
 */
const EOL_SOURCE_COLORS = EOL_COVERAGE_COLORS;

const QUALITY_COLORS = Object.fromEntries(
  DATA_QUALITY_BANDS.map((b) => [b.key, b.color]),
) as Record<DataQualityBand, string>;

const BAND_LABEL_KEY: Record<DataQualityBand, string> = {
  complete: "dataQuality.complete",
  partial: "dataQuality.partial",
  minimal: "dataQuality.minimal",
};

function scopePath(scope: DQScope): string {
  const params = new URLSearchParams();
  if (scope.kind === "band") {
    params.set("type", scope.typeKey);
    params.set("band", scope.band);
  } else if (scope.kind === "type") {
    params.set("type", scope.typeKey);
  } else if (scope.kind === "eol") {
    // The bucket rides the existing `scope` parameter alongside `type`, the
    // same pairing the band scopes use — no new endpoint surface.
    params.set("type", scope.typeKey);
    params.set("scope", `eol_${scope.bucket}`);
  } else {
    params.set("scope", scope.flag);
  }
  return `/reports/data-quality/cards?${params.toString()}`;
}

function dataQualityColor(v: number): string {
  return bandColor(v);
}

function dataQualityLabelKey(v: number): string {
  return BAND_LABEL_KEY[bandOf(v)];
}

export default function DataQualityReport() {
  const { t } = useTranslation(["reports", "common"]);
  const theme = useTheme();
  const chartTheme = useEChartsTheme();
  // The category axis reserves a fixed pixel gutter, so on a phone it has to
  // shrink or the bars get squeezed into whatever is left over.
  const isNarrow = useMediaQuery(theme.breakpoints.down("sm"));
  const axisWidth = isNarrow ? 96 : 150;
  const tickFontSize = isNarrow ? 11 : 12;
  const { formatDate } = useDateFormat();
  const { types } = useMetamodel();
  const typeLabel = useTypeLabel();
  const subtypeLabel = useCardSubtypeLabel();
  const saved = useSavedReport("data-quality");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() => saved.setSaveDialogOpen(true));
  const [data, setData] = useState<DQData | null>(null);
  const [sidePanelCardId, setSidePanelCardId] = useState<string | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  // Which slice the side panel is showing; null keeps `useApiQuery` idle.
  const [scope, setScope] = useState<DQScope | null>(null);

  // Keyed on user-controlled state, so it must go through the request hook —
  // a bare api.get in an effect lets a stale segment's response land last and
  // fill the panel with cards the header says you are not looking at (#882).
  const { data: panelData, loading: panelLoading } = useApiQuery<DQCardsResponse>(
    scope ? scopePath(scope) : null,
  );

  // Load saved report config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    if (cfg) {
      if (cfg.view) setView(cfg.view as "chart" | "table");
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({ view });

  // Auto-persist config to localStorage
  useEffect(() => {
    saved.persistConfig(getConfig());
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset all parameters to defaults
  const handleReset = useCallback(() => {
    saved.resetAll();
    setView("chart");
  }, [saved]);

  useEffect(() => {
    api.get<DQData>("/reports/data-quality").then(setData);
  }, []);

  // Same handoff the portfolio drawer makes: the aggregate panel steps aside
  // for the single-card panel rather than stacking two drawers.
  const handlePanelItemClick = useCallback((id: string) => {
    setScope(null);
    setSidePanelCardId(id);
  }, []);

  /** Guarded because a click is only as reliable as the datum it lands on —
   * a click that cannot name its type opens nothing. */
  const openBand = useCallback((typeKey: string | undefined, band: DataQualityBand) => {
    if (typeKey) setScope({ kind: "band", typeKey, band });
  }, []);

  const openEol = useCallback((typeKey: string | undefined, bucket: EolCoverageBucket) => {
    if (typeKey) setScope({ kind: "eol", typeKey, bucket });
  }, []);

  const labelForType = useCallback(
    (key: string) => typeLabel(types.find((tp) => tp.key === key)) || key,
    [types, typeLabel],
  );

  // Both charts are the same stacked-bar shape, so they read as one report.
  const completeLabel = t("dataQuality.complete");
  const partialLabel = t("dataQuality.partial");
  const minimalLabel = t("dataQuality.minimal");
  const eolLinkedLabel = t("dataQuality.eolLinked");
  const eolManualLabel = t("dataQuality.eolManual");
  const eolMissingLabel = t("dataQuality.eolMissing");

  const completenessRows: StackedBarRow[] = useMemo(
    () =>
      (data?.by_type ?? []).map((bt) => ({
        key: bt.type,
        label: labelForType(bt.type),
        values: [bt.complete, bt.partial, bt.minimal],
      })),
    [data, labelForType],
  );

  // EOL coverage: the backend already counts per type, so this only resolves
  // the labels.
  const eolRows: StackedBarRow[] = useMemo(
    () =>
      (data?.eol_coverage ?? []).map((row) => ({
        key: row.type,
        label: labelForType(row.type),
        values: [row.linked, row.manual, row.missing],
      })),
    [data, labelForType],
  );

  const chartOptions = useMemo(() => {
    const opts = {
      chrome: chartTheme,
      isRtl: chartTheme.isRtl,
      axisWidth,
      tickFontSize,
      totalLabel: (count: number) => t("dataQuality.totalItemsLabel", { count }),
    };
    return {
      completeness: buildStackedBarOption(
        completenessRows,
        [
          { key: "complete", name: completeLabel, color: QUALITY_COLORS.complete },
          { key: "partial", name: partialLabel, color: QUALITY_COLORS.partial },
          { key: "minimal", name: minimalLabel, color: QUALITY_COLORS.minimal },
        ],
        opts,
      ),
      eol: buildStackedBarOption(
        eolRows,
        [
          { key: "linked", name: eolLinkedLabel, color: EOL_SOURCE_COLORS.linked },
          { key: "manual", name: eolManualLabel, color: EOL_SOURCE_COLORS.manual },
          { key: "missing", name: eolMissingLabel, color: EOL_SOURCE_COLORS.missing },
        ],
        opts,
      ),
    };
  }, [
    chartTheme,
    axisWidth,
    tickFontSize,
    t,
    completenessRows,
    eolRows,
    completeLabel,
    partialLabel,
    minimalLabel,
    eolLinkedLabel,
    eolManualLabel,
    eolMissingLabel,
  ]);

  // Each datum names its card type and segment (`buildStackedBarOption`), and
  // the segment is checked against its chart's own vocabulary before it opens
  // anything.
  const handleCompletenessClick = useCallback(
    (p: { data?: unknown }) => {
      const d = p.data as SegmentDatum | undefined;
      if (d && isDataQualityBand(d.segment)) openBand(d.type, d.segment);
    },
    [openBand],
  );

  const handleEolClick = useCallback(
    (p: { data?: unknown }) => {
      const d = p.data as SegmentDatum | undefined;
      if (d && isEolBucket(d.segment)) openEol(d.type, d.segment);
    },
    [openEol],
  );

  if (data === null)
    return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>;

  const lifecyclePct = data.total_items > 0 ? ((data.with_lifecycle / data.total_items) * 100).toFixed(0) : "0";
  const orphanedPct = data.total_items > 0 ? ((data.orphaned / data.total_items) * 100).toFixed(0) : "0";
  const stalePct = data.total_items > 0 ? ((data.stale / data.total_items) * 100).toFixed(0) : "0";

  const EOL_BUCKET_LABEL: Record<EolCoverageBucket, string> = {
    linked: eolLinkedLabel,
    manual: eolManualLabel,
    missing: eolMissingLabel,
  };

  // ---- Side panel ----------------------------------------------------
  const panelTitle = (() => {
    if (!scope) return "";
    if (scope.kind === "band") {
      return `${labelForType(scope.typeKey)} · ${t(BAND_LABEL_KEY[scope.band])}`;
    }
    if (scope.kind === "type") return labelForType(scope.typeKey);
    if (scope.kind === "eol") {
      // The same segment labels the chart and its legend use.
      return `${labelForType(scope.typeKey)} · ${EOL_BUCKET_LABEL[scope.bucket]}`;
    }
    return scope.flag === "orphaned" ? t("dataQuality.orphaned") : t("dataQuality.stale");
  })();

  const panelItems: ReportCardListItem[] = (panelData?.items ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    secondary: [
      subtypeLabel(item.type, item.subtype) || labelForType(item.type),
      `${Math.round(item.data_quality)}%`,
    ].join(" · "),
    dotColor: dataQualityColor(item.data_quality),
  }));

  // Band and type slices land grouped by quality with the clicked band
  // expanded; the flag tiles land on their own inventory filter.
  // Only the "not recorded" bucket has an exact equivalent in the inventory:
  // its End of life facet filters by STATUS, never by where the data came
  // from, so "linked" and "entered by hand" have no landing that lists the
  // same cards — and a button onto a different set is worse than none.
  const panelInventoryHref = !scope
    ? undefined
    : scope.kind === "eol"
      ? scope.bucket === "missing"
        ? buildInventoryEolUrl(scope.typeKey, INVENTORY_EMPTY_VALUE)
        : undefined
      : scope.kind === "flag"
        ? buildInventoryFlagUrl(scope.flag)
      : buildInventorySliceUrl({
          cardType: scope.typeKey,
          mode: { kind: "quality" },
          group:
            scope.kind === "band"
              ? { key: scope.band, label: t(BAND_LABEL_KEY[scope.band]) }
              : null,
        });

  const panelTotal = panelData?.total ?? 0;
  const shown = panelItems.length;

  // Alerts
  const alerts: { severity: "error" | "warning" | "info"; msg: string }[] = [];
  if (data.orphaned > 5) alerts.push({ severity: "warning", msg: t("dataQuality.orphanedAlert", { count: data.orphaned }) });
  if (data.stale > 5) alerts.push({ severity: "warning", msg: t("dataQuality.staleAlert", { count: data.stale }) });
  if (data.overall_data_quality < 50) alerts.push({ severity: "error", msg: t("dataQuality.overallAlert", { pct: data.overall_data_quality }) });

  return (
    <ReportShell
      title={t("dataQuality.title")}
      icon="verified"
      iconColor="#2e7d32"
      paginateRowSelector="[data-export-row]"
      view={view}
      onViewChange={setView}
      chartRef={chartRef}
      onSaveReport={captureAndSave}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      onReset={handleReset}
    >
      {/* Alerts */}
      {alerts.length > 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 2 }}>
          {alerts.map((a, i) => (
            <Alert key={i} severity={a.severity} variant="outlined" sx={{ py: 0 }}>
              {a.msg}
            </Alert>
          ))}
        </Box>
      )}

      {/* KPI strip */}
      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <MetricCard
          label={t("dataQuality.overallQuality")}
          value={`${data.overall_data_quality}%`}
          icon="speed"
          iconColor={dataQualityColor(data.overall_data_quality)}
          color={dataQualityColor(data.overall_data_quality)}
        />
        <MetricCard
          label={t("dataQuality.totalItems")}
          value={data.total_items}
          icon="inventory_2"
        />
        <MetricCard
          label={t("dataQuality.withLifecycle")}
          value={`${lifecyclePct}%`}
          subtitle={`${data.with_lifecycle} of ${data.total_items}`}
          icon="schedule"
          iconColor="#1976d2"
        />
        <MetricCard
          label={t("dataQuality.orphaned")}
          value={data.orphaned}
          subtitle={t("dataQuality.percentOfTotal", { pct: orphanedPct })}
          icon="link_off"
          iconColor={data.orphaned > 5 ? "#e65100" : theme.palette.text.secondary}
          onClick={() => setScope({ kind: "flag", flag: "orphaned" })}
        />
        <MetricCard
          label={t("dataQuality.stale")}
          value={data.stale}
          subtitle={t("dataQuality.percentOfTotal", { pct: stalePct })}
          icon="update_disabled"
          iconColor={data.stale > 5 ? "#e65100" : theme.palette.text.secondary}
          onClick={() => setScope({ kind: "flag", flag: "stale" })}
        />
      </Box>

      {view === "chart" ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {/* Stacked bar chart by type */}
          <Paper variant="outlined" sx={{ p: 2 }} data-export-row>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
              {t("dataQuality.completenessByType")}
            </Typography>
            <EChart
              option={chartOptions.completeness}
              style={{ height: stackedBarHeight(completenessRows.length, 250, 50) }}
              devicePixelRatio={EXPORT_DPR}
              ariaLabel={t("dataQuality.completenessByType")}
              onClick={handleCompletenessClick}
            />
          </Paper>

          {/* Per-type data quality bars */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
              {t("dataQuality.avgCompletionByType")}
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              {data.by_type.map((bt) => {
                const found = types.find((tp) => tp.key === bt.type);
                const label = typeLabel(found) || bt.type;
                return (
                  <Box
                    key={bt.type}
                    data-export-row
                    onClick={() => setScope({ kind: "type", typeKey: bt.type })}
                    sx={{
                      cursor: "pointer",
                      borderRadius: 1,
                      p: 0.5,
                      mx: -0.5,
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  >
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500, fontSize: 13 }}>{label}</Typography>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Chip size="small" label={t("dataQuality.items", { count: bt.total })} variant="outlined" sx={{ height: 20, fontSize: 10 }} />
                        <Typography
                          variant="caption"
                          sx={{ fontWeight: 700, color: dataQualityColor(bt.avg_data_quality), minWidth: 36, textAlign: "right" }}
                        >
                          {bt.avg_data_quality}%
                        </Typography>
                      </Box>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={bt.avg_data_quality}
                      sx={{
                        height: 8,
                        borderRadius: 4,
                        bgcolor: "action.selected",
                        "& .MuiLinearProgress-bar": {
                          bgcolor: dataQualityColor(bt.avg_data_quality),
                          borderRadius: 4,
                        },
                      }}
                    />
                  </Box>
                );
              })}
            </Box>
          </Paper>

          {/* EOL coverage. Data quality above is about the fields a card
              type defines; this is about a fact that lives outside the
              metamodel entirely — whether anyone has recorded an end of life
              for the components that can have one. Split by source because a
              vendor link keeps itself current while a hand-entered date is
              only as good as its last review, and rendered only when the
              landscape actually holds such cards. */}
          {eolRows.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2 }} data-export-row>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {t("dataQuality.eolCoverage")}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
                {t("dataQuality.eolCoverageHint")}
              </Typography>
              {/* Each segment opens the panel on the cards behind it, the
                  same way a completeness segment does. */}
              <EChart
                option={chartOptions.eol}
                style={{ height: stackedBarHeight(eolRows.length, 160, 70) }}
                devicePixelRatio={EXPORT_DPR}
                ariaLabel={t("dataQuality.eolCoverage")}
                onClick={handleEolClick}
              />
            </Paper>
          )}
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {/* Type breakdown table */}
          <Paper variant="outlined" sx={{ overflow: "auto" }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, p: 2, pb: 0 }}>
              {t("dataQuality.byType")}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("common:labels.type")}</TableCell>
                  <TableCell align="right">{t("cost.total")}</TableCell>
                  <TableCell align="right">{t("dataQuality.complete")}</TableCell>
                  <TableCell align="right">{t("dataQuality.partial")}</TableCell>
                  <TableCell align="right">{t("dataQuality.minimal")}</TableCell>
                  <TableCell align="right">{t("dataQuality.avgCompletion")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.by_type.map((bt) => (
                  <TableRow key={bt.type} hover>
                    {/* Same slices as the chart's bar and its segments, so the
                        two views drill into identical panels. */}
                    <TableCell
                      sx={{ fontWeight: 500, cursor: "pointer" }}
                      onClick={() => setScope({ kind: "type", typeKey: bt.type })}
                    >
                      {labelForType(bt.type)}
                    </TableCell>
                    <TableCell align="right">{bt.total}</TableCell>
                    {DATA_QUALITY_BANDS.map((band) => (
                      <TableCell
                        key={band.key}
                        align="right"
                        sx={{ color: QUALITY_COLORS[band.key], cursor: "pointer" }}
                        onClick={() => openBand(bt.type, band.key)}
                      >
                        {bt[band.key]}
                      </TableCell>
                    ))}
                    <TableCell align="right">
                      <Chip
                        size="small"
                        label={`${bt.avg_data_quality}%`}
                        sx={{
                          bgcolor: dataQualityColor(bt.avg_data_quality),
                          color: "#fff",
                          fontWeight: 700,
                          height: 22,
                          fontSize: 11,
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>

          {/* Worst offenders */}
          <Paper variant="outlined" sx={{ overflow: "auto" }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, p: 2, pb: 0 }}>
              {t("dataQuality.lowestQuality")}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("common:labels.name")}</TableCell>
                  <TableCell>{t("common:labels.type")}</TableCell>
                  <TableCell align="right">{t("dataQuality.completion")}</TableCell>
                  <TableCell>{t("common:labels.status")}</TableCell>
                  <TableCell>{t("dataQuality.lastUpdated")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.worst_items.map((item) => (
                  <TableRow
                    key={item.id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => setSidePanelCardId(item.id)}
                  >
                    <TableCell sx={{ fontWeight: 500 }}>{item.name}</TableCell>
                    <TableCell>
                      <Chip size="small" label={(() => { const tp = types.find((tp) => tp.key === item.type); return typeLabel(tp) || item.type; })()} variant="outlined" sx={{ height: 22, fontSize: 11 }} />
                    </TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, justifyContent: "flex-end" }}>
                        <LinearProgress
                          variant="determinate"
                          value={item.data_quality}
                          sx={{
                            width: 60,
                            height: 6,
                            borderRadius: 3,
                            bgcolor: "action.selected",
                            "& .MuiLinearProgress-bar": {
                              bgcolor: dataQualityColor(item.data_quality),
                              borderRadius: 3,
                            },
                          }}
                        />
                        <Typography variant="caption" sx={{ fontWeight: 600, minWidth: 30, textAlign: "right" }}>
                          {item.data_quality}%
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={t(dataQualityLabelKey(item.data_quality))}
                        sx={{
                          bgcolor: dataQualityColor(item.data_quality),
                          color: "#fff",
                          height: 20,
                          fontSize: 10,
                          fontWeight: 600,
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {item.updated_at ? formatDate(item.updated_at) : "—"}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </Box>
      )}

      {/* Legend */}
      <Box sx={{ mt: 2, display: "flex", gap: 2, flexWrap: "wrap" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: QUALITY_COLORS.complete }} />
          <Typography variant="caption" color="text.secondary">{t("dataQuality.completeLegend")}</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: QUALITY_COLORS.partial }} />
          <Typography variant="caption" color="text.secondary">{t("dataQuality.partialLegend")}</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: QUALITY_COLORS.minimal }} />
          <Typography variant="caption" color="text.secondary">{t("dataQuality.minimalLegend")}</Typography>
        </Box>
      </Box>
      <ReportCardListPanel
        open={scope !== null}
        title={panelTitle}
        items={panelItems}
        loading={panelLoading}
        metrics={[{ value: panelTotal, label: t("common:labels.cards") }]}
        emptyLabel={t("dataQuality.noCardsInSegment")}
        truncatedLabel={
          panelTotal > shown ? t("dataQuality.showingOf", { shown, total: panelTotal }) : undefined
        }
        inventoryHref={panelInventoryHref}
        onItemClick={handlePanelItemClick}
        onClose={() => setScope(null)}
      />
      <CardDetailSidePanel
        cardId={sidePanelCardId}
        open={!!sidePanelCardId}
        onClose={() => setSidePanelCardId(null)}
      />
      <SaveReportDialog
        open={saved.saveDialogOpen}
        onClose={() => saved.setSaveDialogOpen(false)}
        reportType="data-quality"
        config={getConfig()}
        thumbnail={thumbnail}
      />
    </ReportShell>
  );
}
