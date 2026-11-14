import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import ListItemText from "@mui/material/ListItemText";
import FiscalYearTimeTravel from "@/components/FiscalYearTimeTravel";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import EChart, { type EChartClickParams } from "@/components/charts/EChart";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import CardPicker, { type CardOption } from "@/components/CardPicker";
import CardScopeFilter from "@/components/CardScopeFilter";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useAuthContext } from "@/hooks/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
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
import { isLicenseType, LICENSE_METRICS, statusColor, STATUS_ORDER } from "@/lib/licenses";
import { CHART_OTHER, STATUS_COLORS } from "@/theme/tokens";
import type {
  FieldDef,
  LicenseMetric,
  LicenseReportCell,
  LicenseReportResponse,
  LicenseReportRow,
  LicenseStatus,
  LicenseTypeStatus,
} from "@/types";
import CostDrillBar from "./CostDrillBar";
import CostLegend from "./CostLegend";
import { catalogueHues } from "./costColors";
import { applyDrill, crumbsOf, type Drill } from "./costDrill";
import {
  commonGroupableFields,
  isBuiltInFieldType,
  relationGroupOptions,
} from "./costReportOptions";
import { buildCostTrendOption, type CostTrendRow } from "./costTrendOption";
import { buildByTypeOption, type ByTypeBar } from "./licensingByTypeOption";
import {
  buildUtilisationOption,
  utilisationHeight,
  type UtilisationBar,
} from "./licensingUtilisationOption";
import LicensingImportDialog from "./LicensingImportDialog";
import LicensingTable from "./LicensingTable";
import MetricCard from "./MetricCard";
import ReportShell, { type PrintParam } from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";

export type LicensingView = "chart" | "bytype" | "table";

const OTHER_GROUP = "__other__";
const GROUP_PREFIX = "group:";
const NO_FOLDED: Set<string> = new Set();
const PICKABLE_TYPES = ["Application", "ITComponent", "Platform"];

const cellStatus = (s: LicenseTypeStatus): LicenseStatus => (s === "no_data" ? "no_actual_data" : s);

/** The highest-priority status of the list (`over` first), `compliant` when empty. */
function worstStatus(statuses: LicenseStatus[]): LicenseStatus {
  return STATUS_ORDER.find((s) => statuses.includes(s)) ?? "compliant";
}

/** A report row with what the page needs for the current license type filter. */
interface ViewRow {
  id: string;
  name: string;
  type: string;
  group?: string;
  pct: number | null;
  noLicence: boolean;
  status: LicenseStatus;
  raw: LicenseReportRow;
}

export default function LicensingReport() {
  const { t } = useTranslation(["reports", "common"]);
  const { types, relationTypes, loading: ml } = useMetamodel();
  const readableTypes = useReadableCardTypes("module");
  const typeLabel = useTypeLabel();
  const relLabel = useRelationLabel();
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();
  const chrome = useEChartsTheme();
  const saved = useSavedReport("licensing");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() =>
    saved.setSaveDialogOpen(true),
  );

  const [cardTypeKey, setCardTypeKey] = useState("Application");
  const [metric, setMetric] = useState<LicenseMetric>("users");
  const [licenseType, setLicenseType] = useState(""); // "" = all
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

  const typeOptions = useMemo(
    () =>
      readableTypes
        .filter((tp) => isLicenseType(tp.key))
        .map((tp) => ({ key: tp.key, label: typeLabel(tp) })),
    [readableTypes, typeLabel],
  );
  // A type the user may not read falls back to one they may.
  useEffect(() => {
    if (ml || typeOptions.length === 0) return;
    if (!typeOptions.some((o) => o.key === cardTypeKey)) setCardTypeKey(typeOptions[0].key);
  }, [ml, typeOptions, cardTypeKey]);

  const scope = useCardScope({ typeKey: cardTypeKey, enabled: true });
  const { setScopeIds, effectiveScopeIds, scopeIds } = scope;

  // Group by: single selects and yes/no fields, plus relations the card sits on the "one" end of.
  const schemas = useMemo(() => {
    const def = types.find((tp) => tp.key === cardTypeKey);
    return def ? [def.fields_schema] : [];
  }, [types, cardTypeKey]);
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
      ...relationGroupOptions(relationTypes, [cardTypeKey], relLabel),
    ],
    [groupableFields, relationTypes, cardTypeKey, relLabel],
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

  // The picker works in the By-license-type view; elsewhere the pick is kept but not sent.
  const cardIdParam = view === "bytype" && picked ? picked.id : null;
  const path = useMemo(() => {
    const p = new URLSearchParams({ type: cardTypeKey, metric });
    if (fiscalYearParam != null) p.set("fiscal_year", String(fiscalYearParam));
    if (effectiveGroupBy && !cardIdParam) p.set("group_by", effectiveGroupBy);
    if (cardIdParam) p.set("card_id", cardIdParam);
    return `/reports/licensing?${p.toString()}`;
  }, [cardTypeKey, metric, fiscalYearParam, effectiveGroupBy, cardIdParam]);
  const { data, loading, error, refetch } = useApiQuery<LicenseReportResponse>(path);
  const { user } = useAuthContext();
  const canImport = usePermissions(user).can("licenses.edit");
  const [importOpen, setImportOpen] = useState(false);
  const aggregate = data?.aggregate ?? null;

  // Ids named by a drill exist only under the current selection.
  useEffect(() => {
    setDrill((d) => (d.group === undefined && d.cardId === undefined ? d : {}));
  }, [cardTypeKey, metric, effectiveGroupBy, fiscalYearParam, picked?.id]);

  const currentFiscalYear = data?.current_fiscal_year ?? new Date().getFullYear();
  const yearOptions = useMemo(
    () => costFiscalYearOptions(currentFiscalYear).filter((o) => o.value !== currentFiscalYear + 1),
    [currentFiscalYear],
  );

  // ── license types: label, order, hue (stable across filters and years) ────────────────────
  const sortedTypes = useMemo(
    () => [...(data?.license_types ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [data],
  );
  const hues = useMemo(
    () => catalogueHues(sortedTypes.map((x) => x.key), chrome.categorical, CHART_OTHER[chrome.mode]),
    [sortedTypes, chrome.categorical, chrome.mode],
  );
  const labelOfType = useCallback(
    (key: string) => {
      const lt = sortedTypes.find((x) => x.key === key);
      return lt ? fieldLabel({ key, label: lt.label, translations: lt.translations }) : key;
    },
    [sortedTypes, fieldLabel],
  );

  // ── rows for the current license type filter ──────────────────────────────────────────────
  const viewRows = useMemo<ViewRow[]>(() => {
    if (!data) return [];
    return data.rows.flatMap((raw): ViewRow[] => {
      const base = {
        id: raw.id,
        name: raw.name,
        type: raw.type,
        group: effectiveGroupBy && !aggregate ? (raw.group ?? OTHER_GROUP) : undefined,
        raw,
      };
      if (licenseType) {
        const c: LicenseReportCell | undefined = raw.by_type[licenseType];
        // A card holding nothing of the picked type has nothing to show for it.
        if (!c) return [];
        return [{ ...base, pct: c.pct, noLicence: c.no_licence, status: cellStatus(c.status) }];
      }
      // The server's status ignores a no-data type; a Platform's rows carry none: compliant.
      const status = raw.status ?? "compliant";
      return [{ ...base, pct: raw.worst_pct, noLicence: raw.worst_no_licence, status }];
    });
  }, [data, licenseType, effectiveGroupBy, aggregate]);
  // A Platform (or one picked card) is not narrowed by the scope.
  const closure = cardIdParam ? null : scope.closure;
  const scopedRows = useMemo(() => applyScope(viewRows, closure), [viewRows, closure]);

  const counts = useMemo(() => {
    const c: Record<LicenseStatus, number> = { compliant: 0, approaching: 0, over: 0, no_actual_data: 0 };
    for (const r of scopedRows) c[r.status] += 1;
    return c;
  }, [scopedRows]);

  // ── trend: summed from the response, re-derived (never refetched) by scope and drill ──────
  const trendIds = useMemo<Set<string> | null>(() => {
    if (drill.cardId !== undefined) return new Set([drill.cardId]);
    if (drill.group !== undefined)
      return new Set(applyDrill(viewRows, drill, NO_FOLDED).map((r) => r.id));
    return null;
  }, [drill, viewRows]);
  const trend = useMemo(() => {
    // Every type any counted card holds in any year, whatever the license type filter.
    const present = new Set<string>();
    const totals = (data?.trend ?? []).map((y) => {
      const actual: Record<string, number> = {};
      let licensed = 0;
      for (const [cardId, cells] of Object.entries(y.cards)) {
        if (closure && !closure.has(cardId)) continue;
        if (trendIds && !trendIds.has(cardId)) continue;
        for (const [key, c] of Object.entries(cells)) {
          present.add(key);
          if (licenseType && key !== licenseType) continue;
          licensed += c.licensed;
          actual[key] = (actual[key] ?? 0) + (c.actual ?? 0);
        }
      }
      return { fiscalYear: y.fiscal_year, actual, licensed };
    });
    const components = sortedTypes.map((x) => x.key).filter((k) => present.has(k));
    return { totals, components };
  }, [data, closure, trendIds, licenseType, sortedTypes]);
  const trendOption = useMemo(() => {
    const rows: CostTrendRow[] = trend.totals.map((y) => ({
      fiscalYear: y.fiscalYear,
      ...Object.fromEntries(trend.components.map((k) => [k, y.actual[k] ?? 0])),
    }));
    return buildCostTrendOption(rows, trend.components, {
      chrome,
      isRtl: chrome.isRtl,
      format: String,
      yearLabel: (y) => costFiscalYearName(y, currentFiscalYear),
      componentLabel: labelOfType,
      colorOf: (k) => hues.get(k) ?? CHART_OTHER[chrome.mode],
      extraSeries: [
        {
          type: "scatter",
          name: t("licensing.licensed"),
          symbol: "rect",
          symbolSize: [32, 3],
          z: 5,
          itemStyle: { color: chrome.textPrimary },
          data: trend.totals.map((y) => y.licensed),
        },
      ],
    });
  }, [trend, chrome, currentFiscalYear, labelOfType, hues, t]);

  const typeLabelOf = useCallback(
    (key: string) => {
      const tp = types.find((x) => x.key === key);
      return tp ? typeLabel(tp) : key;
    },
    [types, typeLabel],
  );

  // ── Utilisation ───────────────────────────────────────────────────────────────────────────
  const drilledRows = useMemo(() => applyDrill(scopedRows, drill, NO_FOLDED), [scopedRows, drill]);
  const groupedBars = effectiveGroupBy && !aggregate && drill.group === undefined && drill.cardId === undefined;
  const utilisationBars = useMemo<UtilisationBar[]>(() => {
    if (!groupedBars) {
      return drilledRows.map((r) => ({
        id: r.id,
        name: r.name,
        pct: r.pct,
        noLicence: r.noLicence,
        status: r.status,
        ...(aggregate && { typeLabel: typeLabelOf(r.type) }),
      }));
    }
    const byGroup = new Map<string, ViewRow[]>();
    for (const r of drilledRows) {
      const key = r.group ?? OTHER_GROUP;
      const members = byGroup.get(key);
      if (members) members.push(r);
      else byGroup.set(key, [r]);
    }
    return [...byGroup].map(([key, members]) => {
      const pcts = members.flatMap((m) => (m.pct == null ? [] : [m.pct]));
      return {
        id: `${GROUP_PREFIX}${key}`,
        name: groupLabel(key),
        pct: pcts.length ? Math.max(...pcts) : null,
        noLicence: members.some((m) => m.noLicence),
        status: worstStatus(members.map((m) => m.status)),
      };
    });
  }, [groupedBars, drilledRows, aggregate, groupLabel, typeLabelOf]);
  const utilisationOption = useMemo(
    () =>
      buildUtilisationOption(utilisationBars, {
        chrome,
        isRtl: chrome.isRtl,
        noData: t("licensing.noActual"),
        noLicense: t("licensing.noLicense"),
      }),
    [utilisationBars, chrome, t],
  );

  const idOf = (p: EChartClickParams) => (p.data as { id?: string } | undefined)?.id;
  const handleOpen = useCallback((p: EChartClickParams) => {
    const id = idOf(p);
    if (id && !id.startsWith(GROUP_PREFIX)) setSidePanelCardId(id);
  }, []);
  const drillToCard = useCallback(
    (id: string) => {
      const row = viewRows.find((r) => r.id === id);
      setDrill({ ...(row?.group !== undefined && { group: row.group }), cardId: id });
    },
    [viewRows],
  );
  const handleDrill = useCallback(
    (p: EChartClickParams) => {
      const id = idOf(p);
      if (!id) return;
      if (id.startsWith(GROUP_PREFIX)) setDrill({ group: id.slice(GROUP_PREFIX.length) });
      else drillToCard(id);
    },
    [drillToCard],
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

  // ── By license type: the scope's (or the picked card's) totals per type ───────────────────
  const byTypeBars = useMemo<ByTypeBar[]>(() => {
    const rows = closure ? data?.rows.filter((r) => closure.has(r.id)) : data?.rows;
    return sortedTypes
      .filter((x) => !licenseType || x.key === licenseType)
      .flatMap((x) => {
        let licensed = 0;
        let actual: number | null = null;
        for (const r of rows ?? []) {
          const c = r.by_type[x.key];
          if (!c) continue;
          licensed += c.licensed;
          if (c.actual != null) actual = (actual ?? 0) + c.actual;
        }
        return licensed > 0 || actual != null
          ? [{ key: x.key, label: labelOfType(x.key), licensed, actual, color: hues.get(x.key) ?? "" }]
          : [];
      });
  }, [data, closure, sortedTypes, licenseType, labelOfType, hues]);
  const byTypeOption = useMemo(
    () =>
      buildByTypeOption(byTypeBars, {
        chrome,
        isRtl: chrome.isRtl,
        licensedLabel: t("licensing.licensed"),
        actualLabel: t("licensing.actual"),
      }),
    [byTypeBars, chrome, t],
  );

  // ── Table: the same rows as the Utilisation view, one per card ────────────────────────────
  const tableTypes = useMemo(
    () =>
      sortedTypes.filter(
        (x) => (!licenseType || x.key === licenseType) && viewRows.some((r) => r.raw.by_type[x.key]),
      ),
    [sortedTypes, licenseType, viewRows],
  );
  const tableGroups = useMemo(() => {
    if (!effectiveGroupBy || aggregate || drill.cardId !== undefined) return undefined;
    const keys = [...new Set(drilledRows.map((r) => r.group ?? OTHER_GROUP))];
    return keys
      .map((key) => ({ key, label: groupLabel(key) }))
      .sort((a, b) =>
        a.key === OTHER_GROUP ? 1 : b.key === OTHER_GROUP ? -1 : a.label.localeCompare(b.label),
      );
  }, [effectiveGroupBy, aggregate, drill.cardId, drilledRows, groupLabel]);
  const tableRows = useMemo(
    () => (tableGroups ? drilledRows.map((r) => ({ ...r, group: r.group ?? OTHER_GROUP })) : drilledRows),
    [tableGroups, drilledRows],
  );
  const yesNo = { yes: t("common:labels.yes"), no: t("common:labels.no") };
  const extraValue = (row: { raw: LicenseReportRow }, key: string) => {
    const f = allFields.find((fd) => fd.key === key);
    return formatFieldValue(
      row.raw.attributes?.[key],
      f ? ({ ...f, typeKeys: [cardTypeKey] } as FieldMeta) : undefined,
      { optionLabel: optLabel, yes: yesNo.yes, no: yesNo.no },
    );
  };
  const onSort = (k: string) => {
    setSortD(sortK === k && sortD === "asc" ? "desc" : "asc");
    setSortK(k);
  };

  const printParams = useMemo(() => {
    const params: PrintParam[] = [
      { label: t("licensing.cardType"), value: typeOptions.find((o) => o.key === cardTypeKey)?.label ?? cardTypeKey },
      { label: t("licensing.metric"), value: t(`licensing.metric_${metric}`) },
    ];
    if (licenseType) params.push({ label: t("licensing.licenseType"), value: labelOfType(licenseType) });
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
  }, [t, typeOptions, cardTypeKey, metric, licenseType, labelOfType, data, currentFiscalYear, effectiveGroupBy, groupOptions, aggregate, view, effectiveScopeIds]);

  const legendEntries = useMemo(
    () =>
      trend.components.map((k) => ({
        key: k,
        label: labelOfType(k),
        color: hues.get(k) ?? CHART_OTHER[chrome.mode],
      })),
    [trend.components, labelOfType, hues, chrome.mode],
  );

  // ── saved reports: restore, persist, reset ────────────────────────────────────────────────
  // A restored year the report no longer offers (the Forecast year, one older than the window)
  // or the server refuses falls back to the current year; so does a vanished license type.
  useEffect(() => {
    if (data && fiscalYearParam != null && !yearOptions.some((o) => o.value === fiscalYearParam))
      setFiscalYearParam(null);
  }, [data, fiscalYearParam, yearOptions]);
  useEffect(() => {
    if (error && restoredYear.current && fiscalYearParam != null) {
      restoredYear.current = false;
      setFiscalYearParam(null);
    }
  }, [error, fiscalYearParam]);
  useEffect(() => {
    if (data && licenseType && !data.license_types.some((x) => x.key === licenseType))
      setLicenseType("");
  }, [data, licenseType]);
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
      typeof cfg.cardTypeKey === "string" && isLicenseType(cfg.cardTypeKey)
        ? cfg.cardTypeKey
        : undefined;
    if (restoredType) setCardTypeKey(restoredType);
    if (LICENSE_METRICS.includes(cfg.metric as LicenseMetric)) setMetric(cfg.metric as LicenseMetric);
    if (typeof cfg.licenseType === "string") setLicenseType(cfg.licenseType);
    if (typeof cfg.groupBy === "string") setGroupBy(cfg.groupBy);
    if (cfg.view === "chart" || cfg.view === "bytype" || cfg.view === "table") setView(cfg.view);
    if (typeof cfg.sortK === "string") setSortK(cfg.sortK);
    if (cfg.sortD === "asc" || cfg.sortD === "desc") setSortD(cfg.sortD);
    if (typeof cfg.fiscalYearParam === "number") {
      restoredYear.current = true;
      setFiscalYearParam(cfg.fiscalYearParam);
    }
    if (Array.isArray(cfg.extraColumns))
      setExtraColumns((cfg.extraColumns as unknown[]).filter((v): v is string => typeof v === "string"));
    if (Array.isArray(cfg.scopeIds))
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
    setMetric("users");
    setLicenseType("");
    setGroupBy("");
    setView("chart");
    setFiscalYearParam(null);
    setPicked(null);
    setScopeIds([]);
  }, [setScopeIds, saved]);

  const statusCards: { status: LicenseStatus; label: string; icon: string }[] = [
    { status: "compliant", label: t("licensing.statusCompliant"), icon: "check_circle" },
    { status: "approaching", label: t("licensing.statusApproaching"), icon: "warning" },
    { status: "over", label: t("licensing.statusOver"), icon: "error" },
    { status: "no_actual_data", label: t("licensing.statusNoActualData"), icon: "help" },
  ];

  const empty = data && data.rows.length === 0;

  return (
    <ReportShell<LicensingView>
      title={t("licensing.title")}
      icon="badge"
      iconColor={STATUS_COLORS.info}
      view={view}
      onViewChange={setView}
      chartViewLabel={t("licensing.viewUtilisation")}
      extraViews={[{ value: "bytype", icon: "bar_chart", label: t("licensing.viewByType") }]}
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
      legend={view === "table" ? undefined : <CostLegend entries={legendEntries} />}
      toolbar={
        <>
          <TextField
            select
            size="small"
            label={t("licensing.cardType")}
            value={cardTypeKey}
            onChange={(e) => setCardTypeKey(e.target.value)}
            sx={{ minWidth: 150 }}
          >
            {typeOptions.map((o) => (
              <MenuItem key={o.key} value={o.key}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("licensing.metric")}
            value={metric}
            onChange={(e) => setMetric(e.target.value as LicenseMetric)}
            sx={{ minWidth: 140 }}
          >
            {LICENSE_METRICS.map((m) => (
              <MenuItem key={m} value={m}>
                {t(`licensing.metric_${m}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("licensing.licenseType")}
            value={licenseType}
            slotProps={{ select: { displayEmpty: true } }}
            onChange={(e) => setLicenseType(e.target.value)}
            sx={{ minWidth: 170 }}
          >
            <MenuItem value="">{t("licensing.allLicenseTypes")}</MenuItem>
            {sortedTypes.map((x) => (
              <MenuItem key={x.key} value={x.key}>
                {labelOfType(x.key)}
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
          {view === "bytype" && (
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
          )}
        </>
      }
    >
      {data && (
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
      )}
      {error && <Alert severity="error">{t("licensing.loadFailed")}</Alert>}
      {loading && !data && (
        <Box sx={{ py: 8, textAlign: "center" }}>
          <CircularProgress />
        </Box>
      )}
      {data && (
        <>
          {aggregate ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("licensing.platformNote", { name: aggregate.name })}
            </Typography>
          ) : (
            <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
              {statusCards.map((c) => (
                <MetricCard
                  key={c.status}
                  label={c.label}
                  value={counts[c.status]}
                  icon={c.icon}
                  iconColor={statusColor(c.status)}
                  color={statusColor(c.status)}
                />
              ))}
            </Box>
          )}

          <Box sx={{ mb: 3 }} data-testid="licensing-trend">
            <EChart option={trendOption} style={{ height: 300 }} ariaLabel={t("licensing.trendAria")} />
          </Box>

          {view === "chart" &&
            (utilisationBars.length === 0 ? (
              <Box sx={{ py: 8, textAlign: "center" }}>
                <Typography color="text.secondary">{t("licensing.noData")}</Typography>
              </Box>
            ) : (
              <>
                <CostDrillBar crumbs={crumbs} onSelect={setDrill} hint={t("licensing.drillHint")} />
                <EChart
                  option={utilisationOption}
                  style={{ height: utilisationHeight(utilisationBars.length) }}
                  ariaLabel={t("licensing.utilisationAria")}
                  onClick={handleOpen}
                  onContextMenu={handleDrill}
                />
              </>
            ))}

          {view === "bytype" &&
            (empty || byTypeBars.length === 0 ? (
              <Box sx={{ py: 8, textAlign: "center" }}>
                <Typography color="text.secondary">{t("licensing.noData")}</Typography>
              </Box>
            ) : (
              <EChart option={byTypeOption} style={{ height: 360 }} ariaLabel={t("licensing.byTypeAria")} />
            ))}

          {view === "table" &&
            (tableRows.length === 0 ? (
              <Box sx={{ py: 8, textAlign: "center" }}>
                <Typography color="text.secondary">{t("licensing.noData")}</Typography>
              </Box>
            ) : (
              <>
                <CostDrillBar crumbs={crumbs} onSelect={setDrill} hint={t("licensing.drillHint")} />
                <LicensingTable
                  rows={tableRows}
                  types={tableTypes}
                  labelOf={labelOfType}
                  groups={tableGroups}
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
