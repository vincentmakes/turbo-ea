/**
 * ArchitectureDiagram — React Flow visualization for ArchLens Architect results.
 *
 * Converts the structured ArchitectureResult (layers + components + integrations)
 * into an interactive C4-style diagram using @xyflow/react and dagre layout.
 */

import { useMemo, memo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import dagre from "@dagrejs/dagre";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  ReactFlowProvider,
  getSmoothStepPath,
  type NodeProps,
  type EdgeProps,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ArchitectureResult, ArchComponent, ArchIntegration } from "@/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_W = 200;
const NODE_H = 80;
const GROUP_PAD_X = 40;
const GROUP_PAD_TOP = 44;
const GROUP_PAD_BOTTOM = 28;

const TYPE_COLORS: Record<string, string> = {
  existing: "#4caf50",
  new: "#1976d2",
  recommended: "#ff9800",
};

const TYPE_BG: Record<string, { light: string; dark: string }> = {
  existing: { light: "rgba(76,175,80,0.08)", dark: "rgba(76,175,80,0.12)" },
  new: { light: "rgba(25,118,210,0.08)", dark: "rgba(25,118,210,0.12)" },
  recommended: { light: "rgba(255,152,0,0.08)", dark: "rgba(255,152,0,0.12)" },
};

// ---------------------------------------------------------------------------
// Node data types
// ---------------------------------------------------------------------------

interface ArchNodeData {
  name: string;
  compType: string; // existing | new | recommended
  category?: string;
  role?: string;
  product?: string;
  [key: string]: unknown;
}

interface ArchGroupData {
  label: string;
  color: string;
  [key: string]: unknown;
}

interface ArchEdgeData {
  label: string;
  protocol?: string;
  direction?: string;
  isHovered?: boolean;
  connectedToHovered?: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Custom Node
// ---------------------------------------------------------------------------

const ArchNode = memo(({ data }: NodeProps<Node<ArchNodeData>>) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const color = TYPE_COLORS[data.compType] || "#999";
  const bg = TYPE_BG[data.compType]?.[isDark ? "dark" : "light"] ?? "rgba(0,0,0,0.04)";
  const name = data.name.length > 26 ? data.name.slice(0, 25) + "\u2026" : data.name;
  const handleStyle = { width: 6, height: 6, border: "none" };

  return (
    <Box
      sx={{
        width: NODE_W,
        height: NODE_H,
        borderRadius: "10px",
        border: `2px solid ${color}`,
        bgcolor: bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        px: 1.2,
        position: "relative",
        boxShadow: isDark ? "0 2px 8px rgba(0,0,0,0.4)" : "0 2px 8px rgba(0,0,0,0.08)",
      }}
    >
      <Handle type="target" position={Position.Top} id="t" style={{ ...handleStyle, background: color }} />
      <Handle type="source" position={Position.Bottom} id="b" style={{ ...handleStyle, background: color }} />
      <Handle type="target" position={Position.Left} id="l" style={{ ...handleStyle, background: "transparent" }} />
      <Handle type="source" position={Position.Right} id="r" style={{ ...handleStyle, background: "transparent" }} />
      <Tooltip title={data.role || ""} arrow placement="top">
        <Typography
          variant="body2"
          sx={{
            fontWeight: 700,
            lineHeight: 1.2,
            textAlign: "center",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            width: "100%",
            fontSize: 12.5,
          }}
        >
          {name}
        </Typography>
      </Tooltip>
      {data.product && data.product !== data.name && (
        <Typography
          variant="caption"
          sx={{ color: "text.secondary", lineHeight: 1.15, fontSize: 10, mt: 0.3, textAlign: "center" }}
          noWrap
        >
          {data.product}
        </Typography>
      )}
      {data.category && (
        <Typography
          variant="caption"
          sx={{ color, fontStyle: "italic", lineHeight: 1.15, fontSize: 10, mt: 0.2 }}
          noWrap
        >
          [{data.category}]
        </Typography>
      )}
    </Box>
  );
});
ArchNode.displayName = "ArchNode";

// ---------------------------------------------------------------------------
// Custom Group
// ---------------------------------------------------------------------------

const ArchGroup = memo(({ data }: NodeProps<Node<ArchGroupData>>) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        border: `1.5px dashed ${data.color}`,
        borderRadius: "12px",
        bgcolor: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.012)",
        position: "relative",
      }}
    >
      <Typography
        variant="subtitle2"
        sx={{
          position: "absolute",
          top: 8,
          left: 14,
          fontWeight: 700,
          color: data.color,
          fontSize: "0.78rem",
        }}
      >
        {data.label}
      </Typography>
    </Box>
  );
});
ArchGroup.displayName = "ArchGroup";

// ---------------------------------------------------------------------------
// Custom Edge
// ---------------------------------------------------------------------------

const ArchEdge = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps) => {
  const theme = useTheme();
  const edgeData = data as ArchEdgeData | undefined;
  const active = edgeData?.isHovered || edgeData?.connectedToHovered;
  const isDark = theme.palette.mode === "dark";
  const baseColor = isDark ? "#aaa" : "#777";
  const hoverColor = isDark ? "#4fc3f7" : "#1976d2";
  const color = active ? hoverColor : baseColor;

  const [path, lx, ly] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    borderRadius: 8,
    offset: 24,
  });

  const label = edgeData?.label || "";
  const labelBg = isDark ? "#121212" : "#ffffff";

  return (
    <>
      <path d={path} fill="none" stroke="transparent" strokeWidth={14} style={{ cursor: "pointer", pointerEvents: "stroke" }} />
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: active ? 2 : 1.2,
          strokeDasharray: active ? "none" : "5 3",
          transition: "stroke 0.15s, stroke-width 0.15s",
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`,
              pointerEvents: "none",
              fontSize: 10,
              fontFamily: "inherit",
              color: active ? hoverColor : (isDark ? "#aaa" : "#666"),
              background: labelBg,
              border: `1px solid ${isDark ? "#444" : "#ccc"}`,
              borderRadius: 4,
              padding: "2px 6px",
              whiteSpace: "nowrap",
              lineHeight: "14px",
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// Node/Edge type registries
// ---------------------------------------------------------------------------

const nodeTypes = { archNode: ArchNode, archGroup: ArchGroup };
const edgeTypes = { archEdge: ArchEdge };

// ---------------------------------------------------------------------------
// Layout engine — single global dagre graph for proper cross-layer spreading
// ---------------------------------------------------------------------------

function buildArchFlow(
  arch: ArchitectureResult,
): { nodes: Node[]; edges: Edge[] } {
  const layers = arch.layers ?? [];
  const integrations = arch.integrations ?? [];

  if (layers.length === 0) return { nodes: [], edges: [] };

  // 1. Assign unique IDs to all components
  const compIdMap = new Map<string, string>(); // lowercase name → id
  let idCounter = 0;
  const allComps: { comp: ArchComponent; layerIdx: number; layerName: string; id: string }[] = [];

  for (let li = 0; li < layers.length; li++) {
    for (const comp of layers[li].components ?? []) {
      const id = `arch-${idCounter++}`;
      compIdMap.set(comp.name.toLowerCase(), id);
      allComps.push({ comp, layerIdx: li, layerName: layers[li].name, id });
    }
  }

  // 2. Resolve integration edges
  const resolvedEdges: { sourceId: string; targetId: string; intg: ArchIntegration }[] = [];
  for (const intg of integrations) {
    const srcId = compIdMap.get(intg.from.toLowerCase());
    const tgtId = compIdMap.get(intg.to.toLowerCase());
    if (srcId && tgtId) resolvedEdges.push({ sourceId: srcId, targetId: tgtId, intg });
  }

  // 3. Build a SINGLE global dagre graph with ALL nodes and edges
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: 100, nodesep: 60, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const entry of allComps) {
    g.setNode(entry.id, { width: NODE_W, height: NODE_H });
  }
  for (const re of resolvedEdges) {
    g.setEdge(re.sourceId, re.targetId);
  }

  // Add invisible edges between consecutive layers to maintain layer ordering
  const layerNodeIds: string[][] = [];
  for (let li = 0; li < layers.length; li++) {
    layerNodeIds.push(allComps.filter(c => c.layerIdx === li).map(c => c.id));
  }
  for (let li = 0; li < layerNodeIds.length - 1; li++) {
    const curr = layerNodeIds[li];
    const next = layerNodeIds[li + 1];
    if (curr.length > 0 && next.length > 0) {
      // Check if any real edge already connects these layers
      const hasRealEdge = resolvedEdges.some(re => {
        const sLayer = allComps.find(c => c.id === re.sourceId)?.layerIdx;
        const tLayer = allComps.find(c => c.id === re.targetId)?.layerIdx;
        return (sLayer === li && tLayer === li + 1) || (sLayer === li + 1 && tLayer === li);
      });
      if (!hasRealEdge) {
        // Add a hidden ordering edge from first node of layer to first of next
        g.setEdge(curr[0], next[0]);
      }
    }
  }

  dagre.layout(g);

  // 4. Read absolute positions from dagre
  const nodeAbsPos = new Map<string, { x: number; y: number }>();
  for (const entry of allComps) {
    const pos = g.node(entry.id);
    if (pos) nodeAbsPos.set(entry.id, { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 });
  }

  // 5. Compute group boundaries per layer, then resolve overlaps
  const LAYER_COLORS = [
    "#1976d2", "#33cc58", "#8e24aa", "#d29270", "#0f7eb5", "#ffa31f", "#f44336",
  ];
  const MIN_GROUP_GAP = 48;

  // First pass: compute raw bounding boxes for each layer
  const groupBounds: {
    li: number; entries: typeof allComps;
    minX: number; minY: number; maxX: number; maxY: number;
  }[] = [];
  for (let li = 0; li < layers.length; li++) {
    const entries = allComps.filter(c => c.layerIdx === li);
    if (entries.length === 0) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of entries) {
      const p = nodeAbsPos.get(e.id)!;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE_W);
      maxY = Math.max(maxY, p.y + NODE_H);
    }
    groupBounds.push({ li, entries, minX, minY, maxX, maxY });
  }

  // Sort by top edge so we process top-to-bottom
  groupBounds.sort((a, b) => a.minY - b.minY);

  // Resolve vertical overlaps: push groups down if they encroach on the previous
  for (let i = 1; i < groupBounds.length; i++) {
    const prev = groupBounds[i - 1];
    const curr = groupBounds[i];
    const prevBottom = prev.maxY + GROUP_PAD_BOTTOM;
    const currTop = curr.minY - GROUP_PAD_TOP;
    const overlap = prevBottom + MIN_GROUP_GAP - currTop;
    if (overlap > 0) {
      // Shift this group and all its nodes down
      const dy = overlap;
      for (const e of curr.entries) {
        const p = nodeAbsPos.get(e.id)!;
        p.y += dy;
      }
      curr.minY += dy;
      curr.maxY += dy;
    }
  }

  // Second pass: build React Flow nodes with resolved positions
  const rfNodes: Node[] = [];
  for (const gb of groupBounds) {
    const groupId = `layer-${gb.li}`;
    const layerColor = LAYER_COLORS[gb.li % LAYER_COLORS.length];

    const groupX = gb.minX - GROUP_PAD_X;
    const groupY = gb.minY - GROUP_PAD_TOP;
    const groupW = gb.maxX - gb.minX + 2 * GROUP_PAD_X;
    const groupH = gb.maxY - gb.minY + GROUP_PAD_TOP + GROUP_PAD_BOTTOM;

    rfNodes.push({
      id: groupId,
      type: "archGroup",
      position: { x: groupX, y: groupY },
      data: { label: layers[gb.li].name, color: layerColor } satisfies ArchGroupData,
      style: { width: groupW, height: groupH },
      selectable: false,
      draggable: false,
    });

    for (const entry of gb.entries) {
      const absP = nodeAbsPos.get(entry.id)!;
      rfNodes.push({
        id: entry.id,
        type: "archNode",
        position: { x: absP.x - groupX, y: absP.y - groupY },
        parentId: groupId,
        extent: "parent" as const,
        data: {
          name: entry.comp.name,
          compType: entry.comp.type || "new",
          category: entry.comp.category,
          role: entry.comp.role,
          product: entry.comp.product,
        } satisfies ArchNodeData,
        style: { width: NODE_W, height: NODE_H },
        draggable: false,
      });
    }
  }

  // 6. Build edges with smart handle selection
  const nodeLayerIdx = new Map(allComps.map(c => [c.id, c.layerIdx]));
  const rfEdges: Edge[] = resolvedEdges.map((re, i) => {
    const sPos = nodeAbsPos.get(re.sourceId);
    const tPos = nodeAbsPos.get(re.targetId);
    const sLayer = nodeLayerIdx.get(re.sourceId) ?? 0;
    const tLayer = nodeLayerIdx.get(re.targetId) ?? 0;

    let source = re.sourceId;
    let target = re.targetId;
    let srcHandle = "b";
    let tgtHandle = "t";

    if (sLayer === tLayer && sPos && tPos) {
      // Same layer → use left/right handles
      if (sPos.x <= tPos.x) {
        srcHandle = "r";
        tgtHandle = "l";
      } else {
        srcHandle = "l";
        tgtHandle = "r";
        [source, target] = [target, source];
      }
    } else if (sPos && tPos) {
      // Cross-layer → use top/bottom, ensure top-to-bottom direction
      if (sPos.y > tPos.y) {
        [source, target] = [target, source];
      }
    }

    const labelParts: string[] = [];
    if (re.intg.protocol) labelParts.push(re.intg.protocol);
    if (re.intg.direction && re.intg.direction !== "sync") labelParts.push(re.intg.direction);
    const edgeLabel = labelParts.join(", ") || "";

    return {
      id: `arch-e-${i}`,
      source,
      target,
      sourceHandle: srcHandle,
      targetHandle: tgtHandle,
      type: "archEdge",
      data: {
        label: edgeLabel,
        protocol: re.intg.protocol,
        direction: re.intg.direction,
      } satisfies ArchEdgeData,
      animated: false,
      markerEnd: { type: "arrowclosed" as const, color: "#888" },
    };
  });

  return { nodes: rfNodes, edges: rfEdges };
}

// ---------------------------------------------------------------------------
// Inner component
// ---------------------------------------------------------------------------

function ArchitectureDiagramInner({ arch }: { arch: ArchitectureResult }) {
  const { t } = useTranslation("admin");
  const theme = useTheme();

  const { nodes, edges } = useMemo(() => buildArchFlow(arch), [arch]);

  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const hoveredNeighbors = useMemo(() => {
    if (!hoveredNode) return null;
    const s = new Set<string>([hoveredNode]);
    for (const e of edges) {
      if (e.source === hoveredNode) s.add(e.target);
      if (e.target === hoveredNode) s.add(e.source);
    }
    return s;
  }, [hoveredNode, edges]);

  const handleNodeMouseEnter = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === "archNode") setHoveredNode(node.id);
  }, []);
  const handleNodeMouseLeave = useCallback(() => setHoveredNode(null), []);

  const decoratedEdges = useMemo(() =>
    edges.map(e => ({
      ...e,
      data: {
        ...e.data,
        connectedToHovered: hoveredNode ? e.source === hoveredNode || e.target === hoveredNode : false,
      },
    })),
    [edges, hoveredNode],
  );

  const hoverStyle = useMemo(() => {
    if (!hoveredNeighbors) return "";
    const keep = [...hoveredNeighbors].map(id => `.react-flow__node[data-id="${id}"]`).join(",");
    return [
      `.arch-hover-active .react-flow__node-archNode { opacity: 0.35; transition: opacity 0.15s; }`,
      `${keep} { opacity: 1 !important; }`,
    ].join("\n");
  }, [hoveredNeighbors]);

  const allComps = (arch.layers ?? []).flatMap(l => l.components ?? []);
  const existingCnt = allComps.filter(c => c.existsInLandscape || c.type === "existing").length;
  const newCnt = allComps.filter(c => c.type === "new").length;
  const recommendedCnt = allComps.filter(c => c.type === "recommended").length;

  if (nodes.length === 0) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <Typography color="text.secondary">{t("archlens_arch_no_diagram")}</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider", alignItems: "center" }}>
        {existingCnt > 0 && (
          <Chip size="small" label={`${existingCnt} ${t("archlens_arch_existing_reused")}`}
            sx={{ bgcolor: TYPE_COLORS.existing + "18", color: TYPE_COLORS.existing, border: `1px solid ${TYPE_COLORS.existing}44`, fontWeight: 600, fontSize: 11 }} />
        )}
        {newCnt > 0 && (
          <Chip size="small" label={`${newCnt} ${t("archlens_arch_new_components")}`}
            sx={{ bgcolor: TYPE_COLORS.new + "18", color: TYPE_COLORS.new, border: `1px solid ${TYPE_COLORS.new}44`, fontWeight: 600, fontSize: 11 }} />
        )}
        {recommendedCnt > 0 && (
          <Chip size="small" label={`${recommendedCnt} ${t("archlens_arch_legend_recommended")}`}
            sx={{ bgcolor: TYPE_COLORS.recommended + "18", color: TYPE_COLORS.recommended, border: `1px solid ${TYPE_COLORS.recommended}44`, fontWeight: 600, fontSize: 11 }} />
        )}
        <Box sx={{ flex: 1 }} />
        <Chip size="small" label={`${allComps.length} components \u00b7 ${(arch.integrations ?? []).length} integrations`} variant="outlined" />
      </Stack>
      <Box sx={{ height: 600 }} className={hoveredNode ? "arch-hover-active" : undefined}>
        {hoverStyle && <style>{hoverStyle}</style>}
        <ReactFlow
          nodes={nodes}
          edges={decoratedEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeMouseEnter={handleNodeMouseEnter}
          onNodeMouseLeave={handleNodeMouseLeave}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          elementsSelectable={false}
          colorMode={theme.palette.mode}
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Exported wrapper
// ---------------------------------------------------------------------------

export default function ArchitectureDiagram({ arch }: { arch: ArchitectureResult }) {
  return (
    <ReactFlowProvider>
      <ArchitectureDiagramInner arch={arch} />
    </ReactFlowProvider>
  );
}
