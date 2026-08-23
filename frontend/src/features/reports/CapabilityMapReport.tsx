import { useEffect, useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import ReportShell from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";
import TimelineSlider from "@/components/TimelineSlider";
import FilterSelect, { EMPTY_FILTER_KEY } from "@/components/FilterSelect";
import CardScopeFilter from "@/components/CardScopeFilter";
import type { CardScopeOption } from "@/components/CardScopeDialog";
import TagPicker from "@/components/TagPicker";
import type { TagGroup } from "@/types";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import ReportCardListPanel, { type ReportCardListItem } from "./ReportCardListPanel";
import ReportFilterSection from "./ReportFilterSection";
import { isAliveAtDate, isRetiredByDate } from "./portfolioHelpers";
import {
  classifyTimelineChange,
  computeTimelineMilestones,
  computeTimelineRange,
} from "./timelineRange";
import {
  PULSE_COLORS,
  TIMELINE_PULSE_KEYFRAMES,
  useMilestoneSpotlight,
} from "./useMilestoneSpotlight";
import type { ContainerPulseKind, PulseKind } from "./useMilestoneSpotlight";
import {
  buildInventorySliceUrl,
  type InventorySliceFilters,
} from "./portfolioInventoryLink";
import { api } from "@/api/client";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { readableTextColor } from "@/lib/color";
import { CARD_TYPE_COLORS } from "@/theme";
import { useCurrency } from "@/hooks/useCurrency";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { useTimeline } from "@/hooks/useTimeline";
import { applyScope, useCardScope } from "@/hooks/useCardScope";
import { useTypeLabel, useFieldLabel, useOptionLabel } from "@/hooks/useResolveLabel";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FieldOption {
  key: string;
  label: string;
  color?: string;
  translations?: Record<string, string>;
}

interface FieldDef {
  key: string;
  label: string;
  type: string;
  options?: FieldOption[];
  translations?: Record<string, string>;
}

interface SectionDef {
  section: string;
  fields: FieldDef[];
}

interface AppData {
  id: string;
  name: string;
  subtype?: string;
  attributes?: Record<string, unknown>;
  lifecycle?: Record<string, string>;
  org_ids: string[];
  related_by_type?: Record<string, string[]>;
  tag_ids?: string[];
}

interface TagGroupDef {
  id: string;
  name: string;
  mode: string;
  tags: { id: string; name: string; color?: string }[];
}

interface FilterableTypeRef {
  id: string;
  name: string;
  type: string;
}

interface CapItem {
  id: string;
  name: string;
  parent_id: string | null;
  app_count: number;
  total_cost: number;
  risk_count: number;
  attributes?: Record<string, unknown>;
  apps: AppData[];
}

// Removed OrgRef — now using filterable_types from the API

type Metric = "app_count" | "total_cost" | "risk_count";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const METRIC_OPTIONS: { key: Metric; labelKey: string; icon: string }[] = [
  { key: "app_count", labelKey: "capabilityMap.metricAppCount", icon: "apps" },
  { key: "total_cost", labelKey: "capabilityMap.metricTotalCost", icon: "payments" },
  { key: "risk_count", labelKey: "capabilityMap.metricRiskCount", icon: "warning" },
];

const UNSET_COLOR = "rgba(128, 128, 128, 0.2)";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function pickSelectFields(schema: SectionDef[]): FieldDef[] {
  const out: FieldDef[] = [];
  for (const s of schema)
    for (const f of s.fields) if (f.type === "single_select") out.push(f);
  return out;
}

function nodeMetric(node: CapNode, metric: Metric): number {
  if (metric === "app_count") return node.deepAppCount;
  if (metric === "total_cost") return node.deepCost;
  if (metric === "risk_count") return node.deepRiskCount;
  return 0;
}

function heatColor(value: number, max: number, metric: Metric): string {
  if (max === 0) return "rgba(128, 128, 128, 0.1)";
  const ratio = Math.min(value / max, 1);
  if (metric === "risk_count") {
    const r = Math.round(255 - ratio * 55);
    const g = Math.round(255 - ratio * 207);
    const b = Math.round(255 - ratio * 215);
    return `rgb(${r},${g},${b})`;
  }
  const r = Math.round(227 - ratio * 202);
  const g = Math.round(242 - ratio * 152);
  const b = Math.round(253 - ratio * 51);
  return `rgb(${r},${g},${b})`;
}

function getAppColor(
  app: AppData,
  colorBy: string,
  selectFields: FieldDef[],
  defaultColor: string = CARD_TYPE_COLORS.Application,
): string {
  if (!colorBy || colorBy === "none") return defaultColor;
  const val = (app.attributes || {})[colorBy] as string | undefined;
  if (!val) return UNSET_COLOR;
  const fd = selectFields.find((f) => f.key === colorBy);
  const opt = fd?.options?.find((o) => o.key === val);
  return opt?.color || UNSET_COLOR;
}

function getAppColorLabel(
  app: AppData,
  colorBy: string,
  selectFields: FieldDef[],
): string | null {
  if (!colorBy || colorBy === "none") return null;
  const val = (app.attributes || {})[colorBy] as string | undefined;
  if (!val) return null;
  const fd = selectFields.find((f) => f.key === colorBy);
  const opt = fd?.options?.find((o) => o.key === val);
  return opt?.label || val;
}

/**
 * Filter an app based on active attribute, relation and tag filters. The
 * timeline date is deliberately NOT part of this matcher: the milestone
 * marks/delta/pills are computed from the statically-filtered set, and the
 * alive-at-date check is applied separately by the caller.
 */
function matchesFilters(
  app: AppData,
  attrFilters: Record<string, string[]>,
  relationFilters: Record<string, string[]>,
  tagFilterIds: string[],
  tagGroups: TagGroupDef[],
): boolean {
  // Attribute filters
  const attrs = app.attributes || {};
  for (const [key, vals] of Object.entries(attrFilters)) {
    if (vals.length === 0) continue;
    const v = attrs[key] as string | undefined;
    const isEmpty = v === undefined || v === null || v === "";
    const wantEmpty = vals.includes(EMPTY_FILTER_KEY);
    const realVals = vals.filter((x) => x !== EMPTY_FILTER_KEY);
    if (wantEmpty && isEmpty) continue;
    if (realVals.length > 0 && realVals.includes(v as string)) continue;
    return false;
  }
  // Relation filters (e.g. Organization, Platform, etc.)
  const byType = app.related_by_type || {};
  for (const [typeKey, ids] of Object.entries(relationFilters)) {
    if (ids.length === 0) continue;
    const appRelIds = byType[typeKey] || app.org_ids || [];
    const wantEmpty = ids.includes(EMPTY_FILTER_KEY);
    const realIds = ids.filter((x) => x !== EMPTY_FILTER_KEY);
    if (wantEmpty && appRelIds.length === 0) continue;
    if (realIds.length > 0 && realIds.some((id) => appRelIds.includes(id))) continue;
    return false;
  }
  // Tag filters (OR within a group, AND across groups) — bucket the flat
  // selection by tag_group_id before matching.
  if (tagFilterIds.length > 0) {
    const appTagIds = new Set(app.tag_ids || []);
    const selectedSet = new Set(tagFilterIds);
    for (const group of tagGroups) {
      const pickedInGroup = group.tags
        .filter((tag) => selectedSet.has(tag.id))
        .map((tag) => tag.id);
      if (pickedInGroup.length === 0) continue;
      if (!pickedInGroup.some((id) => appTagIds.has(id))) return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/*  Tree builder                                                       */
/* ------------------------------------------------------------------ */

interface CapNode extends CapItem {
  children: CapNode[];
  level: number;
  /** Filtered apps directly linked to this capability */
  filteredApps: AppData[];
  /** All unique filtered apps in this node + all descendants (deduplicated) */
  deepUniqueApps: Map<string, AppData>;
  /** Count of unique filtered apps in this subtree */
  deepAppCount: number;
  /** Sum of costs from deepUniqueApps */
  deepCost: number;
  /** Count of apps with endOfLife from deepUniqueApps */
  deepRiskCount: number;
}

function buildTree(
  items: CapItem[],
  attrFilters: Record<string, string[]>,
  relationFilters: Record<string, string[]>,
  tagFilterIds: string[],
  tagGroups: TagGroupDef[],
  timelineDate: number,
  costFieldKeys: string[],
  /** Retiring apps transiently kept visible while a retirement mark's
   *  spotlight runs — the map hides retired apps, so the pulse needs a ghost
   *  to point at. */
  revealedForPulse: Set<string>,
): CapNode[] {
  const nodeMap = new Map<string, CapNode>();
  for (const item of items) {
    const filteredApps = item.apps.filter(
      (a) =>
        matchesFilters(a, attrFilters, relationFilters, tagFilterIds, tagGroups) &&
        (isAliveAtDate(a.lifecycle, timelineDate) || revealedForPulse.has(a.id)),
    );
    nodeMap.set(item.id, {
      ...item,
      children: [],
      level: 0,
      filteredApps,
      deepUniqueApps: new Map(),
      deepAppCount: 0,
      deepCost: 0,
      deepRiskCount: 0,
    });
  }

  // A scope is applied to `items` *before* this runs (see `scopedData`), so a
  // scoped capability's parent is simply absent and it lands here as a root.
  // Re-levelling then falls out of the existing pass below: a scoped L3
  // becomes level 1, so "Display Depth: Level 2" keeps meaning "two tiers from
  // what I'm looking at" wherever the user scoped (#954). Deep metrics follow
  // too — `propagate` only walks these roots, so an application supporting a
  // capability outside the scope drops out of the counts.
  const roots: CapNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parent_id && nodeMap.has(node.parent_id)) {
      nodeMap.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Set levels & sort children. Macro Capabilities (cards with
  // attributes.capabilityLevel === "Macro") sit above L1 and must start at
  // level 0 so their L1 children resolve to level 1 — otherwise the level
  // dropdown ("Level 1" / "Level 2" / …) silently labels every tier one
  // off when macros are present. Mixed roots are OK: only the macro roots
  // start at 0; non-macro roots keep starting at 1.
  function setLevel(nodes: CapNode[], lvl: number) {
    for (const n of nodes) {
      n.level = lvl;
      n.children.sort((a, b) => a.name.localeCompare(b.name));
      setLevel(n.children, lvl + 1);
    }
  }
  roots.sort((a, b) => a.name.localeCompare(b.name));
  const macroRoots = roots.filter((r) => r.attributes?.capabilityLevel === "Macro");
  const nonMacroRoots = roots.filter((r) => r.attributes?.capabilityLevel !== "Macro");
  setLevel(macroRoots, 0);
  setLevel(nonMacroRoots, 1);

  // Propagate unique apps upward (bottom-up) and compute deep metrics.
  function propagate(n: CapNode): Map<string, AppData> {
    const map = new Map<string, AppData>();
    for (const a of n.filteredApps) map.set(a.id, a);
    for (const ch of n.children) {
      for (const [id, a] of propagate(ch)) map.set(id, a);
    }
    n.deepUniqueApps = map;
    n.deepAppCount = map.size;
    n.deepCost = 0;
    n.deepRiskCount = 0;
    for (const app of map.values()) {
      const attrs = app.attributes || {};
      for (const ck of costFieldKeys) {
        n.deepCost += (attrs[ck] as number) || 0;
      }
      if (app.lifecycle?.endOfLife) n.deepRiskCount++;
    }
    return map;
  }
  for (const r of roots) propagate(r);

  return roots;
}

/**
 * Get the apps that should be DISPLAYED at a given node, considering the
 * display level.  Apps are shown at their deepest visible capability only.
 */
function getVisibleApps(node: CapNode, displayLevel: number): AppData[] {
  const isLeaf = node.level >= displayLevel || node.children.length === 0;

  if (isLeaf) {
    return Array.from(node.deepUniqueApps.values());
  }

  // Non-leaf: only show apps that are NOT in any child subtree
  const childAppIds = new Set<string>();
  for (const ch of node.children) {
    for (const id of ch.deepUniqueApps.keys()) childAppIds.add(id);
  }
  return node.filteredApps.filter((a) => !childAppIds.has(a.id));
}

function getMaxLevel(nodes: CapNode[]): number {
  let mx = 0;
  function walk(ns: CapNode[]) {
    for (const n of ns) {
      mx = Math.max(mx, n.level);
      walk(n.children);
    }
  }
  walk(nodes);
  return mx;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function AppChip({
  app,
  colorBy,
  selectFields,
  onClick,
  pulse,
  dimmed,
}: {
  app: AppData;
  colorBy: string;
  selectFields: FieldDef[];
  onClick: () => void;
  /** Mark-click spotlight: this chip's card changes at the clicked mark. */
  pulse?: PulseKind;
  /** A spotlight is running and this chip is not part of it. */
  dimmed?: boolean;
}) {
  // Metamodel Application color (admin-editable) when not coloring by field.
  const { getType } = useMetamodel();
  const appDefault = getType("Application")?.color || CARD_TYPE_COLORS.Application;
  const color = getAppColor(app, colorBy, selectFields, appDefault);
  const colorLabel = getAppColorLabel(app, colorBy, selectFields);
  const light = readableTextColor(color) === "#000000";
  const tip = colorLabel ? `${app.name} \u2014 ${colorLabel}` : app.name;

  return (
    <Tooltip title={tip}>
      <Chip
        size="small"
        label={app.name}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        sx={{
          bgcolor: color,
          color: light ? "#333" : "#fff",
          fontWeight: 500,
          fontSize: "0.7rem",
          maxWidth: 160,
          cursor: "pointer",
          "&:hover": { opacity: 0.85 },
          ...(dimmed && { opacity: 0.3, transition: "opacity 0.2s, box-shadow 0.2s" }),
          ...(pulse && {
            boxShadow: `0 0 0 3px ${PULSE_COLORS[pulse]}55`,
            animation: `tl-pulse-${pulse} 0.65s ease-in-out 2`,
          }),
        }}
      />
    </Tooltip>
  );
}

function CapabilityCard({
  node,
  displayLevel,
  showApps,
  colorBy,
  selectFields,
  metric,
  maxVal,
  onCapClick,
  onAppClick,
  fmtCost,
  pulseCards,
  pulsing,
  pulsedCaps,
}: {
  node: CapNode;
  displayLevel: number;
  showApps: boolean;
  colorBy: string;
  selectFields: FieldDef[];
  metric: Metric;
  maxVal: number;
  onCapClick: (cap: CapNode) => void;
  onAppClick: (id: string) => void;
  fmtCost: (v: number) => string;
  pulseCards: Record<string, PulseKind>;
  pulsing: boolean;
  /** Capability boxes pulsed on behalf of hidden app chips (Show
   *  Applications off) — a ring only, never a dim: dimming a heatmap box
   *  would read as a data change. */
  pulsedCaps: Map<string, ContainerPulseKind>;
}) {
  const { t } = useTranslation(["reports"]);
  const val = nodeMetric(node, metric);
  const fmtVal = (v: number) =>
    metric === "total_cost" ? fmtCost(v) : String(v);

  // Apps to display at THIS node — pushed to deepest visible level
  const visibleApps = useMemo(
    () => getVisibleApps(node, displayLevel),
    [node, displayLevel],
  );

  const boxPulse = pulsedCaps.get(node.id);
  const boxPulseSx = boxPulse
    ? {
        boxShadow: `0 0 0 3px ${PULSE_COLORS[boxPulse]}55`,
        animation: `tl-pulse-${boxPulse} 0.65s ease-in-out 2`,
      }
    : undefined;

  // If this node is at or below the display level, render as a leaf card
  const isLeaf = node.level >= displayLevel || node.children.length === 0;

  if (isLeaf) {
    return (
      <Box
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          overflow: "hidden",
          bgcolor: "background.paper",
          cursor: "pointer",
          transition: "box-shadow 0.2s",
          "&:hover": { boxShadow: 3 },
          ...boxPulseSx,
        }}
        onClick={() => onCapClick(node)}
      >
        <Box
          sx={{
            p: 1.5,
            bgcolor: heatColor(val, maxVal, metric),
            borderBottom:
              showApps && visibleApps.length > 0 ? 1 : "none",
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <Typography
            variant="subtitle2"
            sx={{
              fontWeight: 700,
              flex: 1,
              color: val > maxVal * 0.7 ? "#fff" : "#333",
            }}
            noWrap
          >
            {node.name}
          </Typography>
          <Chip
            size="small"
            label={fmtVal(val)}
            sx={{ height: 20, fontSize: "0.7rem", bgcolor: "rgba(255,255,255,0.7)", color: "#333" }}
          />
          {node.deepRiskCount > 0 && metric !== "risk_count" && (
            <Tooltip title={t("capabilityMap.eolRisk", { count: node.deepRiskCount })}>
              <Box sx={{ display: "flex" }}>
                <MaterialSymbol icon="warning" size={16} color="#e65100" />
              </Box>
            </Tooltip>
          )}
        </Box>

        {/* Show apps — all unique apps from the subtree */}
        {showApps && visibleApps.length > 0 && (
          <Box sx={{ p: 1, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {visibleApps
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((app) => (
                <AppChip
                  key={app.id}
                  app={app}
                  colorBy={colorBy}
                  selectFields={selectFields}
                  onClick={() => onAppClick(app.id)}
                  pulse={pulseCards[app.id]}
                  dimmed={pulsing && !pulseCards[app.id]}
                />
              ))}
          </Box>
        )}
      </Box>
    );
  }

  // Non-leaf: render as a container with children nested inside
  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        overflow: "hidden",
        bgcolor: "background.paper",
        ...boxPulseSx,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 1.5,
          bgcolor: heatColor(val, maxVal, metric),
          borderBottom: 1,
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          gap: 1,
          cursor: "pointer",
          "&:hover": { opacity: 0.9 },
        }}
        onClick={() => onCapClick(node)}
      >
        <Typography
          variant="subtitle2"
          sx={{
            fontWeight: 700,
            flex: 1,
            color: val > maxVal * 0.7 ? "#fff" : "#333",
          }}
          noWrap
        >
          {node.name}
        </Typography>
        <Chip
          size="small"
          label={t("capabilityMap.apps", { count: node.deepAppCount })}
          sx={{ height: 20, fontSize: "0.7rem", bgcolor: "rgba(255,255,255,0.7)", color: "#333" }}
        />
        {node.deepRiskCount > 0 && metric !== "risk_count" && (
          <Tooltip title={t("capabilityMap.eolRisk", { count: node.deepRiskCount })}>
            <Box sx={{ display: "flex" }}>
              <MaterialSymbol icon="warning" size={16} color="#e65100" />
            </Box>
          </Tooltip>
        )}
      </Box>

      {/* Show only this node's own apps that aren't in any child subtree */}
      {showApps && visibleApps.length > 0 && (
        <Box sx={{ px: 1.5, pt: 1, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {visibleApps
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((app) => (
              <AppChip
                key={app.id}
                app={app}
                colorBy={colorBy}
                selectFields={selectFields}
                onClick={() => onAppClick(app.id)}
                pulse={pulseCards[app.id]}
                dimmed={pulsing && !pulseCards[app.id]}
              />
            ))}
        </Box>
      )}

      {/* Children */}
      <Box sx={{ p: 1, display: "flex", flexWrap: "wrap", gap: 1 }}>
        {node.children.map((ch) => (
          <Box key={ch.id} sx={{ flex: "1 1 200px", minWidth: 180, maxWidth: 400 }}>
            <CapabilityCard
              node={ch}
              displayLevel={displayLevel}
              showApps={showApps}
              colorBy={colorBy}
              selectFields={selectFields}
              metric={metric}
              maxVal={maxVal}
              onCapClick={onCapClick}
              onAppClick={onAppClick}
              fmtCost={fmtCost}
              pulseCards={pulseCards}
              pulsing={pulsing}
              pulsedCaps={pulsedCaps}
            />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function CapabilityMapReport() {
  const { t } = useTranslation(["reports", "common"]);
  const { fmtShort } = useCurrency();
  const { types: metamodelTypes } = useMetamodel();
  const typeLabel = useTypeLabel();
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();
  const saved = useSavedReport("capability-map");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() => saved.setSaveDialogOpen(true));

  // Data
  const [data, setData] = useState<CapItem[] | null>(null);
  const [fieldsSchema, setFieldsSchema] = useState<SectionDef[]>([]);
  const [filterableTypes, setFilterableTypes] = useState<Record<string, FilterableTypeRef[]>>({});
  const [drawer, setDrawer] = useState<CapNode | null>(null);
  const [sidePanelCardId, setSidePanelCardId] = useState<string | null>(null);

  // Controls
  const [metric, setMetric] = useState<Metric>("app_count");
  const [displayLevel, setDisplayLevel] = useState(2);
  const [showApps, setShowApps] = useState(false);
  const [colorBy, setColorBy] = useState("");
  // Timeline slider
  const tl = useTimeline();

  // Dynamic filters
  const [attrFilters, setAttrFilters] = useState<Record<string, string[]>>({});
  const [relationFilters, setRelationFilters] = useState<Record<string, string[]>>({});
  const [tagFilterIds, setTagFilterIds] = useState<string[]>([]);
  const [tagGroupsData, setTagGroupsData] = useState<TagGroupDef[]>([]);
  const [showAllRelFilters, setShowAllRelFilters] = useState(false);
  // Fold the filter block away. Expanded by default; persisted with the rest
  // of the report config, so a missing key means expanded.
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);

  // Narrow the map to chosen capabilities and everything beneath them (#954).
  // The heatmap payload is the complete capability set with parent chains, so
  // the hook takes its hierarchy from `data` and issues no fetch of its own.
  const scope = useCardScope({ typeKey: "BusinessCapability", hierarchy: data });
  const { scopeIds, setScopeIds, effectiveScopeIds } = scope;

  // Load saved report config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    tl.restore(cfg?.timelineDate as number | undefined);
    if (cfg) {
      if (cfg.metric) setMetric(cfg.metric as Metric);
      if (cfg.displayLevel != null) setDisplayLevel(cfg.displayLevel as number);
      if (cfg.showApps != null) setShowApps(cfg.showApps as boolean);
      if (cfg.colorBy != null) setColorBy(cfg.colorBy as string);
      if (Array.isArray(cfg.scopeIds)) {
        setScopeIds((cfg.scopeIds as unknown[]).filter((v): v is string => typeof v === "string"));
      }
      if (cfg.attrFilters) setAttrFilters(cfg.attrFilters as Record<string, string[]>);
      if (cfg.relationFilters) setRelationFilters(cfg.relationFilters as Record<string, string[]>);
      if (cfg.filtersCollapsed != null) setFiltersCollapsed(!!cfg.filtersCollapsed);
      // Migrate prior `{groupId: tagIds[]}` shape to a flat `string[]`
      if (cfg.tagFilterIds) {
        setTagFilterIds(cfg.tagFilterIds as string[]);
      } else if (cfg.tagFilters && typeof cfg.tagFilters === "object") {
        const flat: string[] = [];
        for (const vals of Object.values(cfg.tagFilters as Record<string, string[]>)) {
          if (Array.isArray(vals)) flat.push(...vals);
        }
        setTagFilterIds(flat);
      }
      // Backwards compat
      if (cfg.filterOrgs) setRelationFilters((prev) => ({ ...prev, Organization: cfg.filterOrgs as string[] }));
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({ metric, displayLevel, showApps, colorBy, timelineDate: tl.persistValue, attrFilters, relationFilters, tagFilterIds, scopeIds, filtersCollapsed });

  // Auto-persist config to localStorage
  useEffect(() => {
    saved.persistConfig(getConfig());
  }, [metric, displayLevel, showApps, colorBy, tl.timelineDate, attrFilters, relationFilters, tagFilterIds, scopeIds, filtersCollapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset all parameters to defaults
  const handleReset = useCallback(() => {
    saved.resetAll();
    setMetric("app_count");
    setDisplayLevel(2);
    setShowApps(false);
    setColorBy("");
    setScopeIds([]);
    tl.reset();
    setAttrFilters({});
    setRelationFilters({});
    setTagFilterIds([]);
    setShowAllRelFilters(false);
    setFiltersCollapsed(false);
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derived: select fields from schema — resolve labels for the current locale
  const selectFields = useMemo(() => {
    const raw = pickSelectFields(fieldsSchema);
    return raw.map((f) => ({
      ...f,
      label: fieldLabel(f),
      options: f.options?.map((o) => ({
        ...o,
        label: optLabel(o),
      })),
    }));
  }, [fieldsSchema, fieldLabel, optLabel]);

  // Color-by options: all single_select fields + "none"
  const colorByOptions = useMemo(() => {
    const opts: { key: string; label: string }[] = [
      { key: "none", label: t("capabilityMap.noColor") },
    ];
    for (const f of selectFields) {
      opts.push({ key: f.key, label: f.label });
    }
    return opts;
  }, [selectFields, t]);

  // Detect cost field keys from schema for deep cost computation
  const costFieldKeys = useMemo(() => {
    const keys: string[] = [];
    for (const s of fieldsSchema)
      for (const f of s.fields)
        if (f.type === "cost") keys.push(f.key);
    return keys;
  }, [fieldsSchema]);

  // Four setStates, three of them conditional — `useAbortableEffect` rather
  // than `useApiQuery`, so switching metric can't let the previous metric's
  // response land last (#882).
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      const r = await api.get<{
        items: CapItem[];
        filterable_types?: Record<string, FilterableTypeRef[]>;
        fields_schema?: SectionDef[];
        tag_groups?: TagGroupDef[];
      }>(`/reports/capability-heatmap?metric=${metric}`, { signal });
      if (!isCurrent()) return;
      setData(r.items);
      if (r.filterable_types) setFilterableTypes(r.filterable_types);
      if (r.fields_schema) setFieldsSchema(r.fields_schema);
      if (r.tag_groups) setTagGroupsData(r.tag_groups);
    },
    [metric],
  );

  // Compute date range from all app lifecycle dates
  const { dateRange, yearMarks, hasLifecycleData } = useMemo(
    () =>
      computeTimelineRange(
        (data ?? []).flatMap((cap) => cap.apps.map((app) => app.lifecycle)),
        tl.todayMs,
      ),
    [data, tl.todayMs],
  );

  const hasActiveFilters =
    Object.values(attrFilters).some((v) => v.length > 0) ||
    Object.values(relationFilters).some((v) => v.length > 0) ||
    tagFilterIds.length > 0;

  // Report filters the drawer's inventory link carries over. Relation filters
  // are id-keyed here but name-based in the inventory, so they are translated
  // through `filterableTypes`; anything that fails to resolve is dropped,
  // which can only widen the landing, never silently empty it.
  const carriedLinkFilters = useMemo<InventorySliceFilters>(() => {
    const relations: Record<string, string[]> = {};
    for (const [typeKey, ids] of Object.entries(relationFilters)) {
      if (ids.length === 0) continue;
      const members = filterableTypes[typeKey] || [];
      const names = ids
        .map((id) => members.find((m) => m.id === id)?.name)
        .filter((n): n is string => !!n);
      if (names.length > 0) relations[typeKey] = names;
    }
    return { attributes: attrFilters, relations, tagIds: tagFilterIds };
  }, [attrFilters, relationFilters, tagFilterIds, filterableTypes]);

  /**
   * "View in inventory" for the drawer, on LEAF capabilities only.
   *
   * The list shows every app in the node's whole subtree, while the inventory
   * can only filter on a direct relation to one capability — so on a parent
   * the link would land on fewer rows than the panel just listed. A leaf has
   * no descendants, so there the two sets are identical. Same rule the
   * portfolio applies to its nested tree nodes, for the same reason.
   */
  const drawerInventoryHref = useMemo(() => {
    if (!drawer || drawer.children.length > 0) return undefined;
    return buildInventorySliceUrl({
      cardType: "Application",
      mode: { kind: "relation", typeKey: "BusinessCapability" },
      group: { key: drawer.id, label: drawer.name },
      filters: carriedLinkFilters,
    });
  }, [drawer, carriedLinkFilters]);

  // Rows for the capability drawer: every unique app in the subtree.
  const drawerItems = useMemo<ReportCardListItem[]>(() => {
    if (!drawer) return [];
    const coloured = colorBy && colorBy !== "none";
    return Array.from(drawer.deepUniqueApps.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => {
        const parts: string[] = [];
        if (coloured) {
          const label = getAppColorLabel(a, colorBy, selectFields);
          if (label) parts.push(label);
        }
        if (a.lifecycle?.endOfLife) parts.push(`EOL: ${a.lifecycle.endOfLife}`);
        return {
          id: a.id,
          name: a.name,
          secondary: parts.join(" · ") || undefined,
          dotColor: coloured ? getAppColor(a, colorBy, selectFields) : undefined,
          warn: !!a.lifecycle?.endOfLife,
        };
      });
  }, [drawer, colorBy, selectFields]);

  /** Scoped capabilities as picker options, so chips label instantly. */
  const scopeOptions = useMemo<CardScopeOption[]>(() => {
    if (!data) return [];
    return data.map((c) => ({
      id: c.id,
      name: c.name,
      type: "BusinessCapability",
      parent_id: c.parent_id,
    }));
  }, [data]);

  // The heatmap payload is the complete capability set with parent chains, so
  // the hook needs no fetch of its own here.
  const scopedData = useMemo(
    () => (data ? applyScope(data, scope.closure) : null),
    [data, scope.closure],
  );

  // Transition marks, delta and pills are computed from the statically-
  // filtered set (timeline filter NOT applied — what changes over time must
  // not vanish from the track the moment the travelled date hides it),
  // DEDUPED by app id: an app supporting several capabilities appears once
  // per capability in the payload, and counting it per appearance would
  // inflate every mark, pill row and delta chip.
  const milestoneScope = useMemo(() => {
    if (!scopedData) return [];
    const byId = new Map<string, AppData>();
    for (const cap of scopedData) {
      for (const app of cap.apps) {
        if (byId.has(app.id)) continue;
        if (matchesFilters(app, attrFilters, relationFilters, tagFilterIds, tagGroupsData))
          byId.set(app.id, app);
      }
    }
    return [...byId.values()];
  }, [scopedData, attrFilters, relationFilters, tagFilterIds, tagGroupsData]);

  const milestones = useMemo(
    () => computeTimelineMilestones(milestoneScope.map((a) => a.lifecycle)),
    [milestoneScope],
  );

  // Pill accents reuse the report's own colour-by, so the pill row matches
  // the chips it spotlights.
  const appDefaultColor = useMemo(
    () =>
      metamodelTypes.find((tp) => tp.key === "Application")?.color ||
      CARD_TYPE_COLORS.Application,
    [metamodelTypes],
  );
  const milestoneById = useMemo(
    () => new Map(milestoneScope.map((a) => [a.id, a])),
    [milestoneScope],
  );
  const milestoneCardColor = useCallback(
    (id: string) => {
      const app = milestoneById.get(id);
      return app ? getAppColor(app, colorBy, selectFields, appDefaultColor) : undefined;
    },
    [milestoneById, colorBy, selectFields, appDefaultColor],
  );

  const {
    pulseCards,
    revealedForPulse,
    pulsing,
    handleMilestoneClick,
    milestoneCards,
    handleMilestoneCardClick,
  } = useMilestoneSpotlight({ scope: milestoneScope, getColor: milestoneCardColor });

  // The transformation between today and the selected date, over the same
  // scope as the marks and computed BEFORE the alive-at-date filter — hiding
  // retired apps must not make the count lie.
  const timelineDelta = useMemo(() => {
    const at = tl.timelineDate;
    if (at <= tl.todayMs) return { arriving: 0, retiring: 0 };
    let arriving = 0;
    let retiring = 0;
    for (const a of milestoneScope) {
      if (classifyTimelineChange(a.lifecycle, tl.todayMs, at) === "arriving") arriving++;
      else if (isRetiredByDate(a.lifecycle, at) && !isRetiredByDate(a.lifecycle, tl.todayMs))
        retiring++;
    }
    return { arriving, retiring };
  }, [milestoneScope, tl.timelineDate, tl.todayMs]);

  const tree = useMemo(
    () => (scopedData ? buildTree(scopedData, attrFilters, relationFilters, tagFilterIds, tagGroupsData, tl.timelineDate, costFieldKeys, revealedForPulse) : []),
    [scopedData, attrFilters, relationFilters, tagFilterIds, tagGroupsData, tl.timelineDate, costFieldKeys, revealedForPulse],
  );
  const maxLvl = useMemo(() => getMaxLevel(tree), [tree]);

  // With Show Applications off there are no chips to pulse, so a mark-click
  // spotlight falls on the capability boxes instead: each pulsed app lights
  // the DEEPEST VISIBLE box it displays under (the same box its chip would
  // occupy), never the whole ancestor chain. A box holding both an arriving
  // and a retiring app pulses "mixed".
  const pulsedCaps = useMemo(() => {
    const out = new Map<string, ContainerPulseKind>();
    if (!pulsing || showApps) return out;
    const walk = (nodes: CapNode[]) => {
      for (const n of nodes) {
        let live = false;
        let retire = false;
        for (const app of getVisibleApps(n, displayLevel)) {
          const kind = pulseCards[app.id];
          if (kind === "live") live = true;
          else if (kind === "retire") retire = true;
        }
        if (live || retire) out.set(n.id, live && retire ? "mixed" : live ? "live" : "retire");
        // A leaf-rendered node draws no children, so their boxes can't pulse.
        if (n.level < displayLevel && n.children.length > 0) walk(n.children);
      }
    };
    walk(tree);
    return out;
  }, [pulsing, showApps, pulseCards, tree, displayLevel]);

  // Scoping into a shallower branch re-ranges the Display Depth options, which
  // can strand the current value outside them — a MUI Select with no matching
  // MenuItem renders blank and warns. Clamp it back into range. `99`
  // ("all levels") is a sentinel, not a depth, so it is never clamped.
  useEffect(() => {
    if (displayLevel !== 99 && maxLvl > 0 && displayLevel > maxLvl) setDisplayLevel(maxLvl);
  }, [maxLvl, displayLevel]);

  // Compute max metric value for heatmap coloring
  const maxVal = useMemo(() => {
    let mx = 0;
    function walk(nodes: CapNode[]) {
      for (const n of nodes) {
        mx = Math.max(mx, nodeMetric(n, metric));
        walk(n.children);
      }
    }
    walk(tree);
    return mx;
  }, [tree, metric]);

  const fmtVal = useCallback(
    (v: number) => (metric === "total_cost" ? fmtShort(v) : String(v)),
    [metric, fmtShort],
  );

  const handleAppClick = useCallback((id: string) => {
    setDrawer(null);
    setSidePanelCardId(id);
  }, []);

  // Build relation filter options from filterable_types with metamodel labels
  const relationFilterOptions = useMemo(() => {
    const out: { typeKey: string; label: string; options: { key: string; label: string }[] }[] = [];
    for (const [typeKey, members] of Object.entries(filterableTypes)) {
      if (members.length === 0) continue;
      const typeMeta = metamodelTypes.find((t) => t.key === typeKey);
      out.push({
        typeKey,
        label: typeLabel(typeMeta) || typeKey,
        options: members.map((m) => ({ key: m.id, label: m.name })),
      });
    }
    // Sort so Organization comes first if present
    out.sort((a, b) => {
      if (a.typeKey === "Organization") return -1;
      if (b.typeKey === "Organization") return 1;
      return a.typeKey.localeCompare(b.typeKey);
    });
    return out;
  }, [filterableTypes, metamodelTypes, typeLabel]);

  // Level picker options
  const levelOptions = useMemo(() => {
    const opts = [];
    for (let i = 1; i <= Math.max(maxLvl, 2); i++) {
      opts.push({ value: i, label: t("capabilityMap.levelN", { n: i }) });
    }
    opts.push({ value: 99, label: t("capabilityMap.allLevels") });
    return opts;
  }, [maxLvl, t]);

  // Color legend — built dynamically from schema
  const colorLegend = useMemo(() => {
    if (!colorBy || colorBy === "none") return null;
    const fd = selectFields.find((f) => f.key === colorBy);
    if (!fd?.options) return null;
    return fd.options
      .filter((o) => o.color)
      .map((o) => ({ label: o.label, color: o.color! }));
  }, [colorBy, selectFields]);

  const activeFilterCount = Object.values(attrFilters).flat().length + Object.values(relationFilters).flat().length + tagFilterIds.length;
  const printParams = useMemo(() => {
    const params: { label: string; value: string }[] = [];
    const mo = METRIC_OPTIONS.find((o) => o.key === metric);
    const metricLabel = mo ? t(mo.labelKey) : metric;
    params.push({ label: t("common.metric"), value: metricLabel });
    const depthLabel = levelOptions.find((o) => o.value === displayLevel)?.label || "";
    params.push({ label: t("common.depth"), value: depthLabel });
    if (effectiveScopeIds.length > 0) {
      params.push({
        label: t("common.scope"),
        value: t("capabilityMap.scopeCount", { count: effectiveScopeIds.length }),
      });
    }
    if (showApps) params.push({ label: t("common.showApps"), value: t("common:labels.yes") });
    if (showApps && colorBy && colorBy !== "none") {
      const cLabel = colorByOptions.find((o) => o.key === colorBy)?.label || "";
      params.push({ label: t("common.colorBy"), value: cLabel });
    }
    if (tl.printParam) params.push(tl.printParam);
    if (timelineDelta.arriving > 0 || timelineDelta.retiring > 0)
      params.push({
        label: t("common:timelineSlider.deltaLabel"),
        value: `+${timelineDelta.arriving} / −${timelineDelta.retiring}`,
      });
    if (activeFilterCount > 0) params.push({ label: t("common.filters"), value: t("common.filtersActive", { count: activeFilterCount }) });
    return params;
  }, [metric, displayLevel, showApps, colorBy, colorByOptions, levelOptions, tl.printParam, timelineDelta, activeFilterCount, effectiveScopeIds, t]);

  if (data === null)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );

  return (
    <ReportShell
      title={t("capabilityMap.title")}
      icon="grid_view"
      iconColor={
        metamodelTypes.find((tp) => tp.key === "BusinessCapability")?.color ||
        CARD_TYPE_COLORS.BusinessCapability
      }
      hasTableToggle={false}
      paginateRowSelector="[data-export-row]"
      chartRef={chartRef}
      onSaveReport={captureAndSave}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      onReset={handleReset}
      printParams={printParams}
      toolbar={
        <>
          {/* Row 1: Main controls */}
          <TextField
            select
            size="small"
            label={t("capabilityMap.heatmapMetric")}
            value={metric}
            onChange={(e) => setMetric(e.target.value as Metric)}
            sx={{ minWidth: 180 }}
          >
            {METRIC_OPTIONS.map((o) => (
              <MenuItem key={o.key} value={o.key}>
                {t(o.labelKey)}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            size="small"
            label={t("capabilityMap.displayDepth")}
            value={displayLevel}
            onChange={(e) => setDisplayLevel(Number(e.target.value))}
            sx={{ minWidth: 140 }}
          >
            {levelOptions.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>

          {/* Scopes the *capabilities* the map draws, so it belongs up here
              with the other structural controls — not in the Application
              Filters block below, which narrows the apps inside them. */}
          <CardScopeFilter
            types="BusinessCapability"
            value={effectiveScopeIds}
            onChange={setScopeIds}
            labelAll={t("capabilityMap.scopeAll")}
            labelCount={(count) => t("capabilityMap.scopeCount", { count })}
            dialogTitle={t("capabilityMap.scopeDialogTitle")}
            helperText={t("capabilityMap.scopeHelper")}
            tooltip={t("capabilityMap.scopeTooltip")}
            initialOptions={scopeOptions}
          />

          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={showApps}
                onChange={(_, v) => setShowApps(v)}
              />
            }
            label={
              <Typography variant="body2" color="text.secondary">
                {t("capabilityMap.showApplications")}
              </Typography>
            }
          />

          {showApps && (
            <TextField
              select
              size="small"
              label={t("capabilityMap.colorAppsBy")}
              value={colorBy || "none"}
              onChange={(e) => setColorBy(e.target.value === "none" ? "" : e.target.value)}
              sx={{ minWidth: 180 }}
            >
              {colorByOptions.map((o) => (
                <MenuItem key={o.key} value={o.key}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          )}

          {/* Timeline slider */}
          {hasLifecycleData && (
            <TimelineSlider
              value={tl.timelineDate}
              onChange={tl.setTimelineDate}
              dateRange={dateRange}
              yearMarks={yearMarks}
              todayMs={tl.todayMs}
              milestones={milestones}
              delta={timelineDelta}
              onMilestoneClick={handleMilestoneClick}
              milestoneCards={milestoneCards}
              onMilestoneCardClick={handleMilestoneCardClick}
            />
          )}

          {/* Row 2: Dynamic application filters — collapsible, state
              persisted as filtersCollapsed */}
          {(showApps || hasActiveFilters) && (
            <ReportFilterSection
              label={t("capabilityMap.applicationFilters")}
              collapsed={filtersCollapsed}
              onToggle={() => setFiltersCollapsed((v) => !v)}
              count={activeFilterCount}
              clearAllLabel={hasActiveFilters ? t("capabilityMap.clearAll") : undefined}
              onClearAll={
                hasActiveFilters
                  ? () => {
                      setAttrFilters({});
                      setRelationFilters({});
                      setTagFilterIds([]);
                    }
                  : undefined
              }
            >
              {/* Related By section */}
              {relationFilterOptions.length > 0 && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    flexWrap: "wrap",
                    bgcolor: "action.hover",
                    borderRadius: 1.5,
                    px: 1.5,
                    py: 0.75,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary", fontWeight: 600, fontSize: "0.7rem", whiteSpace: "nowrap" }}
                  >
                    {t("capabilityMap.relatedBy")}
                  </Typography>
                  {relationFilterOptions.slice(0, showAllRelFilters ? undefined : 2).map((rf) => (
                    <FilterSelect
                      key={rf.typeKey}
                      label={rf.label}
                      options={rf.options}
                      value={relationFilters[rf.typeKey] || []}
                      onChange={(v) =>
                        setRelationFilters((prev) => ({ ...prev, [rf.typeKey]: v }))
                      }
                    />
                  ))}
                  {!showAllRelFilters && relationFilterOptions.length > 2 && (
                    <Tooltip title={t("capabilityMap.showMore", { count: relationFilterOptions.length - 2 })}>
                      <Chip
                        size="small"
                        icon={<MaterialSymbol icon="add" size={14} />}
                        label={t("capabilityMap.more", { count: relationFilterOptions.length - 2 })}
                        onClick={() => setShowAllRelFilters(true)}
                        sx={{
                          height: 26,
                          fontSize: "0.72rem",
                          fontWeight: 500,
                          cursor: "pointer",
                          bgcolor: "background.paper",
                          border: "1px dashed",
                          borderColor: "divider",
                          "&:hover": { bgcolor: "action.hover" },
                        }}
                      />
                    </Tooltip>
                  )}
                  {showAllRelFilters && relationFilterOptions.length > 2 && (
                    <Chip
                      size="small"
                      label={t("capabilityMap.less")}
                      onClick={() => setShowAllRelFilters(false)}
                      sx={{
                        height: 26,
                        fontSize: "0.72rem",
                        cursor: "pointer",
                        bgcolor: "background.paper",
                        border: 1,
                        borderColor: "divider",
                      }}
                    />
                  )}
                </Box>
              )}

              {/* Tags section */}
              {tagGroupsData.length > 0 && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    flexWrap: "wrap",
                    bgcolor: "action.hover",
                    borderRadius: 1.5,
                    px: 1.5,
                    py: 0.75,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary", fontWeight: 600, fontSize: "0.7rem", whiteSpace: "nowrap" }}
                  >
                    {t("capabilityMap.tags")}
                  </Typography>
                  <TagPicker
                    groups={tagGroupsData as unknown as TagGroup[]}
                    value={tagFilterIds}
                    onChange={setTagFilterIds}
                    size="small"
                    label={t("capabilityMap.tags")}
                    placeholder=""
                    sx={{ minWidth: 180, maxWidth: 320 }}
                  />
                </Box>
              )}

              {/* Own Fields section */}
              {selectFields.filter((f) => f.options && f.options.length > 0).length > 0 && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    flexWrap: "wrap",
                    bgcolor: "action.hover",
                    borderRadius: 1.5,
                    px: 1.5,
                    py: 0.75,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary", fontWeight: 600, fontSize: "0.7rem", whiteSpace: "nowrap" }}
                  >
                    {t("capabilityMap.fields")}
                  </Typography>
                  {selectFields
                    .filter((f) => f.options && f.options.length > 0)
                    .map((f) => (
                      <FilterSelect
                        key={f.key}
                        label={f.label}
                        options={(f.options || []).map((o) => ({
                          key: o.key,
                          label: o.label,
                          color: o.color,
                        }))}
                        value={attrFilters[f.key] || []}
                        onChange={(v) =>
                          setAttrFilters((prev) => ({ ...prev, [f.key]: v }))
                        }
                      />
                    ))}
                </Box>
              )}
            </ReportFilterSection>
          )}
        </>
      }
      legend={
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
          {/* Heatmap gradient legend */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {t("capabilityMap.low")}
            </Typography>
            <Box sx={{ display: "flex", height: 12 }}>
              {[0, 0.25, 0.5, 0.75, 1].map((r) => (
                <Box
                  key={r}
                  sx={{
                    width: 28,
                    height: 12,
                    bgcolor: heatColor(r * maxVal, maxVal, metric),
                  }}
                />
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary">
              {t("capabilityMap.high")}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {t("capabilityMap.max", { value: fmtVal(maxVal) })}
            </Typography>
          </Box>

          {/* App color legend — dynamic from schema */}
          {showApps && colorBy && colorLegend && colorLegend.length > 0 && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, ml: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                {colorByOptions.find((o) => o.key === colorBy)?.label}:
              </Typography>
              {colorLegend.map((item) => (
                <Box
                  key={item.label}
                  sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                >
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      bgcolor: item.color,
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {item.label}
                  </Typography>
                </Box>
              ))}
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: UNSET_COLOR,
                    flexShrink: 0,
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  {t("capabilityMap.notSet")}
                </Typography>
              </Box>
            </Box>
          )}
        </Box>
      }
    >
      {pulsing && <style>{TIMELINE_PULSE_KEYFRAMES}</style>}
      {tree.length === 0 ? (
        <Box sx={{ py: 8, textAlign: "center" }}>
          <Typography color="text.secondary">
            {t("capabilityMap.noCapabilities")}
          </Typography>
        </Box>
      ) : (
        <Box
          className={displayLevel <= 1 ? "report-print-grid-4" : "report-print-grid-3"}
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "1fr 1fr",
              md: displayLevel <= 1 ? "1fr 1fr 1fr" : "1fr 1fr",
              lg: displayLevel <= 1 ? "1fr 1fr 1fr 1fr" : "1fr 1fr 1fr",
            },
            gap: 2,
          }}
        >
          {tree.map((cap) => (
            <Box key={cap.id} data-export-row>
              <CapabilityCard
                node={cap}
                displayLevel={displayLevel}
                showApps={showApps}
                colorBy={colorBy}
                selectFields={selectFields}
                metric={metric}
                maxVal={maxVal}
                onCapClick={setDrawer}
                onAppClick={handleAppClick}
                fmtCost={fmtShort}
                pulseCards={pulseCards}
                pulsing={pulsing}
                pulsedCaps={pulsedCaps}
              />
            </Box>
          ))}
        </Box>
      )}

      {/* Detail drawer */}
      <ReportCardListPanel
        open={!!drawer}
        title={drawer?.name ?? ""}
        items={drawerItems}
        metrics={METRIC_OPTIONS.map((o) => ({
          value: drawer
            ? o.key === "total_cost"
              ? fmtShort(nodeMetric(drawer, o.key))
              : nodeMetric(drawer, o.key)
            : 0,
          label: t(o.labelKey),
        }))}
        beforeList={
          drawer && drawer.children.length > 0 ? (
            <>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                {t("capabilityMap.subCapabilities", { count: drawer.children.length })}
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2 }}>
                {drawer.children.map((ch) => (
                  <Chip
                    key={ch.id}
                    size="small"
                    label={`${ch.name} (${ch.deepAppCount})`}
                    // Re-targets the drawer at the child node — navigation,
                    // not a card click, so it stays out of `items`.
                    onClick={() => setDrawer(ch)}
                    sx={{ fontWeight: 500, fontSize: "0.75rem", cursor: "pointer" }}
                  />
                ))}
              </Box>
            </>
          ) : undefined
        }
        inventoryHref={drawerInventoryHref}
        listHeading={t("capabilityMap.supportingApps", { count: drawer?.deepAppCount ?? 0 })}
        emptyLabel={
          hasActiveFilters
            ? t("capabilityMap.noAppsFiltered")
            : t("capabilityMap.noLinkedApps")
        }
        onItemClick={handleAppClick}
        onClose={() => setDrawer(null)}
      />
      <CardDetailSidePanel
        cardId={sidePanelCardId}
        open={!!sidePanelCardId}
        onClose={() => setSidePanelCardId(null)}
      />
      <SaveReportDialog
        open={saved.saveDialogOpen}
        onClose={() => saved.setSaveDialogOpen(false)}
        reportType="capability-map"
        config={getConfig()}
        thumbnail={thumbnail}
      />
    </ReportShell>
  );
}
