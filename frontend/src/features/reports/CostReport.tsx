import { useEffect, useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Checkbox from "@mui/material/Checkbox";
import Link from "@mui/material/Link";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import Tooltip from "@mui/material/Tooltip";
import { Treemap, ResponsiveContainer, Tooltip as RTooltip } from "recharts";
import ReportShell from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";
import MetricCard from "./MetricCard";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { useCurrency, type CurrencyFormatter } from "@/hooks/useCurrency";
import { useIsRtl } from "@/hooks/useIsRtl";
import { useAuth } from "@/hooks/useAuth";
import { useTypeLabel, useFieldLabel, useOptionLabel } from "@/hooks/useResolveLabel";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { CardType, FieldDef, RelationType } from "@/types";

interface CostItem {
  id: string;
  name: string;
  cost: number;
  attributes?: Record<string, unknown>;
}

interface AggregateOption {
  /** "<typeKey>:<fieldKey>" — the only encoding the backend accepts */
  value: string;
  /** "<TypeLabel> · <FieldLabel>" */
  label: string;
  typeKey: string;
  typeLabel: string;
  fieldKey: string;
  fieldLabel: string;
}

/** A single (related-type, cost-field) pair contributing to a parent's roll-up. */
interface SourceRef {
  typeKey: string;
  fieldKey: string;
  /** "<TypeLabel> · <FieldLabel>" — used as the panel header label. */
  label: string;
}

/**
 * One step of the treemap drill-down. Pushed when the user clicks a rectangle
 * while at least one aggregate cost source is active; ``cardId`` becomes the
 * ``parent_card_id`` query param. ``sources`` holds every aggregate pair that
 * contributed to the parent's roll-up — one panel is rendered per source so
 * drilling preserves the per-source breakdown rather than mixing card types
 * with different scales.
 */
interface DrillFrame {
  cardId: string;
  cardName: string;
  sources: SourceRef[];
}

/**
 * Migrate a legacy single-source drill frame ({type, costField}) into the
 * current multi-source shape. Used when restoring saved-report configs.
 */
function normaliseDrillFrame(raw: unknown): DrillFrame | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const cardId = typeof obj.cardId === "string" ? obj.cardId : null;
  const cardName = typeof obj.cardName === "string" ? obj.cardName : null;
  if (!cardId || !cardName) return null;
  if (Array.isArray(obj.sources)) {
    const sources = (obj.sources as unknown[])
      .map((s): SourceRef | null => {
        if (!s || typeof s !== "object") return null;
        const so = s as Record<string, unknown>;
        if (typeof so.typeKey !== "string" || typeof so.fieldKey !== "string") return null;
        const label = typeof so.label === "string" ? so.label : `${so.typeKey} · ${so.fieldKey}`;
        return { typeKey: so.typeKey, fieldKey: so.fieldKey, label };
      })
      .filter((s): s is SourceRef => s !== null);
    if (sources.length === 0) return null;
    return { cardId, cardName, sources };
  }
  if (typeof obj.type === "string" && typeof obj.costField === "string") {
    return {
      cardId, cardName,
      sources: [{ typeKey: obj.type, fieldKey: obj.costField, label: `${obj.type} · ${obj.costField}` }],
    };
  }
  return null;
}

function pickCostFields(schema: { fields: FieldDef[] }[]): FieldDef[] {
  const out: FieldDef[] = [];
  for (const s of schema) for (const f of s.fields) if (f.type === "cost") out.push(f);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Treemap helpers                                                     */
/* ------------------------------------------------------------------ */

const COLORS = ["#1565c0", "#1976d2", "#1e88e5", "#2196f3", "#42a5f5", "#64b5f6", "#90caf9", "#bbdefb", "#0d47a1", "#1565c0"];

function treemapColor(index: number): string {
  return COLORS[index % COLORS.length];
}

const TreemapContent = ({
  x, y, width, height, name, cost, index, id, costFmt, onCellClick, clickable, isRtl,
}: {
  x: number; y: number; width: number; height: number; name: string; cost: number; index: number;
  id?: string;
  costFmt: CurrencyFormatter;
  onCellClick?: (id: string, name: string) => void;
  clickable?: boolean;
  isRtl?: boolean;
}) => {
  if (width < 4 || height < 4) return null;
  const showLabel = width > 50 && height > 30;
  const showCost = width > 70 && height > 45;
  const handleClick = id && onCellClick ? () => onCellClick(id, name) : undefined;
  // In RTL, anchor the cell labels at the top-right corner so they read correctly.
  const labelX = isRtl ? x + width - 6 : x + 6;
  const textDir = isRtl ? { textAnchor: "end" as const, direction: "rtl" as const } : {};
  return (
    <g
      onClick={handleClick}
      style={clickable && handleClick ? { cursor: "pointer" } : undefined}
    >
      <rect x={x} y={y} width={width} height={height} fill={treemapColor(index)} stroke="#fff" strokeWidth={2} rx={3} />
      {showLabel && (
        <text x={labelX} y={y + 16} fontSize={11} fontWeight={600} fill="#fff" style={{ pointerEvents: "none" }} {...textDir}>
          {name.length > Math.floor(width / 7) ? name.slice(0, Math.floor(width / 7) - 1) + "\u2026" : name}
        </text>
      )}
      {showCost && (
        <text x={labelX} y={y + 30} fontSize={10} fill="rgba(255,255,255,0.8)" style={{ pointerEvents: "none" }} {...textDir}>
          {costFmt.format(cost)}
        </text>
      )}
    </g>
  );
};

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function CostReport() {
  const { t } = useTranslation(["reports", "common"]);
  const { types, relationTypes, loading: ml } = useMetamodel();
  const typeLabel = useTypeLabel();
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();
  const { fmt } = useCurrency();
  const isRtl = useIsRtl();
  const { user } = useAuth();
  const canViewCostsGlobally = !!(
    user?.permissions?.["*"] || user?.permissions?.["costs.view"]
  );
  const saved = useSavedReport("cost");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() => saved.setSaveDialogOpen(true));
  const [cardTypeKey, setCardTypeKey] = useState("Application");
  const [sidePanelCardId, setSidePanelCardId] = useState<string | null>(null);
  const [costField, setCostField] = useState("costTotalAnnual");
  // Each entry is "<typeKey>:<fieldKey>"; an empty array means "use the direct cost field".
  // Multiple entries are summed: every (type, field) targets a different set of cost values
  // (different types contain different cards, different fields are distinct on the same card),
  // so summing across entries cannot double-count by construction.
  const [costSources, setCostSources] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState("");
  // Root-level (depth 0) data set: a single dataset of primary cards.
  const [rawItems, setRawItems] = useState<CostItem[] | null>(null);
  // Drilled-level (depth ≥ 1) data: one panel per source so multi-source drill
  // shows separate treemaps side-by-side rather than mixing card types into a
  // single chart.
  const [drillPanels, setDrillPanels] = useState<{ source: SourceRef; items: CostItem[] }[] | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [sortK, setSortK] = useState("cost");
  const [sortD, setSortD] = useState<"asc" | "desc">("desc");
  // Drill-down stack. Empty = root. Each frame swaps the treemap to the related
  // cards contributing to that frame's parent. Re-queried via parent_card_id.
  const [drillStack, setDrillStack] = useState<DrillFrame[]>([]);

  // Load saved report config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    if (cfg) {
      if (cfg.cardTypeKey) setCardTypeKey(cfg.cardTypeKey as string);
      if (cfg.costField) setCostField(cfg.costField as string);
      if (Array.isArray(cfg.costSources)) {
        setCostSources(cfg.costSources as string[]);
      } else if (typeof cfg.costSource === "string" && cfg.costSource) {
        // Backwards-compat: an earlier single-select shape stored a string.
        setCostSources([cfg.costSource]);
      }
      if (cfg.groupBy !== undefined) setGroupBy(cfg.groupBy as string);
      if (cfg.view) setView(cfg.view as "chart" | "table");
      if (cfg.sortK) setSortK(cfg.sortK as string);
      if (cfg.sortD) setSortD(cfg.sortD as "asc" | "desc");
      const restored = Array.isArray(cfg.drillStack)
        ? (cfg.drillStack as unknown[])
            .map(normaliseDrillFrame)
            .filter((f): f is DrillFrame => f !== null)
        : [];
      setDrillStack(restored);
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({
    cardTypeKey, costField, costSources, groupBy, view, sortK, sortD,
    drillStack,
  });

  // Auto-persist config to localStorage
  useEffect(() => {
    saved.persistConfig(getConfig());
  }, [cardTypeKey, costField, costSources, groupBy, view, sortK, sortD, drillStack]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset all parameters to defaults
  const handleReset = useCallback(() => {
    saved.resetAll();
    setCardTypeKey("Application");
    setCostField("costTotalAnnual");
    setCostSources([]);
    setGroupBy("");
    setView("chart");
    setSortK("cost");
    setSortD("desc");
    setDrillStack([]);
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const typeDef = useMemo(() => types.find((t) => t.key === cardTypeKey), [types, cardTypeKey]);
  const costFields = useMemo(() => {
    const raw = typeDef ? pickCostFields(typeDef.fields_schema) : [];
    return raw.map((f) => ({ ...f, label: fieldLabel(f) }));
  }, [typeDef, fieldLabel]);

  // Auto-select cost field when card type changes
  useEffect(() => {
    if (costFields.length === 1) {
      setCostField(costFields[0].key);
    } else if (costFields.length > 0 && !costFields.some((f) => f.key === costField)) {
      setCostField(costFields[0].key);
    }
  }, [costFields]); // eslint-disable-line react-hooks/exhaustive-deps

  const groupableFields = useMemo(() => {
    if (!typeDef) return [];
    const out: FieldDef[] = [];
    for (const s of typeDef.fields_schema) for (const f of s.fields) {
      if (f.type === "single_select") out.push({
        ...f,
        label: fieldLabel(f),
        options: f.options?.map((o) => ({ ...o, label: optLabel(o) })),
      });
    }
    return out;
  }, [typeDef, fieldLabel, optLabel]);

  // Aggregate options: every (related-type, cost-field) pair reachable via any relation
  // type involving the current card type. The relation label is intentionally NOT shown —
  // a single (type, field) pair is the unit that prevents double-counting (each related
  // card contributes at most once to its primary card's roll-up). When the same pair is
  // reachable via several relation types, the backend de-dupes at link-resolution time.
  const aggregateOptions = useMemo<AggregateOption[]>(() => {
    if (!typeDef) return [];
    const typeMap = new Map<string, CardType>(types.map((tp) => [tp.key, tp]));
    const reachable = new Set<string>();
    for (const rt of relationTypes as RelationType[]) {
      if (rt.is_hidden) continue;
      const involves =
        rt.source_type_key === cardTypeKey || rt.target_type_key === cardTypeKey;
      if (!involves) continue;
      const otherKey =
        rt.source_type_key === cardTypeKey ? rt.target_type_key : rt.source_type_key;
      if (otherKey === cardTypeKey) continue; // self-relations would re-aggregate the primary type
      reachable.add(otherKey);
    }
    const out: AggregateOption[] = [];
    for (const otherKey of reachable) {
      const otherType = typeMap.get(otherKey);
      if (!otherType) continue;
      const otherTypeLabel = typeLabel(otherType);
      for (const f of pickCostFields(otherType.fields_schema)) {
        const otherFieldLabel = fieldLabel(f);
        out.push({
          value: `${otherKey}:${f.key}`,
          label: t("cost.costSourceItem", { type: otherTypeLabel, field: otherFieldLabel }),
          typeKey: otherKey,
          typeLabel: otherTypeLabel,
          fieldKey: f.key,
          fieldLabel: otherFieldLabel,
        });
      }
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [typeDef, types, relationTypes, cardTypeKey, typeLabel, fieldLabel, t]);

  // Drop any selected pair that's no longer offered (e.g. after switching card type).
  useEffect(() => {
    if (costSources.length === 0) return;
    const valid = new Set(aggregateOptions.map((o) => o.value));
    const filtered = costSources.filter((s) => valid.has(s));
    if (filtered.length !== costSources.length) setCostSources(filtered);
  }, [aggregateOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeAggregates = useMemo(
    () => aggregateOptions.filter((o) => costSources.includes(o.value)),
    [aggregateOptions, costSources],
  );

  // At depth ≥ 1 we render one treemap per source, each showing the related
  // cards linked to the parent of the deepest frame.
  const drillFrame = drillStack.length > 0 ? drillStack[drillStack.length - 1] : null;

  useEffect(() => {
    if (!canViewCostsGlobally) {
      setRawItems([]);
      setDrillPanels(null);
      return;
    }
    if (drillFrame) {
      // One round-trip per source so the panels render independently.
      const sources = drillFrame.sources;
      const parentId = drillFrame.cardId;
      Promise.all(sources.map((s) => {
        const p = new URLSearchParams({
          type: s.typeKey,
          cost_field: s.fieldKey,
          parent_card_id: parentId,
        });
        return api.get<{ items: CostItem[]; total: number }>(`/reports/cost-treemap?${p}`);
      })).then((rs) => {
        setDrillPanels(rs.map((r, i) => ({ source: sources[i], items: r.items })));
        setRawItems(null);
      });
    } else {
      const p = new URLSearchParams({ type: cardTypeKey });
      if (activeAggregates.length > 0) {
        for (const a of activeAggregates) p.append("aggregate", a.value);
      } else {
        p.set("cost_field", costField);
      }
      api.get<{ items: CostItem[]; total: number }>(`/reports/cost-treemap?${p}`).then((r) => {
        setRawItems(r.items);
        setDrillPanels(null);
      });
    }
  }, [cardTypeKey, costField, activeAggregates, drillFrame, canViewCostsGlobally]);

  // Unify root and drilled data into a list of panels: depth-0 has one
  // anonymous panel; drilled levels have one labelled panel per source.
  const panels = useMemo<{ source?: SourceRef; items: CostItem[] }[]>(() => {
    if (drillPanels) return drillPanels;
    if (rawItems) return [{ items: rawItems }];
    return [];
  }, [drillPanels, rawItems]);

  // Per-panel totals (no time-travel filtering — costs reflect the current
  // state of the cards, not their state at an earlier point in time).
  const panelsWithTotals = useMemo(() => {
    return panels.map((p) => ({
      source: p.source,
      items: p.items,
      total: p.items.reduce((sum, item) => sum + item.cost, 0),
    }));
  }, [panels]);

  const { items, total } = useMemo(() => {
    const flat = panelsWithTotals.flatMap((p) => p.items);
    return { items: flat, total: panelsWithTotals.reduce((s, p) => s + p.total, 0) };
  }, [panelsWithTotals]);

  const groupedField = useMemo(() => groupableFields.find((f) => f.key === groupBy), [groupableFields, groupBy]);

  const groups = useMemo(() => {
    // Group-by uses root-type field keys, so it's meaningless once drilled
    // into a different card type — fall through to the flat list instead.
    if (!groupBy || !groupedField || drillFrame) return null;
    const optionMap = new Map<string, string>();
    for (const o of groupedField.options ?? []) optionMap.set(o.key, o.label);
    const map = new Map<string, { label: string; items: CostItem[]; cost: number }>();
    for (const item of items) {
      const val = String((item.attributes as Record<string, unknown>)?.[groupBy] ?? "");
      const label = optionMap.get(val) || val || t("cost.unspecified");
      const g = map.get(label) || { label, items: [], cost: 0 };
      g.items.push(item);
      g.cost += item.cost;
      map.set(label, g);
    }
    return [...map.values()].sort((a, b) => b.cost - a.cost);
  }, [items, groupBy, groupedField, t, drillFrame]);

  const printParams = useMemo(() => {
    const params: { label: string; value: string }[] = [];
    const tp = types.find((tp) => tp.key === cardTypeKey);
    const tpLabel = typeLabel(tp) || cardTypeKey;
    params.push({ label: t("common:labels.type"), value: tpLabel });
    if (activeAggregates.length > 0) {
      params.push({
        label: t("cost.costSource"),
        value: activeAggregates.map((a) => a.label).join(" + "),
      });
    } else if (costFields.length > 1) {
      const cfLabel = costFields.find((f) => f.key === costField)?.label || costField;
      params.push({ label: t("cost.costField"), value: cfLabel });
    }
    if (groupBy) {
      const gLabel = groupableFields.find((f) => f.key === groupBy)?.label || groupBy;
      params.push({ label: t("cost.groupBy"), value: gLabel });
    }
    if (view === "table") params.push({ label: t("common.view"), value: t("common.table") });
    if (drillStack.length > 0) {
      params.push({
        label: t("cost.drillDown.path"),
        value: drillStack.map((f) => f.cardName).join(" › "),
      });
    }
    return params;
  }, [cardTypeKey, types, costField, costFields, activeAggregates, groupBy, groupableFields, view, drillStack, t, typeLabel]);

  // Drill is offered at depth 0 whenever at least one aggregate source is
  // active. With multiple sources, depth 1 renders one chart per source so
  // each card type stays on its own scale. With no aggregate, clicking falls
  // back to opening the card side panel — there's nothing to break down.
  const canDrill = !drillFrame && activeAggregates.length > 0;

  const drillSources = useMemo<SourceRef[]>(() =>
    activeAggregates.map((a) => ({
      typeKey: a.typeKey,
      fieldKey: a.fieldKey,
      label: a.label,
    })),
    [activeAggregates],
  );

  const handleRectClick = useCallback((id: string, name: string) => {
    if (drillFrame || drillSources.length === 0) {
      setSidePanelCardId(id);
      return;
    }
    setDrillStack((s) => [...s, { cardId: id, cardName: name, sources: drillSources }]);
  }, [drillFrame, drillSources]);

  const rootTypeLabel = useMemo(() => {
    const tp = types.find((tp) => tp.key === cardTypeKey);
    return typeLabel(tp) || cardTypeKey;
  }, [types, cardTypeKey, typeLabel]);

  if (!canViewCostsGlobally) {
    return (
      <ReportShell title={t("cost.title")} icon="payments" iconColor="#2e7d32" view={view} onViewChange={setView}>
        <Box sx={{ py: 8, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
          <MaterialSymbol icon="lock" size={32} color="#9e9e9e" />
          <Typography variant="h6" color="text.secondary">
            {t("cost.permissionDeniedTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480 }}>
            {t("cost.permissionDeniedBody")}
          </Typography>
        </Box>
      </ReportShell>
    );
  }

  if (ml || (rawItems === null && drillPanels === null))
    return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>;

  const sortedAllItems = [...items].sort((a, b) => b.cost - a.cost);
  const topDriver = sortedAllItems.length > 0 ? sortedAllItems[0] : null;
  const avgCost = items.length > 0 ? total / items.length : 0;

  // Build per-panel treemap data (rectangles sized by cost, sorted desc so
  // the top driver is visually leading).
  const panelChartData = panelsWithTotals.map((p) => ({
    source: p.source,
    total: p.total,
    data: [...p.items]
      .sort((a, b) => b.cost - a.cost)
      .map((d, i) => ({ name: d.name, size: d.cost, cost: d.cost, id: d.id, index: i })),
  }));

  const sort = (k: string) => { setSortD(sortK === k && sortD === "asc" ? "desc" : "asc"); setSortK(k); };
  const sorted = [...items].sort((a, b) => {
    const d = sortD === "asc" ? 1 : -1;
    if (sortK === "cost") return (a.cost - b.cost) * d;
    return a.name.localeCompare(b.name) * d;
  });

  // Tooltip is parameterised by the panel's own total so per-panel %-of-total
  // is meaningful in multi-source drill (where panels may have different
  // scales, e.g. Provider costs vs IT Component costs). Recharts clones the
  // element it receives via ``content``, injecting ``active`` and ``payload``.
  const Tip = ({ active, payload, panelTotal }: {
    active?: boolean;
    payload?: { payload: { name: string; cost: number; size: number } }[];
    panelTotal: number;
  }) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0].payload;
    return (
      <Paper sx={{ p: 1.5 }} elevation={3}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{d.name}</Typography>
        <Typography variant="caption" display="block">{fmt.format(d.cost)}</Typography>
        <Typography variant="caption" color="text.secondary">{panelTotal > 0 ? t("cost.percentOfTotal", { pct: ((d.cost / panelTotal) * 100).toFixed(1) }) : ""}</Typography>
      </Paper>
    );
  };

  return (
    <ReportShell
      title={t("cost.title")}
      icon="payments"
      iconColor="#2e7d32"
      view={view}
      onViewChange={setView}
      chartRef={chartRef}
      onSaveReport={captureAndSave}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      onReset={handleReset}
      printParams={printParams}
      toolbar={
        <>
          <TextField select size="small" label={t("cost.cardType")} value={cardTypeKey} onChange={(e) => { setCardTypeKey(e.target.value); setDrillStack([]); }} sx={{ minWidth: 150 }}>
            {types.filter((tp) => !tp.is_hidden).map((tp) => <MenuItem key={tp.key} value={tp.key}>{typeLabel(tp)}</MenuItem>)}
          </TextField>
          {aggregateOptions.length > 0 && (
            <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
              <TextField
                select
                size="small"
                label={t("cost.costSource")}
                value={costSources}
                onChange={(e) => {
                  const v = e.target.value;
                  setCostSources(typeof v === "string" ? v.split(",").filter(Boolean) : (v as string[]));
                  setDrillStack([]);
                }}
                InputLabelProps={{ shrink: true }}
                SelectProps={{
                  multiple: true,
                  displayEmpty: true,
                  renderValue: (selected) => {
                    const arr = selected as string[];
                    if (arr.length === 0) return t("cost.costSourceDirect");
                    if (arr.length === 1) {
                      return aggregateOptions.find((o) => o.value === arr[0])?.label ?? arr[0];
                    }
                    return t("cost.costSourceMultiple", { count: arr.length });
                  },
                }}
                sx={{ minWidth: 200 }}
              >
                {aggregateOptions.map((s) => (
                  <MenuItem key={s.value} value={s.value}>
                    <Checkbox checked={costSources.includes(s.value)} size="small" />
                    <ListItemText primary={s.label} />
                  </MenuItem>
                ))}
              </TextField>
              <Tooltip title={t("cost.costSourceHelp")} arrow placement="bottom">
                <Box
                  component="span"
                  tabIndex={0}
                  aria-label={t("cost.costSourceHelp")}
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    color: "text.secondary",
                    cursor: "help",
                  }}
                >
                  <MaterialSymbol icon="help" size={18} />
                </Box>
              </Tooltip>
            </Box>
          )}
          {activeAggregates.length === 0 && costFields.length > 1 && (
            <TextField select size="small" label={t("cost.costField")} value={costField} onChange={(e) => { setCostField(e.target.value); setDrillStack([]); }} sx={{ minWidth: 160 }}>
              {costFields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
            </TextField>
          )}

          {view === "table" && !drillFrame && groupableFields.length > 0 && (
            <TextField select size="small" label={t("cost.groupBy")} value={groupBy} onChange={(e) => setGroupBy(e.target.value)} sx={{ minWidth: 150 }}>
              <MenuItem value="">{t("cost.none")}</MenuItem>
              {groupableFields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
            </TextField>
          )}
        </>
      }
    >
      {/* Summary strip */}
      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <MetricCard label={t("cost.totalCost")} value={fmt.format(total)} icon="payments" iconColor="#2e7d32" color="#2e7d32" />
        <MetricCard label={t("cost.items")} value={items.length} icon="inventory_2" />
        <MetricCard label={t("cost.average")} value={fmt.format(avgCost)} icon="calculate" />
        {topDriver && (
          <MetricCard
            label={t("cost.topCostDriver")}
            value={topDriver.name}
            subtitle={`${fmt.format(topDriver.cost)} (${total > 0 ? ((topDriver.cost / total) * 100).toFixed(0) : 0}%)`}
            icon="trending_up"
            iconColor="#e65100"
          />
        )}
      </Box>

      {/* Drill-down breadcrumb. Visible when at least one frame is on the
          stack; clicking a segment pops to that level, clicking the root
          clears the stack. Click affordance hint shown when drillable but
          not yet drilled. */}
      {drillStack.length > 0 && (
        <Breadcrumbs sx={{ mb: 1.5 }} aria-label={t("cost.drillDown.path")}>
          <Link
            component="button"
            type="button"
            underline="hover"
            color="inherit"
            onClick={() => setDrillStack([])}
            sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontSize: "0.875rem" }}
          >
            <MaterialSymbol icon="home" size={16} />
            {t("cost.drillDown.allItems", { type: rootTypeLabel })}
          </Link>
          {drillStack.map((f, i) => {
            const isLast = i === drillStack.length - 1;
            return isLast ? (
              <Typography key={f.cardId} color="text.primary" sx={{ fontSize: "0.875rem", fontWeight: 600 }}>
                {f.cardName}
              </Typography>
            ) : (
              <Link
                key={f.cardId}
                component="button"
                type="button"
                underline="hover"
                color="inherit"
                onClick={() => setDrillStack((s) => s.slice(0, i + 1))}
                sx={{ fontSize: "0.875rem" }}
              >
                {f.cardName}
              </Link>
            );
          })}
        </Breadcrumbs>
      )}

      {view === "chart" ? (
        items.length === 0 ? (
          <Box sx={{ py: 8, textAlign: "center" }}>
            <Typography color="text.secondary">{t("cost.noData")}</Typography>
          </Box>
        ) : (
          <Box
            sx={{
              display: "grid",
              gap: 2,
              // Drilled multi-source levels lay out as 2 columns on md+, 1 on
              // narrow viewports. Single-panel always uses 1 column.
              gridTemplateColumns: panelChartData.length > 1
                ? { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }
                : "1fr",
            }}
          >
            {panelChartData.map((panel, idx) => {
              const panelHeight = panelChartData.length > 1 ? 360 : 450;
              const panelTotal = panel.total;
              return (
                <Paper key={panel.source ? panel.source.label : `root-${idx}`} variant="outlined" sx={{ p: 1 }}>
                  {panel.source ? (
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", px: 1, pb: 0.5 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {panel.source.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {fmt.format(panelTotal)}
                      </Typography>
                    </Box>
                  ) : (
                    canDrill && drillStack.length === 0 && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", px: 1, pt: 0.5 }}
                      >
                        {t("cost.drillDown.hint")}
                      </Typography>
                    )
                  )}
                  {panel.data.length === 0 ? (
                    <Box sx={{ py: 6, textAlign: "center" }}>
                      <Typography color="text.secondary" variant="body2">{t("cost.noData")}</Typography>
                    </Box>
                  ) : (
                    <ResponsiveContainer width="100%" height={panelHeight}>
                      <Treemap
                        data={panel.data}
                        dataKey="size"
                        stroke="#fff"
                        animationDuration={300}
                        content={
                          <TreemapContent
                            x={0} y={0} width={0} height={0} name="" cost={0} index={0}
                            costFmt={fmt}
                            onCellClick={handleRectClick}
                            clickable={canDrill}
                            isRtl={isRtl}
                          />
                        }
                      >
                        <RTooltip content={<Tip panelTotal={panelTotal} />} />
                      </Treemap>
                    </ResponsiveContainer>
                  )}
                </Paper>
              );
            })}
          </Box>
        )
      ) : (
        <Paper variant="outlined" sx={{ overflow: "auto" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell><TableSortLabel active={sortK === "name"} direction={sortK === "name" ? sortD : "asc"} onClick={() => sort("name")}>{t("common:labels.name")}</TableSortLabel></TableCell>
                <TableCell align="right"><TableSortLabel active={sortK === "cost"} direction={sortK === "cost" ? sortD : "asc"} onClick={() => sort("cost")}>{t("cost.cost")}</TableSortLabel></TableCell>
                <TableCell align="right">{t("cost.percentTotal")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {groups ? (
                groups.map((g) => {
                  const groupSorted = [...g.items].sort((a, b) => {
                    const d = sortD === "asc" ? 1 : -1;
                    if (sortK === "cost") return (a.cost - b.cost) * d;
                    return a.name.localeCompare(b.name) * d;
                  });
                  return [
                    <TableRow key={`grp-${g.label}`} sx={{ bgcolor: "action.hover" }}>
                      <TableCell sx={{ fontWeight: 700, fontSize: "0.85rem" }}>
                        {g.label}
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                          ({g.items.length})
                        </Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt.format(g.cost)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, color: "text.secondary" }}>
                        {total > 0 ? `${((g.cost / total) * 100).toFixed(1)}%` : "\u2014"}
                      </TableCell>
                    </TableRow>,
                    ...groupSorted.map((d) => (
                      <TableRow key={d.id} hover sx={{ cursor: "pointer" }} onClick={() => setSidePanelCardId(d.id)}>
                        <TableCell sx={{ fontWeight: 500, pl: 4 }}>{d.name}</TableCell>
                        <TableCell align="right">{fmt.format(d.cost)}</TableCell>
                        <TableCell align="right">{total > 0 ? `${((d.cost / total) * 100).toFixed(1)}%` : "\u2014"}</TableCell>
                      </TableRow>
                    )),
                  ];
                })
              ) : (
                sorted.map((d) => (
                  <TableRow key={d.id} hover sx={{ cursor: "pointer" }} onClick={() => setSidePanelCardId(d.id)}>
                    <TableCell sx={{ fontWeight: 500 }}>{d.name}</TableCell>
                    <TableCell align="right">{fmt.format(d.cost)}</TableCell>
                    <TableCell align="right">{total > 0 ? `${((d.cost / total) * 100).toFixed(1)}%` : "\u2014"}</TableCell>
                  </TableRow>
                ))
              )}
              <TableRow sx={{ bgcolor: "action.selected" }}>
                <TableCell sx={{ fontWeight: 700 }}>{t("cost.total")}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt.format(total)}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>100%</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Paper>
      )}
      <CardDetailSidePanel
        cardId={sidePanelCardId}
        open={!!sidePanelCardId}
        onClose={() => setSidePanelCardId(null)}
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
