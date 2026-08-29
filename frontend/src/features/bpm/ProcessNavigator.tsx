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
  lazy,
  Suspense,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
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
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Button from "@mui/material/Button";
import DOMPurify from "dompurify";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColumnCountPicker from "@/components/ColumnCountPicker";
import {
  columnGridProps,
  isColumnCount,
  nestedColumns,
  nestedGridProps,
  DEFAULT_COLUMNS,
  type ColumnCount,
} from "@/components/cardColumns";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useCardSubtypeLabel } from "@/hooks/useCardSubtypeLabel";
import { useSubtypeLabel } from "@/hooks/useResolveLabel";
import { useAuth } from "@/hooks/useAuth";
import { useProcessTypeOptions } from "./useProcessTypeOptions";
import type { ProcessTypeOption } from "./useProcessTypeOptions";
import {
  FULL_CAPABILITIES,
  ProcessNavigatorProvider,
  useNavigatorCapabilities,
  useNavigatorMeta,
  useNavigatorSource,
} from "./ProcessNavigatorContext";
import type {
  NavigatorCapabilities,
  NavigatorMeta,
  NavigatorStep,
  ProcessFlowPayload,
  ProcessNavigatorSource,
} from "./ProcessNavigatorContext";
import type { ProcessElement, ProcessFlowVersion } from "@/types";
import { readableTextColor } from "@/lib/color";

const LazyBpmnViewer = lazy(() => import("./BpmnViewer"));

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
  /** Carried by the public process map, so a portal drawer needs no card fetch. */
  description?: string;
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


type ColorOverlay = "processType" | "maturity" | "automationLevel" | "riskLevel";
type ViewMode = "house" | "matrix" | "dependencies";

/* ================================================================== */
/*  Constants                                                          */
/* ================================================================== */

const OVERLAY_OPTIONS: { key: ColorOverlay; labelKey: string; icon: string }[] = [
  { key: "processType", labelKey: "navigator.overlayType", icon: "category" },
  { key: "maturity", labelKey: "navigator.overlayMaturity", icon: "trending_up" },
  { key: "automationLevel", labelKey: "navigator.overlayAutomation", icon: "precision_manufacturing" },
  { key: "riskLevel", labelKey: "navigator.overlayRisk", icon: "warning" },
];

// Exported for the issue #762 regression test (key parity with the seeded
// automationLevel options); it is a plain constant, not a component.
// processType is deliberately absent: its labels/colors are admin-editable
// metamodel data, resolved via useProcessTypeOptions (issue #857).
// eslint-disable-next-line react-refresh/only-export-components
export const ATTR_COLORS: Record<string, Record<string, { label: string; color: string }>> = {
  maturity: {
    initial: { label: "1-Initial", color: "#d32f2f" },
    managed: { label: "2-Managed", color: "#f57c00" },
    defined: { label: "3-Defined", color: "#fbc02d" },
    measured: { label: "4-Measured", color: "#66bb6a" },
    optimized: { label: "5-Optimized", color: "#2e7d32" },
  },
  automationLevel: {
    manual: { label: "Manual", color: "#d32f2f" },
    partiallyAutomated: { label: "Partial", color: "#f57c00" },
    fullyAutomated: { label: "Fully Auto", color: "#2e7d32" },
  },
  riskLevel: {
    low: { label: "Low", color: "#66bb6a" },
    medium: { label: "Medium", color: "#fbc02d" },
    high: { label: "High", color: "#f57c00" },
    critical: { label: "Critical", color: "#d32f2f" },
  },
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

function getCardColor(
  node: ProcNode,
  overlay: ColorOverlay,
  resolveProcessType: (key: string | null | undefined) => ProcessTypeOption,
): string {
  const val = (node.attributes || {})[overlay] as string | undefined;
  if (!val) return "#bdbdbd";
  if (overlay === "processType") return resolveProcessType(val).color;
  return ATTR_COLORS[overlay]?.[val]?.color ?? "#bdbdbd";
}

/* ================================================================== */
/*  Process House Card                                                 */
/* ================================================================== */

function HouseCard({
  node,
  displayLevel,
  columns,
  depth = 1,
  overlay,
  search,
  isAdmin,
  rowType,
  inProcessRow,
  onOpen,
  onDrill,
  onViewFlow,
  dragRef,
  onDragDrop,
}: {
  node: ProcNode;
  displayLevel: number;
  /** The toolbar's top-level pick; the children grid tapers from it. */
  columns: ColumnCount;
  /** 1-based depth of THIS card, relative to the rendered root. Zooming
   *  re-roots the tree without re-levelling its nodes, so this is tracked
   *  separately from `node.level`. */
  depth?: number;
  overlay: ColorOverlay;
  search: string;
  isAdmin?: boolean;
  rowType?: string;
  /** True when rowType is a process-type row key (not a parent card UUID). */
  inProcessRow?: boolean;
  onOpen: (n: ProcNode) => void;
  onDrill: (id: string) => void;
  onViewFlow: (n: ProcNode) => void;
  dragRef?: React.MutableRefObject<{ id: string; rowType: string } | null>;
  onDragDrop?: (dragId: string, dropId: string, rowType: string) => void;
}) {
  const { t } = useTranslation(["bpm", "common"]);
  const stLabel = useSubtypeLabel();
  const meta = useNavigatorMeta();
  const caps = useNavigatorCapabilities();
  const { resolve: resolveProcessType } = meta.processTypes;
  const color = getCardColor(node, overlay, resolveProcessType);
  const isLeaf = node.level >= displayLevel || node.children.length === 0;
  const childCount = node.children.length;
  const hasElements = (node.element_count ?? 0) > 0;
  const hasDiagram = node.has_diagram ?? false;
  const stDef = node.subtype ? meta.subtypes.find((s) => s.key === node.subtype) : undefined;
  const subtypeLabel = stDef ? stLabel(stDef) : null;

  // Search highlight
  const matchesSearch =
    !search || node.name.toLowerCase().includes(search.toLowerCase());
  const opacity = search && !matchesSearch ? 0.3 : 1;

  // A card is nested if rowType is a parent UUID (not a process-type row key)
  const isNested = rowType ? !inProcessRow : false;
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
          borderColor: matchesSearch && search ? color : "divider",
          borderRadius: 2,
          overflow: "hidden",
          bgcolor: "background.paper",
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
                opacity: isNested ? 0.5 : (hovered ? 1 : 0),
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
                "&:hover": { opacity: 1, bgcolor: "rgba(255,255,255,0.5)" },
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
              minWidth: 0,
              lineHeight: 1.3,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {node.name}
          </Typography>
        </Box>

        {/* Footer badges */}
        <Box
          sx={{
            px: 1,
            py: 0.5,
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            bgcolor: "action.hover",
            borderTop: 1,
            borderColor: "divider",
          }}
        >
          {subtypeLabel && (
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.6rem", flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {subtypeLabel}
            </Typography>
          )}
          {caps.showRollups && node.deepAppCount > 0 && (
            <Tooltip title={t("navigator.applicationCount", { count: node.deepAppCount })}>
              <Chip
                size="small"
                icon={<MaterialSymbol icon="apps" size={12} />}
                label={node.deepAppCount}
                sx={{ height: 20, fontSize: "0.65rem", bgcolor: "action.hover", flexShrink: 0 }}
              />
            </Tooltip>
          )}
          {hasElements && (
            <Tooltip title={t("navigator.bpmnElementCount", { count: node.element_count })}>
              <Chip
                size="small"
                icon={<MaterialSymbol icon="checklist" size={12} />}
                label={node.element_count}
                sx={{ height: 20, fontSize: "0.65rem", bgcolor: "action.hover", flexShrink: 0 }}
              />
            </Tooltip>
          )}
          {hasDiagram && (
            <Tooltip title={t("navigator.viewFlow")}>
              <Box
                role="button"
                tabIndex={0}
                aria-label={t("navigator.viewFlow")}
                onClick={(e) => {
                  e.stopPropagation();
                  onViewFlow(node);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onViewFlow(node);
                  }
                }}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  flexShrink: 0,
                  cursor: "pointer",
                  borderRadius: 1,
                  p: 0.25,
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <MaterialSymbol icon="schema" size={14} color="#7b1fa2" />
              </Box>
            </Tooltip>
          )}
          <Box sx={{ flex: 1 }} />
          {childCount > 0 && !isNested && (
            <Tooltip title={t("navigator.subProcessDrillDown", { count: childCount })}>
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
                  flexShrink: 0,
                  "&:hover": { opacity: 0.85 },
                }}
              />
            </Tooltip>
          )}
        </Box>
      </Box>
    );
  }

  // Container card with nested children.
  // Top-level containers use row chevrons; nested containers are draggable.
  const nestedDrag = isNested && canDrag;
  return (
    <Box
      draggable={!!nestedDrag}
      onDragStart={nestedDrag ? (e) => {
        if (!dragHandleActive.current) { e.preventDefault(); return; }
        dragRef!.current = { id: node.id, rowType: rowType! };
        e.dataTransfer.effectAllowed = "move";
        (e.currentTarget as HTMLElement).style.opacity = "0.4";
      } : undefined}
      onDragEnd={nestedDrag ? (e) => {
        (e.currentTarget as HTMLElement).style.opacity = "";
        dragRef!.current = null;
        dragHandleActive.current = false;
      } : undefined}
      onDragOver={nestedDrag ? (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        (e.currentTarget as HTMLElement).style.outline = "2px solid " + color;
      } : undefined}
      onDragLeave={nestedDrag ? (e) => {
        (e.currentTarget as HTMLElement).style.outline = "";
      } : undefined}
      onDrop={nestedDrag ? (e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).style.outline = "";
        if (dragRef!.current && dragRef!.current.rowType === rowType) {
          onDragDrop!(dragRef!.current.id, node.id, rowType!);
        }
        dragRef!.current = null;
      } : undefined}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        overflow: "hidden",
        bgcolor: "background.paper",
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
          flexDirection: "column",
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
        {/* Title row — the name gets the full width */}
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
          {nestedDrag && (
            <Box
              onMouseDown={() => { dragHandleActive.current = true; }}
              onMouseUp={() => { dragHandleActive.current = false; }}
              sx={{
                opacity: 0.5,
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
                "&:hover": { opacity: 1, bgcolor: "rgba(255,255,255,0.5)" },
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
              fontWeight: 700,
              fontSize: "0.82rem",
              flex: 1,
              minWidth: 0,
              lineHeight: 1.3,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {node.name}
          </Typography>
        </Box>
        {/* Meta row — subtype label, counts, and the drill affordance */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minHeight: 20 }}>
          {subtypeLabel && (
            <Typography variant="caption" sx={{ opacity: 0.85, fontSize: "0.6rem", flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {subtypeLabel}
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          {(hasDiagram || hasElements) && (
            <Tooltip title={hasDiagram ? t("navigator.viewFlow") : t("navigator.bpmnElementCount", { count: node.element_count })}>
              <Box
                role={hasDiagram ? "button" : undefined}
                tabIndex={hasDiagram ? 0 : undefined}
                aria-label={hasDiagram ? t("navigator.viewFlow") : undefined}
                onClick={hasDiagram ? (e) => {
                  e.stopPropagation();
                  onViewFlow(node);
                } : undefined}
                onKeyDown={hasDiagram ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onViewFlow(node);
                  }
                } : undefined}
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 0.25,
                  opacity: 0.85,
                  flexShrink: 0,
                  borderRadius: 1,
                  p: 0.25,
                  cursor: hasDiagram ? "pointer" : "default",
                  ...(hasDiagram && { "&:hover": { bgcolor: "rgba(255,255,255,0.2)", opacity: 1 } }),
                }}
              >
                <MaterialSymbol icon="schema" size={16} />
                {hasElements && (
                  <Typography variant="caption" sx={{ fontSize: "0.6rem", color: "#fff", fontWeight: 600, lineHeight: 1 }}>
                    {node.element_count}
                  </Typography>
                )}
              </Box>
            </Tooltip>
          )}
          <Tooltip title={t("navigator.subProcessDrillDown", { count: childCount })}>
            <Chip
              size="small"
              label={childCount}
              sx={{
                height: 20,
                fontSize: "0.65rem",
                fontWeight: 600,
                bgcolor: "rgba(255,255,255,0.25)",
                color: "#fff",
                flexShrink: 0,
              }}
            />
          </Tooltip>
          {!isNested && (
            <Tooltip title={t("navigator.drillDown")}>
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); onDrill(node.id); }}
                sx={{
                  p: 0.25,
                  color: "#fff",
                  opacity: 0.7,
                  flexShrink: 0,
                  "&:hover": { opacity: 1, bgcolor: "rgba(255,255,255,0.2)" },
                }}
              >
                <MaterialSymbol icon="zoom_in" size={18} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>
      <Box
        {...nestedGridProps(nestedColumns(columns, depth + 1), {
          gap: 0.75,
          sx: { p: 0.75, bgcolor: "rgba(0,0,0,0.02)" },
        })}
      >
        {node.children.map((ch) => (
          <Box key={ch.id}>
            <HouseCard
              node={ch}
              displayLevel={displayLevel}
              columns={columns}
              depth={depth + 1}
              overlay={overlay}
              search={search}
              isAdmin={isAdmin}
              rowType={node.id}
              onOpen={onOpen}
              onDrill={onDrill}
              onViewFlow={onViewFlow}
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
  const { t } = useTranslation(["bpm", "common"]);
  const stLabel = useSubtypeLabel();
  const meta = useNavigatorMeta();
  const caps = useNavigatorCapabilities();
  const source = useNavigatorSource();
  const { resolve: resolveProcessType } = meta.processTypes;
  const [card, setCard] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  // A portal source has no `loadCard`: it never calls `/cards/{id}` and never
  // links to one. The description and lifecycle below then fall back to what the
  // process map already carries, so the tab stays useful without a card fetch.
  const loadCard = source.loadCard;
  useEffect(() => {
    if (!loadCard) {
      setCard(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setCard(null);
    loadCard(node.id)
      .then(setCard)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [node.id, loadCard]);

  const description = (card?.description as string | undefined) ?? node.description;
  const lifecycle =
    (card?.lifecycle as Record<string, string> | undefined) ?? node.lifecycle ?? {};

  const attrChips: { label: string; color: string }[] = [];
  for (const opt of OVERLAY_OPTIONS) {
    const val = (node.attributes || {})[opt.key] as string | undefined;
    const info =
      opt.key === "processType"
        ? val
          ? resolveProcessType(val)
          : null
        : val
          ? ATTR_COLORS[opt.key]?.[val]
          : null;
    if (info) attrChips.push({ label: `${t(opt.labelKey)}: ${info.label}`, color: info.color });
  }
  const stDef = node.subtype ? meta.subtypes.find((s) => s.key === node.subtype) : undefined;
  const drawerSubtypeLabel = stDef ? stLabel(stDef) : null;

  return (
    <Box>
      {/* Attribute chips */}
      {attrChips.length > 0 && (
        <Box sx={{ display: "flex", gap: 0.5, mb: 2, flexWrap: "wrap" }}>
          {drawerSubtypeLabel && (
            <Chip size="small" label={drawerSubtypeLabel} variant="outlined" />
          )}
          {attrChips.map((c) => (
            <Chip key={c.label} size="small" label={c.label} sx={{ bgcolor: c.color, color: readableTextColor(c.color) }} />
          ))}
        </Box>
      )}

      {/* KPI row — the application and data counts are landscape data, which a
          portal does not publish, so it shows the step count alone. */}
      <Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap" }}>
        {caps.showRollups && (
          <>
            <Box sx={{ textAlign: "center", minWidth: 70 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>{node.deepAppCount}</Typography>
              <Typography variant="caption" color="text.secondary">{t("navigator.apps")}</Typography>
            </Box>
            <Box sx={{ textAlign: "center", minWidth: 70 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>{node.deepDataObjects.size}</Typography>
              <Typography variant="caption" color="text.secondary">{t("navigator.dataObjects")}</Typography>
            </Box>
          </>
        )}
        <Box sx={{ textAlign: "center", minWidth: 70 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>{node.element_count ?? 0}</Typography>
          <Typography variant="caption" color="text.secondary">{t("navigator.elements")}</Typography>
        </Box>
      </Box>

      {/* Actions */}
      {(node.children.length > 0 || node.has_diagram) && (
        <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
          {node.children.length > 0 && (
            <Chip
              size="small"
              icon={<MaterialSymbol icon="zoom_in" size={14} />}
              label={t("navigator.drillDown")}
              onClick={() => onDrill(node.id)}
              color="secondary"
              sx={{ cursor: "pointer" }}
            />
          )}
          {node.has_diagram && caps.canOpenCard ? (
            <Chip
              size="small"
              icon={<MaterialSymbol icon="schema" size={14} />}
              label={t("navigator.viewFlow")}
              onClick={() => onNavigate(`/cards/${node.id}?tab=1`)}
              variant="outlined"
              sx={{ cursor: "pointer" }}
            />
          ) : null}
        </Box>
      )}

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* Description */}
      {!!description && (
        <>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t("common:labels.description")}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap", mb: 1 }}>
            {String(description)}
          </Typography>
        </>
      )}

      {/* Lifecycle */}
      {Object.keys(lifecycle).length > 0 && (
        <>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t("navigator.lifecycle")}</Typography>
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mb: 1 }}>
            {Object.entries(lifecycle).map(
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
      {card && (
        <>
          <Divider sx={{ my: 1.5 }} />
          <Box sx={{ display: "flex", gap: 2, mb: 1, alignItems: "center" }}>
            {typeof card.data_quality === "number" && (
              <Box sx={{ flex: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {t("navigator.completion")}
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <LinearProgress
                    variant="determinate"
                    value={card.data_quality as number}
                    sx={{ flex: 1, height: 6, borderRadius: 3 }}
                  />
                  <Typography variant="caption" sx={{ fontWeight: 600, minWidth: 35 }}>
                    {Math.round(card.data_quality as number)}%
                  </Typography>
                </Box>
              </Box>
            )}
            {card.approval_status ? (
              <Chip
                size="small"
                label={String(card.approval_status)}
                color={
                  card.approval_status === "APPROVED"
                    ? "success"
                    : card.approval_status === "REJECTED"
                      ? "error"
                      : card.approval_status === "BROKEN"
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
            {t("navigator.subProcesses", { count: node.children.length })}
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
                  bgcolor: getCardColor(ch, overlay, resolveProcessType),
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
                    {t("navigator.appsCount", { count: ch.deepAppCount })}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        </>
      )}

      {/* Tags */}
      {card &&
        Array.isArray(card.tags) &&
        (card.tags as Array<{ id: string; name: string; color?: string }>).length > 0 && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t("navigator.tags")}</Typography>
            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
              {(card.tags as Array<{ id: string; name: string; color?: string }>).map((tag) => (
                <Chip
                  key={tag.id}
                  size="small"
                  label={tag.name}
                  sx={tag.color ? { bgcolor: tag.color, color: readableTextColor(tag.color) } : {}}
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
  const { t } = useTranslation(["bpm", "common"]);
  const source = useNavigatorSource();
  const caps = useNavigatorCapabilities();
  const [elements, setElements] = useState<NavigatorStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    source
      .loadFlow(processId)
      .then((flow) => {
        if (!cancelled) setElements(flow.steps);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "Failed to load elements");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [processId, source]);

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
          {t("navigator.noElements")}
        </Typography>
      </Box>
    );

  // Group by lane
  const lanes = new Map<string, NavigatorStep[]>();
  for (const el of elements) {
    const lane = el.lane_name || t("navigator.defaultLane");
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
                <Box key={el.bpmn_element_id}>
                  {/* Step card */}
                  <Box
                    sx={{
                      display: "flex",
                      gap: 1.5,
                      alignItems: "flex-start",
                      px: 1.5,
                      py: 1,
                      borderRadius: 1.5,
                      border: 1,
                      borderColor: "divider",
                      bgcolor: el.is_automated ? "rgba(126,87,194,0.04)" : "background.paper",
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
                          {el.name || t("viewer.unnamed")}
                        </Typography>
                        {el.is_automated && (
                          <Chip
                            size="small"
                            label={t("navigator.auto")}
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
                            onClick={
                              caps.canOpenCard && el.application_id
                                ? () => onNavigate(el.application_id!)
                                : undefined
                            }
                            sx={{
                              height: 20,
                              fontSize: "0.65rem",
                              cursor: "pointer",
                              bgcolor: "action.hover",
                              "&:hover": { bgcolor: "action.selected" },
                            }}
                          />
                        )}
                        {el.data_object_name && (
                          <Chip
                            size="small"
                            icon={<MaterialSymbol icon="database" size={12} />}
                            label={el.data_object_name}
                            onClick={
                              caps.canOpenCard && el.data_object_id
                                ? () => onNavigate(el.data_object_id!)
                                : undefined
                            }
                            sx={{
                              height: 20,
                              fontSize: "0.65rem",
                              cursor: "pointer",
                              bgcolor: "action.hover",
                              "&:hover": { bgcolor: "action.selected" },
                            }}
                          />
                        )}
                        {el.it_component_name && (
                          <Chip
                            size="small"
                            icon={<MaterialSymbol icon="memory" size={12} />}
                            label={el.it_component_name}
                            onClick={
                              caps.canOpenCard && el.it_component_id
                                ? () => onNavigate(el.it_component_id!)
                                : undefined
                            }
                            sx={{
                              height: 20,
                              fontSize: "0.65rem",
                              cursor: "pointer",
                              bgcolor: "action.hover",
                              "&:hover": { bgcolor: "action.selected" },
                            }}
                          />
                        )}
                        {(el.organizations || []).map((org) => (
                          <Chip
                            key={org.id}
                            size="small"
                            icon={<MaterialSymbol icon="corporate_fare" size={12} />}
                            label={org.name}
                            onClick={caps.canOpenCard ? () => onNavigate(org.id) : undefined}
                            sx={{
                              height: 20,
                              fontSize: "0.65rem",
                              cursor: "pointer",
                              bgcolor: "action.hover",
                              "&:hover": { bgcolor: "action.selected" },
                            }}
                          />
                        ))}
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
  const { t } = useTranslation(["bpm", "common"]);
  const source = useNavigatorSource();
  const caps = useNavigatorCapabilities();
  const [svgThumbnail, setSvgThumbnail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasPublished, setHasPublished] = useState(false);
  const [hasDrafts, setHasDrafts] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setHasPublished(false);
    setHasDrafts(false);
    setSvgThumbnail(null);

    // One call for the published flow, its thumbnail and its steps — the tab
    // used to make two, and the fullscreen preview a third for the same data.
    source
      .loadFlow(processId)
      .then((flow) => {
        if (cancelled) return;
        if (flow.bpmnXml) {
          setHasPublished(true);
          if (flow.svgThumbnail) setSvgThumbnail(flow.svgThumbnail);
        }
        if (flow.hasDrafts) setHasDrafts(true);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [processId, source]);

  // Navigate to card detail Process Flow tab (read-only published view)
  const openFlowTab = () => onNavigate(`/cards/${processId}?tab=1`);
  // Navigate to card detail Process Flow tab, Drafts sub-tab
  const openDraftsTab = () => onNavigate(`/cards/${processId}?tab=1&subtab=1`);

  if (loading)
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <CircularProgress size={32} />
      </Box>
    );

  if (!hasPublished && !hasDrafts)
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <MaterialSymbol icon="schema" size={40} color="#ccc" />
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("navigator.noProcessFlow")}
        </Typography>
        {caps.canOpenCard && (
          <Chip
            size="small"
            icon={<MaterialSymbol icon="open_in_new" size={14} />}
            label={t("navigator.goToProcessFlow")}
            onClick={openFlowTab}
            color="primary"
            sx={{ mt: 1, cursor: "pointer" }}
          />
        )}
      </Box>
    );

  if (!hasPublished && hasDrafts)
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <MaterialSymbol icon="edit_note" size={40} color="#ed6c02" />
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("navigator.noPublishedDraftAvailable")}
        </Typography>
        <Chip
          size="small"
          icon={<MaterialSymbol icon="open_in_new" size={14} />}
          label={t("navigator.viewDrafts")}
          onClick={openDraftsTab}
          color="warning"
          sx={{ mt: 1, cursor: "pointer" }}
        />
      </Box>
    );

  if (hasPublished && !svgThumbnail)
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <MaterialSymbol icon="schema" size={40} color="#7b1fa2" />
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("navigator.publishedFlowAvailable")}
        </Typography>
        {caps.canOpenCard && (
          <Chip
            size="small"
            icon={<MaterialSymbol icon="open_in_new" size={14} />}
            label={t("navigator.viewPublishedFlow")}
            onClick={openFlowTab}
            color="primary"
            sx={{ mt: 1, cursor: "pointer" }}
          />
        )}
      </Box>
    );

  return (
    <Box>
      <Box
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          overflow: "hidden",
          mb: 2,
          bgcolor: "action.hover",
          cursor: "pointer",
          "&:hover": { boxShadow: 2 },
          "& svg": { maxWidth: "100%", height: "auto" },
        }}
        onClick={caps.canOpenCard ? openFlowTab : undefined}
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(svgThumbnail!, { USE_PROFILES: { svg: true } }) }}
      />
      {caps.canOpenCard && (
        <Box sx={{ display: "flex", justifyContent: "center" }}>
          <Chip
            size="small"
            icon={<MaterialSymbol icon="open_in_new" size={14} />}
            label={t("navigator.viewPublishedFlow")}
            onClick={openFlowTab}
            color="primary"
            sx={{ cursor: "pointer" }}
          />
        </Box>
      )}
    </Box>
  );
}

/* ================================================================== */
/*  Fullscreen Flow Preview Dialog                                     */
/* ================================================================== */

function FlowPreviewDialog({
  node,
  onClose,
  onNavigate,
}: {
  node: ProcNode;
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  const { t } = useTranslation(["bpm", "common"]);
  const source = useNavigatorSource();
  const caps = useNavigatorCapabilities();
  const [loading, setLoading] = useState(true);
  const [bpmnXml, setBpmnXml] = useState<string | null>(null);
  const [elements, setElements] = useState<NavigatorStep[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBpmnXml(null);
    setElements([]);
    source
      .loadFlow(node.id)
      .then((flow) => {
        if (cancelled) return;
        setBpmnXml(flow.bpmnXml);
        setElements(flow.steps);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [node.id, source]);

  const openFlowEditor = () => onNavigate(`/cards/${node.id}?tab=1`);

  return (
    <Dialog open onClose={onClose} fullScreen>
      <AppBar position="relative" color="default" elevation={1}>
        <Toolbar>
          <IconButton edge="start" onClick={onClose} aria-label={t("common:actions.close")}>
            <MaterialSymbol icon="close" />
          </IconButton>
          <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div" noWrap>
            {node.name} &mdash; {t("navigator.flow")}
          </Typography>
          {caps.canOpenCard && (
            <Button
              color="inherit"
              startIcon={<MaterialSymbol icon="open_in_new" />}
              onClick={openFlowEditor}
            >
              {t("navigator.viewFlow")}
            </Button>
          )}
        </Toolbar>
      </AppBar>
      <DialogContent sx={{ p: 0, display: "flex", flexDirection: "column" }}>
        {loading ? (
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", py: 6 }}>
            <CircularProgress size={40} />
          </Box>
        ) : !bpmnXml ? (
          <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", py: 6 }}>
            <MaterialSymbol icon="schema" size={48} color="#ccc" />
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {t("navigator.noProcessFlow")}
            </Typography>
            {caps.canOpenCard && (
              <Chip
                size="small"
                icon={<MaterialSymbol icon="open_in_new" size={14} />}
                label={t("navigator.goToProcessFlow")}
                onClick={openFlowEditor}
                color="primary"
                sx={{ mt: 1.5, cursor: "pointer" }}
              />
            )}
          </Box>
        ) : (
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <Suspense
              fallback={
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "calc(100vh - 116px)" }}>
                  <CircularProgress size={40} />
                </Box>
              }
            >
              <LazyBpmnViewer
                bpmnXml={bpmnXml}
                elements={elements}
                onElementClick={() => {}}
                height="calc(100vh - 116px)"
              />
            </Suspense>
          </Box>
        )}
      </DialogContent>
    </Dialog>
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
  const { t } = useTranslation(["bpm", "common"]);
  const subtypeLabel = useCardSubtypeLabel();
  const apps = useMemo(
    () => Array.from(node.deepUniqueApps.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [node],
  );

  if (apps.length === 0)
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <MaterialSymbol icon="apps" size={40} color="#ccc" />
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("navigator.noAppsLinked")}
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
            border: 1,
            borderColor: "divider",
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
                {subtypeLabel("Application", app.subtype)}
              </Typography>
            )}
          </Box>
          {app.lifecycle?.endOfLife && (
            <Tooltip title={t("navigator.endOfLife")}>
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
  const { t } = useTranslation(["bpm", "common"]);
  const dataObjs = useMemo(
    () => Array.from(node.deepDataObjects.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [node],
  );

  if (dataObjs.length === 0)
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <MaterialSymbol icon="database" size={40} color="#ccc" />
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("navigator.noDataObjectsLinked")}
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
            border: 1,
            borderColor: "divider",
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
  const { t } = useTranslation(["bpm", "common"]);
  const caps = useNavigatorCapabilities();
  const [tab, setTab] = useState(0);
  // Rendered by key, not by index: a portal publishes only the first three, so
  // a positional `tab === 3` would silently show Data under an Apps label.
  const tabs = caps.drawerTabs;
  const activeTab = tabs[Math.min(tab, tabs.length - 1)];

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
          {caps.canOpenCard && (
            <Tooltip title={t("navigator.openCard")}>
              <IconButton
                onClick={() => onNavigate(node.id)}
                size="small"
                sx={{ color: "#fff" }}
                aria-label={t("navigator.openCard")}
              >
                <MaterialSymbol icon="open_in_new" size={20} />
              </IconButton>
            </Tooltip>
          )}
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
        {tabs.map((key) =>
          key === "overview" ? (
            <Tab key={key} label={t("navigator.overview")} icon={<MaterialSymbol icon="info" size={16} />} iconPosition="start" />
          ) : key === "steps" ? (
            <Tab
              key={key}
              label={`${t("navigator.steps")}${node.element_count ? ` (${node.element_count})` : ""}`}
              icon={<MaterialSymbol icon="checklist" size={16} />}
              iconPosition="start"
            />
          ) : key === "flow" ? (
            <Tab key={key} label={t("navigator.flow")} icon={<MaterialSymbol icon="schema" size={16} />} iconPosition="start" />
          ) : key === "apps" ? (
            <Tab
              key={key}
              label={`${t("navigator.apps")} (${node.deepAppCount})`}
              icon={<MaterialSymbol icon="apps" size={16} />}
              iconPosition="start"
            />
          ) : (
            <Tab
              key={key}
              label={`${t("navigator.data")} (${node.deepDataObjects.size})`}
              icon={<MaterialSymbol icon="database" size={16} />}
              iconPosition="start"
            />
          ),
        )}
      </Tabs>

      {/* Tab content */}
      <Box sx={{ flex: 1, overflowY: "auto", p: 2 }}>
        {activeTab === "overview" && (
          <DrawerOverview
            node={node}
            overlay={overlay}
            onNavigate={onNavigate}
            onSwitchNode={onSwitchNode}
            onDrill={onDrill}
          />
        )}
        {activeTab === "steps" && <DrawerSteps processId={node.id} onNavigate={onNavigate} />}
        {activeTab === "flow" && <DrawerFlow processId={node.id} onNavigate={onNavigate} />}
        {activeTab === "apps" && <DrawerApps node={node} onNavigate={onNavigate} />}
        {activeTab === "data" && <DrawerData node={node} onNavigate={onNavigate} />}
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
  const { t } = useTranslation(["bpm", "common"]);
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
          {t("reports.noDataLinkApplications")}
        </Typography>
      </Box>
    );

  return (
    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 600 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700, position: "sticky", left: 0, zIndex: 3, bgcolor: "background.paper" }}>
              {t("reports.process")}
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
                  bgcolor: "background.paper",
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
                            x.source === "element" ? `${t("reports.element")}: ${x.element_name}` : t("reports.relation"),
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
  const { t } = useTranslation(["bpm", "common"]);
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
          {t("reports.noDependencies")}
        </Typography>
      </Box>
    );

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("reports.dependenciesSummary", { processes: data.nodes.length, dependencies: data.edges.length })}
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>{t("reports.fromProcess")}</TableCell>
              <TableCell align="center" sx={{ width: 80 }}>
                {t("reports.dependsOn")}
              </TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{t("reports.toProcess")}</TableCell>
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
  const { t } = useTranslation(["bpm", "common"]);
  const marks = [];
  for (let i = 1; i <= maxLevel; i++) {
    marks.push({ value: i, label: `L${i}` });
  }
  if (maxLevel > 1) {
    marks.push({ value: maxLevel + 1, label: t("common:labels.all") });
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
        {t("navigator.depth")}
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
  const { t } = useTranslation(["bpm", "common"]);
  const { options: processTypeOptions } = useNavigatorMeta().processTypes;
  const items =
    overlay === "processType"
      ? processTypeOptions.map(({ label, color }) => ({ label, color }))
      : Object.values(ATTR_COLORS[overlay] ?? {});
  if (items.length === 0) return null;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
      {items.map((item) => (
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
          {t("navigator.notSet")}
        </Typography>
      </Box>
    </Box>
  );
}

/* ================================================================== */
/*  Main: ProcessNavigator                                             */
/* ================================================================== */

/**
 * The navigator itself. Renders from the source, capabilities and metamodel
 * facts on the context, so the in-app page and a published web portal share
 * one implementation. See `ProcessNavigatorContext.tsx`.
 */
export function ProcessNavigatorBody() {
  const { t } = useTranslation(["bpm", "common"]);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const source = useNavigatorSource();
  const caps = useNavigatorCapabilities();
  const meta = useNavigatorMeta();
  const isAdmin = caps.canReorder;
  const containerRef = useRef<HTMLDivElement>(null);

  const typeIcon = meta.typeIcon;
  const typeColor = meta.typeColor;

  // ── Data ──
  const [data, setData] = useState<ProcItem[] | null>(null);
  const [organizations, setOrganizations] = useState<RefItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reordering, setReordering] = useState(false);
  const [rowOrder, setRowOrder] = useState<string[]>(["management", "core", "support"]);

  // ── Load defaults from localStorage (URL params take priority) ──
  const STORAGE_KEY = "turboea-report:process-navigator";
  const [localConfig] = useState<Record<string, unknown> | null>(() => {
    // A portal visitor gets the opening state its administrator configured, and
    // nothing is remembered — a reload returns to it. Same contract as the
    // published PPM board.
    //
    // Mapped onto the stored-preference key names rather than spread verbatim:
    // the readers below look for `displayLevel`, so passing the capability's
    // `level` through unchanged would silently ignore a configured opening level.
    if (!caps.persistPreferences) {
      const init = caps.initial;
      if (!init) return null;
      return {
        displayLevel: init.level,
        overlay: init.overlay,
        columns: init.columns,
      };
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return null;
  });

  // ── URL-synced state (with localStorage fallback) ──
  const hasUrlParams = searchParams.toString().length > 0;
  const viewParam = (searchParams.get("view") as ViewMode) || (!hasUrlParams && localConfig?.viewMode as ViewMode) || "house";
  const searchParam = searchParams.get("search") || "";
  const levelParam = parseInt(searchParams.get("level") || (!hasUrlParams && localConfig?.displayLevel != null ? String(localConfig.displayLevel) : "2"), 10);
  const overlayParam = (searchParams.get("overlay") as ColorOverlay) || (!hasUrlParams && localConfig?.overlay as ColorOverlay) || "processType";
  const colsRaw = searchParams.get("cols") ?? (!hasUrlParams ? localConfig?.columns : undefined);
  const colsNum = Number(colsRaw);
  const colsParam: ColumnCount = isColumnCount(colsNum) ? colsNum : DEFAULT_COLUMNS;
  const zoomParam = searchParams.get("zoom") || null;
  const drawerParam = searchParams.get("open") || null;

  const [viewMode, setViewMode] = useState<ViewMode>(viewParam);
  const [search, setSearch] = useState(searchParam);
  const [displayLevel, setDisplayLevel] = useState(levelParam);
  const [overlay, setOverlay] = useState<ColorOverlay>(overlayParam);
  const [columns, setColumns] = useState<ColumnCount>(colsParam);
  const [zoomNodeId, setZoomNodeId] = useState<string | null>(zoomParam);
  const [drawerNode, setDrawerNode] = useState<ProcNode | null>(null);
  const [flowNode, setFlowNode] = useState<ProcNode | null>(null);
  const [orgFilter, setOrgFilter] = useState<RefItem[]>([]);

  // ── Load data ──
  const loadData = useCallback(() => {
    source
      .loadMap()
      .then((r) => {
        setData(r.items as ProcItem[]);
        setOrganizations(r.organizations ?? []);
        if (r.rowOrder?.length) setRowOrder(r.rowOrder);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [source]);

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
    if (columns !== DEFAULT_COLUMNS) params.cols = String(columns);
    if (zoomNodeId) params.zoom = zoomNodeId;
    if (drawerNode) params.open = drawerNode.id;
    setSearchParams(params, { replace: true });
  }, [viewMode, search, displayLevel, overlay, columns, zoomNodeId, drawerNode, setSearchParams]);

  // ── Auto-persist to localStorage ──
  useEffect(() => {
    if (!caps.persistPreferences) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        viewMode,
        displayLevel,
        overlay,
        columns,
      }));
    } catch { /* ignore */ }
  }, [viewMode, displayLevel, overlay, columns, STORAGE_KEY, caps.persistPreferences]);

  // ── Reset all parameters to defaults ──
  const handleReset = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setViewMode("house");
    setSearch("");
    setDisplayLevel(2);
    setOverlay("processType");
    setColumns(DEFAULT_COLUMNS);
    setZoomNodeId(null);
    setDrawerNode(null);
    setOrgFilter([]);
  }, [STORAGE_KEY]);

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

  const handleViewFlow = useCallback((node: ProcNode) => setFlowNode(node), []);

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
        navigate(`/cards/${path}`);
      }
    },
    [navigate],
  );

  const handleSwitchNode = useCallback((n: ProcNode) => {
    setDrawerNode(n);
  }, []);

  // ── Process House rows: metamodel-driven grouping by processType ──
  const {
    options: ptOptions,
    defaultKey: ptDefaultKey,
    resolve: resolveProcessType,
  } = meta.processTypes;

  const houseRows = useMemo(() => {
    const rows: Record<string, ProcNode[]> = {};
    for (const opt of ptOptions) rows[opt.key] = [];
    if (!rows[ptDefaultKey]) rows[ptDefaultKey] = [];
    for (const node of displayTree) {
      const pType = (node.attributes?.processType as string) || ptDefaultKey;
      // Unknown / hidden keys get their own synthetic row instead of being
      // silently folded into the default row.
      if (!rows[pType]) rows[pType] = [];
      rows[pType].push(node);
    }
    return rows;
  }, [displayTree, ptOptions, ptDefaultKey]);

  // Persisted order first (stale keys dropped), then any option or
  // data-derived row key it doesn't cover yet, in metamodel order.
  const effectiveRowOrder = useMemo(() => {
    const known = new Set(Object.keys(houseRows));
    const order: string[] = [];
    for (const key of [...rowOrder, ...ptOptions.map((o) => o.key), ...Object.keys(houseRows)]) {
      if (known.has(key) && !order.includes(key)) order.push(key);
    }
    return order;
  }, [rowOrder, ptOptions, houseRows]);

  // ── Drag-and-drop reorder for cards (admin only) ──
  const dragRef = useRef<{ id: string; rowType: string } | null>(null);
  const handleDragDrop = useCallback(
    async (dragId: string, dropId: string, rowType: string) => {
      if (!data || reordering || dragId === dropId) return;

      // rowType is either a process-type row key (e.g. "management")
      // or a parent node ID (for leaf cards inside a container).
      const isProcessRow = effectiveRowOrder.includes(rowType);
      const siblings = data
        .filter((d) => isProcessRow
          ? (!d.parent_id && ((d.attributes?.processType as string) || ptDefaultKey) === rowType)
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

      if (!source.reorderCards) return;
      setReordering(true);
      try {
        await source.reorderCards(reordered.map((s, i) => ({ id: s.id, sortOrder: i })));
        loadData();
      } catch (e) {
        console.error("Drag reorder failed", e);
      } finally {
        setReordering(false);
      }
    },
    [data, reordering, loadData, effectiveRowOrder, ptDefaultKey, source],
  );

  // ── Row reorder (admin) ──
  const handleMoveRow = useCallback(
    async (rowType: string, direction: "up" | "down") => {
      const idx = effectiveRowOrder.indexOf(rowType);
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (idx < 0 || swapIdx < 0 || swapIdx >= effectiveRowOrder.length) return;
      const newOrder = [...effectiveRowOrder];
      [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
      setRowOrder(newOrder);
      // Persist to backend
      try {
        await source.saveRowOrder?.(newOrder);
      } catch (e) {
        console.error("Failed to save row order", e);
      }
    },
    [effectiveRowOrder, source],
  );

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
            <Tooltip title={t("navigator.processHouse")}>
              <Box sx={{ display: "flex" }}>
                <MaterialSymbol icon="grid_view" size={18} />
              </Box>
            </Tooltip>
          </ToggleButton>
          {caps.viewModes.includes("matrix") && (
            <ToggleButton value="matrix">
              <Tooltip title={t("navigator.processAppMatrix")}>
                <Box sx={{ display: "flex" }}>
                  <MaterialSymbol icon="table_chart" size={18} />
                </Box>
              </Tooltip>
            </ToggleButton>
          )}
          {caps.viewModes.includes("dependencies") && (
            <ToggleButton value="dependencies">
              <Tooltip title={t("reports.processDependencies")}>
                <Box sx={{ display: "flex" }}>
                  <MaterialSymbol icon="hub" size={18} />
                </Box>
              </Tooltip>
            </ToggleButton>
          )}
        </ToggleButtonGroup>

        <Tooltip title={t("navigator.resetToDefaults")}>
          <IconButton size="small" onClick={handleReset}>
            <MaterialSymbol icon="restart_alt" size={20} />
          </IconButton>
        </Tooltip>
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
            bgcolor: "action.hover",
            borderRadius: 2,
            border: 1,
            borderColor: "divider",
          }}
        >
          {/* Search */}
          <TextField
            size="small"
            placeholder={t("navigator.searchProcesses")}
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
                label={t(opt.labelKey)}
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

          <ColumnCountPicker value={columns} onChange={setColumns} />

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
                  placeholder={orgFilter.length === 0 ? t("navigator.filterByOrg") : ""}
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
              ? t("navigator.matchOfTotal", { match: matchCount, total: totalProcesses })
              : orgFilter.length > 0
                ? t("navigator.totalShowingFiltered", { total: allFlat.length })
                : t("navigator.totalProcesses", { count: totalProcesses })}
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
              {t("navigator.allProcesses")}
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
                {t("navigator.noProcessesFound")}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
              {effectiveRowOrder.map((rowType, rowIdx) => {
                const nodes = houseRows[rowType] || [];
                if (nodes.length === 0 && search) return null;
                const rowOption = resolveProcessType(rowType);
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
                          bgcolor: rowOption.color,
                        }}
                      />
                      <Typography
                        variant="subtitle2"
                        sx={{
                          fontWeight: 700,
                          color: rowOption.color,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          fontSize: "0.75rem",
                        }}
                      >
                        {t("navigator.processRow", { type: rowOption.label })}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        ({nodes.length})
                      </Typography>
                      {isAdmin && effectiveRowOrder.length > 1 && (
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
                            disabled={rowIdx === effectiveRowOrder.length - 1}
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
                          border: "1px dashed",
                          borderColor: "divider",
                          borderRadius: 2,
                          bgcolor: "action.hover",
                        }}
                      >
                        <Typography variant="body2" color="text.secondary">
                          {t("navigator.noProcessesDefined", { type: t("navigator.processRow", { type: rowOption.label }) })}
                        </Typography>
                      </Box>
                    ) : (() => {
                      // Check if nodes will render as containers (expanded with children)
                      // or as compact leaf cards. This determines the grid layout.
                      const allLeaves = nodes.every(
                        (n) => n.level >= displayLevel || n.children.length === 0,
                      );
                      // Honour the user's column choice, but never leave a
                      // short row stretched across empty tracks.
                      const rowCols = Math.min(columns, nodes.length) as ColumnCount;
                      return allLeaves ? (
                        // Leaf cards: multi-column grid filling the row
                        <Box {...columnGridProps(rowCols, { gap: 1.5 })}>
                          {nodes.map((node) => (
                            <HouseCard
                              key={node.id}
                              node={node}
                              displayLevel={displayLevel}
                              columns={columns}
                              overlay={overlay}
                              search={search}
                              isAdmin={isAdmin}
                              rowType={rowType}
                              inProcessRow
                              onOpen={handleOpenDrawer}
                              onDrill={handleDrill}
                              onViewFlow={handleViewFlow}
                              dragRef={dragRef}
                              onDragDrop={handleDragDrop}
                            />
                          ))}
                        </Box>
                      ) : (
                        // Container cards: same column choice as leaf rows
                        <Box {...columnGridProps(rowCols, { gap: 1.5 })}>
                          {nodes.map((node) => (
                            <HouseCard
                              key={node.id}
                              node={node}
                              displayLevel={displayLevel}
                              columns={columns}
                              overlay={overlay}
                              search={search}
                              isAdmin={isAdmin}
                              rowType={rowType}
                              inProcessRow
                              onOpen={handleOpenDrawer}
                              onDrill={handleDrill}
                              onViewFlow={handleViewFlow}
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
          <Box sx={{ mt: 2, pt: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
            <OverlayLegend overlay={overlay} />
          </Box>
        </>
      )}

      {viewMode === "matrix" && caps.viewModes.includes("matrix") && (
        <MatrixView onNavigate={handleNavigate} />
      )}
      {viewMode === "dependencies" && caps.viewModes.includes("dependencies") && (
        <DependenciesView onNavigate={handleNavigate} />
      )}

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

      {/* ── Fullscreen Flow Preview ── */}
      {flowNode && (
        <FlowPreviewDialog
          node={flowNode}
          onClose={() => setFlowNode(null)}
          onNavigate={handleNavigate}
        />
      )}
    </Box>
  );
}

/* ================================================================== */
/*  Authenticated container                                            */
/* ================================================================== */

/**
 * The in-app Process Navigator.
 *
 * Supplies the authenticated source and the full capability set, so this export
 * behaves exactly as it did before the context seam existed — which is what lets
 * `ProcessNavigator.test.tsx` go on guarding it unchanged. The published portal
 * twin is `features/web-portals/PortalProcessNavigator.tsx`.
 */
export default function ProcessNavigator() {
  const { getType } = useMetamodel();
  const processTypes = useProcessTypeOptions();
  const { user } = useAuth();
  const bpType = getType("BusinessProcess");

  const source = useMemo<ProcessNavigatorSource>(
    () => ({
      loadMap: async () => {
        const [r, rowOrderRes] = await Promise.all([
          api.get<{ items: ProcItem[]; organizations: RefItem[] }>("/reports/bpm/process-map"),
          api
            .get<{ row_order: string[] }>("/settings/bpm-row-order")
            .catch(() => ({ row_order: ["management", "core", "support"] })),
        ]);
        return {
          items: r.items,
          organizations: r.organizations ?? [],
          rowOrder: rowOrderRes.row_order ?? [],
        };
      },
      // One call for what used to be two endpoints fetched three times: the
      // Steps tab, the flow thumbnail and the fullscreen preview all want the
      // published flow and its elements.
      loadFlow: async (processId): Promise<ProcessFlowPayload> => {
        const [pub, els, drafts] = await Promise.all([
          api
            .get<ProcessFlowVersion | null>(`/bpm/processes/${processId}/flow/published`)
            .catch(() => null),
          api
            .get<ProcessElement[]>(`/bpm/processes/${processId}/elements`)
            .catch(() => [] as ProcessElement[]),
          api
            .get<{ id: string }[]>(`/bpm/processes/${processId}/flow/drafts`)
            .catch(() => [] as { id: string }[]),
        ]);
        return {
          bpmnXml: pub?.bpmn_xml ?? null,
          svgThumbnail: pub?.svg_thumbnail ?? null,
          steps: (els ?? []) as NavigatorStep[],
          hasDrafts: (drafts?.length ?? 0) > 0,
        };
      },
      loadCard: (processId) => api.get<Record<string, unknown>>(`/cards/${processId}`),
      reorderCards: async (updates) => {
        await Promise.all(
          updates.map((u) =>
            api.patch(`/cards/${u.id}`, { attributes: { sortOrder: u.sortOrder } }),
          ),
        );
      },
      saveRowOrder: async (order) => {
        await api.patch("/settings/bpm-row-order", { row_order: order });
      },
    }),
    [],
  );

  const capabilities = useMemo<NavigatorCapabilities>(
    () => ({ ...FULL_CAPABILITIES, canReorder: user?.role === "admin" }),
    [user?.role],
  );

  const meta = useMemo<NavigatorMeta>(
    () => ({
      typeIcon: bpType?.icon ?? "route",
      typeColor: bpType?.color ?? "#028f00",
      subtypes: bpType?.subtypes ?? [],
      processTypes,
    }),
    [bpType, processTypes],
  );

  return (
    <ProcessNavigatorProvider value={{ source, capabilities, meta }}>
      <ProcessNavigatorBody />
    </ProcessNavigatorProvider>
  );
}
