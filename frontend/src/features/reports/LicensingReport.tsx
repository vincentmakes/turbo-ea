import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import CardPicker, { type CardOption } from "@/components/CardPicker";
import CardScopeFilter from "@/components/CardScopeFilter";
import FiscalYearTimeTravel from "@/components/FiscalYearTimeTravel";
import PairHistory from "@/components/licensing/PairHistory";
import {
  metricName,
  pairHistoryRows,
  pairHues,
  pairName,
} from "@/components/licensing/licensePairs";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useAuthContext } from "@/hooks/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { useLicenseCatalogue } from "@/hooks/useLicenseCatalogue";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { applyScope, useCardScope } from "@/hooks/useCardScope";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useReadableCardTypes } from "@/hooks/useReadableCardTypes";
import {
  useFieldLabel,
  useOptionLabel,
  useRelationLabel,
  useTypeLabel,
} from "@/hooks/useResolveLabel";
import { formatFieldValue, type FieldMeta } from "@/lib/cardDisplayFields";
import { resolveFacetField } from "@/lib/fieldFacets";
import { costFiscalYearName, costFiscalYearOptions } from "@/lib/fiscalYear";
import { LICENSE_TYPES, isLicenseType, pairKey, parsePairKey, statusColor } from "@/lib/licenses";
import { CHART_OTHER, STATUS_COLORS } from "@/theme/tokens";
import type {
  CardLicensesResponse,
  FieldDef,
  LicenseReportResponse,
  LicenseStatus,
} from "@/types";
import CostDrillBar from "./CostDrillBar";
import { applyDrill, crumbsOf, type Drill } from "./costDrill";
import {
  COMBINED_KEY,
  commonGroupableFields,
  isBuiltInFieldType,
  relationGroupOptions,
  typeKeysOf,
  typeParam,
} from "./costReportOptions";
import LicensingCardRow from "./LicensingCardRow";
import LicensingImportDialog from "./LicensingImportDialog";
import LicensingTable, { type LicensingTableRow } from "./LicensingTable";
import MetricCard from "./MetricCard";
import ReportShell, { type PrintParam } from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";

export type LicensingView = "chart" | "table";

const OTHER_GROUP = "__other__";
const NO_FOLDED: Set<string> = new Set();
const PICKABLE_TYPES = ["Application", "ITComponent", "Platform"];
const TILE_DIMMED = 0.4;
// The route's two exact 400 details about the year (`reports.py`); `ApiError.message` is the plain detail.
const YEAR_REFUSAL = /^(fiscal_year_out_of_range|forecast_not_selectable)$/;

/** A pair of the list that is open: its card and its `metric:type` key. */
interface Pick {
  cardId: string;
  key: string;
}

export default function LicensingReport() {
  const { t, i18n } = useTranslation(["reports", "common", "cards"]);
  const locale = i18n.language;
  const { types, relationTypes, loading: ml } = useMetamodel();
  const readableTypes = useReadableCardTypes("module");
  const typeLabel = useTypeLabel();
  const relLabel = useRelationLabel();
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();
  const chrome = useEChartsTheme();
  const { metrics: catalogue, loading: catalogueLoading, failed: catalogueFailed } =
    useLicenseCatalogue();
  const catalogueReady = !catalogueLoading && !catalogueFailed;
  const saved = useSavedReport("licensing");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() =>
    saved.setSaveDialogOpen(true),
  );

  // A type key, or COMBINED_KEY for Applications and IT Components together (the cost report's).
  const [cardTypeKey, setCardTypeKey] = useState("Application");
  const typeKeys = useMemo(() => typeKeysOf(cardTypeKey), [cardTypeKey]);
  const combined = typeKeys.length > 1;
  const [metric, setMetric] = useState(""); // "" = all metrics
  const [licenseType, setLicenseType] = useState(""); // a `metric:type` key, "" = all
  const [groupBy, setGroupBy] = useState("");
  const [view, setView] = useState<LicensingView>("chart");
  // null = the current year (the param is omitted); the Forecast year is never offered.
  const [fiscalYearParam, setFiscalYearParam] = useState<number | null>(null);
  const [picked, setPicked] = useState<CardOption | null>(null);
  const [extraColumns, setExtraColumns] = useState<string[]>([]);
  const [sortK, setSortK] = useState("name");
  const [sortD, setSortD] = useState<"asc" | "desc">("asc");
  // A card id restored from a saved report, resolved to a CardOption once.
  const [restorePickId, setRestorePickId] = useState<string | null>(null);
  // True while the year in use came from a restored config rather than from the picker.
  const restoredYear = useRef(false);
  const [drill, setDrill] = useState<Drill>({});
  const [sidePanelCardId, setSidePanelCardId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<LicenseStatus | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [pick, setPick] = useState<Pick | null>(null);

  const cardTypeOptions = useMemo(() => {
    const byKey = new Map(readableTypes.map((tp) => [tp.key, tp]));
    return LICENSE_TYPES.flatMap((k) => {
      const tp = byKey.get(k);
      return tp ? [{ key: k, label: typeLabel(tp) }] : [];
    });
  }, [readableTypes, typeLabel]);
  // A type the user may not read falls back to one they may.
  useEffect(() => {
    if (ml || cardTypeOptions.length === 0) return;
    const keys = typeKeysOf(cardTypeKey);
    if (!keys.every((k) => cardTypeOptions.some((o) => o.key === k)))
      setCardTypeKey(cardTypeOptions[0].key);
  }, [ml, cardTypeOptions, cardTypeKey]);

  // A scope belongs to one type, so the combined selection has none.
  const scope = useCardScope({ typeKey: combined ? null : cardTypeKey, enabled: true });
  const { setScopeIds, effectiveScopeIds, scopeIds } = scope;

  // Group by: single selects and yes/no fields, plus relations the card sits on the "one" end of.
  const schemas = useMemo(() => {
    const defs = typeKeys.map((k) => types.find((tp) => tp.key === k));
    return defs.every(Boolean) ? defs.map((d) => d!.fields_schema) : [];
  }, [types, typeKeys]);
  // Extra table columns: the built-in-typed fields of the card type (object-typed ones cannot show in a cell).
  const allFields = useMemo(
    () =>
      schemas
        .flatMap((sc) => sc)
        .flatMap((sec) => sec.fields)
        .filter((f) => isBuiltInFieldType(f.type))
        .map((f) => ({ ...f, label: fieldLabel(f) })),
    [schemas, fieldLabel],
  );
  // Picked columns the type no longer defines (card-type switch) are dropped.
  useEffect(() => {
    setExtraColumns((prev) => {
      const next = prev.filter((key) => allFields.some((f) => f.key === key));
      return next.length === prev.length ? prev : next;
    });
  }, [allFields]);
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
  const groupOptions = useMemo(
    () => [
      ...groupableFields.map((f) => ({ value: `field:${f.key}`, label: f.label })),
      ...relationGroupOptions(relationTypes, typeKeys, relLabel),
    ],
    [groupableFields, relationTypes, typeKeys, relLabel],
  );
  const effectiveGroupBy = groupOptions.some((o) => o.value === groupBy) ? groupBy : "";
  const groupLabel = useCallback(
    (raw: string | undefined) => {
      if (!raw || raw === OTHER_GROUP) return t("cost.unspecified");
      const key = effectiveGroupBy.startsWith("field:") ? effectiveGroupBy.slice(6) : null;
      const opt = groupableFields.find((f) => f.key === key)?.options?.find((o) => o.key === raw);
      return opt?.label ?? raw;
    },
    [effectiveGroupBy, groupableFields, t],
  );

  // The server refuses a metric or pair it does not know (400): only what the catalogue has is sent.
  const knownMetric = catalogue.some((m) => m.key === metric);
  // A pair of another metric than the selected one is refused by the server (400) too.
  const knownType =
    catalogue.some((m) => m.types.some((x) => pairKey(m.key, x.key) === licenseType)) &&
    (!knownMetric || licenseType.startsWith(`${metric}:`));
  const cardIdParam = picked?.id ?? null;
  const path = useMemo(() => {
    const p = new URLSearchParams({ card_types: typeParam(cardTypeKey) });
    if (knownMetric) p.set("metric", metric);
    if (knownType) p.set("license_type", licenseType);
    if (fiscalYearParam != null) p.set("fiscal_year", String(fiscalYearParam));
    if (effectiveGroupBy && !cardIdParam) p.set("group_by", effectiveGroupBy);
    if (cardIdParam) p.set("card_id", cardIdParam);
    return `/reports/licensing?${p.toString()}`;
  }, [cardTypeKey, metric, knownMetric, licenseType, knownType, fiscalYearParam, effectiveGroupBy, cardIdParam]);
  const { data, loading, error, refetch } = useApiQuery<LicenseReportResponse>(
    // Not before the catalogue can say what a metric or a type is.
    catalogueReady ? path : null,
  );
  const { user } = useAuthContext();
  const canImport = usePermissions(user).can("licenses.edit");
  const [importOpen, setImportOpen] = useState(false);
  // ── the selects: what the catalogue offers, an archived entry only with data in the year ──
  const archivedSuffix = ` (${t("cards:licensing.archived")})`;
  const metricOptions = useMemo(
    () => catalogue.filter((m) => !m.archived || data?.metrics_in_year.includes(m.key)),
    [catalogue, data],
  );
  const effectiveMetric = metricOptions.some((m) => m.key === metric) ? metric : "";
  const licenseTypeOptions = useMemo(
    () =>
      metricOptions
        .filter((m) => !effectiveMetric || m.key === effectiveMetric)
        .flatMap((m) =>
          m.types
            .filter((x) => !x.archived || data?.types_in_year.includes(pairKey(m.key, x.key)))
            .map((x) => ({
              value: pairKey(m.key, x.key),
              label: pairName(catalogue, m.key, x.key, locale, archivedSuffix),
            })),
        ),
    [metricOptions, effectiveMetric, data, catalogue, locale, archivedSuffix],
  );
  const effectiveLicenseType = licenseTypeOptions.some((o) => o.value === licenseType)
    ? licenseType
    : "";

  const aggregate = data?.aggregate ?? null;

  // A saved metric or license type the catalogue retired, or an archived one the year has no
  // data for, falls back to all (the server refuses an unknown one, so this cannot wait for data).
  useEffect(() => {
    if (!catalogueReady) return;
    if (metric && (!knownMetric || (data && !effectiveMetric))) setMetric("");
    if (licenseType && (!knownType || (data && !effectiveLicenseType))) setLicenseType("");
  }, [catalogueReady, data, metric, knownMetric, effectiveMetric, licenseType, knownType, effectiveLicenseType]);

  // Ids named by a drill exist only under the current selection.
  useEffect(() => {
    setDrill((d) => (d.group === undefined && d.cardId === undefined ? d : {}));
  }, [cardTypeKey, effectiveMetric, effectiveLicenseType, effectiveGroupBy, fiscalYearParam, picked?.id]);

  const currentFiscalYear = data?.current_fiscal_year ?? new Date().getFullYear();
  const yearOptions = useMemo(
    () => costFiscalYearOptions(currentFiscalYear).filter((o) => o.value !== currentFiscalYear + 1),
    [currentFiscalYear],
  );

  // ── rows: the server narrows them (and their status) to the selection ──────────────────────
  const viewRows = useMemo<LicensingTableRow[]>(
    () =>
      (data?.rows ?? []).map((raw) => ({
        id: raw.id,
        name: raw.name,
        type: raw.type,
        group: effectiveGroupBy && !aggregate ? (raw.group ?? OTHER_GROUP) : undefined,
        // A Platform's rows carry none: compliant.
        status: raw.status ?? "compliant",
        raw,
      })),
    [data, effectiveGroupBy, aggregate],
  );
  // A Platform (or one picked card) is not narrowed by the scope.
  const closure = cardIdParam ? null : scope.closure;
  const scopedRows = useMemo(() => applyScope(viewRows, closure), [viewRows, closure]);

  const counts = useMemo(() => {
    const c: Record<LicenseStatus, number> = { compliant: 0, approaching: 0, over: 0, no_actual_data: 0 };
    for (const r of scopedRows) c[r.status] += 1;
    return c;
  }, [scopedRows]);
  const activeStatus = aggregate ? null : statusFilter;
  const drilledRows = useMemo(
    () =>
      applyDrill(
        activeStatus ? scopedRows.filter((r) => r.status === activeStatus) : scopedRows,
        drill,
        NO_FOLDED,
      ),
    [scopedRows, activeStatus, drill],
  );

  const groups = useMemo(() => {
    if (!effectiveGroupBy || aggregate || drill.cardId !== undefined) return undefined;
    const keys = [...new Set(drilledRows.map((r) => r.group ?? OTHER_GROUP))];
    return keys
      .map((key) => ({ key, label: groupLabel(key) }))
      .sort((a, b) =>
        a.key === OTHER_GROUP ? 1 : b.key === OTHER_GROUP ? -1 : a.label.localeCompare(b.label),
      );
  }, [effectiveGroupBy, aggregate, drill.cardId, drilledRows, groupLabel]);

  const drillToCard = useCallback(
    (id: string) => {
      const row = viewRows.find((r) => r.id === id);
      setDrill({ ...(row?.group !== undefined && { group: row.group }), cardId: id });
    },
    [viewRows],
  );
  const crumbs = useMemo(
    () =>
      crumbsOf(drill, {
        root: t("cost.breadcrumbRoot"),
        group: groupLabel,
        card: (id) => viewRows.find((r) => r.id === id)?.name ?? id,
      }),
    [drill, t, groupLabel, viewRows],
  );

  // ── the list: expanded rows and the one pair whose history shows below ────────────────────
  const toggleRow = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
    setPick((cur) => (cur?.cardId === id ? null : cur));
  }, []);
  const pickPair = useCallback(
    (cardId: string, key: string) =>
      setPick((cur) => (cur?.cardId === cardId && cur.key === key ? null : { cardId, key })),
    [],
  );
  // A pair is only chosen while its card's row is open and still lists it.
  const activePick =
    pick &&
    expanded.has(pick.cardId) &&
    drilledRows.some(
      (r) =>
        r.id === pick.cardId &&
        r.raw.by_metric.some((m) => m.types.some((x) => pairKey(m.metric, x.key) === pick.key)),
    )
      ? pick
      : null;
  const history = useApiQuery<CardLicensesResponse>(
    activePick ? `/cards/${activePick.cardId}/licenses` : null,
    { keepPreviousData: false },
  );
  const hues = useMemo(
    () => pairHues(catalogue, chrome.categorical, CHART_OTHER[chrome.mode]),
    [catalogue, chrome.categorical, chrome.mode],
  );
  const renderRow = (r: LicensingTableRow) => (
    <LicensingCardRow
      key={r.id}
      row={r.raw}
      expanded={expanded.has(r.id)}
      onToggle={toggleRow}
      selectedPairKey={activePick?.cardId === r.id ? activePick.key : null}
      onPick={pickPair}
      onOpen={setSidePanelCardId}
      onDrill={drillToCard}
    />
  );

  // ── Table: the same rows, a column group per pair present in the scope ────────────────────
  const tablePairs = useMemo(() => {
    const present = new Set(
      scopedRows.flatMap((r) => r.raw.by_metric.flatMap((m) => m.types.map((x) => pairKey(m.metric, x.key)))),
    );
    const bySort = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order;
    const known = [...catalogue].sort(bySort).flatMap((m) =>
      [...m.types].sort(bySort).map((x) => ({ key: pairKey(m.key, x.key), metric: m.key, type: x.key })),
    );
    const unknown = [...present]
      .filter((k) => !known.some((x) => x.key === k))
      .sort()
      .map((k) => {
        const [metric, type] = parsePairKey(k);
        return { key: k, metric, type };
      });
    return [...known, ...unknown]
      .filter((x) => present.has(x.key))
      .map((x) => ({
        key: x.key,
        metric: x.metric,
        label: pairName(catalogue, x.metric, x.type, locale, archivedSuffix),
      }));
  }, [scopedRows, catalogue, locale, archivedSuffix]);
  const tableMetrics = useMemo(
    () =>
      [...new Set(tablePairs.map((p) => p.metric))].map((key) => ({
        key,
        label: metricName(catalogue, key, locale, archivedSuffix),
      })),
    [tablePairs, catalogue, locale, archivedSuffix],
  );
  const tableRows = useMemo(
    () => (groups ? drilledRows.map((r) => ({ ...r, group: r.group ?? OTHER_GROUP })) : drilledRows),
    [groups, drilledRows],
  );
  const yesNo = { yes: t("common:labels.yes"), no: t("common:labels.no") };
  const extraValue = (row: LicensingTableRow, key: string) => {
    const f = allFields.find((fd) => fd.key === key);
    return formatFieldValue(
      row.raw.attributes?.[key],
      f ? ({ ...f, typeKeys } as FieldMeta) : undefined,
      { optionLabel: optLabel, yes: yesNo.yes, no: yesNo.no },
    );
  };
  const onSort = (k: string) => {
    setSortD(sortK === k && sortD === "asc" ? "desc" : "asc");
    setSortK(k);
  };

  const printParams = useMemo(() => {
    const params: PrintParam[] = [
      {
        label: t("licensing.cardType"),
        value:
          typeKeys.map((k) => cardTypeOptions.find((o) => o.key === k)?.label ?? k).join(", "),
      },
      {
        label: t("licensing.metric"),
        value: effectiveMetric
          ? metricName(catalogue, effectiveMetric, locale, archivedSuffix)
          : t("licensing.allMetrics"),
      },
    ];
    if (effectiveLicenseType)
      params.push({
        label: t("licensing.licenseType"),
        value: licenseTypeOptions.find((o) => o.value === effectiveLicenseType)?.label ?? effectiveLicenseType,
      });
    if (data)
      params.push({
        label: t("cost.fiscalYear"),
        value: costFiscalYearName(data.fiscal_year, currentFiscalYear),
      });
    if (effectiveGroupBy)
      params.push({
        label: t("cost.groupBy"),
        value: groupOptions.find((o) => o.value === effectiveGroupBy)?.label ?? effectiveGroupBy,
      });
    if (aggregate) params.push({ label: t("licensing.pickCard"), value: aggregate.name });
    if (view === "table") params.push({ label: t("common.view"), value: t("common.table") });
    if (effectiveScopeIds.length > 0)
      params.push({
        label: t("common.scope"),
        value: t("cost.scopeCount", { count: effectiveScopeIds.length }),
      });
    return params;
  }, [t, typeKeys, cardTypeOptions, effectiveMetric, catalogue, locale, archivedSuffix, effectiveLicenseType, licenseTypeOptions, data, currentFiscalYear, effectiveGroupBy, groupOptions, aggregate, view, effectiveScopeIds]);

  // ── saved reports: restore, persist, reset ────────────────────────────────────────────────
  // A restored year the report no longer offers (the Forecast year, one older than the window)
  // or the server refuses falls back to the current year.
  useEffect(() => {
    if (data && fiscalYearParam != null && !yearOptions.some((o) => o.value === fiscalYearParam))
      setFiscalYearParam(null);
  }, [data, fiscalYearParam, yearOptions]);
  useEffect(() => {
    // Only a refusal about the year: another 400 (a bad selection) says nothing against it.
    if (error && restoredYear.current && fiscalYearParam != null && YEAR_REFUSAL.test(error.message)) {
      restoredYear.current = false;
      setFiscalYearParam(null);
    }
  }, [error, fiscalYearParam]);
  // The pick is saved as an id and fetched again: the card may be gone or hidden by now.
  useAbortableEffect(async ({ signal, isCurrent }) => {
    if (!restorePickId) return;
    try {
      const c = await api.get<CardOption>(`/cards/${restorePickId}`, { signal });
      if (isCurrent() && PICKABLE_TYPES.includes(c.type))
        setPicked({ id: c.id, name: c.name, type: c.type });
    } catch {
      /* deleted, hidden or aborted: no pick */
    }
    if (isCurrent()) setRestorePickId(null);
  }, [restorePickId]);

  useEffect(() => {
    const cfg = saved.consumeConfig();
    if (!cfg) return;
    const restoredType =
      typeof cfg.cardTypeKey === "string" &&
      (cfg.cardTypeKey === COMBINED_KEY || isLicenseType(cfg.cardTypeKey))
        ? cfg.cardTypeKey
        : undefined;
    if (restoredType) setCardTypeKey(restoredType);
    if (typeof cfg.metric === "string") setMetric(cfg.metric);
    if (typeof cfg.licenseType === "string" && (cfg.licenseType === "" || cfg.licenseType.includes(":")))
      setLicenseType(cfg.licenseType);
    if (typeof cfg.groupBy === "string") setGroupBy(cfg.groupBy);
    if (cfg.view === "chart" || cfg.view === "table") setView(cfg.view);
    if (typeof cfg.sortK === "string") setSortK(cfg.sortK);
    if (cfg.sortD === "asc" || cfg.sortD === "desc") setSortD(cfg.sortD);
    if (typeof cfg.fiscalYearParam === "number") {
      restoredYear.current = true;
      setFiscalYearParam(cfg.fiscalYearParam);
    }
    if (Array.isArray(cfg.extraColumns))
      setExtraColumns((cfg.extraColumns as unknown[]).filter((v): v is string => typeof v === "string"));
    if (Array.isArray(cfg.scopeIds) && restoredType !== COMBINED_KEY)
      setScopeIds(
        (cfg.scopeIds as unknown[]).filter((v): v is string => typeof v === "string"),
        restoredType,
      );
    if (typeof cfg.pickedCardId === "string") setRestorePickId(cfg.pickedCardId);
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({
    cardTypeKey,
    metric,
    licenseType,
    groupBy,
    view,
    scopeIds,
    fiscalYearParam,
    pickedCardId: picked?.id ?? null,
    extraColumns,
    sortK,
    sortD,
  });
  useEffect(() => {
    saved.persistConfig(getConfig());
  }, [cardTypeKey, metric, licenseType, groupBy, view, scopeIds, fiscalYearParam, picked, extraColumns, sortK, sortD]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReset = useCallback(() => {
    saved.resetAll();
    setExtraColumns([]);
    setSortK("name");
    setSortD("asc");
    restoredYear.current = false;
    setCardTypeKey("Application");
    setMetric("");
    setLicenseType("");
    setGroupBy("");
    setView("chart");
    setFiscalYearParam(null);
    setPicked(null);
    setScopeIds([]);
    setStatusFilter(null);
    setExpanded(new Set());
    setPick(null);
  }, [setScopeIds, saved]);

  const statusCards: { status: LicenseStatus; label: string; icon: string }[] = [
    { status: "compliant", label: t("licensing.statusCompliant"), icon: "check_circle" },
    { status: "approaching", label: t("licensing.statusApproaching"), icon: "warning" },
    { status: "over", label: t("licensing.statusOver"), icon: "error" },
    { status: "no_actual_data", label: t("licensing.statusNoActualData"), icon: "help" },
  ];
  const toggleStatus = (s: LicenseStatus) => setStatusFilter((cur) => (cur === s ? null : s));

  const showDrillBar = view === "table" || crumbs.length > 1;
  const drillBar = showDrillBar && (
    <CostDrillBar crumbs={crumbs} onSelect={setDrill} hint={t("licensing.drillHint")} />
  );
  const noRows = (
    <Box sx={{ py: 8, textAlign: "center" }}>
      <Typography color="text.secondary">
        {activeStatus ? t("licensing.noRowsForStatus") : t("licensing.noData")}
      </Typography>
    </Box>
  );
  const pickedHistory = activePick && (
    <Box sx={{ mt: 2 }}>
      {history.error ? (
        <Alert severity="error">{t("cards:licensing.loadFailed")}</Alert>
      ) : history.data ? (
        <PairHistory
          pair={{
            label: pairName(catalogue, ...parsePairKey(activePick.key), locale, archivedSuffix),
            color: hues.get(activePick.key) ?? chrome.categorical[0],
          }}
          years={pairHistoryRows(history.data.years, ...parsePairKey(activePick.key))}
        />
      ) : (
        <CircularProgress size={20} />
      )}
    </Box>
  );

  return (
    <ReportShell<LicensingView>
      title={t("licensing.title")}
      icon="badge"
      iconColor={STATUS_COLORS.info}
      view={view}
      onViewChange={setView}
      chartViewLabel={t("licensing.viewUtilisation")}
      chartRef={chartRef}
      onSaveReport={captureAndSave}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      printParams={printParams}
      actions={
        canImport ? (
          <Button
            size="small"
            variant="outlined"
            startIcon={<MaterialSymbol icon="upload_file" size={18} />}
            onClick={() => setImportOpen(true)}
          >
            {t("licensing.import.button")}
          </Button>
        ) : undefined
      }
      onReset={handleReset}
      toolbar={
        <>
          <ToggleButtonGroup
            size="small"
            aria-label={t("licensing.cardType")}
            value={typeKeys}
            onChange={(_, next: string[]) => {
              // Never zero buttons on; both on is the combined key.
              if (next.length === 0) return;
              setCardTypeKey(next.length > 1 ? COMBINED_KEY : next[0]);
            }}
          >
            {cardTypeOptions.map((o) => (
              <ToggleButton key={o.key} value={o.key}>
                {o.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <TextField
            select
            size="small"
            label={t("licensing.metric")}
            value={effectiveMetric}
            slotProps={{ select: { displayEmpty: true } }}
            onChange={(e) => {
              setMetric(e.target.value);
              setLicenseType(""); // the types follow the metric
            }}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">{t("licensing.allMetrics")}</MenuItem>
            {metricOptions.map((m) => (
              <MenuItem key={m.key} value={m.key}>
                {metricName(catalogue, m.key, locale, archivedSuffix)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("licensing.licenseType")}
            value={effectiveLicenseType}
            slotProps={{ select: { displayEmpty: true } }}
            onChange={(e) => setLicenseType(e.target.value)}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">{t("licensing.allLicenseTypes")}</MenuItem>
            {licenseTypeOptions.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("cost.groupBy")}
            value={effectiveGroupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            disabled={groupOptions.length === 0}
            helperText={groupOptions.length === 0 ? t("cost.groupByUnavailable") : undefined}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">{t("cost.groupByNone")}</MenuItem>
            {groupOptions.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          {!combined && (
            <CardScopeFilter
              types={cardTypeKey}
              value={effectiveScopeIds.length ? effectiveScopeIds : scopeIds}
              onChange={setScopeIds}
              labelAll={t("cost.scopeAll")}
              labelCount={(count) => t("cost.scopeCount", { count })}
              dialogTitle={t("cost.scopeDialogTitle")}
              helperText={t("cost.scopeHelper")}
              tooltip={t("cost.scopeTooltip")}
            />
          )}
          {view === "table" && allFields.length > 0 && (
            <TextField
              select
              size="small"
              label={t("cost.columns")}
              value={extraColumns}
              onChange={(e) => {
                const v = e.target.value as unknown;
                setExtraColumns(typeof v === "string" ? v.split(",") : (v as string[]));
              }}
              slotProps={{
                select: {
                  multiple: true,
                  renderValue: (selected) =>
                    (selected as string[]).length ? String((selected as string[]).length) : t("cost.columnsNone"),
                },
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
          <CardPicker
            types={PICKABLE_TYPES}
            value={picked}
            onChange={(v) => {
              setRestorePickId(null); // a choice made while the saved pick loads wins
              setPicked(v);
            }}
            label={t("licensing.pickCard")}
            helperText={t("licensing.pickCardHelper")}
            size="small"
            sx={{ minWidth: 220 }}
          />
        </>
      }
    >
      {data && (
        // Hidden in print, like the toolbar it used to sit in: the year is in the print header.
        <Box sx={{ "@media print": { display: "none" } }}>
          <FiscalYearTimeTravel
            // Oldest first; the forecast year is not offered here.
            years={[...yearOptions].reverse().map((o) => o.value ?? currentFiscalYear)}
            currentFy={currentFiscalYear}
            value={fiscalYearParam ?? currentFiscalYear}
            onChange={(fy) => {
              restoredYear.current = false;
              setFiscalYearParam(fy === currentFiscalYear ? null : fy);
            }}
            servedYear={data.fiscal_year}
          />
        </Box>
      )}
      {(error || catalogueFailed) && <Alert severity="error">{t("licensing.loadFailed")}</Alert>}
      {((loading && !data) || catalogueLoading) && (
        <Box sx={{ py: 8, textAlign: "center" }}>
          <CircularProgress />
        </Box>
      )}
      {data && catalogueReady && (
        <>
          {aggregate ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("licensing.platformNote", { name: aggregate.name })}
            </Typography>
          ) : (
            <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
              {statusCards.map((c) => {
                const pressed = statusFilter === c.status;
                return (
                  <Box
                    key={c.status}
                    role="button"
                    tabIndex={0}
                    aria-pressed={pressed}
                    aria-label={`${c.label}: ${counts[c.status]}`}
                    onClick={() => toggleStatus(c.status)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleStatus(c.status);
                      }
                    }}
                    sx={{
                      display: "flex",
                      flex: "1 1 150px",
                      minWidth: 150,
                      cursor: "pointer",
                      opacity: statusFilter && !pressed ? TILE_DIMMED : 1,
                      transition: "opacity 120ms",
                      "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", borderRadius: 1 },
                    }}
                  >
                    <MetricCard
                      label={c.label}
                      value={counts[c.status]}
                      icon={c.icon}
                      iconColor={statusColor(c.status)}
                      color={statusColor(c.status)}
                    />
                  </Box>
                );
              })}
            </Box>
          )}

          {view === "chart" &&
            (drilledRows.length === 0 ? (
              noRows
            ) : (
              <>
                {drillBar}
                {groups
                  ? groups.map((g) => (
                      <Fragment key={g.key}>
                        <Typography
                          variant="subtitle2"
                          sx={{ mt: 2, mb: 1 }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setDrill({ group: g.key });
                          }}
                        >
                          {g.label}
                        </Typography>
                        {drilledRows.filter((r) => r.group === g.key).map(renderRow)}
                      </Fragment>
                    ))
                  : drilledRows.map(renderRow)}
                {pickedHistory}
              </>
            ))}

          {view === "table" &&
            (tableRows.length === 0 ? (
              noRows
            ) : (
              <>
                {drillBar}
                <LicensingTable
                  rows={tableRows}
                  pairs={tablePairs}
                  metrics={tableMetrics}
                  groups={groups}
                  extraColumns={extraColumns}
                  extraLabel={(key) => allFields.find((f) => f.key === key)?.label ?? key}
                  extraValue={extraValue}
                  typeOf={(key) => {
                    const tp = types.find((x) => x.key === key);
                    return tp ? { icon: tp.icon, label: typeLabel(tp) } : null;
                  }}
                  showStatus={!aggregate}
                  sortK={sortK}
                  sortD={sortD}
                  onSort={onSort}
                  onOpen={setSidePanelCardId}
                  onDrill={(target) => ("group" in target ? setDrill({ group: target.group }) : drillToCard(target.id))}
                />
              </>
            ))}
        </>
      )}
      <CardDetailSidePanel
        cardId={sidePanelCardId}
        open={sidePanelCardId !== null}
        onClose={() => setSidePanelCardId(null)}
      />
      <SaveReportDialog
        open={saved.saveDialogOpen}
        onClose={() => saved.setSaveDialogOpen(false)}
        reportType="licensing"
        config={getConfig()}
        thumbnail={thumbnail}
      />
      <LicensingImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onApplied={refetch}
      />
    </ReportShell>
  );
}
