/**
 * ProcessNavigator — Full-featured Process House with multi-tab drawer,
 * tag overlay toggles, matrix/dependency views, deep-linking, and keyboard nav.
 *
 * Replaces BpmReportPage with a unified process exploration experience.
 */
import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Divider from "@mui/material/Divider";
import LinearProgress from "@mui/material/LinearProgress";
import CircularProgress from "@mui/material/CircularProgress";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Link from "@mui/material/Link";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableContainer from "@mui/material/TableContainer";
import Paper from "@mui/material/Paper";
import Slider from "@mui/material/Slider";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Skeleton from "@mui/material/Skeleton";
import Autocomplete from "@mui/material/Autocomplete";
import Checkbox from "@mui/material/Checkbox";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useAuth } from "@/hooks/useAuth";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

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
  has_diagram?: boolean;
  element_count?: number;
}

interface RefItem {
  id: string;
  name: string;
}

interface ProcNode extends ProcItem {
  children: ProcNode[];
  level: number;
  deepAppCount: number;
  deepCost: number;
  deepUniqueApps: Map<string, AppData>;
  deepDataObjects: Map<string, DataObjRef>;
}

interface ProcessElementData {
  id: string;
  process_id: string;
  bpmn_element_id?: string;
  element_type: string;
  name: string;
  documentation?: string;
  lane_name?: string;
  is_automated: boolean;
  sequence_order: number;
  application_id?: string;
  application_name?: string;
  data_object_id?: string;
  data_object_name?: string;
  it_component_id?: string;
  it_component_name?: string;
  custom_fields?: Record<string, unknown>;
}

type ColorOverlay = "processType" | "maturity" | "automationLevel" | "riskLevel";
type ViewMode = "house" | "matrix" | "dependencies";

/* ================================================================== */
/*  Constants                                                          */
/* ================================================================== */

const OVERLAY_OPTIONS: { key: ColorOverlay; label: string; icon: string }[] = [
  { key: "processType", label: "Type", icon: "category" },
  { key: "maturity", label: "Maturity", icon: "trending_up" },
  { key: "automationLevel", label: "Automation", icon: "precision_manufacturing" },
  { key: "riskLevel", label: "Risk", icon: "warning" },
];

const ATTR_COLORS: Record<string, Record<string, { label: string; color: string }>> = {
  processType: {
    core: { label: "Core", color: "#1565c0" },
    support: { label: "Support", color: "#7b1fa2" },
    management: { label: "Management", color: "#00695c" },
  },
  maturity: {
    initial: { label: "1-Initial", color: "#d32f2f" },
    managed: { label: "2-Managed", color: "#f57c00" },
    defined: { label: "3-Defined", color: "#fbc02d" },
    measured: { label: "4-Measured", color: "#66bb6a" },
    optimized: { label: "5-Optimized", color: "#2e7d32" },
  },
  automationLevel: {
    manual: { label: "Manual", color: "#d32f2f" },
    partially: { label: "Partial", color: "#f57c00" },
    fully: { label: "Fully Auto", color: "#2e7d32" },
  },
  riskLevel: {
    low: { label: "Low", color: "#66bb6a" },
    medium: { label: "Medium", color: "#fbc02d" },
    high: { label: "High", color: "#f57c00" },
    critical: { label: "Critical", color: "#d32f2f" },
  },
};

const SUBTYPE_LABELS: Record<string, string> = {
  category: "Category",
  group: "Group",
  process: "Process",
  variant: "Variant",
};

const PROCESS_TYPE_ROW_LABELS: Record<string, string> = {
  management: "Management Processes",
  core: "Core Processes",
  support: "Support Processes",
};
const PROCESS_TYPE_ROW_COLORS: Record<string, string> = {
  management: "#00695c",
  core: "#1565c0",
  support: "#7b1fa2",
};

const ELEMENT_TYPE_ICONS: Record<string, { icon: string; color: string }> = {
  task: { icon: "check_box", color: "#1976d2" },
  userTask: { icon: "person", color: "#1976d2" },
  serviceTask: { icon: "settings", color: "#7b1fa2" },
  scriptTask: { icon: "code", color: "#00695c" },
  businessRuleTask: { icon: "rule", color: "#e65100" },
  sendTask: { icon: "send", color: "#0097a7" },
  receiveTask: { icon: "call_received", color: "#0097a7" },
  manualTask: { icon: "back_hand", color: "#795548" },
  callActivity: { icon: "call_split", color: "#512da8" },
  subProcess: { icon: "account_tree", color: "#512da8" },
  exclusiveGateway: { icon: "call_split", color: "#f57c00" },
  parallelGateway: { icon: "add", color: "#f57c00" },
  inclusiveGateway: { icon: "radio_button_checked", color: "#f57c00" },
  eventBasedGateway: { icon: "bolt", color: "#f57c00" },
  startEvent: { icon: "play_circle", color: "#2e7d32" },
  endEvent: { icon: "stop_circle", color: "#c62828" },
  intermediateThrowEvent: { icon: "send", color: "#f57c00" },
  intermediateCatchEvent: { icon: "call_received", color: "#f57c00" },
  boundaryEvent: { icon: "adjust", color: "#e65100" },
  dataObjectReference: { icon: "description", color: "#774fcc" },
  dataStoreReference: { icon: "database", color: "#774fcc" },
};

/* ================================================================== */
/*  Tree builder                                                       */
/* ================================================================== */

function buildTree(items: ProcItem[]): ProcNode[] {
  const nodeMap = new Map<string, ProcNode>();
  for (const item of items) {
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

  function sortNodes(a: ProcNode, b: ProcNode) {
    const oa = (a.attributes?.sortOrder as number) ?? 999;
    const ob = (b.attributes?.sortOrder as number) ?? 999;
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name);
  }
  function setLevel(nodes: ProcNode[], lvl: number) {
    for (const n of nodes) {
      n.level = lvl;
      n.children.sort(sortNodes);
      setLevel(n.children, lvl + 1);
    }
  }
  roots.sort(sortNodes);
  setLevel(roots, 1);

  function propagate(n: ProcNode) {
    const appMap = new Map<string, AppData>();
    const doMap = new Map<string, DataObjRef>();
    for (const a of n.apps) appMap.set(a.id, a);
    for (const d of n.data_objects) doMap.set(d.id, d);
    for (const ch of n.children) {
      propagate(ch);
      for (const [id, a] of ch.deepUniqueApps) appMap.set(id, a);
      for (const [id, d] of ch.deepDataObjects) doMap.set(id, d);
    }
    n.deepUniqueApps = appMap;
    n.deepDataObjects = doMap;
    n.deepAppCount = appMap.size;
    n.deepCost = 0;
    for (const app of appMap.values()) {
      const attrs = app.attributes || {};
      n.deepCost += (attrs.costTotalAnnual as number) || (attrs.totalAnnualCost as number) || 0;
    }
  }
  for (const r of roots) propagate(r);

  return roots;
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

function findNode(nodes: ProcNode[], id: string): ProcNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

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

function flatCollect(nodes: ProcNode[]): ProcNode[] {
  const result: ProcNode[] = [];
  function walk(ns: ProcNode[]) {
    for (const n of ns) {
      result.push(n);
      walk(n.children);
    }
  }
  walk(nodes);
  return result;
}

function getCardColor(node: ProcNode, overlay: ColorOverlay): string {
  const val = (node.attributes || {})[overlay] as string | undefined;
  if (!val) return "#bdbdbd";
  return ATTR_COLORS[overlay]?.[val]?.color ?? "#bdbdbd";
}

/* ================================================================== */
/*  Process House Card                                                 */
/* ================================================================== */

function HouseCard({
  node,
  displayLevel,
  overlay,
  search,
  isAdmin,
  rowType,
  onOpen,
  onDrill,
  dragRef,
  onDragDrop,
}: {
  node: ProcNode;
  displayLevel: number;
  overlay: ColorOverlay;
  search: string;
  isAdmin?: boolean;
  rowType?: string;
  onOpen: (n: ProcNode) => void;
  onDrill: (id: string) => void;
  dragRef?: React.MutableRefObject<{ id: string; rowType: string } | null>;
  onDragDrop?: (dragId: string, dropId: string, rowType: string) => void;
}) {
  const color = getCardColor(node, overlay);
  const isLeaf = node.level >= displayLevel || node.children.length === 0;
  const childCount = node.children.length;
  const hasElements = (node.element_count ?? 0) > 0;
  const hasDiagram = node.has_diagram ?? false;
  const subtypeLabel = SUBTYPE_LABELS[node.subtype || ""] || null;

  // Search highlight
  const matchesSearch =
    !search || node.name.toLowerCase().includes(search.toLowerCase());
  const opacity = search && !matchesSearch ? 0.3 : 1;

  // A card is nested if rowType is a parent UUID (not a process-type row name)
  const isNested = rowType ? !["management", "core", "support"].includes(rowType) : false;
  const canDrag = isAdmin && dragRef && onDragDrop && rowType;
  const dragHandleActive = useRef(false);
  const [hovered, setHovered] = useState(false);

  if (isLeaf) {
    return (
      <Box
        draggable={!!canDrag}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onDragStart={canDrag ? (e) => {
          if (!dragHandleActive.current) { e.preventDefault(); return; }
          dragRef.current = { id: node.id, rowType: rowType! };
          e.dataTransfer.effectAllowed = "move";
          (e.currentTarget as HTMLElement).style.opacity = "0.4";
        } : undefined}
        onDragEnd={canDrag ? (e) => {
          (e.currentTarget as HTMLElement).style.opacity = "";
          dragRef.current = null;
          dragHandleActive.current = false;
        } : undefined}
        onDragOver={canDrag ? (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          (e.currentTarget as HTMLElement).style.outline = "2px solid " + color;
        } : undefined}
        onDragLeave={canDrag ? (e) => {
          (e.currentTarget as HTMLElement).style.outline = "";
        } : undefined}
        onDrop={canDrag ? (e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).style.outline = "";
          if (dragRef.current && dragRef.current.rowType === rowType) {
            onDragDrop(dragRef.current.id, node.id, rowType!);
          }
          dragRef.current = null;
        } : undefined}
        sx={{
          border: "1px solid",
          borderColor: matchesSearch && search ? color : "#e0e0e0",
          borderRadius: 2,
          overflow: "hidden",
          bgcolor: "#fff",
          cursor: "pointer",
          transition: "all 0.2s",
          opacity,
          "&:hover": { boxShadow: 3, transform: "translateY(-1px)" },
        }}
        onClick={() => onOpen(node)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") onOpen(node);
          if (e.key === "ArrowRight" && childCount > 0) onDrill(node.id);
        }}
      >
        <Box
          sx={{
            px: 1.5,
            py: 0.75,
            minHeight: 38,
            bgcolor: color,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            gap: 0.5,
          }}
        >
          {canDrag && (
            <Box
              onMouseDown={() => { dragHandleActive.current = true; }}
              onMouseUp={() => { dragHandleActive.current = false; }}
              sx={{
                opacity: hovered ? 1 : 0,
                transition: "opacity 0.15s",
                cursor: "grab",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                p: 0.25,
                ml: -0.5,
                borderRadius: 0.5,
                zIndex: 2,
                position: "relative",
                bgcolor: "rgba(255,255,255,0.25)",
                "&:hover": { bgcolor: "rgba(255,255,255,0.5)" },
                "&:active": { cursor: "grabbing" },
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <MaterialSymbol icon="drag_indicator" size={16} />
            </Box>
          )}
          <Typography
            variant="body2"
            sx={{
              fontWeight: 600,
              fontSize: "0.82rem",
              flex: 1,
              lineHeight: 1.3,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {node.name}
          </Typography>
          {subtypeLabel && (
            <Typography variant="caption" sx={{ opacity: 0.85, fontSize: "0.6rem", flexShrink: 0, ml: 0.5 }}>
              {subtypeLabel}
            </Typography>
          )}
        </Box>

        {/* Footer badges */}
        <Box
          sx={{
            px: 1,
            py: 0.5,
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            bgcolor: "#fafafa",
            borderTop: "1px solid #f0f0f0",
          }}
        >
          {node.deepAppCount > 0 && (
            <Tooltip title={`${node.deepAppCount} application(s)`}>
              <Chip
                size="small"
                icon={<MaterialSymbol icon="apps" size={12} />}
                label={node.deepAppCount}
                sx={{ height: 20, fontSize: "0.65rem", bgcolor: "#e3f2fd" }}
              />
            </Tooltip>
          )}
          {hasElements && (
            <Tooltip title={`${node.element_count} BPMN elements`}>
              <Chip
                size="small"
                icon={<MaterialSymbol icon="checklist" size={12} />}
                label={node.element_count}
                sx={{ height: 20, fontSize: "0.65rem", bgcolor: "#f3e5f5" }}
              />
            </Tooltip>
          )}
          {hasDiagram && (
            <Tooltip title="Has BPMN diagram">
              <Box sx={{ display: "flex", alignItems: "center" }}>
                <MaterialSymbol icon="schema" size={14} color="#7b1fa2" />
              </Box>
            </Tooltip>
          )}
          <Box sx={{ flex: 1 }} />
          {childCount > 0 && !isNested && (
            <Tooltip title={`${childCount} sub-process(es) — click to drill down`}>
              <Chip
                size="small"
                label={`+${childCount}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDrill(node.id);
                }}
                sx={{
                  height: 20,
                  fontSize: "0.65rem",
                  fontWeight: 700,
                  bgcolor: color,
                  color: "#fff",
                  cursor: "pointer",
                  "&:hover": { opacity: 0.85 },
                }}
              />
            </Tooltip>
          )}
        </Box>
      </Box>
    );
  }

  // Container card with nested children (no drag — use row chevrons to reorder containers)
  return (
    <Box
      sx={{
        border: "1px solid #d0d0d0",
        borderRadius: 2,
        overflow: "hidden",
        bgcolor: "#fff",
        opacity,
        transition: "opacity 0.2s",
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 0.75,
          bgcolor: color,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          cursor: "pointer",
          "&:hover": { opacity: 0.9 },
        }}
        onClick={() => onOpen(node)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") onOpen(node);
        }}
      >
        <Typography
          variant="body2"
          sx={{ fontWeight: 700, fontSize: "0.82rem", flex: 1, lineHeight: 1.3 }}
        >
          {node.name}
        </Typography>
        {subtypeLabel && (
          <Typography variant="caption" sx={{ opacity: 0.85, fontSize: "0.6rem", flexShrink: 0, ml: 0.5 }}>
            {subtypeLabel}
          </Typography>
        )}
        <Chip
          size="small"
          label={childCount}
          sx={{
            height: 20,
            fontSize: "0.65rem",
            fontWeight: 600,
            bgcolor: "rgba(255,255,255,0.25)",
            color: "#fff",
            ml: 0.5,
          }}
        />
        {!isNested && (
          <Tooltip title="Drill down into this process">
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); onDrill(node.id); }}
              sx={{
                p: 0.25,
                ml: 0.25,
                color: "#fff",
                opacity: 0.7,
                "&:hover": { opacity: 1, bgcolor: "rgba(255,255,255,0.2)" },
              }}
            >
              <MaterialSymbol icon="zoom_in" size={18} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Box sx={{ p: 0.75, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 0.75, bgcolor: "rgba(0,0,0,0.02)" }}>
        {node.children.map((ch) => (
          <Box key={ch.id}>
            <HouseCard
              node={ch}
              displayLevel={displayLevel}
              overlay={overlay}
              search={search}
              isAdmin={isAdmin}
              rowType={node.id}
              onOpen={onOpen}
              onDrill={onDrill}
              dragRef={dragRef}
              onDragDrop={onDragDrop}
            />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/* ================================================================== */
/*  Drawer Tab: Overview                                               */
/* ================================================================== */

function DrawerOverview({
  node,
  overlay,
  onNavigate,
  onSwitchNode,
  onDrill,
}: {
  node: ProcNode;
  overlay: ColorOverlay;
  onNavigate: (id: string) => void;
  onSwitchNode: (n: ProcNode) => void;
  onDrill: (id: string) => void;
}) {
  const [factSheet, setFactSheet] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setFactSheet(null);
    api
      .get<Record<string, unknown>>(`/fact-sheets/${node.id}`)
      .then(setFactSheet)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [node.id]);

  const attrChips: { label: string; color: string }[] = [];
  for (const opt of OVERLAY_OPTIONS) {
    const val = (node.attributes || {})[opt.key] as string | undefined;
    const info = val ? ATTR_COLORS[opt.key]?.[val] : null;
    if (info) attrChips.push({ label: `${opt.label}: ${info.label}`, color: info.color });
  }

  return (
    <Box>
      {/* Attribute chips */}
      {attrChips.length > 0 && (
        <Box sx={{ display: "flex", gap: 0.5, mb: 2, flexWrap: "wrap" }}>
          {node.subtype && SUBTYPE_LABELS[node.subtype] && (
            <Chip size="small" label={SUBTYPE_LABELS[node.subtype]} variant="outlined" />
          )}
          {attrChips.map((c) => (
            <Chip key={c.label} size="small" label={c.label} sx={{ bgcolor: c.color, color: "#fff" }} />
          ))}
        </Box>
      )}

      {/* KPI row */}
      <Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap" }}>
        <Box sx={{ textAlign: "center", minWidth: 70 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>{node.deepAppCount}</Typography>
          <Typography variant="caption" color="text.secondary">Apps</Typography>
        </Box>
        <Box sx={{ textAlign: "center", minWidth: 70 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>{node.deepDataObjects.size}</Typography>
          <Typography variant="caption" color="text.secondary">Data Objects</Typography>
        </Box>
        <Box sx={{ textAlign: "center", minWidth: 70 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>{node.element_count ?? 0}</Typography>
          <Typography variant="caption" color="text.secondary">Elements</Typography>
        </Box>
      </Box>

      {/* Actions */}
      <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
        <Chip
          size="small"
          icon={<MaterialSymbol icon="open_in_new" size={14} />}
          label="Open Fact Sheet"
          onClick={() => onNavigate(node.id)}
          color="primary"
          sx={{ cursor: "pointer" }}
        />
        {node.children.length > 0 && (
          <Chip
            size="small"
            icon={<MaterialSymbol icon="zoom_in" size={14} />}
            label="Drill Down"
            onClick={() => onDrill(node.id)}
            color="secondary"
            sx={{ cursor: "pointer" }}
          />
        )}
        {node.has_diagram ? (
          <Chip
            size="small"
            icon={<MaterialSymbol icon="schema" size={14} />}
            label="Open Flow Editor"
            onClick={() => onNavigate(`/bpm/processes/${node.id}/flow`)}
            variant="outlined"
            sx={{ cursor: "pointer" }}
          />
        ) : null}
      </Box>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* Description */}
      {factSheet && !!factSheet.description && (
        <>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Description</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap", mb: 1 }}>
            {String(factSheet.description)}
          </Typography>
        </>
      )}

      {/* Lifecycle */}
      {factSheet && !!factSheet.lifecycle && Object.keys(factSheet.lifecycle as Record<string, string>).length > 0 && (
        <>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Lifecycle</Typography>
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mb: 1 }}>
            {Object.entries(factSheet.lifecycle as Record<string, string>).map(
              ([phase, date]) =>
                date ? (
                  <Chip
                    key={phase}
                    size="small"
                    label={`${phase}: ${date}`}
                    variant="outlined"
                    sx={{ textTransform: "capitalize" }}
                  />
                ) : null,
            )}
          </Box>
        </>
      )}

      {/* Completion & Quality */}
      {factSheet && (
        <>
          <Divider sx={{ my: 1.5 }} />
          <Box sx={{ display: "flex", gap: 2, mb: 1, alignItems: "center" }}>
            {typeof factSheet.completion === "number" && (
              <Box sx={{ flex: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Completion
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <LinearProgress
                    variant="determinate"
                    value={factSheet.completion as number}
                    sx={{ flex: 1, height: 6, borderRadius: 3 }}
                  />
                  <Typography variant="caption" sx={{ fontWeight: 600, minWidth: 35 }}>
                    {Math.round(factSheet.completion as number)}%
                  </Typography>
                </Box>
              </Box>
            )}
            {factSheet.quality_seal ? (
              <Chip
                size="small"
                label={String(factSheet.quality_seal)}
                color={
                  factSheet.quality_seal === "APPROVED"
                    ? "success"
                    : factSheet.quality_seal === "REJECTED"
                      ? "error"
                      : factSheet.quality_seal === "BROKEN"
                        ? "warning"
                        : "default"
                }
                variant="outlined"
              />
            ) : null}
          </Box>
        </>
      )}

      {/* Sub-processes */}
      {node.children.length > 0 && (
        <>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="subtitle2" sx={{ mb: 0.75, display: "flex", alignItems: "center", gap: 0.5 }}>
            <MaterialSymbol icon="account_tree" size={18} />
            Sub-Processes ({node.children.length})
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            {node.children.map((ch) => (
              <Box
                key={ch.id}
                onClick={() => onSwitchNode(ch)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  px: 1.5,
                  py: 0.75,
                  borderRadius: 1,
                  bgcolor: getCardColor(ch, overlay),
                  color: "#fff",
                  cursor: "pointer",
                  "&:hover": { boxShadow: 2 },
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: "0.85rem", flex: 1 }}>
                  {ch.name}
                </Typography>
                {ch.children.length > 0 && (
                  <Chip
                    size="small"
                    label={`+${ch.children.length}`}
                    sx={{
                      height: 18,
                      fontSize: "0.6rem",
                      bgcolor: "rgba(255,255,255,0.25)",
                      color: "#fff",
                    }}
                  />
                )}
                {ch.deepAppCount > 0 && (
                  <Typography variant="caption" sx={{ opacity: 0.85 }}>
                    {ch.deepAppCount} apps
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        </>
      )}

      {/* Tags */}
      {factSheet &&
        Array.isArray(factSheet.tags) &&
        (factSheet.tags as Array<{ id: string; name: string; color?: string }>).length > 0 && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Tags</Typography>
            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
              {(factSheet.tags as Array<{ id: string; name: string; color?: string }>).map((tag) => (
                <Chip
                  key={tag.id}
                  size="small"
                  label={tag.name}
                  sx={tag.color ? { bgcolor: tag.color, color: "#fff" } : {}}
                  variant={tag.color ? "filled" : "outlined"}
                />
              ))}
            </Box>
          </>
        )}
    </Box>
  );
}

/* ================================================================== */
/*  Drawer Tab: Steps                                                  */
/* ================================================================== */

function DrawerSteps({
  processId,
  onNavigate,
}: {
  processId: string;
  onNavigate: (id: string) => void;
}) {
  const [elements, setElements] = useState<ProcessElementData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    api
      .get<ProcessElementData[]>(`/bpm/processes/${processId}/elements`)
      .then(setElements)
      .catch((err) => setError(err?.message || "Failed to load elements"))
      .finally(() => setLoading(false));
  }, [processId]);

  if (loading) return <LinearProgress />;
  if (error)
    return (
      <Typography color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
        {error}
      </Typography>
    );
  if (elements.length === 0)
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <MaterialSymbol icon="checklist" size={40} color="#ccc" />
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          No BPMN elements found. Create a process flow to see steps here.
        </Typography>
      </Box>
    );

  // Group by lane
  const lanes = new Map<string, ProcessElementData[]>();
  for (const el of elements) {
    const lane = el.lane_name || "(Default)";
    lanes.set(lane, [...(lanes.get(lane) || []), el]);
  }

  return (
    <Box>
      {Array.from(lanes.entries()).map(([laneName, laneElements]) => (
        <Box key={laneName} sx={{ mb: 2 }}>
          {lanes.size > 1 && (
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.75, color: "text.secondary" }}>
              {laneName}
            </Typography>
          )}
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {laneElements.map((el, idx) => {
              const typeInfo = ELEMENT_TYPE_ICONS[el.element_type] || {
                icon: "radio_button_unchecked",
                color: "#999",
              };
              const isLast = idx === laneElements.length - 1;
              return (
                <Box key={el.id}>
                  {/* Step card */}
                  <Box
                    sx={{
                      display: "flex",
                      gap: 1.5,
                      alignItems: "flex-start",
                      px: 1.5,
                      py: 1,
                      borderRadius: 1.5,
                      border: "1px solid #e8e8e8",
                      bgcolor: el.is_automated ? "rgba(126,87,194,0.04)" : "#fff",
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  >
                    {/* Icon + connector */}
                    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", pt: 0.25 }}>
                      <Box
                        sx={{
                          width: 28,
                          height: 28,
                          borderRadius: "50%",
                          bgcolor: typeInfo.color,
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <MaterialSymbol icon={typeInfo.icon} size={16} color="#fff" />
                      </Box>
                    </Box>

                    {/* Content */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: "0.85rem" }}>
                          {el.name || "(unnamed)"}
                        </Typography>
                        {el.is_automated && (
                          <Chip
                            size="small"
                            label="Auto"
                            sx={{ height: 16, fontSize: "0.55rem", bgcolor: "#7b1fa2", color: "#fff" }}
                          />
                        )}
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {el.element_type}
                      </Typography>
                      {el.documentation && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 0.25, fontSize: "0.78rem", lineHeight: 1.4 }}
                        >
                          {el.documentation}
                        </Typography>
                      )}
                      {/* Linked entities */}
                      <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                        {el.application_name && (
                          <Chip
                            size="small"
                            icon={<MaterialSymbol icon="apps" size={12} />}
                            label={el.application_name}
                            onClick={() => el.application_id && onNavigate(el.application_id)}
                            sx={{
                              height: 20,
                              fontSize: "0.65rem",
                              cursor: "pointer",
                              bgcolor: "#e3f2fd",
                              "&:hover": { bgcolor: "#bbdefb" },
                            }}
                          />
                        )}
                        {el.data_object_name && (
                          <Chip
                            size="small"
                            icon={<MaterialSymbol icon="database" size={12} />}
                            label={el.data_object_name}
                            onClick={() => el.data_object_id && onNavigate(el.data_object_id)}
                            sx={{
                              height: 20,
                              fontSize: "0.65rem",
                              cursor: "pointer",
                              bgcolor: "#f3e5f5",
                              "&:hover": { bgcolor: "#e1bee7" },
                            }}
                          />
                        )}
                        {el.it_component_name && (
                          <Chip
                            size="small"
                            icon={<MaterialSymbol icon="memory" size={12} />}
                            label={el.it_component_name}
                            onClick={() => el.it_component_id && onNavigate(el.it_component_id)}
                            sx={{
                              height: 20,
                              fontSize: "0.65rem",
                              cursor: "pointer",
                              bgcolor: "#fff3e0",
                              "&:hover": { bgcolor: "#ffe0b2" },
                            }}
                          />
                        )}
                      </Box>
                    </Box>
                  </Box>

                  {/* Connector arrow between steps */}
                  {!isLast && (
                    <Box sx={{ display: "flex", justifyContent: "center", py: 0.25 }}>
                      <MaterialSymbol icon="arrow_downward" size={16} color="#ccc" />
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/* ================================================================== */
/*  Drawer Tab: Flow (BPMN thumbnail)                                  */
/* ================================================================== */

function DrawerFlow({
  processId,
  onNavigate,
}: {
  processId: string;
  onNavigate: (path: string) => void;
}) {
  const [svgUrl, setSvgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasDiagram, setHasDiagram] = useState(false);

  useEffect(() => {
    setLoading(true);
    setHasDiagram(false);
    setSvgUrl(null);

    // First check if a diagram exists at all, then try SVG
    api.get<{ bpmn_xml?: string; svg_thumbnail?: string; version?: number } | null>(
      `/bpm/processes/${processId}/diagram`,
    )
      .then((diag) => {
        if (diag?.bpmn_xml) setHasDiagram(true);
        if (!diag?.bpmn_xml) return null;
        // Try to get SVG thumbnail via the export endpoint for a clean image
        const token = localStorage.getItem("token");
        return fetch(`/api/v1/bpm/processes/${processId}/diagram/export/svg`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      })
      .then((r) => {
        if (!r || !r.ok) throw new Error("No SVG");
        return r.blob();
      })
      .then((blob) => setSvgUrl(URL.createObjectURL(blob)))
      .catch(() => {
        // SVG may not be available, that's fine if diagram exists
      })
      .finally(() => setLoading(false));

    return () => {
      if (svgUrl) URL.revokeObjectURL(svgUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processId]);

  if (loading)
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <CircularProgress size={32} />
      </Box>
    );

  if (!hasDiagram && !svgUrl)
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <MaterialSymbol icon="schema" size={40} color="#ccc" />
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          No BPMN diagram available for this process.
        </Typography>
        <Chip
          size="small"
          icon={<MaterialSymbol icon="add" size={14} />}
          label="Create Flow Diagram"
          onClick={() => onNavigate(`/bpm/processes/${processId}/flow`)}
          color="primary"
          sx={{ mt: 1, cursor: "pointer" }}
        />
      </Box>
    );

  if (hasDiagram && !svgUrl)
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <MaterialSymbol icon="schema" size={40} color="#7b1fa2" />
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          Diagram exists but preview is not available.
        </Typography>
        <Chip
          size="small"
          icon={<MaterialSymbol icon="open_in_new" size={14} />}
          label="Open Flow Editor"
          onClick={() => onNavigate(`/bpm/processes/${processId}/flow`)}
          color="primary"
          sx={{ mt: 1, cursor: "pointer" }}
        />
      </Box>
    );

  return (
    <Box>
      <Box
        sx={{
          border: "1px solid #e0e0e0",
          borderRadius: 2,
          overflow: "hidden",
          mb: 2,
          bgcolor: "#fafafa",
          cursor: "pointer",
          "&:hover": { boxShadow: 2 },
        }}
        onClick={() => onNavigate(`/bpm/processes/${processId}/flow`)}
      >
        <img
          src={svgUrl!}
          alt="BPMN diagram"
          style={{ width: "100%", height: "auto", display: "block" }}
        />
      </Box>
      <Box sx={{ display: "flex", justifyContent: "center" }}>
        <Chip
          size="small"
          icon={<MaterialSymbol icon="open_in_new" size={14} />}
          label="Open in Flow Editor"
          onClick={() => onNavigate(`/bpm/processes/${processId}/flow`)}
          color="primary"
          sx={{ cursor: "pointer" }}
        />
      </Box>
    </Box>
  );
}

/* ================================================================== */
/*  Drawer Tab: Apps                                                   */
/* ================================================================== */

function DrawerApps({
  node,
  onNavigate,
}: {
  node: ProcNode;
  onNavigate: (id: string) => void;
}) {
  const apps = useMemo(
    () => Array.from(node.deepUniqueApps.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [node],
  );

  if (apps.length === 0)
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <MaterialSymbol icon="apps" size={40} color="#ccc" />
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          No applications linked to this process.
        </Typography>
      </Box>
    );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      {apps.map((app) => (
        <Box
          key={app.id}
          onClick={() => onNavigate(app.id)}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1.5,
            py: 1,
            borderRadius: 1,
            border: "1px solid #e0e0e0",
            cursor: "pointer",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <MaterialSymbol icon="apps" size={18} color="#0f7eb5" />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 500, fontSize: "0.85rem" }}>
              {app.name}
            </Typography>
            {app.subtype && (
              <Typography variant="caption" color="text.secondary">
                {app.subtype}
              </Typography>
            )}
          </Box>
          {app.lifecycle?.endOfLife && (
            <Tooltip title="End of Life">
              <Box>
                <MaterialSymbol icon="warning" size={16} color="#e65100" />
              </Box>
            </Tooltip>
          )}
        </Box>
      ))}
    </Box>
  );
}

/* ================================================================== */
/*  Drawer Tab: Data Objects                                           */
/* ================================================================== */

function DrawerData({
  node,
  onNavigate,
}: {
  node: ProcNode;
  onNavigate: (id: string) => void;
}) {
  const dataObjs = useMemo(
    () => Array.from(node.deepDataObjects.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [node],
  );

  if (dataObjs.length === 0)
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <MaterialSymbol icon="database" size={40} color="#ccc" />
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          No data objects linked to this process.
        </Typography>
      </Box>
    );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      {dataObjs.map((d) => (
        <Box
          key={d.id}
          onClick={() => onNavigate(d.id)}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1.5,
            py: 1,
            borderRadius: 1,
            border: "1px solid #e0e0e0",
            cursor: "pointer",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <MaterialSymbol icon="database" size={18} color="#774fcc" />
          <Typography variant="body2" sx={{ fontWeight: 500, fontSize: "0.85rem" }}>
            {d.name}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/* ================================================================== */
/*  Multi-Tab Drawer                                                   */
/* ================================================================== */

function ProcessDrawer({
  node,
  overlay,
  typeIcon,
  typeColor,
  onClose,
  onNavigate,
  onSwitchNode,
  onDrill,
}: {
  node: ProcNode;
  overlay: ColorOverlay;
  typeIcon: string;
  typeColor: string;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onSwitchNode: (n: ProcNode) => void;
  onDrill: (id: string) => void;
}) {
  const [tab, setTab] = useState(0);

  // Reset tab when node changes
  useEffect(() => {
    setTab(0);
  }, [node.id]);

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <Box
        sx={{
          px: 2.5,
          pt: 2,
          pb: 1,
          bgcolor: typeColor,
          color: "#fff",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 1.5,
              bgcolor: "rgba(255,255,255,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <MaterialSymbol icon={typeIcon} size={22} color="#fff" />
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 700, flex: 1, fontSize: "1.1rem" }} noWrap>
            {node.name}
          </Typography>
          <IconButton onClick={onClose} size="small" sx={{ color: "#fff" }}>
            <MaterialSymbol icon="close" size={20} />
          </IconButton>
        </Box>
      </Box>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          minHeight: 36,
          "& .MuiTab-root": { minHeight: 36, py: 0, fontSize: "0.8rem" },
        }}
      >
        <Tab label="Overview" icon={<MaterialSymbol icon="info" size={16} />} iconPosition="start" />
        <Tab
          label={`Steps${node.element_count ? ` (${node.element_count})` : ""}`}
          icon={<MaterialSymbol icon="checklist" size={16} />}
          iconPosition="start"
        />
        <Tab label="Flow" icon={<MaterialSymbol icon="schema" size={16} />} iconPosition="start" />
        <Tab
          label={`Apps (${node.deepAppCount})`}
          icon={<MaterialSymbol icon="apps" size={16} />}
          iconPosition="start"
        />
        <Tab
          label={`Data (${node.deepDataObjects.size})`}
          icon={<MaterialSymbol icon="database" size={16} />}
          iconPosition="start"
        />
      </Tabs>

      {/* Tab content */}
      <Box sx={{ flex: 1, overflowY: "auto", p: 2 }}>
        {tab === 0 && (
          <DrawerOverview
            node={node}
            overlay={overlay}
            onNavigate={onNavigate}
            onSwitchNode={onSwitchNode}
            onDrill={onDrill}
          />
        )}
        {tab === 1 && <DrawerSteps processId={node.id} onNavigate={onNavigate} />}
        {tab === 2 && <DrawerFlow processId={node.id} onNavigate={onNavigate} />}
        {tab === 3 && <DrawerApps node={node} onNavigate={onNavigate} />}
        {tab === 4 && <DrawerData node={node} onNavigate={onNavigate} />}
      </Box>
    </Box>
  );
}

/* ================================================================== */
/*  Matrix View                                                        */
/* ================================================================== */

function MatrixView({
  onNavigate,
}: {
  onNavigate: (id: string) => void;
}) {
  const [data, setData] = useState<{
    rows: { id: string; name: string }[];
    columns: { id: string; name: string }[];
    cells: { process_id: string; application_id: string; source: string; element_name?: string }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<typeof data>("/reports/bpm/process-application-matrix")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LinearProgress />;
  if (!data || !data.rows.length)
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <MaterialSymbol icon="table_chart" size={48} color="#ccc" />
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          No data. Link processes to applications first.
        </Typography>
      </Box>
    );

  return (
    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 600 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700, position: "sticky", left: 0, zIndex: 3, bgcolor: "#fff" }}>
              Process
            </TableCell>
            {data.columns.map((c) => (
              <TableCell key={c.id} align="center" sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                {c.name}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {data.rows.map((r) => (
            <TableRow key={r.id} hover>
              <TableCell
                sx={{
                  cursor: "pointer",
                  color: "primary.main",
                  fontWeight: 500,
                  position: "sticky",
                  left: 0,
                  bgcolor: "#fff",
                  zIndex: 1,
                }}
                onClick={() => onNavigate(r.id)}
              >
                {r.name}
              </TableCell>
              {data.columns.map((c) => {
                const matches = data.cells.filter(
                  (x) => x.process_id === r.id && x.application_id === c.id,
                );
                return (
                  <TableCell key={c.id} align="center">
                    {matches.length > 0 && (
                      <Tooltip
                        title={matches
                          .map((x) =>
                            x.source === "element" ? `Element: ${x.element_name}` : "Relation",
                          )
                          .join(", ")}
                      >
                        <Chip
                          label={matches.some((x) => x.source === "element") ? "E" : "R"}
                          size="small"
                          color={
                            matches.some((x) => x.source === "element") ? "secondary" : "primary"
                          }
                        />
                      </Tooltip>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/* ================================================================== */
/*  Dependencies View                                                  */
/* ================================================================== */

function DependenciesView({ onNavigate }: { onNavigate: (id: string) => void }) {
  const [data, setData] = useState<{
    nodes: { id: string; name: string }[];
    edges: { id: string; source: string; target: string }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<typeof data>("/reports/bpm/process-dependencies")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LinearProgress />;
  if (!data || !data.nodes.length)
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <MaterialSymbol icon="hub" size={48} color="#ccc" />
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          No process dependencies defined yet.
        </Typography>
      </Box>
    );

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {data.nodes.length} processes, {data.edges.length} dependencies
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>From Process</TableCell>
              <TableCell align="center" sx={{ width: 80 }}>
                depends on
              </TableCell>
              <TableCell sx={{ fontWeight: 700 }}>To Process</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.edges.map((e) => {
              const src = data.nodes.find((n) => n.id === e.source);
              const tgt = data.nodes.find((n) => n.id === e.target);
              return (
                <TableRow key={e.id} hover>
                  <TableCell
                    sx={{ cursor: "pointer", color: "primary.main" }}
                    onClick={() => onNavigate(e.source)}
                  >
                    {src?.name || e.source}
                  </TableCell>
                  <TableCell align="center">
                    <MaterialSymbol icon="arrow_forward" size={18} />
                  </TableCell>
                  <TableCell
                    sx={{ cursor: "pointer", color: "primary.main" }}
                    onClick={() => onNavigate(e.target)}
                  >
                    {tgt?.name || e.target}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

/* ================================================================== */
/*  Level Indicator Widget                                             */
/* ================================================================== */

function LevelIndicator({
  maxLevel,
  displayLevel,
  onChange,
}: {
  maxLevel: number;
  displayLevel: number;
  onChange: (level: number) => void;
}) {
  const marks = [];
  for (let i = 1; i <= maxLevel; i++) {
    marks.push({ value: i, label: `L${i}` });
  }
  if (maxLevel > 1) {
    marks.push({ value: maxLevel + 1, label: "All" });
  }

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        minWidth: 160,
        maxWidth: 260,
      }}
    >
      <MaterialSymbol icon="layers" size={18} color="#666" />
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
        Depth
      </Typography>
      <Slider
        value={Math.min(displayLevel, maxLevel + 1)}
        onChange={(_, v) => onChange(v as number)}
        min={1}
        max={maxLevel + 1}
        step={1}
        marks={marks}
        size="small"
        sx={{
          flex: 1,
          "& .MuiSlider-markLabel": { fontSize: "0.6rem" },
        }}
      />
    </Box>
  );
}

/* ================================================================== */
/*  Overlay Legend                                                      */
/* ================================================================== */

function OverlayLegend({ overlay }: { overlay: ColorOverlay }) {
  const items = ATTR_COLORS[overlay];
  if (!items) return null;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
      {Object.values(items).map((item) => (
        <Box key={item.label} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
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
            bgcolor: "#bdbdbd",
            flexShrink: 0,
          }}
        />
        <Typography variant="caption" color="text.secondary">
          Not set
        </Typography>
      </Box>
    </Box>
  );
}

/* ================================================================== */
/*  Main: ProcessNavigator                                             */
/* ================================================================== */

export default function ProcessNavigator() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { getType } = useMetamodel();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const containerRef = useRef<HTMLDivElement>(null);

  // Metamodel type info for BusinessProcess
  const processType = getType("BusinessProcess");
  const typeIcon = processType?.icon ?? "route";
  const typeColor = processType?.color ?? "#e65100";

  // ── Data ──
  const [data, setData] = useState<ProcItem[] | null>(null);
  const [organizations, setOrganizations] = useState<RefItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reordering, setReordering] = useState(false);
  const [rowOrder, setRowOrder] = useState<string[]>(["management", "core", "support"]);

  // ── URL-synced state ──
  const viewParam = (searchParams.get("view") as ViewMode) || "house";
  const searchParam = searchParams.get("search") || "";
  const levelParam = parseInt(searchParams.get("level") || "2", 10);
  const overlayParam = (searchParams.get("overlay") as ColorOverlay) || "processType";
  const zoomParam = searchParams.get("zoom") || null;
  const drawerParam = searchParams.get("open") || null;

  const [viewMode, setViewMode] = useState<ViewMode>(viewParam);
  const [search, setSearch] = useState(searchParam);
  const [displayLevel, setDisplayLevel] = useState(levelParam);
  const [overlay, setOverlay] = useState<ColorOverlay>(overlayParam);
  const [zoomNodeId, setZoomNodeId] = useState<string | null>(zoomParam);
  const [drawerNode, setDrawerNode] = useState<ProcNode | null>(null);
  const [orgFilter, setOrgFilter] = useState<RefItem[]>([]);

  // ── Load data ──
  const loadData = useCallback(() => {
    Promise.all([
      api.get<{ items: ProcItem[]; organizations: RefItem[]; business_contexts: RefItem[] }>(
        "/reports/bpm/process-map",
      ),
      api.get<{ row_order: string[] }>("/settings/bpm-row-order").catch(() => ({ row_order: ["management", "core", "support"] })),
    ])
      .then(([r, rowOrderRes]) => {
        setData(r.items);
        setOrganizations(r.organizations ?? []);
        if (rowOrderRes.row_order?.length) setRowOrder(rowOrderRes.row_order);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Build tree ──
  const fullTree = useMemo(() => (data ? buildTree(data) : []), [data]);
  const maxLvl = useMemo(() => getMaxLevel(fullTree), [fullTree]);
  const allFlat = useMemo(() => flatCollect(fullTree), [fullTree]);

  // ── Organization filter ──
  const orgFilterIds = useMemo(() => new Set(orgFilter.map((o) => o.id)), [orgFilter]);

  const filteredTree = useMemo(() => {
    if (orgFilterIds.size === 0) return fullTree;
    // A process matches if it or any descendant is linked to a selected org
    function nodeMatchesOrg(n: ProcNode): boolean {
      if (n.org_ids.some((oid) => orgFilterIds.has(oid))) return true;
      return n.children.some(nodeMatchesOrg);
    }
    function filterChildren(nodes: ProcNode[]): ProcNode[] {
      return nodes
        .filter(nodeMatchesOrg)
        .map((n) => ({ ...n, children: filterChildren(n.children) }));
    }
    return filterChildren(fullTree);
  }, [fullTree, orgFilterIds]);

  // ── Zoom / breadcrumbs ──
  const { displayTree, breadcrumbs } = useMemo(() => {
    if (!zoomNodeId) return { displayTree: filteredTree, breadcrumbs: [] as ProcNode[] };
    const ancestors = getAncestors(filteredTree, zoomNodeId);
    const zoomNode = findNode(filteredTree, zoomNodeId);
    if (!zoomNode) return { displayTree: filteredTree, breadcrumbs: [] as ProcNode[] };
    return {
      displayTree: zoomNode.children.length > 0 ? zoomNode.children : [zoomNode],
      breadcrumbs: ancestors,
    };
  }, [filteredTree, zoomNodeId]);

  // ── Open drawer from URL param (initial mount only) ──
  const initialDrawerApplied = useRef(false);
  useEffect(() => {
    if (!initialDrawerApplied.current && drawerParam && fullTree.length > 0) {
      const node = findNode(fullTree, drawerParam);
      if (node) setDrawerNode(node);
      initialDrawerApplied.current = true;
    }
  }, [drawerParam, fullTree]);

  // ── Sync state → URL ──
  useEffect(() => {
    const params: Record<string, string> = {};
    if (viewMode !== "house") params.view = viewMode;
    if (search) params.search = search;
    if (displayLevel !== 2) params.level = String(displayLevel);
    if (overlay !== "processType") params.overlay = overlay;
    if (zoomNodeId) params.zoom = zoomNodeId;
    if (drawerNode) params.open = drawerNode.id;
    setSearchParams(params, { replace: true });
  }, [viewMode, search, displayLevel, overlay, zoomNodeId, drawerNode, setSearchParams]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (drawerNode) {
          setDrawerNode(null);
        } else if (zoomNodeId) {
          setZoomNodeId(null);
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [drawerNode, zoomNodeId]);

  // ── Handlers ──
  const handleOpenDrawer = useCallback(
    (node: ProcNode) => setDrawerNode(node),
    [],
  );

  const handleDrill = useCallback((id: string) => {
    setZoomNodeId(id);
    setDrawerNode(null);
  }, []);

  const handleNavigate = useCallback(
    (path: string) => {
      // Navigate first — don't clear drawer state before navigating,
      // because the URL sync effect would override the navigation.
      if (path.startsWith("/")) {
        navigate(path);
      } else {
        navigate(`/fact-sheets/${path}`);
      }
    },
    [navigate],
  );

  const handleSwitchNode = useCallback((n: ProcNode) => {
    setDrawerNode(n);
  }, []);

  // ── Drag-and-drop reorder for cards (admin only) ──
  const dragRef = useRef<{ id: string; rowType: string } | null>(null);
  const handleDragDrop = useCallback(
    async (dragId: string, dropId: string, rowType: string) => {
      if (!data || reordering || dragId === dropId) return;

      // rowType is either a process-type row ("management"/"core"/"support")
      // or a parent node ID (for leaf cards inside a container).
      const isProcessRow = ["management", "core", "support"].includes(rowType);
      const siblings = data
        .filter((d) => isProcessRow
          ? (!d.parent_id && ((d.attributes?.processType as string) || "core") === rowType)
          : d.parent_id === rowType)
        .sort((a, b) => {
          const oa = (a.attributes?.sortOrder as number) ?? 999;
          const ob = (b.attributes?.sortOrder as number) ?? 999;
          if (oa !== ob) return oa - ob;
          return a.name.localeCompare(b.name);
        });

      const fromIdx = siblings.findIndex((s) => s.id === dragId);
      const toIdx = siblings.findIndex((s) => s.id === dropId);
      if (fromIdx < 0 || toIdx < 0) return;

      const reordered = [...siblings];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);

      setReordering(true);
      try {
        await Promise.all(
          reordered.map((s, i) =>
            api.patch(`/fact-sheets/${s.id}`, {
              attributes: { ...(s.attributes || {}), sortOrder: i },
            }),
          ),
        );
        loadData();
      } catch (e) {
        console.error("Drag reorder failed", e);
      } finally {
        setReordering(false);
      }
    },
    [data, reordering, loadData],
  );

  // ── Row reorder (admin) ──
  const handleMoveRow = useCallback(
    async (rowType: string, direction: "up" | "down") => {
      const idx = rowOrder.indexOf(rowType);
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (idx < 0 || swapIdx < 0 || swapIdx >= rowOrder.length) return;
      const newOrder = [...rowOrder];
      [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
      setRowOrder(newOrder);
      // Persist to backend
      try {
        await api.patch("/settings/bpm-row-order", { row_order: newOrder });
      } catch (e) {
        console.error("Failed to save row order", e);
      }
    },
    [rowOrder],
  );

  // ── Process House: group roots by processType ──
  const houseRows = useMemo(() => {
    const rows: Record<string, ProcNode[]> = {
      management: [],
      core: [],
      support: [],
    };
    const source = displayTree;
    for (const node of source) {
      const pType = (node.attributes?.processType as string) || "core";
      if (rows[pType]) {
        rows[pType].push(node);
      } else {
        rows.core.push(node); // Default to core
      }
    }
    return rows;
  }, [displayTree]);

  // ── Search filter for house view ──
  const searchLower = search.toLowerCase();
  const matchedIds = useMemo(() => {
    if (!searchLower) return null;
    const ids = new Set<string>();
    for (const n of allFlat) {
      if (n.name.toLowerCase().includes(searchLower)) {
        ids.add(n.id);
        // Also add ancestors so container is visible
        let cur: ProcNode | null = n;
        while (cur?.parent_id) {
          const parent = allFlat.find((p) => p.id === cur!.parent_id);
          if (parent) {
            ids.add(parent.id);
            cur = parent;
          } else break;
        }
      }
    }
    return ids;
  }, [searchLower, allFlat]);

  const totalProcesses = allFlat.length;
  const matchCount = matchedIds ? matchedIds.size : totalProcesses;

  // ── Render ──
  if (loading)
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="text" width={300} height={40} />
        <Skeleton variant="rectangular" height={60} sx={{ my: 2, borderRadius: 1 }} />
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2 }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} variant="rectangular" height={100} sx={{ borderRadius: 1 }} />
          ))}
        </Box>
      </Box>
    );

  return (
    <Box ref={containerRef} sx={{ p: { xs: 2, md: 3 } }}>
      {/* ── View mode toggle ── */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2, flexWrap: "wrap" }}>
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          size="small"
          onChange={(_, v) => v && setViewMode(v)}
        >
          <ToggleButton value="house">
            <Tooltip title="Process House">
              <Box sx={{ display: "flex" }}>
                <MaterialSymbol icon="grid_view" size={18} />
              </Box>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="matrix">
            <Tooltip title="Process × App Matrix">
              <Box sx={{ display: "flex" }}>
                <MaterialSymbol icon="table_chart" size={18} />
              </Box>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="dependencies">
            <Tooltip title="Dependencies">
              <Box sx={{ display: "flex" }}>
                <MaterialSymbol icon="hub" size={18} />
              </Box>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* ── Toolbar (House view only) ── */}
      {viewMode === "house" && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            mb: 2,
            flexWrap: "wrap",
            p: 1.5,
            bgcolor: "#fafafa",
            borderRadius: 2,
            border: "1px solid #f0f0f0",
          }}
        >
          {/* Search */}
          <TextField
            size="small"
            placeholder="Search processes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <MaterialSymbol icon="search" size={18} color="#999" />
                </InputAdornment>
              ),
              endAdornment: search ? (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setSearch("")}>
                    <MaterialSymbol icon="close" size={16} />
                  </IconButton>
                </InputAdornment>
              ) : null,
            }}
            sx={{ minWidth: 200, maxWidth: 300, flex: "1 1 200px" }}
          />

          {/* Overlay toggle chips */}
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
            {OVERLAY_OPTIONS.map((opt) => (
              <Chip
                key={opt.key}
                icon={<MaterialSymbol icon={opt.icon} size={14} />}
                label={opt.label}
                onClick={() => setOverlay(opt.key)}
                variant={overlay === opt.key ? "filled" : "outlined"}
                color={overlay === opt.key ? "primary" : "default"}
                size="small"
                sx={{ cursor: "pointer", fontWeight: overlay === opt.key ? 600 : 400 }}
              />
            ))}
          </Box>

          {/* Level indicator */}
          {maxLvl > 1 && (
            <LevelIndicator
              maxLevel={maxLvl}
              displayLevel={displayLevel}
              onChange={(v) => setDisplayLevel(v > maxLvl ? 99 : v)}
            />
          )}

          {/* Organization filter */}
          {organizations.length > 0 && (
            <Autocomplete
              multiple
              size="small"
              options={organizations}
              getOptionLabel={(o) => o.name}
              value={orgFilter}
              onChange={(_, v) => setOrgFilter(v)}
              disableCloseOnSelect
              renderOption={(props, option, { selected }) => (
                <li {...props} key={option.id}>
                  <Checkbox size="small" checked={selected} sx={{ mr: 0.5, p: 0 }} />
                  <Typography variant="body2" noWrap>{option.name}</Typography>
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  placeholder={orgFilter.length === 0 ? "Filter by Organization..." : ""}
                  InputProps={{
                    ...params.InputProps,
                    startAdornment: (
                      <>
                        <InputAdornment position="start">
                          <MaterialSymbol icon="corporate_fare" size={16} color="#999" />
                        </InputAdornment>
                        {params.InputProps.startAdornment}
                      </>
                    ),
                  }}
                />
              )}
              sx={{ minWidth: 200, maxWidth: 350, flex: "1 1 200px" }}
            />
          )}

          {/* Summary */}
          <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
            {search
              ? `${matchCount} of ${totalProcesses} processes`
              : orgFilter.length > 0
                ? `${allFlat.length} total, showing filtered`
                : `${totalProcesses} processes`}
          </Typography>
        </Box>
      )}

      {/* ── Breadcrumbs ── */}
      {viewMode === "house" && zoomNodeId && breadcrumbs.length > 0 && (
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

      {/* ── Main Content ── */}
      {viewMode === "house" && (
        <>
          {displayTree.length === 0 ? (
            <Box sx={{ py: 8, textAlign: "center" }}>
              <MaterialSymbol icon="account_tree" size={56} color="#ccc" />
              <Typography color="text.secondary" sx={{ mt: 1, fontSize: "1.05rem" }}>
                No Business Processes found. Add processes to see the Process House.
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
              {rowOrder.map((rowType, rowIdx) => {
                const nodes = houseRows[rowType] || [];
                if (nodes.length === 0 && search) return null;
                return (
                  <Box key={rowType}>
                    {/* Row header */}
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        mb: 1,
                        pl: 0.5,
                      }}
                    >
                      <Box
                        sx={{
                          width: 4,
                          height: 20,
                          borderRadius: 2,
                          bgcolor: PROCESS_TYPE_ROW_COLORS[rowType],
                        }}
                      />
                      <Typography
                        variant="subtitle2"
                        sx={{
                          fontWeight: 700,
                          color: PROCESS_TYPE_ROW_COLORS[rowType],
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          fontSize: "0.75rem",
                        }}
                      >
                        {PROCESS_TYPE_ROW_LABELS[rowType]}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        ({nodes.length})
                      </Typography>
                      {isAdmin && rowOrder.length > 1 && (
                        <Box sx={{ display: "flex", ml: 0.5 }}>
                          <IconButton
                            size="small"
                            disabled={rowIdx === 0}
                            onClick={() => handleMoveRow(rowType, "up")}
                            sx={{ p: 0.25 }}
                          >
                            <MaterialSymbol icon="arrow_upward" size={14} />
                          </IconButton>
                          <IconButton
                            size="small"
                            disabled={rowIdx === rowOrder.length - 1}
                            onClick={() => handleMoveRow(rowType, "down")}
                            sx={{ p: 0.25 }}
                          >
                            <MaterialSymbol icon="arrow_downward" size={14} />
                          </IconButton>
                        </Box>
                      )}
                    </Box>

                    {/* Cards grid */}
                    {nodes.length === 0 ? (
                      <Box
                        sx={{
                          py: 3,
                          textAlign: "center",
                          border: "1px dashed #e0e0e0",
                          borderRadius: 2,
                          bgcolor: "#fafafa",
                        }}
                      >
                        <Typography variant="body2" color="text.secondary">
                          No {PROCESS_TYPE_ROW_LABELS[rowType].toLowerCase()} defined
                        </Typography>
                      </Box>
                    ) : (() => {
                      // Check if nodes will render as containers (expanded with children)
                      // or as compact leaf cards. This determines the grid layout.
                      const allLeaves = nodes.every(
                        (n) => n.level >= displayLevel || n.children.length === 0,
                      );
                      return allLeaves ? (
                        // Leaf cards: multi-column grid filling the row
                        <Box
                          sx={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                            gap: 1.5,
                          }}
                        >
                          {nodes.map((node) => (
                            <HouseCard
                              key={node.id}
                              node={node}
                              displayLevel={displayLevel}
                              overlay={overlay}
                              search={search}
                              isAdmin={isAdmin}
                              rowType={rowType}
                              onOpen={handleOpenDrawer}
                              onDrill={handleDrill}
                              dragRef={dragRef}
                              onDragDrop={handleDragDrop}
                            />
                          ))}
                        </Box>
                      ) : (
                        // Container cards: 2-column layout on wide screens
                        <Box
                          sx={{
                            display: "grid",
                            gridTemplateColumns: {
                              xs: "1fr",
                              md: nodes.length === 1 ? "1fr" : "1fr 1fr",
                              lg: nodes.length <= 2 ? "repeat(" + nodes.length + ", 1fr)" : "1fr 1fr 1fr",
                            },
                            gap: 1.5,
                          }}
                        >
                          {nodes.map((node) => (
                            <HouseCard
                              key={node.id}
                              node={node}
                              displayLevel={displayLevel}
                              overlay={overlay}
                              search={search}
                              isAdmin={isAdmin}
                              rowType={rowType}
                              onOpen={handleOpenDrawer}
                              onDrill={handleDrill}
                              dragRef={dragRef}
                              onDragDrop={handleDragDrop}
                            />
                          ))}
                        </Box>
                      );
                    })()}
                  </Box>
                );
              })}
            </Box>
          )}

          {/* Legend */}
          <Box sx={{ mt: 2, pt: 1.5, borderTop: "1px solid #f0f0f0" }}>
            <OverlayLegend overlay={overlay} />
          </Box>
        </>
      )}

      {viewMode === "matrix" && <MatrixView onNavigate={handleNavigate} />}
      {viewMode === "dependencies" && <DependenciesView onNavigate={handleNavigate} />}

      {/* ── Detail Drawer ── */}
      <Drawer
        anchor="right"
        open={!!drawerNode}
        onClose={() => setDrawerNode(null)}
        PaperProps={{ sx: { width: { xs: "100%", sm: 520 } } }}
      >
        {drawerNode && (
          <ProcessDrawer
            node={drawerNode}
            overlay={overlay}
            typeIcon={typeIcon}
            typeColor={typeColor}
            onClose={() => setDrawerNode(null)}
            onNavigate={handleNavigate}
            onSwitchNode={handleSwitchNode}
            onDrill={handleDrill}
          />
        )}
      </Drawer>
    </Box>
  );
}
