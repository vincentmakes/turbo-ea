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
import TimelineSlider from "@/components/TimelineSlider";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useCurrency } from "@/hooks/useCurrency";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AppData {
  id: string;
  name: string;
  subtype?: string;
  attributes?: Record<string, unknown>;
  lifecycle?: Record<string, string>;
  org_ids: string[];
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

interface OrgRef {
  id: string;
  name: string;
}

type Metric = "app_count" | "total_cost" | "risk_count";

type AppColorBy =
  | "none"
  | "timeModel"
  | "businessCriticality"
  | "functionalSuitability"
  | "technicalSuitability"
  | "hostingType";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const METRIC_OPTIONS: { key: Metric; label: string; icon: string }[] = [
  { key: "app_count", label: "Application Count", icon: "apps" },
  { key: "total_cost", label: "Total Cost", icon: "payments" },
  { key: "risk_count", label: "Risk (EOL count)", icon: "warning" },
];

const APP_COLOR_OPTIONS: { key: AppColorBy; label: string }[] = [
  { key: "none", label: "No color" },
  { key: "timeModel", label: "TIME Model" },
  { key: "businessCriticality", label: "Business Criticality" },
  { key: "functionalSuitability", label: "Functional Suitability" },
  { key: "technicalSuitability", label: "Technical Suitability" },
  { key: "hostingType", label: "Hosting Type" },
];

/** Well-known option colors from the seed metamodel */
const ATTRIBUTE_COLORS: Record<string, Record<string, { label: string; color: string }>> = {
  timeModel: {
    tolerate: { label: "Tolerate", color: "#ff9800" },
    invest: { label: "Invest", color: "#4caf50" },
    migrate: { label: "Migrate", color: "#2196f3" },
    eliminate: { label: "Eliminate", color: "#d32f2f" },
  },
  businessCriticality: {
    missionCritical: { label: "Mission Critical", color: "#d32f2f" },
    businessCritical: { label: "Business Critical", color: "#f57c00" },
    businessOperational: { label: "Business Operational", color: "#fbc02d" },
    administrativeService: { label: "Administrative", color: "#9e9e9e" },
  },
  functionalSuitability: {
    perfect: { label: "Perfect", color: "#2e7d32" },
    appropriate: { label: "Appropriate", color: "#66bb6a" },
    insufficient: { label: "Insufficient", color: "#f57c00" },
    unreasonable: { label: "Unreasonable", color: "#d32f2f" },
  },
  technicalSuitability: {
    fullyAppropriate: { label: "Fully Appropriate", color: "#2e7d32" },
    adequate: { label: "Adequate", color: "#66bb6a" },
    unreasonable: { label: "Unreasonable", color: "#f57c00" },
    inappropriate: { label: "Inappropriate", color: "#d32f2f" },
  },
  hostingType: {
    onPremise: { label: "On-Premise", color: "#5c6bc0" },
    cloudSaaS: { label: "Cloud (SaaS)", color: "#26a69a" },
    cloudPaaS: { label: "Cloud (PaaS)", color: "#42a5f5" },
    cloudIaaS: { label: "Cloud (IaaS)", color: "#7e57c2" },
    hybrid: { label: "Hybrid", color: "#ff7043" },
  },
};

const UNSET_COLOR = "#e0e0e0";

const LIFECYCLE_PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

function getAppColor(app: AppData, colorBy: AppColorBy): string {
  if (colorBy === "none") return "#0f7eb5";
  const val = (app.attributes || {})[colorBy] as string | undefined;
  if (!val) return UNSET_COLOR;
  return ATTRIBUTE_COLORS[colorBy]?.[val]?.color ?? UNSET_COLOR;
}

function getAppColorLabel(app: AppData, colorBy: AppColorBy): string | null {
  if (colorBy === "none") return null;
  const val = (app.attributes || {})[colorBy] as string | undefined;
  if (!val) return "Not set";
  return ATTRIBUTE_COLORS[colorBy]?.[val]?.label ?? val;
}

/** Filter an app based on active filters */
function matchesFilters(
  app: AppData,
  filters: FilterState,
): boolean {
  // Timeline filter
  if (!isAppAliveAtDate(app, filters.timelineDate)) return false;
  if (filters.orgIds.length > 0 && !filters.orgIds.some((o) => app.org_ids.includes(o)))
    return false;
  const attrs = app.attributes || {};
  if (filters.timeModel.length > 0 && !filters.timeModel.includes(attrs.timeModel as string))
    return false;
  if (
    filters.businessCriticality.length > 0 &&
    !filters.businessCriticality.includes(attrs.businessCriticality as string)
  )
    return false;
  if (
    filters.functionalSuitability.length > 0 &&
    !filters.functionalSuitability.includes(attrs.functionalSuitability as string)
  )
    return false;
  if (
    filters.technicalSuitability.length > 0 &&
    !filters.technicalSuitability.includes(attrs.technicalSuitability as string)
  )
    return false;
  if (
    filters.hostingType.length > 0 &&
    !filters.hostingType.includes(attrs.hostingType as string)
  )
    return false;
  return true;
}

interface FilterState {
  orgIds: string[];
  timeModel: string[];
  businessCriticality: string[];
  functionalSuitability: string[];
  technicalSuitability: string[];
  hostingType: string[];
  timelineDate: number;
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

function buildTree(items: CapItem[], filters: FilterState): CapNode[] {
  const nodeMap = new Map<string, CapNode>();
  for (const item of items) {
    const filteredApps = item.apps.filter((a) => matchesFilters(a, filters));
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
      n.deepCost += ((app.attributes?.totalAnnualCost as number) || 0);
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
  onClick,
}: {
  app: AppData;
  colorBy: AppColorBy;
  onClick: () => void;
}) {
  const color = getAppColor(app, colorBy);
  const colorLabel = getAppColorLabel(app, colorBy);
  const isLight = color === UNSET_COLOR || color === "#fbc02d" || color === "#ff9800";
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
          color: isLight ? "#333" : "#fff",
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
  metric,
  maxVal,
  onCapClick,
  onAppClick,
  fmtCost,
}: {
  node: CapNode;
  displayLevel: number;
  showApps: boolean;
  colorBy: AppColorBy;
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
                fontSize: "0.72rem",
              }}
            />
          );
        })
      }
      renderInput={(params) => <TextField {...params} label={label} />}
      sx={{ minWidth: 180, maxWidth: 280 }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Filter option constants                                            */
/* ------------------------------------------------------------------ */

const TIME_OPTS = [
  { key: "tolerate", label: "Tolerate", color: "#ff9800" },
  { key: "invest", label: "Invest", color: "#4caf50" },
  { key: "migrate", label: "Migrate", color: "#2196f3" },
  { key: "eliminate", label: "Eliminate", color: "#d32f2f" },
];
const CRIT_OPTS = [
  { key: "missionCritical", label: "Mission Critical", color: "#d32f2f" },
  { key: "businessCritical", label: "Business Critical", color: "#f57c00" },
  { key: "businessOperational", label: "Business Operational", color: "#fbc02d" },
  { key: "administrativeService", label: "Administrative", color: "#9e9e9e" },
];
const FUNC_OPTS = [
  { key: "perfect", label: "Perfect", color: "#2e7d32" },
  { key: "appropriate", label: "Appropriate", color: "#66bb6a" },
  { key: "insufficient", label: "Insufficient", color: "#f57c00" },
  { key: "unreasonable", label: "Unreasonable", color: "#d32f2f" },
];
const TECH_OPTS = [
  { key: "fullyAppropriate", label: "Fully Appropriate", color: "#2e7d32" },
  { key: "adequate", label: "Adequate", color: "#66bb6a" },
  { key: "unreasonable", label: "Unreasonable", color: "#f57c00" },
  { key: "inappropriate", label: "Inappropriate", color: "#d32f2f" },
];
const HOST_OPTS = [
  { key: "onPremise", label: "On-Premise" },
  { key: "cloudSaaS", label: "Cloud (SaaS)" },
  { key: "cloudPaaS", label: "Cloud (PaaS)" },
  { key: "cloudIaaS", label: "Cloud (IaaS)" },
  { key: "hybrid", label: "Hybrid" },
];

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function CapabilityMapReport() {
  const navigate = useNavigate();
  const { fmtShort } = useCurrency();

  // Data
  const [data, setData] = useState<CapItem[] | null>(null);
  const [organizations, setOrganizations] = useState<OrgRef[]>([]);
  const [drawer, setDrawer] = useState<CapNode | null>(null);

  // Controls
  const [metric, setMetric] = useState<Metric>("app_count");
  const [displayLevel, setDisplayLevel] = useState(2);
  const [showApps, setShowApps] = useState(false);
  const [colorBy, setColorBy] = useState<AppColorBy>("none");

  // Timeline slider
  const todayMs = useMemo(() => Date.now(), []);
  const [timelineDate, setTimelineDate] = useState(todayMs);

  // Filters
  const [filterOrgs, setFilterOrgs] = useState<string[]>([]);
  const [filterTime, setFilterTime] = useState<string[]>([]);
  const [filterCrit, setFilterCrit] = useState<string[]>([]);
  const [filterFunc, setFilterFunc] = useState<string[]>([]);
  const [filterTech, setFilterTech] = useState<string[]>([]);
  const [filterHost, setFilterHost] = useState<string[]>([]);

  useEffect(() => {
    api
      .get<{ items: CapItem[]; organizations: OrgRef[] }>(
        `/reports/capability-heatmap?metric=${metric}`,
      )
      .then((r) => {
        setData(r.items);
        setOrganizations(r.organizations ?? []);
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

  const filters = useMemo<FilterState>(
    () => ({
      orgIds: filterOrgs,
      timeModel: filterTime,
      businessCriticality: filterCrit,
      functionalSuitability: filterFunc,
      technicalSuitability: filterTech,
      hostingType: filterHost,
      timelineDate,
    }),
    [filterOrgs, filterTime, filterCrit, filterFunc, filterTech, filterHost, timelineDate],
  );

  const hasActiveFilters =
    filterOrgs.length > 0 ||
    filterTime.length > 0 ||
    filterCrit.length > 0 ||
    filterFunc.length > 0 ||
    filterTech.length > 0 ||
    filterHost.length > 0;

  const tree = useMemo(() => (data ? buildTree(data, filters) : []), [data, filters]);
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

  const orgOptions = useMemo(
    () => organizations.map((o) => ({ key: o.id, label: o.name })),
    [organizations],
  );

  // Level picker options
  const levelOptions = useMemo(() => {
    const opts = [];
    for (let i = 1; i <= Math.max(maxLvl, 2); i++) {
      opts.push({ value: i, label: `Level ${i}` });
    }
    opts.push({ value: 99, label: "All levels" });
    return opts;
  }, [maxLvl]);

  // Color legend
  const colorLegend = useMemo(() => {
    if (colorBy === "none") return null;
    const map = ATTRIBUTE_COLORS[colorBy];
    if (!map) return null;
    return Object.values(map);
  }, [colorBy]);

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
              value={colorBy}
              onChange={(e) => setColorBy(e.target.value as AppColorBy)}
              sx={{ minWidth: 180 }}
            >
              {APP_COLOR_OPTIONS.map((o) => (
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

          {/* Row 2: Application filters */}
          {(showApps || hasActiveFilters) && (
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
                App Filters:
              </Typography>

              {organizations.length > 0 && (
                <FilterSelect
                  label="Organization"
                  options={orgOptions}
                  value={filterOrgs}
                  onChange={setFilterOrgs}
                />
              )}
              <FilterSelect
                label="TIME Model"
                options={TIME_OPTS}
                value={filterTime}
                onChange={setFilterTime}
              />
              <FilterSelect
                label="Business Criticality"
                options={CRIT_OPTS}
                value={filterCrit}
                onChange={setFilterCrit}
              />
              <FilterSelect
                label="Functional Fit"
                options={FUNC_OPTS}
                value={filterFunc}
                onChange={setFilterFunc}
              />
              <FilterSelect
                label="Technical Fit"
                options={TECH_OPTS}
                value={filterTech}
                onChange={setFilterTech}
              />
              <FilterSelect
                label="Hosting"
                options={HOST_OPTS}
                value={filterHost}
                onChange={setFilterHost}
              />

              {hasActiveFilters && (
                <Chip
                  size="small"
                  label="Clear all"
                  variant="outlined"
                  onDelete={() => {
                    setFilterOrgs([]);
                    setFilterTime([]);
                    setFilterCrit([]);
                    setFilterFunc([]);
                    setFilterTech([]);
                    setFilterHost([]);
                  }}
                  sx={{ fontSize: "0.72rem" }}
                />
              )}
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

          {/* App color legend */}
          {showApps && colorLegend && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, ml: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                {APP_COLOR_OPTIONS.find((o) => o.key === colorBy)?.label}:
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
                  const timeVal = (a.attributes || {}).timeModel as string | undefined;
                  const critVal = (a.attributes || {}).businessCriticality as string | undefined;
                  return (
                    <ListItemButton key={a.id} onClick={() => handleAppClick(a.id)}>
                      <ListItemText
                        primary={a.name}
                        secondary={
                          [
                            critVal &&
                              ATTRIBUTE_COLORS.businessCriticality?.[critVal]?.label,
                            timeVal && ATTRIBUTE_COLORS.timeModel?.[timeVal]?.label,
                            a.lifecycle?.endOfLife && `EOL: ${a.lifecycle.endOfLife}`,
                          ]
                            .filter(Boolean)
                            .join(" \u00B7 ") || undefined
                        }
                      />
                      {colorBy !== "none" && (
                        <Box
                          sx={{
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            bgcolor: getAppColor(a, colorBy),
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
    </ReportShell>
  );
}
