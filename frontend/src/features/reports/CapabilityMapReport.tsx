import { useEffect, useState, useMemo, useCallback } from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Autocomplete from "@mui/material/Autocomplete";
import { useNavigate } from "react-router-dom";
import ReportShell from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";
import TimelineSlider from "@/components/TimelineSlider";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useCurrency } from "@/hooks/useCurrency";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FieldOption {
  key: string;
  label: string;
  color?: string;
}

interface FieldDef {
  key: string;
  label: string;
  type: string;
  options?: FieldOption[];
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

const METRIC_OPTIONS: { key: Metric; label: string; icon: string }[] = [
  { key: "app_count", label: "Application Count", icon: "apps" },
  { key: "total_cost", label: "Total Cost", icon: "payments" },
  { key: "risk_count", label: "Risk (EOL count)", icon: "warning" },
];

const UNSET_COLOR = "#e0e0e0";

const LIFECYCLE_PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function pickSelectFields(schema: SectionDef[]): FieldDef[] {
  const out: FieldDef[] = [];
  for (const s of schema)
    for (const f of s.fields) if (f.type === "single_select") out.push(f);
  return out;
}

function parseDate(s: string | undefined): number | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
}

/** An app is "alive" at a date if it has started (earliest phase <= date) and hasn't been retired (endOfLife > date). */
function isAppAliveAtDate(app: AppData, dateMs: number): boolean {
  const lc = app.lifecycle;
  if (!lc) return true;
  const dates = LIFECYCLE_PHASES.map((p) => parseDate(lc[p])).filter((d): d is number => d != null);
  if (dates.length === 0) return true;
  if (Math.min(...dates) > dateMs) return false;
  const eol = parseDate(lc.endOfLife);
  if (eol != null && eol <= dateMs) return false;
  return true;
}

function nodeMetric(node: CapNode, metric: Metric): number {
  if (metric === "app_count") return node.deepAppCount;
  if (metric === "total_cost") return node.deepCost;
  if (metric === "risk_count") return node.deepRiskCount;
  return 0;
}

function heatColor(value: number, max: number, metric: Metric): string {
  if (max === 0) return "#f5f5f5";
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
): string {
  if (!colorBy || colorBy === "none") return "#0f7eb5";
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
  if (!val) return "Not set";
  const fd = selectFields.find((f) => f.key === colorBy);
  const opt = fd?.options?.find((o) => o.key === val);
  return opt?.label || val;
}

/** Compute perceived luminance to decide text color */
function isLightColor(hex: string): boolean {
  const c = hex.replace("#", "");
  if (c.length < 6) return true;
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

/** Filter an app based on active attribute and relation filters */
function matchesFilters(
  app: AppData,
  attrFilters: Record<string, string[]>,
  relationFilters: Record<string, string[]>,
  timelineDate: number,
): boolean {
  if (!isAppAliveAtDate(app, timelineDate)) return false;
  // Attribute filters
  const attrs = app.attributes || {};
  for (const [key, vals] of Object.entries(attrFilters)) {
    if (vals.length > 0 && !vals.includes(attrs[key] as string)) return false;
  }
  // Relation filters (e.g. Organization, Platform, etc.)
  const byType = app.related_by_type || {};
  for (const [typeKey, ids] of Object.entries(relationFilters)) {
    if (ids.length > 0) {
      const appRelIds = byType[typeKey] || app.org_ids || [];
      if (!ids.some((id) => appRelIds.includes(id))) return false;
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
  timelineDate: number,
  costFieldKeys: string[],
): CapNode[] {
  const nodeMap = new Map<string, CapNode>();
  for (const item of items) {
    const filteredApps = item.apps.filter((a) =>
      matchesFilters(a, attrFilters, relationFilters, timelineDate),
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

  const roots: CapNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parent_id && nodeMap.has(node.parent_id)) {
      nodeMap.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Set levels & sort children
  function setLevel(nodes: CapNode[], lvl: number) {
    for (const n of nodes) {
      n.level = lvl;
      n.children.sort((a, b) => a.name.localeCompare(b.name));
      setLevel(n.children, lvl + 1);
    }
  }
  roots.sort((a, b) => a.name.localeCompare(b.name));
  setLevel(roots, 1);

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
}: {
  app: AppData;
  colorBy: string;
  selectFields: FieldDef[];
  onClick: () => void;
}) {
  const color = getAppColor(app, colorBy, selectFields);
  const colorLabel = getAppColorLabel(app, colorBy, selectFields);
  const light = isLightColor(color);
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
}) {
  const val = nodeMetric(node, metric);
  const fmtVal = (v: number) =>
    metric === "total_cost" ? fmtCost(v) : String(v);

  // Apps to display at THIS node — pushed to deepest visible level
  const visibleApps = useMemo(
    () => getVisibleApps(node, displayLevel),
    [node, displayLevel],
  );

  // If this node is at or below the display level, render as a leaf card
  const isLeaf = node.level >= displayLevel || node.children.length === 0;

  if (isLeaf) {
    return (
      <Box
        sx={{
          border: "1px solid #e0e0e0",
          borderRadius: 2,
          overflow: "hidden",
          bgcolor: "#fff",
          cursor: "pointer",
          transition: "box-shadow 0.2s",
          "&:hover": { boxShadow: 3 },
        }}
        onClick={() => onCapClick(node)}
      >
        <Box
          sx={{
            p: 1.5,
            bgcolor: heatColor(val, maxVal, metric),
            borderBottom:
              showApps && visibleApps.length > 0 ? "1px solid #e0e0e0" : "none",
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
            sx={{ height: 20, fontSize: "0.7rem", bgcolor: "rgba(255,255,255,0.7)" }}
          />
          {node.deepRiskCount > 0 && metric !== "risk_count" && (
            <Tooltip title={`${node.deepRiskCount} EOL risk`}>
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
        border: "1px solid #d0d0d0",
        borderRadius: 2,
        overflow: "hidden",
        bgcolor: "#fff",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 1.5,
          bgcolor: heatColor(val, maxVal, metric),
          borderBottom: "1px solid #d0d0d0",
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
          label={`${node.deepAppCount} apps`}
          sx={{ height: 20, fontSize: "0.7rem", bgcolor: "rgba(255,255,255,0.7)" }}
        />
        {node.deepRiskCount > 0 && metric !== "risk_count" && (
          <Tooltip title={`${node.deepRiskCount} EOL risk`}>
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
            />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Filter chip selector (reusable for each attribute filter)          */
/* ------------------------------------------------------------------ */

function FilterSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: string; label: string; color?: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <Autocomplete
      multiple
      size="small"
      limitTags={1}
      options={options.map((o) => o.key)}
      getOptionLabel={(key) => options.find((o) => o.key === key)?.label ?? key}
      value={value}
      onChange={(_, v) => onChange(v)}
      disableCloseOnSelect
      renderTags={(vals, getTagProps) =>
        vals.map((key, i) => {
          const opt = options.find((o) => o.key === key);
          return (
            <Chip
              size="small"
              label={opt?.label ?? key}
              {...getTagProps({ index: i })}
              key={key}
              sx={{
                bgcolor: opt?.color ?? undefined,
                color: opt?.color ? "#fff" : undefined,
                fontWeight: 500,
                fontSize: "0.7rem",
                height: 22,
                maxWidth: 110,
              }}
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={value.length === 0 ? "All" : ""}
        />
      )}
      sx={{ width: 180 }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function CapabilityMapReport() {
  const navigate = useNavigate();
  const { fmtShort } = useCurrency();
  const { types: metamodelTypes } = useMetamodel();
  const saved = useSavedReport("capability-map");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() => saved.setSaveDialogOpen(true));

  // Data
  const [data, setData] = useState<CapItem[] | null>(null);
  const [fieldsSchema, setFieldsSchema] = useState<SectionDef[]>([]);
  const [filterableTypes, setFilterableTypes] = useState<Record<string, FilterableTypeRef[]>>({});
  const [drawer, setDrawer] = useState<CapNode | null>(null);

  // Controls
  const [metric, setMetric] = useState<Metric>("app_count");
  const [displayLevel, setDisplayLevel] = useState(2);
  const [showApps, setShowApps] = useState(false);
  const [colorBy, setColorBy] = useState("");

  // Timeline slider
  const todayMs = useMemo(() => Date.now(), []);
  const [timelineDate, setTimelineDate] = useState(todayMs);

  // Dynamic filters
  const [attrFilters, setAttrFilters] = useState<Record<string, string[]>>({});
  const [relationFilters, setRelationFilters] = useState<Record<string, string[]>>({});
  const [showAllRelFilters, setShowAllRelFilters] = useState(false);

  // Load saved report config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    if (cfg) {
      if (cfg.metric) setMetric(cfg.metric as Metric);
      if (cfg.displayLevel != null) setDisplayLevel(cfg.displayLevel as number);
      if (cfg.showApps != null) setShowApps(cfg.showApps as boolean);
      if (cfg.colorBy != null) setColorBy(cfg.colorBy as string);
      if (cfg.timelineDate) setTimelineDate(cfg.timelineDate as number);
      if (cfg.attrFilters) setAttrFilters(cfg.attrFilters as Record<string, string[]>);
      if (cfg.relationFilters) setRelationFilters(cfg.relationFilters as Record<string, string[]>);
      // Backwards compat
      if (cfg.filterOrgs) setRelationFilters((prev) => ({ ...prev, Organization: cfg.filterOrgs as string[] }));
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({ metric, displayLevel, showApps, colorBy, timelineDate, attrFilters, relationFilters });

  // Auto-persist config to localStorage
  useEffect(() => {
    saved.persistConfig(getConfig());
  }, [metric, displayLevel, showApps, colorBy, timelineDate, attrFilters, relationFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset all parameters to defaults
  const handleReset = useCallback(() => {
    saved.resetAll();
    setMetric("app_count");
    setDisplayLevel(2);
    setShowApps(false);
    setColorBy("");
    setTimelineDate(Date.now());
    setAttrFilters({});
    setRelationFilters({});
    setShowAllRelFilters(false);
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derived: select fields from schema
  const selectFields = useMemo(() => pickSelectFields(fieldsSchema), [fieldsSchema]);

  // Color-by options: all single_select fields + "none"
  const colorByOptions = useMemo(() => {
    const opts: { key: string; label: string }[] = [
      { key: "none", label: "No color" },
    ];
    for (const f of selectFields) {
      opts.push({ key: f.key, label: f.label });
    }
    return opts;
  }, [selectFields]);

  // Detect cost field keys from schema for deep cost computation
  const costFieldKeys = useMemo(() => {
    const keys: string[] = [];
    for (const s of fieldsSchema)
      for (const f of s.fields)
        if (f.type === "cost") keys.push(f.key);
    return keys;
  }, [fieldsSchema]);

  useEffect(() => {
    api
      .get<{
        items: CapItem[];
        filterable_types?: Record<string, FilterableTypeRef[]>;
        fields_schema?: SectionDef[];
      }>(
        `/reports/capability-heatmap?metric=${metric}`,
      )
      .then((r) => {
        setData(r.items);
        if (r.filterable_types) setFilterableTypes(r.filterable_types);
        if (r.fields_schema) setFieldsSchema(r.fields_schema);
      });
  }, [metric]);

  // Compute date range from all app lifecycle dates
  const { dateRange, yearMarks } = useMemo(() => {
    const now = todayMs;
    const pad3y = 3 * 365.25 * 86400000;
    if (!data)
      return { dateRange: { min: now - pad3y, max: now + pad3y }, yearMarks: [] as { value: number; label: string }[] };

    let minD = Infinity, maxD = -Infinity;
    for (const cap of data) {
      for (const app of cap.apps) {
        const lc = app.lifecycle || {};
        for (const p of LIFECYCLE_PHASES) {
          const d = parseDate(lc[p]);
          if (d != null) { minD = Math.min(minD, d); maxD = Math.max(maxD, d); }
        }
      }
    }
    if (minD === Infinity)
      return { dateRange: { min: now - pad3y, max: now + pad3y }, yearMarks: [] as { value: number; label: string }[] };

    const pad = 365.25 * 86400000;
    minD -= pad; maxD += pad;
    const marks: { value: number; label: string }[] = [];
    const sy = new Date(minD).getFullYear(), ey = new Date(maxD).getFullYear();
    for (let y = sy; y <= ey + 1; y++) {
      const t = new Date(y, 0, 1).getTime();
      if (t >= minD && t <= maxD) marks.push({ value: t, label: String(y) });
    }
    return { dateRange: { min: minD, max: maxD }, yearMarks: marks };
  }, [data, todayMs]);

  const hasLifecycleData = useMemo(() => {
    if (!data) return false;
    return data.some((cap) =>
      cap.apps.some((app) => app.lifecycle && LIFECYCLE_PHASES.some((p) => app.lifecycle?.[p])),
    );
  }, [data]);

  const hasActiveFilters =
    Object.values(attrFilters).some((v) => v.length > 0) ||
    Object.values(relationFilters).some((v) => v.length > 0);

  const tree = useMemo(
    () => (data ? buildTree(data, attrFilters, relationFilters, timelineDate, costFieldKeys) : []),
    [data, attrFilters, relationFilters, timelineDate, costFieldKeys],
  );
  const maxLvl = useMemo(() => getMaxLevel(tree), [tree]);

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

  const handleAppClick = useCallback(
    (id: string) => {
      setDrawer(null);
      navigate(`/cards/${id}`);
    },
    [navigate],
  );

  // Build relation filter options from filterable_types with metamodel labels
  const relationFilterOptions = useMemo(() => {
    const out: { typeKey: string; label: string; options: { key: string; label: string }[] }[] = [];
    for (const [typeKey, members] of Object.entries(filterableTypes)) {
      if (members.length === 0) continue;
      const typeMeta = metamodelTypes.find((t) => t.key === typeKey);
      out.push({
        typeKey,
        label: typeMeta?.label || typeKey,
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
  }, [filterableTypes, metamodelTypes]);

  // Level picker options
  const levelOptions = useMemo(() => {
    const opts = [];
    for (let i = 1; i <= Math.max(maxLvl, 2); i++) {
      opts.push({ value: i, label: `Level ${i}` });
    }
    opts.push({ value: 99, label: "All levels" });
    return opts;
  }, [maxLvl]);

  // Color legend — built dynamically from schema
  const colorLegend = useMemo(() => {
    if (!colorBy || colorBy === "none") return null;
    const fd = selectFields.find((f) => f.key === colorBy);
    if (!fd?.options) return null;
    return fd.options
      .filter((o) => o.color)
      .map((o) => ({ label: o.label, color: o.color! }));
  }, [colorBy, selectFields]);

  if (data === null)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );

  return (
    <ReportShell
      title="Business Capability Map"
      icon="grid_view"
      iconColor="#003399"
      hasTableToggle={false}
      chartRef={chartRef}
      onSaveReport={captureAndSave}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      onReset={handleReset}
      toolbar={
        <>
          {/* Row 1: Main controls */}
          <TextField
            select
            size="small"
            label="Heatmap Metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value as Metric)}
            sx={{ minWidth: 180 }}
          >
            {METRIC_OPTIONS.map((o) => (
              <MenuItem key={o.key} value={o.key}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            size="small"
            label="Display Depth"
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
                Show Applications
              </Typography>
            }
          />

          {showApps && (
            <TextField
              select
              size="small"
              label="Color Apps By"
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
              value={timelineDate}
              onChange={setTimelineDate}
              dateRange={dateRange}
              yearMarks={yearMarks}
              todayMs={todayMs}
            />
          )}

          {/* Row 2: Dynamic application filters */}
          {(showApps || hasActiveFilters) && (
            <Box sx={{ width: "100%", pt: 0.5 }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  mb: 1,
                }}
              >
                <MaterialSymbol icon="filter_alt" size={16} color="#999" />
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                  Application Filters
                </Typography>
                {hasActiveFilters && (
                  <Chip
                    size="small"
                    label="Clear all"
                    variant="outlined"
                    onDelete={() => {
                      setAttrFilters({});
                      setRelationFilters({});
                    }}
                    sx={{ fontSize: "0.7rem", height: 22, ml: 0.5 }}
                  />
                )}
              </Box>
              <Box
                sx={{
                  display: "flex",
                  gap: 2,
                  flexWrap: "wrap",
                }}
              >
                {/* Related By section */}
                {relationFilterOptions.length > 0 && (
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      flexWrap: "wrap",
                      bgcolor: "#f8f9fb",
                      borderRadius: 1.5,
                      px: 1.5,
                      py: 0.75,
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{ color: "#666", fontWeight: 600, fontSize: "0.7rem", whiteSpace: "nowrap" }}
                    >
                      Related By
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
                      <Tooltip title={`Show ${relationFilterOptions.length - 2} more relation filters`}>
                        <Chip
                          size="small"
                          icon={<MaterialSymbol icon="add" size={14} />}
                          label={`${relationFilterOptions.length - 2} more`}
                          onClick={() => setShowAllRelFilters(true)}
                          sx={{
                            height: 26,
                            fontSize: "0.72rem",
                            fontWeight: 500,
                            cursor: "pointer",
                            bgcolor: "#fff",
                            border: "1px dashed #bbb",
                            "&:hover": { bgcolor: "#f0f0f0" },
                          }}
                        />
                      </Tooltip>
                    )}
                    {showAllRelFilters && relationFilterOptions.length > 2 && (
                      <Chip
                        size="small"
                        label="Less"
                        onClick={() => setShowAllRelFilters(false)}
                        sx={{
                          height: 26,
                          fontSize: "0.72rem",
                          cursor: "pointer",
                          bgcolor: "#fff",
                          border: "1px solid #ddd",
                        }}
                      />
                    )}
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
                      bgcolor: "#f8fbf8",
                      borderRadius: 1.5,
                      px: 1.5,
                      py: 0.75,
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{ color: "#666", fontWeight: 600, fontSize: "0.7rem", whiteSpace: "nowrap" }}
                    >
                      Fields
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
              </Box>
            </Box>
          )}
        </>
      }
      legend={
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
          {/* Heatmap gradient legend */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Low
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
              High
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              Max: {fmtVal(maxVal)}
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
                  Not set
                </Typography>
              </Box>
            </Box>
          )}
        </Box>
      }
    >
      {tree.length === 0 ? (
        <Box sx={{ py: 8, textAlign: "center" }}>
          <Typography color="text.secondary">
            No Business Capabilities found. Add capabilities to see the heatmap.
          </Typography>
        </Box>
      ) : (
        <Box
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
            <CapabilityCard
              key={cap.id}
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
            />
          ))}
        </Box>
      )}

      {/* Detail drawer */}
      <Drawer
        anchor="right"
        open={!!drawer}
        onClose={() => setDrawer(null)}
        PaperProps={{ sx: { width: { xs: "100%", sm: 420 } } }}
      >
        {drawer && (
          <Box sx={{ p: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
                {drawer.name}
              </Typography>
              <IconButton onClick={() => setDrawer(null)}>
                <MaterialSymbol icon="close" size={20} />
              </IconButton>
            </Box>

            {/* Metric summary */}
            <Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap" }}>
              {METRIC_OPTIONS.map((o) => (
                <Box key={o.key} sx={{ textAlign: "center", minWidth: 80 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    {o.key === "total_cost"
                      ? fmtShort(nodeMetric(drawer, o.key))
                      : nodeMetric(drawer, o.key)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {o.label}
                  </Typography>
                </Box>
              ))}
            </Box>

            {/* Sub-capabilities */}
            {drawer.children.length > 0 && (
              <>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  Sub-Capabilities ({drawer.children.length})
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2 }}>
                  {drawer.children.map((ch) => (
                    <Chip
                      key={ch.id}
                      size="small"
                      label={`${ch.name} (${ch.deepAppCount})`}
                      onClick={() => setDrawer(ch)}
                      sx={{ fontWeight: 500, fontSize: "0.75rem", cursor: "pointer" }}
                    />
                  ))}
                </Box>
              </>
            )}

            {/* Supporting applications — all unique apps in the subtree */}
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              Supporting Applications ({drawer.deepAppCount})
            </Typography>
            <List dense>
              {Array.from(drawer.deepUniqueApps.values())
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((a) => {
                  // Build secondary text dynamically from colorBy field
                  const parts: string[] = [];
                  if (colorBy && colorBy !== "none") {
                    const lbl = getAppColorLabel(a, colorBy, selectFields);
                    if (lbl && lbl !== "Not set") parts.push(lbl);
                  }
                  if (a.lifecycle?.endOfLife)
                    parts.push(`EOL: ${a.lifecycle.endOfLife}`);

                  return (
                    <ListItemButton key={a.id} onClick={() => handleAppClick(a.id)}>
                      <ListItemText
                        primary={a.name}
                        secondary={parts.join(" \u00B7 ") || undefined}
                      />
                      {colorBy && colorBy !== "none" && (
                        <Box
                          sx={{
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            bgcolor: getAppColor(a, colorBy, selectFields),
                            flexShrink: 0,
                            ml: 1,
                          }}
                        />
                      )}
                      {a.lifecycle?.endOfLife && (
                        <MaterialSymbol icon="warning" size={16} color="#e65100" />
                      )}
                    </ListItemButton>
                  );
                })}
              {drawer.filteredApps.length === 0 && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ py: 2, textAlign: "center" }}
                >
                  {hasActiveFilters
                    ? "No applications match current filters"
                    : "No linked applications"}
                </Typography>
              )}
            </List>
          </Box>
        )}
      </Drawer>
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
