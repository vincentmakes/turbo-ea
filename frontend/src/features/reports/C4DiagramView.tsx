import { useMemo, useCallback, useState, useRef, memo } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type NodeProps,
  type EdgeProps,
  type Edge,
  type Node,
  getSmoothStepPath,
  BaseEdge,
  EdgeLabelRenderer,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useResolveMetaLabel } from "@/hooks/useResolveLabel";
import type { CardType } from "@/types";
import {
  buildC4Flow,
  C4_NODE_W,
  C4_NODE_H,
  type GNode,
  type GEdge,
  type C4NodeData,
  type C4GroupData,
  type C4EdgeData,
} from "./c4Layout";

/* ------------------------------------------------------------------ */
/*  Module-level long-press flag (shared between C4Node and click handler) */
/* ------------------------------------------------------------------ */

let _longPressFired = false;

/* ------------------------------------------------------------------ */
/*  Custom C4 Node                                                     */
/* ------------------------------------------------------------------ */

const C4Node = memo(({ data }: NodeProps<Node<C4NodeData>>) => {
  const rml = useResolveMetaLabel();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const color = data.typeColor;

  // Light tint for background
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * (isDark ? 0.92 : 0.88));
  const bg = isDark
    ? `rgba(${r},${g},${b},0.12)`
    : `rgb(${mix(r)},${mix(g)},${mix(b)})`;

  const name = data.name.length > 26 ? data.name.slice(0, 25) + "\u2026" : data.name;

  const hs = { background: color, width: 5, height: 5, border: "none" } as const;

  /* ---- Long-press detection (touch-friendly Shift+click alternative) ---- */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(() => {
    if (!data.onLongPress || !data.nodeId) return;
    _longPressFired = false;
    timerRef.current = setTimeout(() => {
      _longPressFired = true;
      data.onLongPress!(data.nodeId!);
    }, 1000);
  }, [data]);

  return (
    <Box
      onPointerDown={handlePointerDown}
      onPointerUp={clearTimer}
      onPointerCancel={clearTimer}
      onPointerLeave={clearTimer}
      sx={{
        width: C4_NODE_W,
        height: C4_NODE_H,
        borderRadius: "8px",
        border: `1.5px solid ${color}`,
        bgcolor: bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        px: 1,
        cursor: "pointer",
        transition: "box-shadow 0.15s",
        touchAction: "none",
        "&:hover": { boxShadow: 4 },
      }}
    >
      {/* Target handles along top edge (spread at 25%, 50%, 75%) */}
      <Handle type="target" position={Position.Top} id="t-l" style={{ ...hs, left: "25%" }} />
      <Handle type="target" position={Position.Top} id="t-c" style={{ ...hs, left: "50%" }} />
      <Handle type="target" position={Position.Top} id="t-r" style={{ ...hs, left: "75%" }} />
      {/* Source handles along bottom edge */}
      <Handle type="source" position={Position.Bottom} id="b-l" style={{ ...hs, left: "25%" }} />
      <Handle type="source" position={Position.Bottom} id="b-c" style={{ ...hs, left: "50%" }} />
      <Handle type="source" position={Position.Bottom} id="b-r" style={{ ...hs, left: "75%" }} />
      {/* Side handles — both source and target on each side */}
      <Handle type="target" position={Position.Left} id="left" style={hs} />
      <Handle type="source" position={Position.Left} id="left-src" style={hs} />
      <Handle type="source" position={Position.Right} id="right" style={hs} />
      <Handle type="target" position={Position.Right} id="right-tgt" style={hs} />
      <Typography
        variant="body2"
        sx={{
          fontWeight: 600,
          lineHeight: 1.3,
          textAlign: "center",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          width: "100%",
        }}
      >
        {name}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          color,
          fontStyle: "italic",
          lineHeight: 1.2,
          mt: 0.25,
        }}
      >
        [{rml(data.typeKey, undefined, "label") || data.typeLabel}]
      </Typography>
    </Box>
  );
});
C4Node.displayName = "C4Node";

/* ------------------------------------------------------------------ */
/*  Custom C4 Group (boundary)                                         */
/* ------------------------------------------------------------------ */

const C4Group = memo(({ data }: NodeProps<Node<C4GroupData>>) => {
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
          fontSize: "0.8rem",
        }}
      >
        {data.label}
      </Typography>
    </Box>
  );
});
C4Group.displayName = "C4Group";

/* ------------------------------------------------------------------ */
/*  Custom C4 Edge (smoothstep + hover highlight)                      */
/* ------------------------------------------------------------------ */

const C4EdgeComponent = memo(
  ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps) => {
    const theme = useTheme();
    const [hovered, setHovered] = useState(false);
    const baseColor = theme.palette.mode === "dark" ? "#aaa" : "#777";
    const hoverColor = theme.palette.mode === "dark" ? "#4fc3f7" : "#1976d2";
    const color = hovered ? hoverColor : baseColor;

    const [path, lx, ly] = getSmoothStepPath({
      sourceX, sourceY, targetX, targetY,
      sourcePosition, targetPosition,
      borderRadius: 8,
    });

    const label = (data as C4EdgeData | undefined)?.relLabel || "";

    return (
      <g
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Invisible wider path for easier hover targeting */}
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          style={{ cursor: "pointer" }}
        />
        <BaseEdge
          id={id}
          path={path}
          markerEnd={markerEnd}
          style={{
            stroke: color,
            strokeWidth: hovered ? 2 : 1.2,
            strokeDasharray: hovered ? "none" : "5 3",
            transition: "stroke 0.15s, stroke-width 0.15s",
          }}
        />
        {label && (
          <EdgeLabelRenderer>
            <Box
              sx={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${lx}px,${ly}px)`,
                fontSize: "0.62rem",
                color: hovered ? "primary.main" : "text.secondary",
                bgcolor: "background.paper",
                border: "1px solid",
                borderColor: hovered ? "primary.main" : "divider",
                px: 0.75,
                py: 0.25,
                borderRadius: 1,
                pointerEvents: "none",
                whiteSpace: "nowrap",
                maxWidth: 160,
                overflow: "hidden",
                textOverflow: "ellipsis",
                lineHeight: 1.3,
                transition: "color 0.15s, border-color 0.15s",
                zIndex: hovered ? 10 : 0,
              }}
              className="nodrag nopan"
            >
              {label}
            </Box>
          </EdgeLabelRenderer>
        )}
      </g>
    );
  },
);
C4EdgeComponent.displayName = "C4EdgeComponent";

/* ------------------------------------------------------------------ */
/*  Node types registry                                                */
/* ------------------------------------------------------------------ */

const nodeTypes = {
  c4Node: C4Node,
  c4Group: C4Group,
};

const edgeTypes = {
  c4Edge: C4EdgeComponent,
};

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface Props {
  nodes: GNode[];
  edges: GEdge[];
  types: CardType[];
  onNodeClick: (id: string) => void;
  onNodeShiftClick?: (id: string) => void;
  onHome: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  centerName?: string;
}

/* ------------------------------------------------------------------ */
/*  Inner component (needs ReactFlowProvider ancestor)                 */
/* ------------------------------------------------------------------ */

function C4DiagramInner({
  nodes,
  edges,
  types,
  onNodeClick,
  onNodeShiftClick,
  onHome,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  centerName,
}: Props) {
  const { t } = useTranslation(["reports"]);
  const theme = useTheme();

  const { nodes: builtNodes, edges: rfEdges } = useMemo(
    () => buildC4Flow(nodes, edges, types),
    [nodes, edges, types],
  );

  // Inject long-press callback into c4Node data so C4Node can handle pointer events
  const rfNodes = useMemo(
    () =>
      builtNodes.map((n) =>
        n.type === "c4Node" && onNodeShiftClick
          ? { ...n, data: { ...n.data, nodeId: n.id, onLongPress: onNodeShiftClick } }
          : n,
      ),
    [builtNodes, onNodeShiftClick],
  );

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (node.type === "c4Node") {
        if (_longPressFired) {
          _longPressFired = false;
          return; // already handled by long-press
        }
        if (event.shiftKey && onNodeShiftClick) {
          onNodeShiftClick(node.id);
        } else {
          onNodeClick(node.id);
        }
      }
    },
    [onNodeClick, onNodeShiftClick],
  );

  // Bring hovered edge to front by reordering
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const handleEdgeMouseEnter = useCallback((_: React.MouseEvent, edge: Edge) => {
    setHoveredEdge(edge.id);
  }, []);
  const handleEdgeMouseLeave = useCallback(() => {
    setHoveredEdge(null);
  }, []);

  // Reorder edges so hovered one renders last (on top)
  const orderedEdges = useMemo(() => {
    if (!hoveredEdge) return rfEdges;
    const rest = rfEdges.filter((e) => e.id !== hoveredEdge);
    const hovered = rfEdges.find((e) => e.id === hoveredEdge);
    return hovered ? [...rest, hovered] : rfEdges;
  }, [rfEdges, hoveredEdge]);

  if (rfNodes.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 6, textAlign: "center", borderRadius: 2 }}>
        <Typography color="text.disabled">{t("dependency.c4NoData")}</Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
      {/* Navigation bar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 0.5,
          borderBottom: "1px solid",
          borderColor: "divider",
          minHeight: 40,
        }}
      >
        <Tooltip title={t("dependency.home")} arrow>
          <IconButton size="small" onClick={onHome}>
            <MaterialSymbol icon="home" size={20} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("dependency.previousCard")} arrow>
          <span>
            <IconButton size="small" disabled={!hasPrev} onClick={onPrev}>
              <MaterialSymbol icon="chevron_left" size={20} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t("dependency.nextCard")} arrow>
          <span>
            <IconButton size="small" disabled={!hasNext} onClick={onNext}>
              <MaterialSymbol icon="chevron_right" size={20} />
            </IconButton>
          </span>
        </Tooltip>
        {centerName && (
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, ml: 0.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {centerName}
          </Typography>
        )}
        <Typography
          variant="caption"
          sx={{ ml: "auto", color: "text.disabled", whiteSpace: "nowrap", fontSize: "0.68rem" }}
        >
          {t("dependency.shiftClickHint")}
        </Typography>
      </Box>
      <Box sx={{ height: 600 }}>
        <ReactFlow
          nodes={rfNodes}
          edges={orderedEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={handleNodeClick}
          onEdgeMouseEnter={handleEdgeMouseEnter}
          onEdgeMouseLeave={handleEdgeMouseLeave}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          colorMode={theme.palette.mode}
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </Box>
      <Box sx={{ px: 1.5, py: 0.75, textAlign: "right" }}>
        <Chip
          size="small"
          label={t("dependency.stats", {
            nodes: nodes.length,
            relations: edges.length,
          })}
          variant="outlined"
        />
      </Box>
    </Paper>
  );
}

/* ------------------------------------------------------------------ */
/*  Exported wrapper with ReactFlowProvider                            */
/* ------------------------------------------------------------------ */

export default function C4DiagramView(props: Props) {
  return (
    <ReactFlowProvider>
      <C4DiagramInner {...props} />
    </ReactFlowProvider>
  );
}
