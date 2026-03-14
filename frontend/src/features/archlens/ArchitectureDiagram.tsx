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

const NODE_W = 190;
const NODE_H = 64;
const PAD = 28;
const LABEL_H = 30;
const GROUP_GAP = 64;

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
  const name = data.name.length > 24 ? data.name.slice(0, 23) + "\u2026" : data.name;

  return (
    <Box
      sx={{
        width: NODE_W,
        height: NODE_H,
        borderRadius: "8px",
        border: `1.5px solid ${color}`,
        bgcolor: bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        px: 1,
        position: "relative",
      }}
    >
      <Handle type="target" position={Position.Top} id="t" style={{ background: color, width: 5, height: 5, border: "none" }} />
      <Handle type="source" position={Position.Bottom} id="b" style={{ background: color, width: 5, height: 5, border: "none" }} />
      <Handle type="target" position={Position.Left} id="l" style={{ background: "transparent", width: 5, height: 5, border: "none" }} />
      <Handle type="source" position={Position.Right} id="r" style={{ background: "transparent", width: 5, height: 5, border: "none" }} />
      <Tooltip title={data.role || data.product || ""} arrow placement="top">
        <Typography
          variant="body2"
          sx={{
            fontWeight: 600,
            lineHeight: 1.2,
            textAlign: "center",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            width: "100%",
            fontSize: 12,
          }}
        >
          {name}
        </Typography>
      </Tooltip>
      {data.product && data.product !== data.name && (
        <Typography
          variant="caption"
          sx={{ color: "text.secondary", lineHeight: 1.1, fontSize: 10, mt: 0.2, textAlign: "center" }}
          noWrap
        >
          {data.product}
        </Typography>
      )}
      {data.category && (
        <Typography
          variant="caption"
          sx={{ color, fontStyle: "italic", lineHeight: 1.1, fontSize: 10, mt: 0.2 }}
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
// Layout engine
// ---------------------------------------------------------------------------

function buildArchFlow(
  arch: ArchitectureResult,
): { nodes: Node[]; edges: Edge[] } {
  const layers = arch.layers ?? [];
  const integrations = arch.integrations ?? [];

  if (layers.length === 0) return { nodes: [], edges: [] };

  // Assign unique IDs to components
  const compIdMap = new Map<string, string>(); // name → id
  let idCounter = 0;
  const allComps: { comp: ArchComponent; layerName: string; id: string }[] = [];

  for (const layer of layers) {
    for (const comp of layer.components ?? []) {
      const id = `arch-${idCounter++}`;
      compIdMap.set(comp.name.toLowerCase(), id);
      allComps.push({ comp, layerName: layer.name, id });
    }
  }

  // Group by layer
  const layerGroups = new Map<string, typeof allComps>();
  for (const entry of allComps) {
    if (!layerGroups.has(entry.layerName)) layerGroups.set(entry.layerName, []);
    layerGroups.get(entry.layerName)!.push(entry);
  }

  // Resolve integration endpoints to node IDs
  const resolvedEdges: { sourceId: string; targetId: string; intg: ArchIntegration }[] = [];
  for (const intg of integrations) {
    const srcId = compIdMap.get(intg.from.toLowerCase());
    const tgtId = compIdMap.get(intg.to.toLowerCase());
    if (srcId && tgtId) {
      resolvedEdges.push({ sourceId: srcId, targetId: tgtId, intg });
    }
  }

  // Layer colors (cycling)
  const LAYER_COLORS = ["#1976d2", "#33cc58", "#8e24aa", "#d29270", "#0f7eb5", "#ffa31f", "#f44336"];

  // Layout each layer with dagre
  const rfNodes: Node[] = [];
  let yOffset = 0;
  const layerOrder = [...layerGroups.keys()];
  const nodeAbsPos = new Map<string, { x: number; y: number }>();

  for (let li = 0; li < layerOrder.length; li++) {
    const layerName = layerOrder[li];
    const entries = layerGroups.get(layerName)!;
    const layerColor = LAYER_COLORS[li % LAYER_COLORS.length];
    const groupId = `layer-${li}`;

    // Dagre layout for components in this layer
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", ranksep: 60, nodesep: 30, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));

    const entryIds = new Set(entries.map(e => e.id));
    for (const e of entries) {
      g.setNode(e.id, { width: NODE_W, height: NODE_H });
    }
    // Add intra-layer edges
    for (const re of resolvedEdges) {
      if (entryIds.has(re.sourceId) && entryIds.has(re.targetId)) {
        g.setEdge(re.sourceId, re.targetId);
      }
    }

    dagre.layout(g);

    // Normalize positions
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const positions: { id: string; x: number; y: number }[] = [];
    for (const e of entries) {
      const pos = g.node(e.id);
      if (!pos) continue;
      const x = pos.x - NODE_W / 2;
      const y = pos.y - NODE_H / 2;
      positions.push({ id: e.id, x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + NODE_W);
      maxY = Math.max(maxY, y + NODE_H);
    }
    for (const p of positions) {
      p.x -= minX;
      p.y -= minY;
    }
    const innerW = maxX - minX;
    const innerH = maxY - minY;
    const groupW = innerW + 2 * PAD;
    const groupH = innerH + LABEL_H + 2 * PAD;

    rfNodes.push({
      id: groupId,
      type: "archGroup",
      position: { x: 0, y: yOffset },
      data: { label: layerName, color: layerColor } satisfies ArchGroupData,
      style: { width: groupW, height: groupH },
      selectable: false,
      draggable: false,
    });

    for (const p of positions) {
      const entry = entries.find(e => e.id === p.id)!;
      const relX = PAD + p.x;
      const relY = LABEL_H + PAD + p.y;
      rfNodes.push({
        id: entry.id,
        type: "archNode",
        position: { x: relX, y: relY },
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
      // Track absolute position for edge routing
      nodeAbsPos.set(entry.id, { x: relX + NODE_W / 2, y: yOffset + relY + NODE_H / 2 });
    }

    yOffset += groupH + GROUP_GAP;
  }

  // Center groups horizontally
  const maxGroupW = Math.max(...rfNodes.filter(n => n.type === "archGroup").map(n => (n.style?.width as number) || 0));
  for (const n of rfNodes) {
    if (n.type === "archGroup") {
      const w = (n.style?.width as number) || 0;
      n.position.x = Math.round((maxGroupW - w) / 2);
      // Update child absolute positions
      const gx = n.position.x;
      const gy = n.position.y;
      for (const child of rfNodes) {
        if (child.parentId === n.id) {
          nodeAbsPos.set(child.id, {
            x: gx + child.position.x + NODE_W / 2,
            y: gy + child.position.y + NODE_H / 2,
          });
        }
      }
    }
  }

  // Build edges
  const rfEdges: Edge[] = resolvedEdges.map((re, i) => {
    const sPos = nodeAbsPos.get(re.sourceId);
    const tPos = nodeAbsPos.get(re.targetId);
    // Orient top-to-bottom
    let source = re.sourceId;
    let target = re.targetId;
    let srcHandle = "b";
    let tgtHandle = "t";
    if (sPos && tPos && tPos.y < sPos.y) {
      source = re.targetId;
      target = re.sourceId;
    }
    // Same layer? Use side handles
    if (sPos && tPos && Math.abs(sPos.y - tPos.y) < NODE_H) {
      if (sPos.x < tPos.x) {
        srcHandle = "r";
        tgtHandle = "l";
      } else {
        srcHandle = "l";
        tgtHandle = "r";
        // Swap source/target for left-to-right flow
        [source, target] = [target, source];
      }
    }

    const labelParts = [re.intg.protocol || "API"];
    if (re.intg.direction && re.intg.direction !== "sync") labelParts.push(re.intg.direction);
    const edgeLabel = labelParts.join(", ");

    return {
      id: `arch-e-${i}`,
      source,
      target,
      sourceHandle: srcHandle,
      targetHandle: tgtHandle,
      type: "archEdge",
      data: { label: edgeLabel, protocol: re.intg.protocol, direction: re.intg.direction } satisfies ArchEdgeData,
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
      <Box sx={{ height: 520 }} className={hoveredNode ? "arch-hover-active" : undefined}>
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
