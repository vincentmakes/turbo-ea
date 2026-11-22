import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Checkbox from "@mui/material/Checkbox";
import ListItemText from "@mui/material/ListItemText";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import type { ECharts, EChartsCoreOption } from "echarts/core";
import EChart, { EXPORT_DPR, type EChartClickParams } from "@/components/charts/EChart";
import { useEChartsTheme, type EChartsThemeValue } from "@/components/charts/echartsTheme";
import ReportShell from "./ReportShell";
import {
  buildCostTreemapOption,
  chartTileRect,
  type CostTreemapGroup,
  type CostTreemapItem,
} from "./costTreemapOption";
import { buildCostSankeyOption, chartSankeyNodeHeight } from "./costSankeyOption";
import SaveReportDialog from "./SaveReportDialog";
import CostTrendChart, { type TrendSelection } from "./CostTrendChart";
import CostDrillBar from "./CostDrillBar";
import { applyDrill, crumbsOf, type Drill } from "./costDrill";
import { useCostBreakdown } from "./useCostBreakdown";
import {
  MAX_GROUP_HUES,
  OTHERS_KEY,
  assignGroupColors,
  cardColor,
  drillGroupKey,
  memberShade,
} from "./costColors";
import CostLegend from "./CostLegend";
import { CHART_OTHER, COST_UNSPECIFIED, EOL_WARNING_COLOR, RAG_COLORS, STATUS_COLORS } from "@/theme/tokens";
import MetricCard from "./MetricCard";
import FullscreenPanel from "./FullscreenPanel";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useReadableCardTypes } from "@/hooks/useReadableCardTypes";
import { useSavedReport } from "@/hooks/useSavedReport";
import { applyScope } from "@/hooks/useCardScope";
import { costScopeSource, useCostReportScope } from "./useCostReportScope";
import Button from "@mui/material/Button";
import CardScopeFilter from "@/components/CardScopeFilter";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { useCurrency } from "@/hooks/useCurrency";
import { useAuth } from "@/hooks/useAuth";
import {
  useTypeLabel,
  useFieldLabel,
  useOptionLabel,
  useRelationLabel,
} from "@/hooks/useResolveLabel";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import CardLogoAvatar from "@/components/CardLogoAvatar";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { resolveFacetField } from "@/lib/fieldFacets";
import {
  COMBINED_KEY,
  commonCostFields,
  costFieldChoices,
  isBuiltInFieldType,
  commonGroupableFields,
  relationGroupOptions,
  typeKeysOf,
  typeParam,
} from "./costReportOptions";
import FiscalYearTimeTravel from "@/components/FiscalYearTimeTravel";
import { costFiscalYearName, costFiscalYearOptions } from "@/lib/fiscalYear";
import { formatFieldValue, EMPTY_VALUE, type FieldMeta } from "@/lib/cardDisplayFields";
import { costValue } from "@/lib/costValue";
import { isCostItemType } from "@/lib/costItems";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { CostItemType, FieldDef, TranslationMap } from "@/types";

const COST_REPORT_TYPE_KEYS = ["Application", "ITComponent"] as const;
/** The server's group for a card with no value (and for an ungrouped report). */
const OTHER_GROUP = "__other__";
type CostView = "chart" | "sankey" | "table";

interface CostItem {
  id: string;
  name: string;
  cost: number;
  attributes?: Record<string, unknown>;
  /** Raw group value, present when the request grouped. */
  group?: string;
  /** The card's type key. */
  type?: string;
  logo_updated_at?: string | null;
}

interface CostTreemapResponse {
  items: CostItem[];
  total: number;
  /** Technical keys of the cost fields that add up to the total. */
  components?: string[];
  /** Catalogue cost items by key: the labels of the components that are cost items. */
  item_labels?: ReportItemLabels;
  /** The fiscal year the figures are for (the one requested). */
  fiscal_year?: number;
  /** The fiscal year that contains today, whatever year was requested. */
  current_fiscal_year?: number;
  /** Month (1-12) the workspace's fiscal year starts in. */
  fiscal_year_start?: number;
}

/** A catalogue cost item as the report sends it (`translations` is `{locale: label}`). */
type ReportItemLabels = Record<string, { label: string; translations?: TranslationMap }>;

const EMPTY_COMPONENTS: string[] = [];

interface SankeyNode {
  id: string;
  name: string;
  type: string;
  /** Card nodes only: the card's total and its value per cost item (incl. `__other__`). */
  cost?: number;
  costs?: Record<string, number>;
  /** Set by the page for the chart: the node's fill and a card's type label. */
  color?: string;
  typeLabel?: string;
  typeIcon?: string;
  logo_updated_at?: string | null;
}

interface SankeyLink {
  source: number;
  target: number;
  value: number;
}

interface CostSankeyResponse {
  nodes: SankeyNode[];
  links: SankeyLink[];
  total: number;
  item_labels?: ReportItemLabels;
  fiscal_year?: number;
  current_fiscal_year?: number;
  fiscal_year_start?: number;
}

/** The fiscal year the figures are for, as the server named it. */
interface FiscalYear {
  year: number;
  start: number;
}

function fiscalYearOf(r: {
  fiscal_year?: number;
  fiscal_year_start?: number;
}): FiscalYear | null {
  return r.fiscal_year != null && r.fiscal_year_start != null
    ? { year: r.fiscal_year, start: r.fiscal_year_start }
    : null;
}

function pickAllFields(schema: { fields: FieldDef[] }[]): FieldDef[] {
  const out: FieldDef[] = [];
  for (const s of schema) for (const f of s.fields) if (isBuiltInFieldType(f.type)) out.push(f);
  return out;
}

/* ------------------------------------------------------------------ */
/*  One treemap panel                                                  */
/* ------------------------------------------------------------------ */

interface CostTreemapPanelProps {
  /** The cards that cost anything, largest first, when the report is not grouped. */
  items: CostTreemapItem[];
  /** The groups, each holding its cards, when the report is grouped. */
  groups?: CostTreemapGroup[];
  /** The report's total, each tile's share is read against. */
  total: number;
  /** The panel fills the screen (fullscreen) instead of a fixed height. */
  fullscreen: boolean;
  /** The chart chrome, with the reading direction. */
  chrome: EChartsThemeValue;
  fmt: { format: (v: number) => string };
  onTileOpen: (p: EChartClickParams) => void;
  onTileDrill: (p: EChartClickParams) => void;
}

/**
 * The report's treemap: one tile per card sized by its cost, or one framed
 * block per group holding its cards. A tile prints what its rectangle fits (a
 * name, a name and a cost, or nothing — `tileLabelTier`), read from the
 * chart's own layout while ECharts renders it.
 */
function CostTreemapPanel({
  items,
  groups,
  total,
  fullscreen,
  chrome,
  fmt,
  onTileOpen,
  onTileDrill,
}: CostTreemapPanelProps) {
  const { t } = useTranslation(["reports", "common"]);
  const chartRef = useRef<ECharts | null>(null);
  const onInit = useCallback((chart: ECharts) => {
    chartRef.current = chart;
  }, []);
  // The label formatter calls this while ECharts renders each tile, after it
  // laid the tile out — so a resize re-reads the real rectangles with no React work.
  const tileRect = useCallback((dataIndex: number) => chartTileRect(chartRef.current, dataIndex), []);

  // Memoised: a new option replaces the chart's whole option and replays its
  // animation, so it is rebuilt only when the data or the theme change.
  const option = useMemo(
    () =>
      buildCostTreemapOption(items, {
        chrome,
        isRtl: chrome.isRtl,
        format: (v) => fmt.format(v),
        panelTotal: total,
        percentOfTotal: (pct) => t("cost.percentOfTotalValue", { pct }),
        clickable: true,
        tileRect,
        deltaNew: t("cost.deltaNew"),
        groups,
      }),
    [items, groups, chrome, fmt, total, t, tileRect],
  );

  return (
    <CostChartFrame
      option={option}
      fullscreen={fullscreen}
      ariaLabel={t("cost.title")}
      onClick={onTileOpen}
      onContextMenu={onTileDrill}
      onInit={onInit}
    />
  );
}

/** The Paper around a cost chart: fixed height, or filling the fullscreen panel. */
function CostChartFrame({
  option,
  fullscreen,
  ariaLabel,
  testId,
  onClick,
  onContextMenu,
  onInit,
}: {
  option: EChartsCoreOption;
  fullscreen: boolean;
  ariaLabel: string;
  testId?: string;
  onClick?: (p: EChartClickParams) => void;
  onContextMenu?: (p: EChartClickParams) => void;
  onInit?: (chart: ECharts) => void;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 1, ...(fullscreen && { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }) }}
      data-testid={testId}
      onContextMenu={onContextMenu ? (e: React.MouseEvent) => e.preventDefault() : undefined}
    >
      {/* Drawn at the export's pixel ratio so the PPTX / PNG capture stays crisp. */}
      <EChart
        option={option}
        style={fullscreen ? { flex: 1, minHeight: 0 } : { height: 450 }}
        devicePixelRatio={EXPORT_DPR}
        ariaLabel={ariaLabel}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onInit={onInit}
      />
    </Paper>
  );
}

interface CostSankeyPanelProps {
  nodes: SankeyNode[];
  links: SankeyLink[];
  /** The panel fills the screen (fullscreen) instead of a fixed height. */
  fullscreen: boolean;
  chrome: EChartsThemeValue;
  fmt: { format: (v: number) => string };
  onNodeOpen?: (p: EChartClickParams) => void;
  onNodeDrill?: (p: EChartClickParams) => void;
}

/** The Sankey view: cost items -> groups -> cards. */
function CostSankeyPanel({
  nodes,
  links,
  fullscreen,
  chrome,
  fmt,
  onNodeOpen,
  onNodeDrill,
}: CostSankeyPanelProps) {
  const { t } = useTranslation(["reports", "common"]);
  const chartRef = useRef<ECharts | null>(null);
  const onInit = useCallback((chart: ECharts) => { chartRef.current = chart; }, []);
  const nodeHeight = useCallback((index: number) => chartSankeyNodeHeight(chartRef.current, index), []);
  const option = useMemo(
    () =>
      buildCostSankeyOption(nodes, links, {
        chrome,
        isRtl: chrome.isRtl,
        format: (v) => fmt.format(v),
        nodeHeight,
      }),
    [nodes, links, chrome, fmt, nodeHeight],
  );
  return (
    <CostChartFrame
      option={option}
      fullscreen={fullscreen}
      ariaLabel={t("cost.sankeyChartView")}
      testId="cost-sankey-panel"
      onClick={onNodeOpen}
      onContextMenu={onNodeDrill}
      onInit={onInit}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function CostReport() {
  const { t } = useTranslation(["reports", "common"]);
  const { types, relationTypes, loading: ml } = useMetamodel();
  // Report type pickers offer only the types the user may see.
  const readableTypes = useReadableCardTypes("module");
  const typeLabel = useTypeLabel();
  const relLabel = useRelationLabel();
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();
  const { fmt } = useCurrency();
  const chartTheme = useEChartsTheme();
  const { user } = useAuth();
  const canViewCostsGlobally = !!(
    user?.permissions?.["*"] || user?.permissions?.["costs.view"]
  );
  const typeOptions = useMemo(() => {
    const byKey = new Map(readableTypes.map((tp) => [tp.key, tp]));
    const app = byKey.get("Application");
    const itc = byKey.get("ITComponent");
    const out: { key: string; label: string }[] = [];
    if (app) out.push({ key: app.key, label: typeLabel(app) });
    if (itc) out.push({ key: itc.key, label: typeLabel(itc) });
    if (app && itc)
      out.push({
        key: COMBINED_KEY,
        label: t("cost.combinedType", {
          first: typeLabel(app),
          second: typeLabel(itc),
        }),
      });
    return out;
  }, [readableTypes, typeLabel, t]);
  const saved = useSavedReport("cost");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() =>
    saved.setSaveDialogOpen(true),
  );
  // A type key, or COMBINED_KEY for Applications and IT Components together.
  const [cardTypeKey, setCardTypeKey] = useState("Application");
  const typeKeys = useMemo(() => typeKeysOf(cardTypeKey), [cardTypeKey]);
  const [sidePanelCardId, setSidePanelCardId] = useState<string | null>(null);
  const [fullscreenContainer, setFullscreenContainer] = useState<HTMLElement | null>(null);
  const [drawerContainer, setDrawerContainer] = useState<HTMLElement | null>(null);
  const [costField, setCostField] = useState("costTotalAnnual");
  const [groupBy, setGroupBy] = useState("");
  const [rawItems, setRawItems] = useState<CostItem[] | null>(null);
  // The cost field keys that add up to the total, from the treemap response.
  // Tagged with the type and field they answer, so a stale list never meets a new selection.
  const [componentsFor, setComponentsFor] = useState<{ key: string; list: string[] }>({
    key: "",
    list: [],
  });
  const components =
    componentsFor.key === `${cardTypeKey}|${costField}` ? componentsFor.list : EMPTY_COMPONENTS;
  // Current-year baseline, fetched only when a past fiscal year is selected —
  // the treemap delta badge diffs against it (id -> cost).
  const [baselineCosts, setBaselineCosts] = useState<Map<string, number>>(
    new Map(),
  );
  // Prior-year costs, fetched only when a past fiscal year is selected — the
  // table YoY% column diffs against it (id -> cost).
  const [priorYearCosts, setPriorYearCosts] = useState<Map<string, number>>(
    new Map(),
  );
  const [sankeyData, setSankeyData] = useState<CostSankeyResponse | null>(null);
  const [itemLabels, setItemLabels] = useState<ReportItemLabels>({});
  const [view, setView] = useState<CostView>("chart");
  const [sortK, setSortK] = useState("cost");
  const [sortD, setSortD] = useState<"asc" | "desc">("desc");
  // The server names the fiscal year the figures are for.
  const [fiscalYear, setFiscalYear] = useState<FiscalYear | null>(null);
  // null = current year (the param is omitted, matching today's default
  // request shape byte-for-byte); a picked value asks the server for a past
  // year's card_cost_history row instead of live attributes.
  const [fiscalYearParam, setFiscalYearParam] = useState<number | null>(null);
  // The fiscal year containing today, from the server. NOT `fiscalYear.year`,
  // which is the requested year: anchoring the picker on it re-centred the list
  // every time a past year was picked.
  const [currentFiscalYear, setCurrentFiscalYear] = useState(() =>
    new Date().getFullYear(),
  );
  const fiscalYearOptions = useMemo(
    () => costFiscalYearOptions(currentFiscalYear),
    [currentFiscalYear],
  );
  // The history chart shows on the Forecast year only: the four years before the current one,
  // the current one and the forecast, oldest first. Memoised: the chart refetches when the identity changes.
  const showForecast = fiscalYearParam === currentFiscalYear + 1;
  const trendYears = useMemo(
    () => Array.from({ length: 6 }, (_, i) => currentFiscalYear - 4 + i),
    [currentFiscalYear],
  );
  // Learn the current year from a response, and fall back to "Current" when the
  // requested year is that one or is not among the offered years (a saved
  // report from an earlier year).
  const adoptCurrentFiscalYear = useCallback((cy: number | undefined) => {
    if (cy == null) return;
    setCurrentFiscalYear(cy);
    setFiscalYearParam((p) =>
      p != null && !costFiscalYearOptions(cy).some((o) => o.value === p) ? null : p,
    );
  }, []);

  const scope = useCostReportScope(typeKeys);
  const { scopeIds, setScopeIds, effectiveScopeIds, restore: restoreScope, clear: clearScope } = scope;

  // One schema per selected type; empty until every one of them is known.
  const schemas = useMemo(() => {
    const defs = typeKeys.map((k) => types.find((tp) => tp.key === k));
    return defs.every(Boolean) ? defs.map((d) => d!.fields_schema) : [];
  }, [types, typeKeys]);
  const costFields = useMemo(
    () => commonCostFields(schemas).map((f) => ({ ...f, label: fieldLabel(f) })),
    [schemas, fieldLabel],
  );
  // Cost-item types pick TCO or one catalogue item; any signed-in user may read the catalogue.
  const { data: catalogue } = useApiQuery<CostItemType[]>("/metamodel/cost-item-types");
  // Catalogue items in display order; null until the catalogue is in.
  const sortedCatalogue = useMemo(
    () => (Array.isArray(catalogue) ? [...catalogue].sort((a, b) => a.sort_order - b.sort_order) : null),
    [catalogue],
  );
  const allCostItemTypes = typeKeys.every(isCostItemType);
  const costChoices = useMemo(
    () =>
      costFieldChoices(
        typeKeys,
        sortedCatalogue ?? [],
        costFields,
        t("cost.tco"),
        (i) => fieldLabel({ key: i.key, label: i.label, translations: i.translations }),
      ),
    [typeKeys, sortedCatalogue, costFields, t, fieldLabel],
  );
  // Extra table columns come from one type's fields: none for the combined option.
  const allFields = useMemo(() => {
    const raw = schemas.length === 1 ? pickAllFields(schemas[0]) : [];
    return raw.map((f) => ({ ...f, label: fieldLabel(f) }));
  }, [schemas, fieldLabel]);
  const [extraColumns, setExtraColumns] = useState<string[]>([]);

  // Drop picked columns the current type no longer defines (card-type
  // switch) — mirrors the removed aggregateOptions pruning effect.
  useEffect(() => {
    setExtraColumns((prev) => {
      const next = prev.filter((key) => allFields.some((f) => f.key === key));
      return next.length === prev.length ? prev : next;
    });
  }, [allFields, extraColumns]);

  // Auto-select cost field when card type changes — only when the current one
  // is not on the type, so a restored field the type does carry is kept.
  // Declared before the restore below on purpose: effects run in declaration
  // order, so on mount this effect's pick (made from the starting type's
  // fields) is queued first and the restored type + field overwrite it.
  useEffect(() => {
    // A cost-item type's choices are incomplete until the catalogue is in: do not reset a restored item.
    if (catalogue === undefined && typeKeys.length > 0 && allCostItemTypes) return;
    if (costChoices.length > 0 && !costChoices.some((f) => f.key === costField)) {
      setCostField(costChoices[0].key);
    }
  }, [costChoices, catalogue]); // eslint-disable-line react-hooks/exhaustive-deps

  // A selection the user may not read (a saved combined option whose IT
  // Component is hidden, an Initiative they cannot see) falls back.
  useEffect(() => {
    if (ml || typeOptions.length === 0) return;
    if (!typeOptions.some((o) => o.key === cardTypeKey))
      setCardTypeKey(
        typeOptions.some((o) => o.key === "Application") ? "Application" : typeOptions[0].key,
      );
  }, [ml, typeOptions, cardTypeKey]);

  // Load saved report config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    if (cfg) {
      const restoredType =
        typeof cfg.cardTypeKey === "string" &&
        (cfg.cardTypeKey === COMBINED_KEY ||
          COST_REPORT_TYPE_KEYS.includes(cfg.cardTypeKey as never))
          ? cfg.cardTypeKey
          : undefined;
      if (restoredType) setCardTypeKey(restoredType);
      if (cfg.costField) setCostField(cfg.costField as string);
      if (cfg.groupBy !== undefined) setGroupBy(cfg.groupBy as string);
      if (cfg.view) setView(cfg.view as CostView);
      if (cfg.sortK) setSortK(cfg.sortK as string);
      if (cfg.sortD) setSortD(cfg.sortD as "asc" | "desc");
      if (typeof cfg.fiscalYearParam === "number")
        setFiscalYearParam(cfg.fiscalYearParam);
      if (Array.isArray(cfg.extraColumns))
        setExtraColumns(
          (cfg.extraColumns as unknown[]).filter(
            (v): v is string => typeof v === "string",
          ),
        );
      // Set for the restored type, so the scope is read as that type's from
      // the render the type lands on.
      if (Array.isArray(cfg.scopeIds)) {
        restoreScope(
          (cfg.scopeIds as unknown[]).filter(
            (v): v is string => typeof v === "string",
          ),
        );
      }
    }
  }, [saved.loadedConfig, restoreScope]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({
    cardTypeKey,
    costField,
    groupBy,
    view,
    sortK,
    sortD,
    scopeIds: scope.loading || scope.error ? scopeIds : effectiveScopeIds,
    extraColumns,
    fiscalYearParam,
  });

  // Auto-persist config to localStorage
  useEffect(() => {
    saved.persistConfig(getConfig());
  }, [cardTypeKey, costField, groupBy, view, sortK, sortD, scopeIds, effectiveScopeIds, scope.loading, scope.error, extraColumns, fiscalYearParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset all parameters to defaults
  const handleReset = useCallback(() => {
    saved.resetAll();
    setCardTypeKey("Application");
    setCostField("costTotalAnnual");
    setGroupBy("");
    setView("chart");
    setSortK("cost");
    setSortD("desc");
    clearScope();
    setExtraColumns([]);
    setFiscalYearParam(null);
  }, [saved, clearScope]);

  // The table's group-by: single selects with options and yes/no fields (a
  // multi-select cannot put a card in exactly one group). A yes/no field is
  // given Yes / No options, so its groups are named rather than "true".
  const groupableFields = useMemo<FieldDef[]>(() => {
    const yesNo = { yes: t("common:labels.yes"), no: t("common:labels.no") };
    return commonGroupableFields(schemas).map((f) =>
      resolveFacetField(
        {
          ...f,
          label: fieldLabel(f),
          options: f.options?.map((o) => ({ ...o, label: optLabel(o) })),
        },
        yesNo,
      ),
    );
  }, [schemas, fieldLabel, optLabel, t]);

  // What the Group by selector offers: `field:<key>` and `rel:<key>` values.
  const groupOptions = useMemo(
    () => [
      ...groupableFields.map((f) => ({ value: `field:${f.key}`, label: f.label })),
      ...relationGroupOptions(relationTypes, typeKeys, relLabel),
    ],
    [groupableFields, relationTypes, typeKeys, relLabel],
  );
  // A saved bare field key becomes `field:<key>`; one that is not offered is dropped.
  const effectiveGroupBy = useMemo(() => {
    const offered = (v: string) => groupOptions.some((o) => o.value === v);
    if (offered(groupBy)) return groupBy;
    return groupBy && offered(`field:${groupBy}`) ? `field:${groupBy}` : "";
  }, [groupBy, groupOptions]);
  useEffect(() => {
    if (!ml && effectiveGroupBy !== groupBy) setGroupBy(effectiveGroupBy);
  }, [ml, effectiveGroupBy, groupBy]);

  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (!canViewCostsGlobally) {
        // Nothing loaded: a later grant shows the spinner, not an empty report.
        setRawItems(null);
        setSankeyData(null);
        return;
      }
      if (view === "sankey") {
        const p = new URLSearchParams({
          type: typeParam(cardTypeKey),
          cost_field: costField,
        });
        if (effectiveGroupBy) p.set("group_by", effectiveGroupBy);
        if (fiscalYearParam != null) p.set("fiscal_year", String(fiscalYearParam));
        const r = await api.get<CostSankeyResponse>(
          `/reports/cost-sankey?${p}`,
          { signal },
        );
        if (!isCurrent()) return;
        setSankeyData(r);
        setItemLabels(r.item_labels ?? {});
        setRawItems(null);
        setFiscalYear((prev) => fiscalYearOf(r) ?? prev);
        adoptCurrentFiscalYear(r.current_fiscal_year);
      } else {
        const p = new URLSearchParams({
          type: typeParam(cardTypeKey),
          cost_field: costField,
        });
        if (effectiveGroupBy) p.set("group_by", effectiveGroupBy);
        if (fiscalYearParam != null) p.set("fiscal_year", String(fiscalYearParam));
        const r = await api.get<CostTreemapResponse>(
          `/reports/cost-treemap?${p}`,
          { signal },
        );
        if (!isCurrent()) return;
        setRawItems(r.items);
        setItemLabels(r.item_labels ?? {});
        setComponentsFor({ key: `${cardTypeKey}|${costField}`, list: r.components ?? [] });
        setSankeyData(null);
        setFiscalYear((prev) => fiscalYearOf(r) ?? prev);
        adoptCurrentFiscalYear(r.current_fiscal_year);
      }
    },
    [cardTypeKey, costField, effectiveGroupBy, view, canViewCostsGlobally, fiscalYearParam],
  );

  // Delta badge baseline: the current fiscal year's per-card costs, fetched
  // only when a past year is selected and the treemap is showing — nothing to
  // diff against when `fiscalYearParam` is null (the picked year already IS
  // the current year).
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (
        !canViewCostsGlobally ||
        view !== "chart" ||
        fiscalYearParam == null
      ) {
        setBaselineCosts(new Map());
        return;
      }
      const p = new URLSearchParams({
        type: typeParam(cardTypeKey),
        cost_field: costField,
      });
      const r = await api.get<CostTreemapResponse>(`/reports/cost-treemap?${p}`, {
        signal,
      });
      if (!isCurrent()) return;
      setBaselineCosts(new Map(r.items.map((it) => [it.id, it.cost])));
    },
    [cardTypeKey, costField, view, canViewCostsGlobally, fiscalYearParam],
  );

  // The earliest year the picker itself offers — a selected year at or below
  // it has no prior year to diff against, so the YoY fetch is skipped rather
  // than sent for a year outside the picker's own range.
  const minFiscalYearOption = useMemo(
    () =>
      Math.min(
        // "Current" (null) is not a requestable year: it is never the earliest.
        ...fiscalYearOptions.flatMap((o) => (o.value == null ? [] : [o.value])),
      ),
    [fiscalYearOptions],
  );

  // Table YoY%: the prior fiscal year's per-card costs, fetched only when a
  // past year is selected, the table is showing, and a prior year exists in
  // the picker's own range.
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (
        !canViewCostsGlobally ||
        view !== "table" ||
        fiscalYearParam == null ||
        fiscalYearParam <= minFiscalYearOption
      ) {
        setPriorYearCosts(new Map());
        return;
      }
      const p = new URLSearchParams({
        type: typeParam(cardTypeKey),
        cost_field: costField,
        fiscal_year: String(fiscalYearParam - 1),
      });
      const r = await api.get<CostTreemapResponse>(`/reports/cost-treemap?${p}`, {
        signal,
      });
      if (!isCurrent()) return;
      setPriorYearCosts(new Map(r.items.map((it) => [it.id, it.cost])));
    },
    [
      cardTypeKey,
      costField,
      view,
      canViewCostsGlobally,
      fiscalYearParam,
      minFiscalYearOption,
    ],
  );

  // Scoped here and nowhere else, so the metric cards, treemap, groups and
  // the table footer total can never disagree with each other.
  const items = useMemo(
    () => (rawItems ? applyScope(rawItems, scope.closure) : []),
    [rawItems, scope.closure],
  );
  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.cost, 0),
    [items],
  );

  // The page names a group: the server sends the raw value (an option key,
  // "true"/"false", a linked card's name, or "__other__").
  const groupLabel = useCallback(
    (raw: string | undefined) => {
      if (!raw || raw === OTHER_GROUP) return t("cost.unspecified");
      const key = effectiveGroupBy.startsWith("field:")
        ? effectiveGroupBy.slice(6)
        : null;
      const opt = groupableFields
        .find((f) => f.key === key)
        ?.options?.find((o) => o.key === raw);
      return opt?.label ?? raw;
    },
    [effectiveGroupBy, groupableFields, t],
  );

  // The Sankey view loads no treemap items: its scoped card nodes (with the group each hangs under)
  // stand in for them, so group order, fold and colours are read off the same numbers in every view.
  const sankeyCards = useMemo<CostItem[]>(() => {
    if (!sankeyData) return [];
    const groupOf = new Map<number, string>();
    for (const l of sankeyData.links) {
      const src = sankeyData.nodes[l.source];
      if (src?.type === "Group") groupOf.set(l.target, src.id.replace(/^group:/, ""));
    }
    return sankeyData.nodes.flatMap((n, i) =>
      n.type === "CostItem" || n.type === "Group" || (scope.closure && !scope.closure.has(n.id))
        ? []
        : [{ id: n.id, name: n.name, type: n.type, cost: n.cost ?? 0, group: groupOf.get(i) }],
    );
  }, [sankeyData, scope.closure]);
  const colorItems = rawItems ? items : sankeyCards;

  const groups = useMemo(() => {
    if (!effectiveGroupBy) return null;
    // Keyed by the raw value: two raw values may share a label.
    const map = new Map<
      string,
      { key: string; label: string; items: CostItem[]; cost: number }
    >();
    for (const item of colorItems) {
      const key = item.group ?? OTHER_GROUP;
      const g = map.get(key) || { key, label: groupLabel(key), items: [], cost: 0 };
      g.items.push(item);
      g.cost += item.cost;
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.cost - a.cost);
  }, [colorItems, effectiveGroupBy, groupLabel]);

  // The one colour assignment of the page: treemap, Sankey and table all read it. Groups take their
  // hue by scoped size, beyond the 8th they fold into Others, and a drill never changes it.
  const colorPlan = useMemo(() => {
    const cardColors = new Map<string, string>();
    if (!groups) {
      for (const it of colorItems) cardColors.set(it.id, cardColor(it.name, chartTheme.categorical));
      return { cardColors, groupHues: new Map<string, string>(), groups: [], foldedKeys: new Set<string>() };
    }
    const { groups: coloured, foldedKeys } = assignGroupColors(groups, {
      categorical: chartTheme.categorical,
      other: CHART_OTHER[chartTheme.mode],
      unspecified: COST_UNSPECIFIED[chartTheme.mode],
      unspecifiedKey: OTHER_GROUP,
    });
    for (const g of coloured) {
      const ranked = [...g.items].sort((a, b) => b.cost - a.cost);
      ranked.forEach((it, i) => cardColors.set(it.id, memberShade(g.hue, i, ranked.length)));
    }
    const groupHues = new Map(coloured.map((g) => [g.key, g.hue]));
    return { cardColors, groupHues, groups: coloured, foldedKeys };
  }, [groups, colorItems, chartTheme.categorical, chartTheme.mode]);
  const { foldedKeys } = colorPlan;
  const groupDisplayLabel = (key: string, label: string) =>
    key === OTHERS_KEY ? t("cost.othersCount", { count: foldedKeys.size }) : label;
  const typeLabelOf = useCallback(
    (key?: string) => {
      const tp = key ? types.find((x) => x.key === key) : undefined;
      return tp ? typeLabel(tp) : undefined;
    },
    [types, typeLabel],
  );

  // A cost item's label: the catalogue's (the report sends it, archived items
  // included), else the schema field's. Undefined when neither knows the key.
  const knownItemLabel = useCallback(
    (key: string) =>
      (itemLabels[key] ? fieldLabel({ key, ...itemLabels[key] }) : undefined) ??
      costFields.find((f) => f.key === key)?.label,
    [itemLabels, costFields, fieldLabel],
  );
  const trendLabelOf = useCallback(
    (key: string) => {
      const known = knownItemLabel(key);
      if (known) return known;
      const item = Array.isArray(catalogue) ? catalogue.find((c) => c.key === key) : undefined;
      return item ? fieldLabel({ key, label: item.label, translations: item.translations }) : key;
    },
    [knownItemLabel, catalogue, fieldLabel],
  );
  // A cost-item type stacks the catalogue's items (archived included) in sort order, so the trend
  // also renders in the Sankey view, where the treemap `components` are not loaded.
  const trendComponents = useMemo(
    () =>
      allCostItemTypes
        ? costField === "costTotalAnnual"
          ? (sortedCatalogue?.map((c) => c.key) ?? [])
          : [costField]
        : components,
    [sortedCatalogue, allCostItemTypes, costField, components],
  );
  const [drill, setDrill] = useState<Drill>({});
  // A drill names ids that exist only under the current selection.
  useEffect(() => {
    setDrill((d) => (d.group === undefined && d.cardId === undefined ? d : {}));
  }, [cardTypeKey, costField, effectiveGroupBy, fiscalYearParam, scopeIds]);
  // The table's item columns and a drilled card need the per-item breakdown; no costs.view, no request.
  const { breakdown } = useCostBreakdown({
    enabled:
      canViewCostsGlobally && (view === "table" || (view === "chart" && drill.cardId !== undefined)),
    typeParam: typeParam(cardTypeKey),
    fiscalYear: fiscalYearParam,
  });
  // A drilled card: one tile per cost item (catalogue order), the first 8 coloured, the rest merged.
  const cardItemTiles = useMemo<CostTreemapItem[] | null>(() => {
    if (drill.cardId === undefined || !breakdown) return null;
    const b = breakdown.get(drill.cardId);
    if (!b) return [];
    const has = (k: string) => (b.items[k] ?? 0) > 0;
    const keys = [
      ...trendComponents.filter(has),
      ...Object.keys(b.items).filter((k) => !trendComponents.includes(k) && k !== OTHER_GROUP && has(k)),
      ...(has(OTHER_GROUP) ? [OTHER_GROUP] : []),
    ];
    const tiles: CostTreemapItem[] = keys.slice(0, MAX_GROUP_HUES).map((k, i) => ({
      name: k === OTHER_GROUP ? t("cost.otherCostItem") : trendLabelOf(k),
      cost: b.items[k],
      index: i,
      color: chartTheme.categorical[i],
    }));
    const rest = keys.slice(MAX_GROUP_HUES);
    if (rest.length > 0)
      tiles.push({
        name: t("cost.otherItems"),
        cost: rest.reduce((sum, k) => sum + b.items[k], 0),
        index: MAX_GROUP_HUES,
        color: CHART_OTHER[chartTheme.mode],
      });
    return tiles;
  }, [drill.cardId, breakdown, trendComponents, trendLabelOf, t, chartTheme.categorical, chartTheme.mode]);
  const trendSelection = useMemo<TrendSelection | undefined>(() => {
    if (drill.cardId !== undefined) return { kind: "card", id: drill.cardId };
    if (drill.group === undefined) return undefined;
    return { kind: "group", keys: drill.group === OTHERS_KEY ? [...foldedKeys] : [drill.group] };
  }, [drill, foldedKeys]);
  const crumbs = useMemo(
    () =>
      crumbsOf(drill, {
        root: t("cost.breadcrumbRoot"),
        group: (k) => (k === OTHERS_KEY ? t("cost.others") : groupLabel(k)),
        card: (id) => colorItems.find((i) => i.id === id)?.name ?? id,
      }),
    [drill, t, groupLabel, colorItems],
  );
  const drillBar = (
    <CostDrillBar crumbs={crumbs} onSelect={setDrill} hint={t("cost.drillHint")} />
  );
  const trendChart =
    showForecast && trendComponents.length > 0 ? (
      <Box sx={{ mb: 3 }}>
        <CostTrendChart
          typeParam={typeParam(cardTypeKey)}
          costField={costField}
          components={trendComponents}
          labelOf={trendLabelOf}
          years={trendYears}
          currentFiscalYear={currentFiscalYear}
          groupBy={effectiveGroupBy}
          selection={trendSelection}
          scopeIds={scope.closure}
        />
      </Box>
    ) : null;
  // A cost-item node: the item's label, or "Other costs" for what the
  // components leave of a card's total.
  const itemLabel = useCallback(
    (key: string, fallback: string) =>
      key === OTHER_GROUP ? t("cost.otherCostItem") : (knownItemLabel(key) ?? fallback),
    [knownItemLabel, t],
  );

  // Scope and drill apply to the Sankey here: hide the cards outside them, then every cost-item and
  // group node left without a card below it; then the folded groups merge into one Others node.
  const drillActive = drill.group !== undefined || drill.cardId !== undefined;
  const sankeyView = useMemo(() => {
    if (!sankeyData) return null;
    const closure = scope.closure;
    const recompute = !!closure || drillActive;
    const drillIds = drillActive ? new Set(applyDrill(sankeyCards, drill, foldedKeys).map((c) => c.id)) : null;
    const isCard = (n: SankeyNode) => n.type !== "CostItem" && n.type !== "Group";
    const keep = sankeyData.nodes.map(
      (n) => !isCard(n) || ((!closure || closure.has(n.id)) && (!drillIds || drillIds.has(n.id))),
    );
    // Recomputed: an item -> group flow is the sum of the kept cards' own values for that item.
    const flowValue = (l: SankeyLink) => {
      if (!recompute || sankeyData.nodes[l.target]?.type !== "Group") return l.value;
      const item = sankeyData.nodes[l.source].id.replace(/^item:/, "");
      return sankeyData.links
        .filter((c) => c.source === l.target && keep[c.target])
        .reduce((n, c) => n + (sankeyData.nodes[c.target].costs?.[item] ?? 0), 0);
    };
    const values = sankeyData.links.map(flowValue);
    if (recompute) {
      // item -> group -> card: the first pass drops groups, the second items.
      for (let pass = 0; pass < 2; pass++)
        sankeyData.nodes.forEach((n, i) => {
          if (!isCard(n))
            keep[i] = sankeyData.links.some(
              (l, k) => l.source === i && keep[l.target] && values[k] > 0,
            );
        });
    }
    const rawGroup = (n: SankeyNode) => n.id.replace(/^group:/, "");
    const isFolded = (n: SankeyNode) => n.type === "Group" && foldedKeys.has(rawGroup(n));
    const index = new Map<number, number>();
    const nodes: SankeyNode[] = [];
    let othersAt = -1;
    sankeyData.nodes.forEach((n, i) => {
      if (!keep[i]) return;
      if (isFolded(n)) {
        if (othersAt < 0) {
          othersAt = nodes.length;
          nodes.push({
            id: `group:${OTHERS_KEY}`,
            name: t("cost.others"),
            type: "Group",
            color: colorPlan.groupHues.get(OTHERS_KEY),
          });
        }
        index.set(i, othersAt);
        return;
      }
      index.set(i, nodes.length);
      nodes.push(
        n.type === "Group"
          ? { ...n, name: groupLabel(rawGroup(n)), color: colorPlan.groupHues.get(rawGroup(n)) }
          : n.type === "CostItem"
            ? { ...n, name: itemLabel(n.id.replace(/^item:/, ""), n.name) }
            : { ...n, color: colorPlan.cardColors.get(n.id), typeLabel: typeLabelOf(n.type), typeIcon: types.find((tp) => tp.key === n.type)?.icon },
      );
    });
    // Both ends are remapped, so the flows into and out of Others add up per (source, target).
    const merged = new Map<string, SankeyLink>();
    sankeyData.links.forEach((l, k) => {
      if (!keep[l.source] || !keep[l.target] || (recompute && values[k] <= 0)) return;
      const source = index.get(l.source)!;
      const target = index.get(l.target)!;
      const key = `${source}>${target}`;
      const prev = merged.get(key);
      merged.set(key, { source, target, value: (prev?.value ?? 0) + values[k] });
    });
    return { ...sankeyData, nodes, links: [...merged.values()] };
  }, [sankeyData, sankeyCards, scope.closure, drill, drillActive, foldedKeys, colorPlan, groupLabel, itemLabel, typeLabelOf, t, types]);

  const printParams = useMemo(() => {
    const params: { label: string; value: string }[] = [];
    const tpLabel =
      typeOptions.find((o) => o.key === cardTypeKey)?.label || cardTypeKey;
    params.push({ label: t("common:labels.type"), value: tpLabel });
    // Always stated: every figure on the page is for this one fiscal year.
    if (fiscalYear) {
      params.push({
        label: t("cost.fiscalYear"),
        value: costFiscalYearName(fiscalYear.year, currentFiscalYear),
      });
    }
    if (costChoices.length > 1) {
      const cfLabel =
        costChoices.find((f) => f.key === costField)?.label || knownItemLabel(costField) || costField;
      params.push({ label: t("cost.costField"), value: cfLabel });
    }
    if (effectiveGroupBy) {
      const gLabel =
        groupOptions.find((o) => o.value === effectiveGroupBy)?.label ||
        effectiveGroupBy;
      params.push({ label: t("cost.groupBy"), value: gLabel });
    }
    if (view === "table")
      params.push({ label: t("common.view"), value: t("common.table") });
    if (effectiveScopeIds.length > 0) {
      params.push({
        label: t("common.scope"),
        value: t("cost.scopeCount", { count: effectiveScopeIds.length }),
      });
    }
    return params;
  }, [
    cardTypeKey,
    typeOptions,
    costField,
    costChoices,
    knownItemLabel,
    effectiveGroupBy,
    groupOptions,
    view,
    effectiveScopeIds,
    fiscalYear,
    currentFiscalYear,
    t,
  ]);

  // A tile hands back the datum it was built from. Right click drills (a card tile into the card, a
  // group frame into the group); a cost-item tile has neither id nor key and is inert.
  const handleTileDrill = useCallback(
    (p: EChartClickParams) => {
      const d = p.data as { id?: string; key?: string } | undefined;
      if (d?.id) {
        const raw = effectiveGroupBy ? items.find((i) => i.id === d.id)?.group : undefined;
        setDrill({ ...(raw !== undefined && { group: drillGroupKey(raw, foldedKeys) }), cardId: d.id });
      } else if (d?.key) setDrill({ group: d.key });
    },
    [items, effectiveGroupBy, foldedKeys],
  );
  // Sankey nodes are named by id: `group:<key>`, `item:<key>`, or a card's id. Items and edges are inert.
  const handleNodeDrill = useCallback(
    (p: EChartClickParams) => {
      const name = p.name;
      if (p.dataType === "edge" || !name || name.startsWith("item:")) return;
      if (name.startsWith("group:")) {
        setDrill({ group: drillGroupKey(name.slice("group:".length), foldedKeys) });
        return;
      }
      const raw = effectiveGroupBy ? sankeyCards.find((c) => c.id === name)?.group : undefined;
      setDrill({ ...(raw !== undefined && { group: drillGroupKey(raw, foldedKeys) }), cardId: name });
    },
    [sankeyCards, effectiveGroupBy, foldedKeys],
  );
  const openCard = useCallback((id: string) => {
    setDrawerContainer(document.fullscreenElement === fullscreenContainer ? fullscreenContainer : null);
    setSidePanelCardId(id);
  }, [fullscreenContainer]);
  const handleNodeOpen = useCallback((p: EChartClickParams) => {
    const name = p.name;
    if (p.dataType === "edge" || !name || name.startsWith("item:") || name.startsWith("group:")) return;
    openCard(name);
  }, [openCard]);
  // Left click opens the card in the side panel; a group frame does nothing.
  const handleTileOpen = useCallback((p: EChartClickParams) => {
    const d = p.data as { id?: string } | undefined;
    if (d?.id) openCard(d.id);
  }, [openCard]);

  if (!canViewCostsGlobally) {
    return (
      <ReportShell
        title={t("cost.title")}
        icon="payments"
        iconColor={RAG_COLORS.green}
        view={view}
        onViewChange={setView}
      >
        <Box
          sx={{
            py: 8,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1,
          }}
        >
          <MaterialSymbol icon="lock" size={32} color={STATUS_COLORS.neutral} />
          <Typography variant="h6" color="text.secondary">
            {t("cost.permissionDeniedTitle")}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ maxWidth: 480 }}
          >
            {t("cost.permissionDeniedBody")}
          </Typography>
        </Box>
      </ReportShell>
    );
  }

  if (scope.error) return <Box sx={{ textAlign: "center", py: 8 }}><Typography>{t("cost.scopeLoadError")}</Typography><Button onClick={scope.retry}>{t("common:actions.retry")}</Button><Button onClick={scope.clear}>{t("common:cardScope.clearAll")}</Button></Box>;

  if (ml || scope.loading || (rawItems === null && sankeyData === null))
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
        {scope.loading && <Button onClick={scope.clear}>{t("common:cardScope.clearAll")}</Button>}
      </Box>
    );

  // Every view reads the scoped cards; the metric strip does not follow the drill.
  const summaryCards = colorItems;
  const summaryTotal = summaryCards.reduce((sum, c) => sum + c.cost, 0);
  const topDriver = summaryCards.reduce<{ name: string; cost: number } | null>(
    (top, c) => (!top || c.cost > top.cost ? c : top),
    null,
  );
  const avgCost = summaryCards.length > 0 ? summaryTotal / summaryCards.length : 0;

  const treemapLeaf = (d: CostItem, i: number): CostTreemapItem => {
    const baseline = baselineCosts.get(d.id);
    const deltaPct =
      fiscalYearParam == null
        ? undefined
        : baseline && baseline > 0
          ? (d.cost - baseline) / baseline
          : null;
    return {
      id: d.id,
      name: d.name,
      cost: d.cost,
      index: i,
      deltaPct,
      color: colorPlan.cardColors.get(d.id) ?? cardColor(d.name, chartTheme.categorical),
      typeLabel: typeLabelOf(d.type),
      typeIcon: types.find((tp) => tp.key === d.type)?.icon,
      logo_updated_at: d.logo_updated_at,
    };
  };
  const cardDrilled = drill.cardId !== undefined;
  const groupDrilled = drill.group !== undefined && !cardDrilled;
  // Grouped: each group is a frame holding its cards; the folded groups share one Others frame.
  const treemapGroups: CostTreemapGroup[] | undefined =
    groups && !groupDrilled && !cardDrilled
      ? colorPlan.groups.map((g, gi) => ({
          key: g.key,
          name: groupDisplayLabel(g.key, g.label),
          cost: g.cost,
          index: gi,
          color: g.hue,
          items: [...g.items].sort((x, y) => y.cost - x.cost).map((d) => treemapLeaf(d, gi)),
        }))
      : undefined;
  const treemapItems =
    cardItemTiles ??
    [...(groupDrilled ? applyDrill(items, drill, foldedKeys) : items)]
      .sort((x, y) => y.cost - x.cost)
      .map(treemapLeaf);
  const treemapTotal = cardDrilled ? (breakdown?.get(drill.cardId!)?.total ?? 0) : total;
  const legend = (
    <CostLegend
      entries={colorPlan.groups.map((g) => ({
        key: g.key,
        label: groupDisplayLabel(g.key, g.label),
        color: g.hue,
      }))}
    />
  );

  // One column per catalogue cost item (archived included) and the TCO; before the catalogue is in,
  // the single column of the selected cost.
  const TCO_KEY = "costTotalAnnual";
  const tableCols =
    sortedCatalogue && allCostItemTypes
      ? [
          ...sortedCatalogue.map((c) => ({ key: c.key, label: trendLabelOf(c.key) })),
          { key: TCO_KEY, label: t("cost.tco") },
        ]
      : [{ key: costField, label: t("cost.cost") }];
  // A cell: from the breakdown when it knows the card; the selected cost falls back to the row's own
  // figure; anything else is unknown (undefined, printed as a dash).
  const cellValue = (d: CostItem, key: string): number | undefined => {
    const b = breakdown?.get(d.id);
    if (b) return key === TCO_KEY ? b.total : (b.items[key] ?? 0);
    return key === costField ? d.cost : undefined;
  };
  // "cost" is what a saved report called the selected cost's column.
  const activeSort = sortK === "cost" ? costField : sortK;
  const sort = (k: string) => {
    setSortD(activeSort === k && sortD === "asc" ? "desc" : "asc");
    setSortK(k);
  };
  const byColumn = (a: CostItem, b: CostItem) => {
    const d = sortD === "asc" ? 1 : -1;
    if (activeSort === "name") return a.name.localeCompare(b.name) * d;
    return ((cellValue(a, activeSort) ?? 0) - (cellValue(b, activeSort) ?? 0)) * d;
  };
  const tableItems = cardDrilled
    ? items.filter((i) => i.id === drill.cardId)
    : groupDrilled
      ? applyDrill(items, drill, foldedKeys)
      : items;
  const tableGroups =
    groups && !cardDrilled
      ? colorPlan.groups.filter((g) => !groupDrilled || g.key === drill.group)
      : null;
  const sorted = [...tableItems].sort(byColumn);
  const sumCol = (members: CostItem[], key: string) =>
    members.reduce((sum, m) => sum + (cellValue(m, key) ?? 0), 0);
  const shownTotal = tableItems.reduce((sum, i) => sum + i.cost, 0);
  const pctOfTotal = (v: number) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "—");
  const cardRow = (d: CostItem, indent: boolean) => {
    const tp = types.find((x) => x.key === d.type);
    return (
    <TableRow
      key={d.id}
      hover
      sx={{ cursor: "pointer" }}
      onClick={() => openCard(d.id)}
      onContextMenu={(e: React.MouseEvent) => {
        e.preventDefault();
        handleTileDrill({ data: { id: d.id } });
      }}
    >
      <TableCell sx={{ fontWeight: 500, ...(indent && { pl: 4 }) }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {tp && <CardLogoAvatar cardId={d.id} logoUpdatedAt={d.logo_updated_at} typeIcon={tp.icon} typeColor={tp.color} size={28} radius={1} />}
        <span data-testid="cost-row-name">{d.name}</span>
        {tp && <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1, display: "inline-flex", alignItems: "center", gap: 0.5, verticalAlign: "middle" }}>
          <MaterialSymbol icon={tp.icon} size={14} />
          {typeLabel(tp)}
        </Typography>}
        </Box>
      </TableCell>
      {tableCols.map((c) => {
        const v = cellValue(d, c.key);
        return (
          <TableCell key={c.key} align="right" sx={c.key === costField ? { fontWeight: 700 } : undefined}>
            {v === undefined ? EMPTY_VALUE : fmt.format(v)}
          </TableCell>
        );
      })}
      <TableCell align="right">
        {pctOfTotal(d.cost)}
      </TableCell>
      {fiscalYearParam != null && yoyCell(d)}
      {extraCell(d)}
    </TableRow>
    );
  };

  const yesNoLabels = {
    yes: t("common:labels.yes"),
    no: t("common:labels.no"),
  };
  const fieldMeta = (key: string): FieldMeta | undefined => {
    const f = allFields.find((fd) => fd.key === key);
    return f ? ({ ...f, typeKeys } as FieldMeta) : undefined;
  };
  const extraCell = (item: CostItem) =>
    extraColumns.map((key) => (
      <TableCell key={key} align="right">
        {formatFieldValue(
          (item.attributes as Record<string, unknown> | undefined)?.[key],
          fieldMeta(key),
          { optionLabel: optLabel, yes: yesNoLabels.yes, no: yesNoLabels.no },
        )}
      </TableCell>
    ));
  const yoyCell = (item: CostItem) => {
    const prior = priorYearCosts.get(item.id);
    const pct = prior && prior > 0 ? (item.cost - prior) / prior : null;
    return (
      <TableCell align="right">
        {pct == null ? EMPTY_VALUE : `${pct >= 0 ? "+" : ""}${(pct * 100).toFixed(1)}%`}
      </TableCell>
    );
  };

  return (
    <ReportShell<CostView>
      title={t("cost.title")}
      icon="payments"
      iconColor={RAG_COLORS.green}
      view={view}
      onViewChange={setView}
      chartViewLabel={t("cost.treemapChartView")}
      extraViews={[
        {
          value: "sankey",
          icon: "waterfall_chart",
          label: t("cost.sankeyChartView"),
        },
      ]}
      chartRef={chartRef}
      onSaveReport={captureAndSave}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      onReset={handleReset}
      printParams={printParams}
      toolbar={
        <>
          <ToggleButtonGroup
            size="small"
            aria-label={t("cost.cardType")}
            value={typeKeys}
            onChange={(_, next: string[]) => {
              // Never zero buttons on; both on is the combined key.
              if (next.length === 0) return;
              setCardTypeKey(next.length > 1 ? COMBINED_KEY : next[0]);
            }}
          >
            {typeOptions
              .filter((o) => o.key !== COMBINED_KEY)
              .map((o) => (
                <ToggleButton key={o.key} value={o.key}>
                  {o.label}
                </ToggleButton>
              ))}
          </ToggleButtonGroup>
            <CardScopeFilter
              types={typeKeys}
              value={effectiveScopeIds}
              onChange={setScopeIds}
              labelAll={t("cost.scopeAll")}
              labelCount={(count) => t("cost.scopeCount", { count })}
              dialogTitle={t("cost.scopeDialogTitle")}
              helperText={t("cost.scopeHelper")}
              tooltip={t("cost.scopeTooltip")}
              searchSource={costScopeSource}
            />
          {costChoices.length > 1 && (
            <TextField
              select
              size="small"
              label={t("cost.costField")}
              value={costField}
              onChange={(e) => {
                setCostField(e.target.value);
                // The table sorts by the chosen cost, largest first.
                setSortK(e.target.value);
                setSortD("desc");
              }}
              sx={{ minWidth: 160 }}
            >
              {costChoices.map((f) => (
                <MenuItem key={f.key} value={f.key}>
                  {f.label}
                </MenuItem>
              ))}
            </TextField>
          )}

          <TextField
            select
            size="small"
            label={t("cost.groupBy")}
            value={effectiveGroupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            disabled={groupOptions.length === 0}
            helperText={
              groupOptions.length === 0 ? t("cost.groupByUnavailable") : undefined
            }
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">{t("cost.groupByNone")}</MenuItem>
            {groupOptions.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>

          {view === "table" && allFields.length > 0 && (
            <TextField
              select
              size="small"
              label={t("cost.columns")}
              value={extraColumns}
              onChange={(e) => {
                const v = e.target.value;
                setExtraColumns(
                  typeof v === "string" ? v.split(",") : (v as string[]),
                );
              }}
              SelectProps={{
                multiple: true,
                renderValue: (selected) =>
                  (selected as string[]).length
                    ? String((selected as string[]).length)
                    : t("cost.columnsNone"),
              }}
              sx={{ minWidth: 150 }}
            >
              {allFields.map((f) => (
                <MenuItem key={f.key} value={f.key}>
                  <Checkbox checked={extraColumns.includes(f.key)} />
                  <ListItemText primary={f.label} />
                </MenuItem>
              ))}
            </TextField>
          )}
        </>
      }
    >
      {fiscalYear && (
        // Hidden in print, like the toolbar it used to sit in: the year is in the print parameters.
        <Box sx={{ "@media print": { display: "none" } }}>
          <FiscalYearTimeTravel
            years={trendYears}
            currentFy={currentFiscalYear}
            value={fiscalYearParam ?? currentFiscalYear}
            onChange={(fy) => setFiscalYearParam(fy === currentFiscalYear ? null : fy)}
            servedYear={fiscalYear.year}
          />
        </Box>
      )}

      {/* Summary strip */}
      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <MetricCard
          label={t("cost.totalCost")}
          value={fmt.format(summaryTotal)}
          icon="payments"
          iconColor={RAG_COLORS.green}
          color={RAG_COLORS.green}
        />
        <MetricCard
          label={t("cost.items")}
          value={summaryCards.length}
          icon="inventory_2"
        />
        <MetricCard
          label={t("cost.average")}
          value={fmt.format(avgCost)}
          icon="calculate"
        />
        {topDriver && (
          <MetricCard
            label={t("cost.topCostDriver")}
            value={topDriver.name}
            subtitle={`${fmt.format(topDriver.cost)} (${summaryTotal > 0 ? ((topDriver.cost / summaryTotal) * 100).toFixed(0) : 0}%)`}
            icon="trending_up"
            iconColor={EOL_WARNING_COLOR}
          />
        )}
      </Box>

      {trendChart}

      {view === "chart" ? (
        items.length === 0 ? (
          <Box sx={{ py: 8, textAlign: "center" }}>
            <Typography color="text.secondary">
              {t("cost.noCostData")}
            </Typography>
          </Box>
        ) : (
          <>
              <FullscreenPanel label={t("cost.fullscreen")} onContainerChange={setFullscreenContainer}>
                {(isFullscreen) => (
                  <>
                  {drillBar}
                  {cardDrilled && cardItemTiles === null ? (
                    <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>
                  ) : (
                  <CostTreemapPanel
                    items={treemapItems}
                    groups={treemapGroups}
                    total={treemapTotal}
                    fullscreen={isFullscreen}
                    chrome={chartTheme}
                    fmt={fmt}
                    onTileOpen={handleTileOpen}
                    onTileDrill={handleTileDrill}
                  />
                  )}
                  </>
                )}
              </FullscreenPanel>
            {legend}
          </>
        )
      ) : view === "sankey" ? (
        !sankeyView || sankeyView.nodes.length === 0 ? (
          <Box sx={{ py: 8, textAlign: "center" }}>
            <Typography color="text.secondary">
              {t("cost.noCostData")}
            </Typography>
          </Box>
        ) : (
          <>
            <FullscreenPanel label={t("cost.fullscreen")} onContainerChange={setFullscreenContainer}>
              {(isFullscreen) => (
                <>
                {drillBar}
                <CostSankeyPanel
                  nodes={sankeyView.nodes}
                  links={sankeyView.links}
                  fullscreen={isFullscreen}
                  chrome={chartTheme}
                  fmt={fmt}
                  onNodeOpen={handleNodeOpen}
                  onNodeDrill={handleNodeDrill}
                />
                </>
              )}
            </FullscreenPanel>
            {legend}
          </>
        )
      ) : (
        <FullscreenPanel label={t("cost.fullscreen")} onContainerChange={setFullscreenContainer}>
        {(isFullscreen) => <>
        {drillBar}
        <Paper variant="outlined" sx={{ overflow: "auto", ...(isFullscreen && { flex: 1, minHeight: 0 }) }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>
                  <TableSortLabel
                    active={activeSort === "name"}
                    direction={activeSort === "name" ? sortD : "asc"}
                    onClick={() => sort("name")}
                  >
                    {t("common:labels.name")}
                  </TableSortLabel>
                </TableCell>
                {tableCols.map((c) => (
                  <TableCell key={c.key} align="right">
                    <TableSortLabel
                      active={activeSort === c.key}
                      direction={activeSort === c.key ? sortD : "asc"}
                      onClick={() => sort(c.key)}
                    >
                      {c.label}
                    </TableSortLabel>
                  </TableCell>
                ))}
                <TableCell align="right">{t("cost.percentOfTotal")}</TableCell>
                {fiscalYearParam != null && (
                  <TableCell align="right">{t("cost.yoyPercent")}</TableCell>
                )}
                {extraColumns.map((key) => (
                  <TableCell key={key} align="right">
                    {allFields.find((f) => f.key === key)?.label ?? key}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {tableGroups
                ? tableGroups.map((g) => [
                    <TableRow
                      key={`grp-${g.key}`}
                      hover
                      sx={{ bgcolor: "action.hover", cursor: "pointer" }}
                      onContextMenu={(e: React.MouseEvent) => {
                        e.preventDefault();
                        setDrill({ group: g.key });
                      }}
                    >
                      <TableCell sx={{ fontWeight: 700, fontSize: "0.85rem" }}>
                        <Box
                          component="span"
                          data-testid={`cost-group-swatch-${g.key}`}
                          sx={{
                            display: "inline-block",
                            width: 12,
                            height: 12,
                            borderRadius: 0.5,
                            mr: 1,
                            verticalAlign: "middle",
                            bgcolor: g.hue,
                          }}
                        />
                        {groupDisplayLabel(g.key, g.label)}
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                          ({g.items.length})
                        </Typography>
                      </TableCell>
                      {tableCols.map((c) => (
                        <TableCell key={c.key} align="right" sx={{ fontWeight: 700 }}>
                          {fmt.format(sumCol(g.items, c.key))}
                        </TableCell>
                      ))}
                      <TableCell align="right" sx={{ fontWeight: 600, color: "text.secondary" }}>
                        {pctOfTotal(g.cost)}
                      </TableCell>
                      {fiscalYearParam != null && <TableCell align="right" sx={{ fontWeight: 700 }} />}
                      {extraColumns.map((key) => (
                        <TableCell key={key} align="right" sx={{ fontWeight: 700 }}>
                          {fieldMeta(key)?.type === "cost"
                            ? fmt.format(
                                g.items.reduce(
                                  (sum, it) =>
                                    sum +
                                    costValue(
                                      (it.attributes as Record<string, unknown> | undefined)?.[key],
                                    ),
                                  0,
                                ),
                              )
                            : null}
                        </TableCell>
                      ))}
                    </TableRow>,
                    ...[...g.items].sort(byColumn).map((d) => cardRow(d, true)),
                  ])
                : sorted.map((d) => cardRow(d, false))}
              <TableRow sx={{ bgcolor: "action.selected" }}>
                <TableCell sx={{ fontWeight: 700 }}>{t("cost.total")}</TableCell>
                {tableCols.map((c) => (
                  <TableCell key={c.key} align="right" sx={{ fontWeight: 700 }}>
                    {fmt.format(sumCol(tableItems, c.key))}
                  </TableCell>
                ))}
                <TableCell align="right" sx={{ fontWeight: 700 }}>
                  {drill.group === undefined && !cardDrilled ? "100%" : pctOfTotal(shownTotal)}
                </TableCell>
                {fiscalYearParam != null && <TableCell align="right" sx={{ fontWeight: 700 }} />}
                {extraColumns.map((key) => (
                  <TableCell key={key} align="right" />
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </Paper>
        </>}
        </FullscreenPanel>
      )}
      <CardDetailSidePanel
        cardId={sidePanelCardId}
        open={!!sidePanelCardId}
        onClose={() => setSidePanelCardId(null)}
        container={drawerContainer}
      />
      <SaveReportDialog
        open={saved.saveDialogOpen}
        onClose={() => saved.setSaveDialogOpen(false)}
        reportType="cost"
        config={getConfig()}
        thumbnail={thumbnail}
      />
    </ReportShell>
  );
}
