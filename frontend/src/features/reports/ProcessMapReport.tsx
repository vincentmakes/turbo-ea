/**
 * ProcessMapReport — Hierarchical process landscape map.
 *
 * Shows BusinessProcess hierarchy (Category → Group → Process → Variant)
 * with heatmap coloring, related applications/data objects, and
 * drill-down filtering by Organization or Business Context.
 *
 * Modeled after CapabilityMapReport.
 */
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
import Autocomplete from "@mui/material/Autocomplete";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Link from "@mui/material/Link";
import { useNavigate } from "react-router-dom";
import ReportShell from "./ReportShell";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useCurrency } from "@/hooks/useCurrency";
import { useSavedReport } from "@/hooks/useSavedReport";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AppData {
  id: string;
  name: string;
  subtype?: string;
  attributes?: Record<string, unknown>;
  lifecycle?: Record<string, string>;
  rel_attributes?: Record<string, unknown>;
}

interface DataObjRef {
  id: string;
  name: string;
}

interface ProcItem {
  id: string;
  name: string;
  subtype?: string;
  parent_id: string | null;
  attributes?: Record<string, unknown>;
  lifecycle?: Record<string, string>;
  app_count: number;
  total_cost: number;
  apps: AppData[];
  data_objects: DataObjRef[];
  org_ids: string[];
  ctx_ids: string[];
}

interface RefItem {
  id: string;
  name: string;
}

type Metric = "app_count" | "maturity" | "automation" | "risk" | "total_cost";

type ShowRelated = "none" | "apps" | "data_objects";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const METRIC_OPTIONS: { key: Metric; label: string; icon: string }[] = [
  { key: "app_count", label: "Application Count", icon: "apps" },
  { key: "maturity", label: "Maturity (CMMI)", icon: "trending_up" },
  { key: "automation", label: "Automation Level", icon: "precision_manufacturing" },
  { key: "risk", label: "Risk Level", icon: "warning" },
  { key: "total_cost", label: "Total Cost", icon: "payments" },
];

const MATURITY_MAP: Record<string, { order: number; label: string; color: string }> = {
  initial: { order: 1, label: "1 - Initial", color: "#d32f2f" },
  managed: { order: 2, label: "2 - Managed", color: "#f57c00" },
  defined: { order: 3, label: "3 - Defined", color: "#fbc02d" },
  measured: { order: 4, label: "4 - Measured", color: "#66bb6a" },
  optimized: { order: 5, label: "5 - Optimized", color: "#2e7d32" },
};

const AUTOMATION_MAP: Record<string, { order: number; label: string; color: string }> = {
  manual: { order: 1, label: "Manual", color: "#d32f2f" },
  partially: { order: 2, label: "Partially Automated", color: "#f57c00" },
  fully: { order: 3, label: "Fully Automated", color: "#2e7d32" },
};

const RISK_MAP: Record<string, { order: number; label: string; color: string }> = {
  low: { order: 1, label: "Low", color: "#66bb6a" },
  medium: { order: 2, label: "Medium", color: "#fbc02d" },
  high: { order: 3, label: "High", color: "#f57c00" },
  critical: { order: 4, label: "Critical", color: "#d32f2f" },
};

const PROCESS_TYPE_MAP: Record<string, { label: string; color: string }> = {
  core: { label: "Core", color: "#1976d2" },
  support: { label: "Support", color: "#7b1fa2" },
  management: { label: "Management", color: "#00695c" },
};

const SUBTYPE_LABELS: Record<string, string> = {
  category: "Category",
  group: "Group",
  process: "Process",
  variant: "Variant",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function metricValue(attrs: Record<string, unknown>, metric: Metric, appCount: number, totalCost: number): number {
  if (metric === "app_count") return appCount;
  if (metric === "total_cost") return totalCost;
  if (metric === "maturity") return MATURITY_MAP[attrs.maturity as string]?.order ?? 0;
  if (metric === "automation") return AUTOMATION_MAP[attrs.automationLevel as string]?.order ?? 0;
  if (metric === "risk") return RISK_MAP[attrs.riskLevel as string]?.order ?? 0;
  return 0;
}

function heatColor(value: number, max: number, metric: Metric): string {
  if (max === 0 || value === 0) return "#f5f5f5";
  const ratio = Math.min(value / max, 1);

  // Risk: white → red
  if (metric === "risk") {
    const r = Math.round(255 - ratio * 55);
    const g = Math.round(255 - ratio * 207);
    const b = Math.round(255 - ratio * 215);
    return `rgb(${r},${g},${b})`;
  }
  // Maturity/automation: white → green (higher is better)
  if (metric === "maturity" || metric === "automation") {
    const r = Math.round(255 - ratio * 213);
    const g = Math.round(255 - ratio * 130);
    const b = Math.round(255 - ratio * 210);
    return `rgb(${r},${g},${b})`;
  }
  // App count / cost: white → blue
  const r = Math.round(227 - ratio * 202);
  const g = Math.round(242 - ratio * 152);
  const b = Math.round(253 - ratio * 51);
  return `rgb(${r},${g},${b})`;
}

function metricLabel(attrs: Record<string, unknown>, metric: Metric, appCount: number, fmtCost: (v: number) => string, totalCost: number): string {
  if (metric === "app_count") return String(appCount);
  if (metric === "total_cost") return fmtCost(totalCost);
  if (metric === "maturity") return MATURITY_MAP[attrs.maturity as string]?.label ?? "—";
  if (metric === "automation") return AUTOMATION_MAP[attrs.automationLevel as string]?.label ?? "—";
  if (metric === "risk") return RISK_MAP[attrs.riskLevel as string]?.label ?? "—";
  return "—";
}

/* ------------------------------------------------------------------ */
/*  Tree builder                                                       */
/* ------------------------------------------------------------------ */

interface ProcNode extends ProcItem {
  children: ProcNode[];
  level: number;
  deepAppCount: number;
  deepCost: number;
  deepUniqueApps: Map<string, AppData>;
  deepDataObjects: Map<string, DataObjRef>;
}

function buildTree(
  items: ProcItem[],
  orgFilter: string[],
  ctxFilter: string[],
): ProcNode[] {
  // Filter by org / context if active
  let filtered = items;
  if (orgFilter.length > 0) {
    filtered = filtered.filter((p) => p.org_ids.some((o) => orgFilter.includes(o)));
  }
  if (ctxFilter.length > 0) {
    filtered = filtered.filter((p) => p.ctx_ids.some((c) => ctxFilter.includes(c)));
  }

  // Also include ancestor processes for filtered items so hierarchy is maintained
  const filteredIds = new Set(filtered.map((p) => p.id));
  const itemMap = new Map(items.map((p) => [p.id, p]));

  function addAncestors(id: string | null) {
    if (!id) return;
    if (filteredIds.has(id)) return;
    const item = itemMap.get(id);
    if (!item) return;
    filteredIds.add(id);
    filtered.push(item);
    addAncestors(item.parent_id);
  }
  for (const p of [...filtered]) addAncestors(p.parent_id);

  const nodeMap = new Map<string, ProcNode>();
  for (const item of filtered) {
    nodeMap.set(item.id, {
      ...item,
      children: [],
      level: 0,
      deepAppCount: 0,
      deepCost: 0,
      deepUniqueApps: new Map(),
      deepDataObjects: new Map(),
    });
  }

  const roots: ProcNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parent_id && nodeMap.has(node.parent_id)) {
      nodeMap.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function setLevel(nodes: ProcNode[], lvl: number) {
    for (const n of nodes) {
      n.level = lvl;
      n.children.sort((a, b) => a.name.localeCompare(b.name));
      setLevel(n.children, lvl + 1);
    }
  }
  roots.sort((a, b) => a.name.localeCompare(b.name));
  setLevel(roots, 1);

  // Propagate apps and data objects upward
  function propagate(n: ProcNode): { apps: Map<string, AppData>; dos: Map<string, DataObjRef> } {
    const appMap = new Map<string, AppData>();
    const doMap = new Map<string, DataObjRef>();
    for (const a of n.apps) appMap.set(a.id, a);
    for (const d of n.data_objects) doMap.set(d.id, d);
    for (const ch of n.children) {
      const child = propagate(ch);
      for (const [id, a] of child.apps) appMap.set(id, a);
      for (const [id, d] of child.dos) doMap.set(id, d);
    }
    n.deepUniqueApps = appMap;
    n.deepDataObjects = doMap;
    n.deepAppCount = appMap.size;
    n.deepCost = 0;
    for (const app of appMap.values()) {
      const attrs = app.attributes || {};
      n.deepCost += ((attrs.costTotalAnnual as number) || (attrs.totalAnnualCost as number) || 0);
    }
    return { apps: appMap, dos: doMap };
  }
  for (const r of roots) propagate(r);

  return roots;
}

function getVisibleApps(node: ProcNode, displayLevel: number): AppData[] {
  const isLeaf = node.level >= displayLevel || node.children.length === 0;
  if (isLeaf) return Array.from(node.deepUniqueApps.values());
  const childAppIds = new Set<string>();
  for (const ch of node.children) {
    for (const id of ch.deepUniqueApps.keys()) childAppIds.add(id);
  }
  return node.apps.filter((a) => !childAppIds.has(a.id));
}

function getVisibleDataObjects(node: ProcNode, displayLevel: number): DataObjRef[] {
  const isLeaf = node.level >= displayLevel || node.children.length === 0;
  if (isLeaf) return Array.from(node.deepDataObjects.values());
  const childDoIds = new Set<string>();
  for (const ch of node.children) {
    for (const id of ch.deepDataObjects.keys()) childDoIds.add(id);
  }
  return node.data_objects.filter((d) => !childDoIds.has(d.id));
}

function getMaxLevel(nodes: ProcNode[]): number {
  let mx = 0;
  function walk(ns: ProcNode[]) {
    for (const n of ns) {
      mx = Math.max(mx, n.level);
      walk(n.children);
    }
  }
  walk(nodes);
  return mx;
}

/** Find a node by id in a tree */
function findNode(nodes: ProcNode[], id: string): ProcNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

/** Get ancestor chain from root to the node (inclusive) */
function getAncestors(nodes: ProcNode[], id: string): ProcNode[] {
  function search(ns: ProcNode[], path: ProcNode[]): ProcNode[] | null {
    for (const n of ns) {
      const cur = [...path, n];
      if (n.id === id) return cur;
      const found = search(n.children, cur);
      if (found) return found;
    }
    return null;
  }
  return search(nodes, []) ?? [];
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ProcessCard({
  node,
  displayLevel,
  showRelated,
  metric,
  maxVal,
  onProcClick,
  onItemClick,
  fmtCost,
}: {
  node: ProcNode;
  displayLevel: number;
  showRelated: ShowRelated;
  metric: Metric;
  maxVal: number;
  onProcClick: (p: ProcNode) => void;
  onItemClick: (id: string) => void;
  fmtCost: (v: number) => string;
}) {
  const attrs = node.attributes || {};
  const val = metricValue(attrs, metric, node.deepAppCount, node.deepCost);
  const label = metricLabel(attrs, metric, node.deepAppCount, fmtCost, node.deepCost);
  const isLeaf = node.level >= displayLevel || node.children.length === 0;

  const visibleApps = useMemo(
    () => (showRelated === "apps" ? getVisibleApps(node, displayLevel) : []),
    [node, displayLevel, showRelated],
  );
  const visibleDOs = useMemo(
    () => (showRelated === "data_objects" ? getVisibleDataObjects(node, displayLevel) : []),
    [node, displayLevel, showRelated],
  );

  const subtypeLabel = SUBTYPE_LABELS[node.subtype || ""] || null;
  const processType = PROCESS_TYPE_MAP[attrs.processType as string];
  const isHighContrast = val > maxVal * 0.65 && maxVal > 0;

  const relatedChips = showRelated === "apps" ? visibleApps : showRelated === "data_objects" ? visibleDOs : [];

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
        onClick={() => onProcClick(node)}
      >
        <Box
          sx={{
            p: 1.5,
            bgcolor: heatColor(val, maxVal, metric),
            borderBottom: relatedChips.length > 0 ? "1px solid #e0e0e0" : "none",
            display: "flex",
            alignItems: "center",
            gap: 0.5,
          }}
        >
          <Typography
            variant="subtitle2"
            sx={{ fontWeight: 700, flex: 1, color: isHighContrast ? "#fff" : "#333" }}
            noWrap
          >
            {node.name}
          </Typography>
          {subtypeLabel && (
            <Chip size="small" label={subtypeLabel} sx={{ height: 18, fontSize: "0.65rem", bgcolor: "rgba(255,255,255,0.6)" }} />
          )}
          {processType && (
            <Chip size="small" label={processType.label}
              sx={{ height: 18, fontSize: "0.65rem", bgcolor: processType.color, color: "#fff" }} />
          )}
          <Chip size="small" label={label}
            sx={{ height: 20, fontSize: "0.7rem", bgcolor: "rgba(255,255,255,0.7)" }} />
        </Box>

        {relatedChips.length > 0 && (
          <Box sx={{ p: 1, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {(relatedChips as Array<{ id: string; name: string }>)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((item) => (
                <Tooltip key={item.id} title={item.name}>
                  <Chip
                    size="small"
                    label={item.name}
                    onClick={(e) => { e.stopPropagation(); onItemClick(item.id); }}
                    sx={{
                      fontWeight: 500,
                      fontSize: "0.7rem",
                      maxWidth: 160,
                      cursor: "pointer",
                      bgcolor: showRelated === "apps" ? "#0f7eb5" : "#774fcc",
                      color: "#fff",
                      "&:hover": { opacity: 0.85 },
                    }}
                  />
                </Tooltip>
              ))}
          </Box>
        )}
      </Box>
    );
  }

  // Non-leaf container
  return (
    <Box sx={{ border: "1px solid #d0d0d0", borderRadius: 2, overflow: "hidden", bgcolor: "#fff" }}>
      <Box
        sx={{
          p: 1.5,
          bgcolor: heatColor(val, maxVal, metric),
          borderBottom: "1px solid #d0d0d0",
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          cursor: "pointer",
          "&:hover": { opacity: 0.9 },
        }}
        onClick={() => onProcClick(node)}
      >
        <Typography
          variant="subtitle2"
          sx={{ fontWeight: 700, flex: 1, color: isHighContrast ? "#fff" : "#333" }}
          noWrap
        >
          {node.name}
        </Typography>
        {subtypeLabel && (
          <Chip size="small" label={subtypeLabel} sx={{ height: 18, fontSize: "0.65rem", bgcolor: "rgba(255,255,255,0.6)" }} />
        )}
        <Chip size="small" label={`${node.deepAppCount} apps`}
          sx={{ height: 20, fontSize: "0.7rem", bgcolor: "rgba(255,255,255,0.7)" }} />
      </Box>

      {relatedChips.length > 0 && (
        <Box sx={{ px: 1.5, pt: 1, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {(relatedChips as Array<{ id: string; name: string }>)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((item) => (
              <Tooltip key={item.id} title={item.name}>
                <Chip
                  size="small"
                  label={item.name}
                  onClick={(e) => { e.stopPropagation(); onItemClick(item.id); }}
                  sx={{
                    fontWeight: 500,
                    fontSize: "0.7rem",
                    maxWidth: 160,
                    cursor: "pointer",
                    bgcolor: showRelated === "apps" ? "#0f7eb5" : "#774fcc",
                    color: "#fff",
                    "&:hover": { opacity: 0.85 },
                  }}
                />
              </Tooltip>
            ))}
        </Box>
      )}

      <Box sx={{ p: 1, display: "flex", flexWrap: "wrap", gap: 1 }}>
        {node.children.map((ch) => (
          <Box key={ch.id} sx={{ flex: "1 1 200px", minWidth: 180, maxWidth: 400 }}>
            <ProcessCard
              node={ch}
              displayLevel={displayLevel}
              showRelated={showRelated}
              metric={metric}
              maxVal={maxVal}
              onProcClick={onProcClick}
              onItemClick={onItemClick}
              fmtCost={fmtCost}
            />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function FilterSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <Autocomplete
      multiple
      size="small"
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
              sx={{ fontWeight: 500, fontSize: "0.72rem" }}
            />
          );
        })
      }
      renderInput={(params) => <TextField {...params} label={label} />}
      sx={{ minWidth: 200, maxWidth: 320 }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function ProcessMapReport() {
  const navigate = useNavigate();
  const { fmtShort } = useCurrency();
  const saved = useSavedReport("process-map");

  // Data
  const [data, setData] = useState<ProcItem[] | null>(null);
  const [organizations, setOrganizations] = useState<RefItem[]>([]);
  const [contexts, setContexts] = useState<RefItem[]>([]);
  const [drawer, setDrawer] = useState<ProcNode | null>(null);

  // Controls
  const [metric, setMetric] = useState<Metric>("maturity");
  const [displayLevel, setDisplayLevel] = useState(2);
  const [showRelated, setShowRelated] = useState<ShowRelated>("none");

  // Drill-down: zoom into a subtree
  const [zoomNodeId, setZoomNodeId] = useState<string | null>(null);

  // Filters
  const [filterOrgs, setFilterOrgs] = useState<string[]>([]);
  const [filterCtxs, setFilterCtxs] = useState<string[]>([]);

  // Load saved/local config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    if (cfg) {
      if (cfg.metric) setMetric(cfg.metric as Metric);
      if (cfg.displayLevel != null) setDisplayLevel(cfg.displayLevel as number);
      if (cfg.showRelated) setShowRelated(cfg.showRelated as ShowRelated);
      if (cfg.filterOrgs) setFilterOrgs(cfg.filterOrgs as string[]);
      if (cfg.filterCtxs) setFilterCtxs(cfg.filterCtxs as string[]);
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({ metric, displayLevel, showRelated, filterOrgs, filterCtxs });

  // Auto-persist config to localStorage
  useEffect(() => {
    saved.persistConfig(getConfig());
  }, [metric, displayLevel, showRelated, filterOrgs, filterCtxs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset all parameters to defaults
  const handleReset = useCallback(() => {
    saved.resetAll();
    setMetric("maturity");
    setDisplayLevel(2);
    setShowRelated("none");
    setZoomNodeId(null);
    setFilterOrgs([]);
    setFilterCtxs([]);
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get<{ items: ProcItem[]; organizations: RefItem[]; business_contexts: RefItem[] }>(
      "/reports/bpm/process-map",
    ).then((r) => {
      setData(r.items);
      setOrganizations(r.organizations ?? []);
      setContexts(r.business_contexts ?? []);
    });
  }, []);

  // Build full tree (with filters applied)
  const fullTree = useMemo(
    () => (data ? buildTree(data, filterOrgs, filterCtxs) : []),
    [data, filterOrgs, filterCtxs],
  );

  // If zoomed, find the subtree root and render only its children
  const { displayTree, breadcrumbs } = useMemo(() => {
    if (!zoomNodeId) return { displayTree: fullTree, breadcrumbs: [] as ProcNode[] };
    const ancestors = getAncestors(fullTree, zoomNodeId);
    const zoomNode = findNode(fullTree, zoomNodeId);
    if (!zoomNode) return { displayTree: fullTree, breadcrumbs: [] as ProcNode[] };
    // Show the zoomed node's children (or itself if leaf)
    return {
      displayTree: zoomNode.children.length > 0 ? zoomNode.children : [zoomNode],
      breadcrumbs: ancestors,
    };
  }, [fullTree, zoomNodeId]);

  const maxLvl = useMemo(() => getMaxLevel(fullTree), [fullTree]);

  // Compute max metric value across visible tree
  const maxVal = useMemo(() => {
    let mx = 0;
    function walk(nodes: ProcNode[]) {
      for (const n of nodes) {
        const attrs = n.attributes || {};
        mx = Math.max(mx, metricValue(attrs, metric, n.deepAppCount, n.deepCost));
        walk(n.children);
      }
    }
    walk(displayTree);
    return mx;
  }, [displayTree, metric]);

  const fmtVal = useCallback(
    (v: number) => (metric === "total_cost" ? fmtShort(v) : String(v)),
    [metric, fmtShort],
  );

  const handleItemClick = useCallback(
    (id: string) => {
      setDrawer(null);
      navigate(`/cards/${id}`);
    },
    [navigate],
  );

  // When clicking a process card: open drawer. Double-click (or drill-down button) to zoom.
  const handleProcClick = useCallback((node: ProcNode) => {
    setDrawer(node);
  }, []);

  const handleDrillDown = useCallback((id: string) => {
    setZoomNodeId(id);
    setDrawer(null);
  }, []);

  const orgOptions = useMemo(
    () => organizations.map((o) => ({ key: o.id, label: o.name })),
    [organizations],
  );
  const ctxOptions = useMemo(
    () => contexts.map((c) => ({ key: c.id, label: c.name })),
    [contexts],
  );

  const levelOptions = useMemo(() => {
    const opts = [];
    for (let i = 1; i <= Math.max(maxLvl, 2); i++) {
      opts.push({ value: i, label: `Level ${i}` });
    }
    opts.push({ value: 99, label: "All levels" });
    return opts;
  }, [maxLvl]);

  const hasActiveFilters = filterOrgs.length > 0 || filterCtxs.length > 0;

  // Legend based on metric
  const metricLegend = useMemo(() => {
    if (metric === "maturity") return Object.values(MATURITY_MAP);
    if (metric === "automation") return Object.values(AUTOMATION_MAP);
    if (metric === "risk") return Object.values(RISK_MAP);
    return null;
  }, [metric]);

  const showRelatedLabel = showRelated === "none" ? "" : showRelated === "apps" ? "Applications" : "Data Objects";
  const printParams = useMemo(() => {
    const params: { label: string; value: string }[] = [];
    const metricLabel = METRIC_OPTIONS.find((o) => o.key === metric)?.label || metric;
    params.push({ label: "Metric", value: metricLabel });
    const depthLabel = levelOptions.find((o) => o.value === displayLevel)?.label || "";
    params.push({ label: "Depth", value: depthLabel });
    if (showRelated !== "none") params.push({ label: "Show Related", value: showRelatedLabel });
    if (filterOrgs.length > 0) {
      const orgNames = filterOrgs.map((id) => orgOptions.find((o) => o.key === id)?.label || id).join(", ");
      params.push({ label: "Organization", value: orgNames });
    }
    if (filterCtxs.length > 0) {
      const ctxNames = filterCtxs.map((id) => ctxOptions.find((o) => o.key === id)?.label || id).join(", ");
      params.push({ label: "Business Context", value: ctxNames });
    }
    return params;
  }, [metric, displayLevel, showRelated, showRelatedLabel, filterOrgs, orgOptions, filterCtxs, ctxOptions, levelOptions]);

  if (data === null)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );

  return (
    <ReportShell
      title="Process Landscape Map"
      icon="account_tree"
      iconColor="#e65100"
      hasTableToggle={false}
      onReset={handleReset}
      printParams={printParams}
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
              <MenuItem key={o.key} value={o.key}>{o.label}</MenuItem>
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
              <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
            ))}
          </TextField>

          <TextField
            select
            size="small"
            label="Show Related"
            value={showRelated}
            onChange={(e) => setShowRelated(e.target.value as ShowRelated)}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="none">None</MenuItem>
            <MenuItem value="apps">Applications</MenuItem>
            <MenuItem value="data_objects">Data Objects</MenuItem>
          </TextField>

          {/* Row 2: Scope filters */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              flexWrap: "wrap",
              width: "100%",
              pt: 0.5,
            }}
          >
            <MaterialSymbol icon="filter_alt" size={18} color="#999" />
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              Scope:
            </Typography>
            {organizations.length > 0 && (
              <FilterSelect label="Organization" options={orgOptions} value={filterOrgs} onChange={setFilterOrgs} />
            )}
            {contexts.length > 0 && (
              <FilterSelect label="Business Context" options={ctxOptions} value={filterCtxs} onChange={setFilterCtxs} />
            )}

            {hasActiveFilters && (
              <Chip
                size="small"
                label="Clear all"
                variant="outlined"
                onDelete={() => { setFilterOrgs([]); setFilterCtxs([]); }}
                sx={{ fontSize: "0.72rem" }}
              />
            )}
          </Box>
        </>
      }
      legend={
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
          {metricLegend ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                {METRIC_OPTIONS.find((o) => o.key === metric)?.label}:
              </Typography>
              {metricLegend.map((item) => (
                <Box key={item.label} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: item.color, flexShrink: 0 }} />
                  <Typography variant="caption" color="text.secondary">{item.label}</Typography>
                </Box>
              ))}
            </Box>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography variant="caption" color="text.secondary">Low</Typography>
              <Box sx={{ display: "flex", height: 12 }}>
                {[0, 0.25, 0.5, 0.75, 1].map((r) => (
                  <Box key={r} sx={{ width: 28, height: 12, bgcolor: heatColor(r * maxVal, maxVal, metric) }} />
                ))}
              </Box>
              <Typography variant="caption" color="text.secondary">High</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                Max: {fmtVal(maxVal)}
              </Typography>
            </Box>
          )}

          {/* Process type legend */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, ml: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>Type:</Typography>
            {Object.values(PROCESS_TYPE_MAP).map((pt) => (
              <Box key={pt.label} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: pt.color, flexShrink: 0 }} />
                <Typography variant="caption" color="text.secondary">{pt.label}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      }
    >
      {/* Breadcrumb drill-down navigation */}
      {zoomNodeId && breadcrumbs.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Breadcrumbs>
            <Link
              component="button"
              variant="body2"
              underline="hover"
              onClick={() => setZoomNodeId(null)}
              sx={{ cursor: "pointer" }}
            >
              All Processes
            </Link>
            {breadcrumbs.map((bc, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return isLast ? (
                <Typography key={bc.id} variant="body2" color="text.primary" sx={{ fontWeight: 600 }}>
                  {bc.name}
                </Typography>
              ) : (
                <Link
                  key={bc.id}
                  component="button"
                  variant="body2"
                  underline="hover"
                  onClick={() => setZoomNodeId(bc.id)}
                  sx={{ cursor: "pointer" }}
                >
                  {bc.name}
                </Link>
              );
            })}
          </Breadcrumbs>
        </Box>
      )}

      {displayTree.length === 0 ? (
        <Box sx={{ py: 8, textAlign: "center" }}>
          <MaterialSymbol icon="route" size={48} color="#999" />
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {hasActiveFilters
              ? "No processes match the current filters."
              : "No Business Processes found. Add processes to see the landscape map."}
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
          {displayTree.map((proc) => (
            <ProcessCard
              key={proc.id}
              node={proc}
              displayLevel={displayLevel}
              showRelated={showRelated}
              metric={metric}
              maxVal={maxVal}
              onProcClick={handleProcClick}
              onItemClick={handleItemClick}
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
            <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
                {drawer.name}
              </Typography>
              <IconButton onClick={() => setDrawer(null)} size="small">
                <MaterialSymbol icon="close" size={20} />
              </IconButton>
            </Box>

            {/* Metadata chips */}
            <Box sx={{ display: "flex", gap: 0.5, mb: 2, flexWrap: "wrap" }}>
              {drawer.subtype && SUBTYPE_LABELS[drawer.subtype] && (
                <Chip size="small" label={SUBTYPE_LABELS[drawer.subtype]} variant="outlined" />
              )}
              {PROCESS_TYPE_MAP[(drawer.attributes?.processType as string) || ""] && (
                <Chip size="small"
                  label={PROCESS_TYPE_MAP[(drawer.attributes?.processType as string) || ""].label}
                  sx={{
                    bgcolor: PROCESS_TYPE_MAP[(drawer.attributes?.processType as string) || ""].color,
                    color: "#fff",
                  }}
                />
              )}
              {MATURITY_MAP[(drawer.attributes?.maturity as string) || ""] && (
                <Chip size="small"
                  label={MATURITY_MAP[(drawer.attributes?.maturity as string) || ""].label}
                  sx={{
                    bgcolor: MATURITY_MAP[(drawer.attributes?.maturity as string) || ""].color,
                    color: "#fff",
                  }}
                />
              )}
              {RISK_MAP[(drawer.attributes?.riskLevel as string) || ""] && (
                <Chip size="small"
                  label={`Risk: ${RISK_MAP[(drawer.attributes?.riskLevel as string) || ""].label}`}
                  sx={{
                    bgcolor: RISK_MAP[(drawer.attributes?.riskLevel as string) || ""].color,
                    color: "#fff",
                  }}
                />
              )}
              {AUTOMATION_MAP[(drawer.attributes?.automationLevel as string) || ""] && (
                <Chip size="small"
                  label={AUTOMATION_MAP[(drawer.attributes?.automationLevel as string) || ""].label}
                  variant="outlined"
                />
              )}
            </Box>

            {/* Metric summary */}
            <Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap" }}>
              <Box sx={{ textAlign: "center", minWidth: 80 }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{drawer.deepAppCount}</Typography>
                <Typography variant="caption" color="text.secondary">Applications</Typography>
              </Box>
              <Box sx={{ textAlign: "center", minWidth: 80 }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{drawer.deepDataObjects.size}</Typography>
                <Typography variant="caption" color="text.secondary">Data Objects</Typography>
              </Box>
              <Box sx={{ textAlign: "center", minWidth: 80 }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{fmtShort(drawer.deepCost)}</Typography>
                <Typography variant="caption" color="text.secondary">Cost</Typography>
              </Box>
            </Box>

            {/* Actions */}
            <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
              <Chip
                size="small"
                icon={<MaterialSymbol icon="open_in_new" size={14} />}
                label="Open Card"
                onClick={() => handleItemClick(drawer.id)}
                sx={{ cursor: "pointer" }}
              />
              {drawer.children.length > 0 && (
                <Chip
                  size="small"
                  icon={<MaterialSymbol icon="zoom_in" size={14} />}
                  label="Drill Down"
                  onClick={() => handleDrillDown(drawer.id)}
                  sx={{ cursor: "pointer" }}
                  color="primary"
                />
              )}
            </Box>

            {/* Sub-processes */}
            {drawer.children.length > 0 && (
              <>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  Sub-Processes ({drawer.children.length})
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

            {/* Applications */}
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              Applications ({drawer.deepAppCount})
            </Typography>
            <List dense>
              {Array.from(drawer.deepUniqueApps.values())
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((a) => (
                  <ListItemButton key={a.id} onClick={() => handleItemClick(a.id)}>
                    <ListItemText
                      primary={a.name}
                      secondary={a.subtype || undefined}
                    />
                    {a.lifecycle?.endOfLife && (
                      <MaterialSymbol icon="warning" size={16} color="#e65100" />
                    )}
                  </ListItemButton>
                ))}
              {drawer.deepAppCount === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ py: 1, textAlign: "center" }}>
                  No linked applications
                </Typography>
              )}
            </List>

            {/* Data Objects */}
            {drawer.deepDataObjects.size > 0 && (
              <>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, mt: 2 }}>
                  Data Objects ({drawer.deepDataObjects.size})
                </Typography>
                <List dense>
                  {Array.from(drawer.deepDataObjects.values())
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((d) => (
                      <ListItemButton key={d.id} onClick={() => handleItemClick(d.id)}>
                        <ListItemText primary={d.name} />
                      </ListItemButton>
                    ))}
                </List>
              </>
            )}
          </Box>
        )}
      </Drawer>
    </ReportShell>
  );
}
