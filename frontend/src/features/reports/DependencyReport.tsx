import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Autocomplete from "@mui/material/Autocomplete";
import Tooltip from "@mui/material/Tooltip";
import InputAdornment from "@mui/material/InputAdornment";
import IconButton from "@mui/material/IconButton";
import Badge from "@mui/material/Badge";
import ReportShell from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { api } from "@/api/client";
import type { CardType } from "@/types";

/* ------------------------------------------------------------------ */
/*  Data types                                                         */
/* ------------------------------------------------------------------ */

interface GNode {
  id: string;
  name: string;
  type: string;
  lifecycle?: Record<string, string>;
  attributes?: Record<string, unknown>;
  parent_id?: string | null;
  path?: string[];
}

interface GEdge {
  source: string;
  target: string;
  type: string;
  label?: string;
  reverse_label?: string;
  description?: string;
}

/* ------------------------------------------------------------------ */
/*  Layout types                                                       */
/* ------------------------------------------------------------------ */

interface PositionedCard {
  instanceId: string;
  id: string;
  node: GNode;
  column: number;
  x: number;
  y: number;
  parentInstanceId: string | null;
  isExpanded: boolean;
  canExpand: boolean;
  isRoot: boolean;
  isDuplicate: boolean;
  breadcrumb: string[];
  connectionCount: number;
}

interface PositionedHeader {
  key: string;
  typeKey: string;
  typeLabel: string;
  typeColor: string;
  typeIcon: string;
  count: number;
  x: number;
  y: number;
}

interface Connection {
  fromInstance: string;
  toInstance: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  relType: string;
  relLabel: string;
  relDescription?: string;
}

interface TreeLayout {
  cards: PositionedCard[];
  headers: PositionedHeader[];
  connections: Connection[];
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CARD_W = 248;
const CARD_H = 40;
const CARD_PATH_H = 52;
const ROOT_CARD_H = 56;
const COL_GAP = 90;
const COL_SPACING = CARD_W + COL_GAP;
const ITEM_GAP = 5;
const GROUP_GAP = 18;
const HEADER_H = 26;
const PADDING = 28;

const FALLBACK_COLORS: Record<string, string> = {
  Application: "#0f7eb5",
  Interface: "#02afa4",
  ITComponent: "#d29270",
  DataObject: "#774fcc",
  BusinessCapability: "#003399",
  Organization: "#2889ff",
  Initiative: "#33cc58",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function tc(key: string, types: CardType[]): string {
  return types.find((t) => t.key === key)?.color || FALLBACK_COLORS[key] || "#999";
}
function tl(key: string, types: CardType[]): string {
  return types.find((t) => t.key === key)?.label || key;
}
function ti(key: string, types: CardType[]): string {
  return types.find((t) => t.key === key)?.icon || "description";
}

function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

function cardH(card: { isRoot: boolean; breadcrumb: string[] }): number {
  if (card.isRoot) return ROOT_CARD_H;
  return card.breadcrumb.length > 0 ? CARD_PATH_H : CARD_H;
}

/* ------------------------------------------------------------------ */
/*  Tree layout engine                                                 */
/* ------------------------------------------------------------------ */

function computeTreeLayout(
  rootId: string,
  expanded: Set<string>,
  adjMap: Map<string, { nodeId: string; relType: string; relLabel: string; relDescription?: string }[]>,
  nodeMap: Map<string, GNode>,
  types: CardType[],
): TreeLayout {
  const cards: PositionedCard[] = [];
  const headers: PositionedHeader[] = [];
  const placedNodeIds = new Set<string>();

  function layoutNode(
    nodeId: string,
    instanceId: string,
    column: number,
    yOffset: number,
    parentInstanceId: string | null,
    pathAncestors: Set<string>,
  ): number {
    const node = nodeMap.get(nodeId);
    if (!node) return 0;

    const isRoot = parentInstanceId === null;
    const breadcrumb = node.path || [];
    const thisH = isRoot ? ROOT_CARD_H : breadcrumb.length > 0 ? CARD_PATH_H : CARD_H;
    const x = column * COL_SPACING + PADDING;
    const isExp = expanded.has(instanceId);
    const totalConns = (adjMap.get(nodeId) || []).length;
    const neighbors = (adjMap.get(nodeId) || []).filter(
      (n) => !pathAncestors.has(n.nodeId) && nodeMap.has(n.nodeId),
    );
    const isDuplicate = placedNodeIds.has(nodeId);
    placedNodeIds.add(nodeId);

    if (!isExp || neighbors.length === 0) {
      cards.push({
        instanceId,
        id: nodeId,
        node,
        column,
        x,
        y: yOffset,
        parentInstanceId,
        isExpanded: isExp,
        canExpand: neighbors.length > 0,
        isRoot,
        isDuplicate,
        breadcrumb,
        connectionCount: totalConns,
      });
      return thisH;
    }

    // Group neighbors by type
    const groupMap = new Map<string, string[]>();
    const groupOrder: string[] = [];
    for (const n of neighbors) {
      const nn = nodeMap.get(n.nodeId);
      if (!nn) continue;
      if (!groupMap.has(nn.type)) {
        groupMap.set(nn.type, []);
        groupOrder.push(nn.type);
      }
      groupMap.get(nn.type)!.push(n.nodeId);
    }
    groupOrder.sort((a, b) => {
      const sa = types.find((t) => t.key === a)?.sort_order ?? 99;
      const sb = types.find((t) => t.key === b)?.sort_order ?? 99;
      return sa - sb;
    });
    for (const ids of groupMap.values()) {
      ids.sort((a, b) => {
        const na = nodeMap.get(a)?.name || "";
        const nb = nodeMap.get(b)?.name || "";
        return na.localeCompare(nb);
      });
    }

    // Layout children
    const childPath = new Set(pathAncestors);
    childPath.add(nodeId);
    let childY = yOffset;
    for (let gi = 0; gi < groupOrder.length; gi++) {
      const tk = groupOrder[gi];
      const nodeIds = groupMap.get(tk)!;
      if (gi > 0) childY += GROUP_GAP;

      headers.push({
        key: `${instanceId}-${tk}`,
        typeKey: tk,
        typeLabel: tl(tk, types),
        typeColor: tc(tk, types),
        typeIcon: ti(tk, types),
        count: nodeIds.length,
        x: (column + 1) * COL_SPACING + PADDING,
        y: childY,
      });
      childY += HEADER_H;

      for (let i = 0; i < nodeIds.length; i++) {
        if (i > 0) childY += ITEM_GAP;
        const childInstanceId = `${instanceId}:${nodeIds[i]}`;
        childY += layoutNode(
          nodeIds[i],
          childInstanceId,
          column + 1,
          childY,
          instanceId,
          childPath,
        );
      }
    }

    const childrenH = childY - yOffset;
    const nodeY = yOffset + Math.max(0, childrenH / 2 - thisH / 2);

    cards.push({
      instanceId,
      id: nodeId,
      node,
      column,
      x,
      y: nodeY,
      parentInstanceId,
      isExpanded: true,
      canExpand: true,
      isRoot,
      isDuplicate,
      breadcrumb,
      connectionCount: totalConns,
    });

    return Math.max(thisH, childrenH);
  }

  if (!nodeMap.has(rootId))
    return { cards: [], headers: [], connections: [], width: 0, height: 0 };

  const rootInstance = `root:${rootId}`;
  const totalH = layoutNode(rootId, rootInstance, 0, PADDING, null, new Set());

  // Build connections
  const connections: Connection[] = [];
  const cardByInst = new Map(cards.map((c) => [c.instanceId, c]));
  for (const card of cards) {
    if (!card.parentInstanceId) continue;
    const parent = cardByInst.get(card.parentInstanceId);
    if (!parent) continue;
    const pH = cardH(parent);
    const cH = cardH(card);
    // Find the relation info between parent and child nodes
    const adj = adjMap.get(parent.id) || [];
    const relInfo = adj.find((a) => a.nodeId === card.id);
    connections.push({
      fromInstance: card.parentInstanceId,
      toInstance: card.instanceId,
      x1: parent.x + CARD_W,
      y1: parent.y + pH / 2,
      x2: card.x,
      y2: card.y + cH / 2,
      color: tc(card.node.type, types),
      relType: relInfo?.relType || "",
      relLabel: relInfo?.relLabel || relInfo?.relType || "",
      relDescription: relInfo?.relDescription,
    });
  }

  const maxX = cards.length ? Math.max(...cards.map((c) => c.x + CARD_W)) : 0;
  const maxY = Math.max(
    ...(cards.length ? cards.map((c) => c.y + cardH(c)) : [0]),
    ...(headers.length ? headers.map((h) => h.y + HEADER_H) : [0]),
    totalH + PADDING,
  );

  return {
    cards,
    headers,
    connections,
    width: maxX + PADDING * 2,
    height: maxY + PADDING,
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DependencyReport() {
  const navigate = useNavigate();
  const { types } = useMetamodel();
  const saved = useSavedReport("dependencies");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() => saved.setSaveDialogOpen(true));
  const [cardTypeKey, setCardTypeKey] = useState("");
  const [center, setCenter] = useState("");
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [edges, setEdges] = useState<GEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredConn, setHoveredConn] = useState<{
    conn: Connection;
    x: number;
    y: number;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  /* -- picker state -- */
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerTypeFilter, setPickerTypeFilter] = useState<string | null>(null);

  // Load saved report config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    if (cfg) {
      if (cfg.cardTypeKey !== undefined) setCardTypeKey(cfg.cardTypeKey as string);
      if (cfg.center) setCenter(cfg.center as string);
      if (cfg.view) setView(cfg.view as "chart" | "table");
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({ cardTypeKey, center, view });

  // Auto-persist config to localStorage
  useEffect(() => {
    saved.persistConfig(getConfig());
  }, [cardTypeKey, center, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset all parameters to defaults
  const handleReset = useCallback(() => {
    saved.resetAll();
    setCardTypeKey("");
    setCenter("");
    setView("chart");
    setPickerSearch("");
    setPickerTypeFilter(null);
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch data
  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (cardTypeKey) p.set("type", cardTypeKey);
    api
      .get<{ nodes: GNode[]; edges: GEdge[] }>(`/reports/dependencies?${p}`)
      .then((r) => {
        setNodes(r.nodes);
        setEdges(r.edges);
        setLoading(false);
      });
  }, [cardTypeKey]);

  // Adjacency map
  const adjMap = useMemo(() => {
    const m = new Map<string, { nodeId: string; relType: string; relLabel: string; relDescription?: string }[]>();
    for (const e of edges) {
      if (!m.has(e.source)) m.set(e.source, []);
      m.get(e.source)!.push({ nodeId: e.target, relType: e.type, relLabel: e.label || e.type, relDescription: e.description });
      if (!m.has(e.target)) m.set(e.target, []);
      m.get(e.target)!.push({ nodeId: e.source, relType: e.type, relLabel: e.reverse_label || e.label || e.type, relDescription: e.description });
    }
    return m;
  }, [edges]);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Connection counts
  const connCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodes) m.set(n.id, (adjMap.get(n.id) || []).length);
    return m;
  }, [nodes, adjMap]);

  // Reset expansion when center changes
  useEffect(() => {
    if (center) {
      setExpanded(new Set([`root:${center}`]));
    } else {
      setExpanded(new Set());
    }
  }, [center]);

  const toggleExpand = useCallback((instanceId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    if (center) setExpanded(new Set([`root:${center}`]));
  }, [center]);

  // Compute tree layout
  const layout = useMemo<TreeLayout | null>(() => {
    if (!center || !nodeMap.has(center)) return null;
    return computeTreeLayout(center, expanded, adjMap, nodeMap, types);
  }, [center, expanded, adjMap, nodeMap, types]);

  // Hovered ancestry chain (for highlighting the path)
  const hoveredChain = useMemo(() => {
    if (!hovered || !layout) return new Set<string>();
    const s = new Set<string>();
    const byInst = new Map(layout.cards.map((c) => [c.instanceId, c]));
    // Walk up
    let cur: string | null = hovered;
    while (cur) {
      s.add(cur);
      const card = byInst.get(cur);
      cur = card?.parentInstanceId ?? null;
    }
    // Direct children
    for (const c of layout.cards) {
      if (c.parentInstanceId === hovered) s.add(c.instanceId);
    }
    return s;
  }, [hovered, layout]);

  // Picker: used types
  const usedTypes = useMemo(() => [...new Set(nodes.map((n) => n.type))], [nodes]);

  // Picker: filtered items
  const pickerItems = useMemo(() => {
    let items = nodes;
    if (pickerTypeFilter) items = items.filter((n) => n.type === pickerTypeFilter);
    if (pickerSearch.trim()) {
      const q = pickerSearch.trim().toLowerCase();
      items = items.filter(
        (n) =>
          n.name.toLowerCase().includes(q) ||
          (n.path && n.path.some((p) => p.toLowerCase().includes(q))),
      );
    }
    return items;
  }, [nodes, pickerTypeFilter, pickerSearch]);

  // Picker: group by type
  const pickerGroups = useMemo(() => {
    const groups = new Map<string, GNode[]>();
    const order: string[] = [];
    for (const n of pickerItems) {
      if (!groups.has(n.type)) {
        groups.set(n.type, []);
        order.push(n.type);
      }
      groups.get(n.type)!.push(n);
    }
    order.sort((a, b) => {
      const sa = types.find((t) => t.key === a)?.sort_order ?? 99;
      const sb = types.find((t) => t.key === b)?.sort_order ?? 99;
      return sa - sb;
    });
    for (const arr of groups.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return { groups, order };
  }, [pickerItems, types]);

  // Autocomplete options for toolbar
  const acOptions = useMemo(
    () => (cardTypeKey ? nodes.filter((n) => n.type === cardTypeKey) : nodes),
    [nodes, cardTypeKey],
  );

  if (loading)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */
  const centerNode = nodes.find((n) => n.id === center);
  const printParams = useMemo(() => {
    const params: { label: string; value: string }[] = [];
    if (cardTypeKey) {
      const typeLabel = types.find((t) => t.key === cardTypeKey)?.label || cardTypeKey;
      params.push({ label: "Type", value: typeLabel });
    }
    if (centerNode) params.push({ label: "Center", value: centerNode.name });
    if (view === "table") params.push({ label: "View", value: "Table" });
    return params;
  }, [cardTypeKey, types, centerNode, view]);

  return (
    <ReportShell
      title="Dependencies"
      icon="hub"
      iconColor="#6a1b9a"
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
          <TextField
            select
            size="small"
            label="Type"
            value={cardTypeKey}
            onChange={(e) => {
              setCardTypeKey(e.target.value);
              setCenter("");
              setPickerTypeFilter(null);
            }}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">All Types</MenuItem>
            {types.filter((t) => !t.is_hidden).map((t) => (
              <MenuItem key={t.key} value={t.key}>
                {t.label}
              </MenuItem>
            ))}
          </TextField>

          <Autocomplete
            size="small"
            options={acOptions}
            getOptionLabel={(o) => o.name}
            value={nodes.find((n) => n.id === center) || null}
            onChange={(_, v) => setCenter(v?.id || "")}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: tc(option.type, types),
                    mr: 1,
                    flexShrink: 0,
                  }}
                />
                <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                  {option.name}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.disabled"
                  sx={{ ml: 1, flexShrink: 0 }}
                >
                  {tl(option.type, types)}
                </Typography>
              </li>
            )}
            renderInput={(params) => (
              <TextField {...params} label="Center on" sx={{ minWidth: 220 }} />
            )}
            sx={{ minWidth: 220 }}
          />

          {center && (
            <Tooltip title="Collapse all branches">
              <IconButton size="small" onClick={collapseAll}>
                <MaterialSymbol icon="unfold_less" size={20} />
              </IconButton>
            </Tooltip>
          )}
        </>
      }
      legend={
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          {usedTypes.map((t) => (
            <Box key={t} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  bgcolor: tc(t, types),
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {tl(t, types)}
              </Typography>
            </Box>
          ))}
        </Box>
      }
    >
      {/* ==================== CHART VIEW ==================== */}
      {view === "chart" ? (
        center && layout && layout.cards.length > 0 ? (
          /* ---------- TREE VIEW ---------- */
          <Paper
            variant="outlined"
            ref={scrollRef}
            sx={{ overflow: "auto", bgcolor: "#f8f9fb", borderRadius: 2 }}
          >
            <Box
              sx={{
                position: "relative",
                width: layout.width,
                height: Math.max(layout.height, 300),
                minWidth: "100%",
              }}
            >
              {/* SVG curves */}
              <svg
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  pointerEvents: "none",
                }}
              >
                {layout.connections.map((c) => {
                  const connKey = `${c.fromInstance}-${c.toInstance}`;
                  const inChain =
                    hovered !== null &&
                    hoveredChain.has(c.fromInstance) &&
                    hoveredChain.has(c.toInstance);
                  const isHoveredConn =
                    hoveredConn?.conn.fromInstance === c.fromInstance &&
                    hoveredConn?.conn.toInstance === c.toInstance;
                  return (
                    <g key={connKey}>
                      <path
                        d={curvePath(c.x1, c.y1, c.x2, c.y2)}
                        fill="none"
                        stroke={c.color}
                        strokeWidth={isHoveredConn ? 3 : inChain ? 2.4 : 1.4}
                        strokeOpacity={
                          isHoveredConn ? 1 : hovered ? (inChain ? 0.9 : 0.1) : 0.35
                        }
                        style={{ transition: "stroke-opacity 0.2s, stroke-width 0.2s" }}
                      />
                      {/* Wider invisible hit area for hover */}
                      <path
                        d={curvePath(c.x1, c.y1, c.x2, c.y2)}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={14}
                        style={{ pointerEvents: "stroke", cursor: "default" }}
                        onMouseEnter={(e) => {
                          const rect = (e.target as SVGElement).closest("svg")!.getBoundingClientRect();
                          setHoveredConn({
                            conn: c,
                            x: e.clientX - rect.left,
                            y: e.clientY - rect.top,
                          });
                        }}
                        onMouseMove={(e) => {
                          const rect = (e.target as SVGElement).closest("svg")!.getBoundingClientRect();
                          setHoveredConn((prev) =>
                            prev && prev.conn === c
                              ? { ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top }
                              : prev,
                          );
                        }}
                        onMouseLeave={() => setHoveredConn(null)}
                      />
                    </g>
                  );
                })}
              </svg>

              {/* Connection tooltip */}
              {hoveredConn && (() => {
                const fromCard = layout.cards.find((c) => c.instanceId === hoveredConn.conn.fromInstance);
                const toCard = layout.cards.find((c) => c.instanceId === hoveredConn.conn.toInstance);
                return (
                  <Paper
                    elevation={6}
                    sx={{
                      position: "absolute",
                      left: hoveredConn.x + 12,
                      top: hoveredConn.y - 10,
                      px: 1.5,
                      py: 1,
                      pointerEvents: "none",
                      zIndex: 20,
                      maxWidth: 280,
                      borderLeft: `3px solid ${hoveredConn.conn.color}`,
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.3, fontSize: "0.8rem" }}>
                      {hoveredConn.conn.relLabel}
                    </Typography>
                    {fromCard && toCard && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.4, mt: 0.25 }}>
                        {fromCard.node.name}
                        <span style={{ color: "#aaa", margin: "0 4px" }}>&rarr;</span>
                        {toCard.node.name}
                      </Typography>
                    )}
                    {hoveredConn.conn.relDescription && (
                      <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.5, lineHeight: 1.3, fontStyle: "italic" }}>
                        {hoveredConn.conn.relDescription}
                      </Typography>
                    )}
                  </Paper>
                );
              })()}

              {/* Type group headers */}
              {layout.headers.map((h) => (
                <Box
                  key={h.key}
                  sx={{
                    position: "absolute",
                    left: h.x,
                    top: h.y,
                    height: HEADER_H,
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    pl: 0.5,
                    userSelect: "none",
                  }}
                >
                  <MaterialSymbol icon={h.typeIcon} size={14} color={h.typeColor} />
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 700, color: h.typeColor, lineHeight: 1 }}
                  >
                    {h.typeLabel}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ color: "text.disabled", lineHeight: 1 }}
                  >
                    ({h.count})
                  </Typography>
                </Box>
              ))}

              {/* Cards */}
              {layout.cards.map((card) => {
                const h = cardH(card);
                const color = tc(card.node.type, types);
                const inChain =
                  hovered !== null && hoveredChain.has(card.instanceId);
                const dimmed = hovered !== null && !inChain;

                return (
                  <Tooltip
                    key={card.instanceId}
                    title={
                      <span>
                        <strong>{tl(card.node.type, types)}</strong>
                        {" · "}
                        {card.connectionCount} connections
                        {card.isDuplicate ? " · Also appears elsewhere" : ""}
                        <br />
                        <em>Click to expand · Right-click to re-center</em>
                      </span>
                    }
                    placement="top"
                    arrow
                    enterDelay={500}
                  >
                    <Paper
                      elevation={inChain ? 4 : card.isRoot ? 2 : 0}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setCenter(card.id);
                      }}
                      sx={{
                        position: "absolute",
                        left: card.x,
                        top: card.y,
                        width: CARD_W,
                        height: h,
                        display: "flex",
                        alignItems: "center",
                        px: 1.5,
                        gap: 0.75,
                        cursor: "pointer",
                        borderLeft: `3.5px solid ${color}`,
                        borderRadius: "8px",
                        bgcolor: card.isExpanded
                          ? "rgba(0,0,0,0.025)"
                          : "background.paper",
                        opacity: dimmed ? 0.4 : 1,
                        transition:
                          "box-shadow 0.2s, opacity 0.2s, background-color 0.15s",
                        "&:hover": {
                          boxShadow: 4,
                          bgcolor: "background.paper",
                        },
                        ...(card.isRoot && {
                          borderLeftWidth: 4,
                          boxShadow: 2,
                        }),
                        ...(!card.isRoot &&
                          !card.isExpanded && {
                            border: "1px solid",
                            borderColor: "divider",
                            borderLeftColor: color,
                            borderLeftWidth: "3.5px",
                          }),
                        ...(card.isDuplicate &&
                          !card.isRoot && {
                            borderStyle: "dashed",
                            borderLeftStyle: "solid",
                          }),
                      }}
                      onClick={() => toggleExpand(card.instanceId)}
                      onMouseEnter={() => setHovered(card.instanceId)}
                      onMouseLeave={() => setHovered(null)}
                    >
                      {/* Card content */}
                      {card.isRoot ? (
                        <Box
                          sx={{
                            display: "flex",
                            flexDirection: "column",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <Typography
                            variant="caption"
                            sx={{
                              color,
                              fontWeight: 700,
                              lineHeight: 1.2,
                              fontSize: "0.63rem",
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                            }}
                          >
                            {tl(card.node.type, types)}
                          </Typography>
                          <Typography
                            variant="body2"
                            noWrap
                            sx={{ fontWeight: 600, lineHeight: 1.3 }}
                          >
                            {card.node.name}
                          </Typography>
                        </Box>
                      ) : card.breadcrumb.length > 0 ? (
                        <Box
                          sx={{
                            display: "flex",
                            flexDirection: "column",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <Typography
                            variant="caption"
                            noWrap
                            sx={{
                              color: "text.disabled",
                              lineHeight: 1.2,
                              fontSize: "0.65rem",
                            }}
                          >
                            {card.breadcrumb.join(" / ")}
                          </Typography>
                          <Typography
                            variant="body2"
                            noWrap
                            sx={{ fontWeight: 500, lineHeight: 1.3 }}
                          >
                            {card.node.name}
                          </Typography>
                        </Box>
                      ) : (
                        <Typography
                          variant="body2"
                          noWrap
                          sx={{ flex: 1, fontWeight: 500, minWidth: 0 }}
                        >
                          {card.node.name}
                        </Typography>
                      )}

                      {card.isDuplicate && !card.isRoot && (
                        <Tooltip title="Also appears elsewhere in this tree" arrow>
                          <Box sx={{ display: "flex" }}>
                            <MaterialSymbol icon="link" size={14} color="#bbb" />
                          </Box>
                        </Tooltip>
                      )}

                      {/* Open in new tab */}
                      <Tooltip title="Open card" arrow>
                        <IconButton
                          size="small"
                          sx={{ p: 0.25, ml: "auto" }}
                          onClick={(e) => { e.stopPropagation(); window.open(`/cards/${card.id}`, "_blank"); }}
                        >
                          <MaterialSymbol icon="open_in_new" size={14} color="#999" />
                        </IconButton>
                      </Tooltip>

                      {card.canExpand && (
                        <Badge
                          badgeContent={card.connectionCount}
                          color="default"
                          max={99}
                          sx={{
                            "& .MuiBadge-badge": {
                              fontSize: "0.6rem",
                              height: 16,
                              minWidth: 16,
                              bgcolor: "rgba(0,0,0,0.08)",
                              color: "text.secondary",
                            },
                          }}
                        >
                          <MaterialSymbol
                            icon={
                              card.isExpanded
                                ? "expand_more"
                                : "chevron_right"
                            }
                            size={18}
                            color="#999"
                          />
                        </Badge>
                      )}
                    </Paper>
                  </Tooltip>
                );
              })}
            </Box>

            {/* Stats chip (sticky bottom-right) */}
            <Box
              sx={{
                position: "sticky",
                bottom: 8,
                left: 0,
                px: 1,
                pb: 0.5,
                textAlign: "right",
              }}
            >
              <Chip
                size="small"
                label={`${layout.cards.length} nodes · ${layout.connections.length} relations`}
                variant="outlined"
                sx={{ bgcolor: "background.paper" }}
              />
            </Box>
          </Paper>
        ) : (
          /* ---------- PICKER (no center selected) ---------- */
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
            {/* Picker header */}
            <Box sx={{ p: 2.5, pb: 0 }}>
              <Box sx={{ textAlign: "center", mb: 2 }}>
                <MaterialSymbol icon="account_tree" size={44} color="#bbb" />
                <Typography variant="h6" color="text.secondary" sx={{ mt: 0.5 }}>
                  Select a card to explore
                </Typography>
                <Typography variant="body2" color="text.disabled" sx={{ maxWidth: 400, mx: "auto" }}>
                  Search and pick a starting point. Click to center, then expand
                  branches interactively.
                </Typography>
              </Box>

              {/* Search */}
              <TextField
                size="small"
                fullWidth
                placeholder="Search cards..."
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <MaterialSymbol icon="search" size={20} color="#999" />
                    </InputAdornment>
                  ),
                  ...(pickerSearch && {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          onClick={() => setPickerSearch("")}
                        >
                          <MaterialSymbol icon="close" size={16} />
                        </IconButton>
                      </InputAdornment>
                    ),
                  }),
                }}
                sx={{ mb: 1.5 }}
              />

              {/* Type filter chips */}
              <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mb: 1.5 }}>
                <Chip
                  label="All"
                  size="small"
                  variant={pickerTypeFilter === null ? "filled" : "outlined"}
                  onClick={() => setPickerTypeFilter(null)}
                  sx={{
                    fontWeight: pickerTypeFilter === null ? 700 : 400,
                  }}
                />
                {usedTypes.map((tk) => {
                  const active = pickerTypeFilter === tk;
                  const color = tc(tk, types);
                  const count = nodes.filter((n) => n.type === tk).length;
                  return (
                    <Chip
                      key={tk}
                      size="small"
                      variant={active ? "filled" : "outlined"}
                      label={`${tl(tk, types)} (${count})`}
                      onClick={() =>
                        setPickerTypeFilter(active ? null : tk)
                      }
                      icon={
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            bgcolor: color,
                            ml: "4px !important",
                          }}
                          component="span"
                        />
                      }
                      sx={{
                        fontWeight: active ? 700 : 400,
                        ...(active && {
                          bgcolor: color + "18",
                          color: color,
                          borderColor: color,
                        }),
                      }}
                    />
                  );
                })}
              </Box>
            </Box>

            {/* Results list */}
            {pickerItems.length === 0 ? (
              <Box sx={{ py: 4, textAlign: "center" }}>
                <Typography color="text.disabled" variant="body2">
                  {nodes.length === 0
                    ? "No cards found."
                    : "No results match your search."}
                </Typography>
              </Box>
            ) : (
              <Box sx={{ maxHeight: 420, overflow: "auto", px: 2.5, pb: 2 }}>
                {pickerGroups.order.map((tk) => {
                  const items = pickerGroups.groups.get(tk)!;
                  const color = tc(tk, types);
                  return (
                    <Box key={tk} sx={{ mb: 2 }}>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 0.5,
                          mb: 0.5,
                          position: "sticky",
                          top: 0,
                          bgcolor: "background.paper",
                          py: 0.25,
                          zIndex: 1,
                        }}
                      >
                        <MaterialSymbol
                          icon={ti(tk, types)}
                          size={15}
                          color={color}
                        />
                        <Typography
                          variant="subtitle2"
                          sx={{ fontWeight: 700, color }}
                        >
                          {tl(tk, types)}
                        </Typography>
                        <Typography variant="caption" color="text.disabled">
                          ({items.length})
                        </Typography>
                      </Box>
                      {items.map((n) => {
                        const conns = connCounts.get(n.id) || 0;
                        const path = n.path || [];
                        return (
                          <Box
                            key={n.id}
                            onClick={() => setCenter(n.id)}
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                              py: 0.6,
                              px: 1,
                              borderRadius: 1,
                              cursor: "pointer",
                              "&:hover": { bgcolor: color + "0a" },
                            }}
                          >
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              {path.length > 0 && (
                                <Typography
                                  variant="caption"
                                  noWrap
                                  sx={{
                                    color: "text.disabled",
                                    fontSize: "0.65rem",
                                    display: "block",
                                    lineHeight: 1.2,
                                  }}
                                >
                                  {path.join(" / ")}
                                </Typography>
                              )}
                              <Typography
                                variant="body2"
                                noWrap
                                sx={{ fontWeight: 500 }}
                              >
                                {n.name}
                              </Typography>
                            </Box>
                            {conns > 0 && (
                              <Chip
                                size="small"
                                label={conns}
                                variant="outlined"
                                sx={{
                                  height: 20,
                                  fontSize: "0.7rem",
                                  color: "text.disabled",
                                  borderColor: "divider",
                                }}
                              />
                            )}
                            <MaterialSymbol
                              icon="chevron_right"
                              size={16}
                              color="#ccc"
                            />
                          </Box>
                        );
                      })}
                    </Box>
                  );
                })}
              </Box>
            )}
          </Paper>
        )
      ) : (
        /* ==================== TABLE VIEW ==================== */
        <Paper variant="outlined" sx={{ overflow: "auto" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Source</TableCell>
                <TableCell>Relation</TableCell>
                <TableCell>Target</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {edges.map((e, i) => {
                const s = nodes.find((n) => n.id === e.source);
                const t = nodes.find((n) => n.id === e.target);
                return (
                  <TableRow key={i} hover>
                    <TableCell
                      sx={{ cursor: "pointer", fontWeight: 500 }}
                      onClick={() =>
                        s && navigate(`/cards/${s.id}`)
                      }
                    >
                      {s?.name}
                    </TableCell>
                    <TableCell>
                      <Tooltip title={e.description || e.type} arrow>
                        <Chip
                          size="small"
                          label={e.label || e.type}
                          variant="outlined"
                        />
                      </Tooltip>
                    </TableCell>
                    <TableCell
                      sx={{ cursor: "pointer", fontWeight: 500 }}
                      onClick={() =>
                        t && navigate(`/cards/${t.id}`)
                      }
                    >
                      {t?.name}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Paper>
      )}
      <SaveReportDialog
        open={saved.saveDialogOpen}
        onClose={() => saved.setSaveDialogOpen(false)}
        reportType="dependencies"
        config={getConfig()}
        thumbnail={thumbnail}
      />
    </ReportShell>
  );
}
