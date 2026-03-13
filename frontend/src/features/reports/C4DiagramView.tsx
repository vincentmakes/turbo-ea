import { useMemo, useCallback, useState, useRef, useEffect, memo } from "react";
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
  ControlButton,
  Handle,
  Position,
  type NodeProps,
  type EdgeProps,
  type Edge,
  type Node,
  getSmoothStepPath,
  BaseEdge,
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

const LP_CIRCUMFERENCE = 2 * Math.PI * 15; // ~94.25

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

  const usedSet = useMemo(() => new Set(data.usedHandles ?? []), [data.usedHandles]);
  const hs = (id: string, extra?: React.CSSProperties) =>
    ({
      background: usedSet.has(id) ? color : "transparent",
      width: 5,
      height: 5,
      border: "none",
      opacity: usedSet.has(id) ? 1 : 0,
      ...extra,
    }) as const;

  /* ---- Long-press detection (touch-friendly Shift+click alternative) ---- */
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pressing, setPressing] = useState(false);

  const clearTimer = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (fireTimerRef.current) {
      clearTimeout(fireTimerRef.current);
      fireTimerRef.current = null;
    }
    setPressing(false);
  }, []);

  const handlePointerDown = useCallback(() => {
    if (!data.onLongPress || !data.nodeId) return;
    _longPressFired = false;
    // Delay showing the ring so quick taps don't flash it
    showTimerRef.current = setTimeout(() => setPressing(true), 150);
    fireTimerRef.current = setTimeout(() => {
      _longPressFired = true;
      setPressing(false);
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
        position: "relative",
        transition: "box-shadow 0.15s, opacity 0.15s",
        touchAction: "none",
        "&:hover": { boxShadow: 4 },
      }}
    >
      {/* Long-press radial progress ring */}
      {pressing && (
        <Box
          sx={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
          }}
        >
          <svg width={40} height={40} viewBox="0 0 40 40">
            <circle
              cx={20}
              cy={20}
              r={15}
              fill="none"
              stroke={color}
              strokeWidth={5}
              strokeLinecap="round"
              strokeDasharray={LP_CIRCUMFERENCE}
              strokeDashoffset={LP_CIRCUMFERENCE}
              style={{
                animation: "c4-lp-ring 850ms linear forwards",
                transformOrigin: "center",
                transform: "rotate(-90deg)",
              }}
            />
          </svg>
        </Box>
      )}
      <style>{`@keyframes c4-lp-ring{to{stroke-dashoffset:0}}`}</style>
      {/* Target handles along top edge (spread at 12%, 30%, 50%, 70%, 88%) */}
      <Handle type="target" position={Position.Top} id="t-1" style={hs("t-1", { left: "12%" })} />
      <Handle type="target" position={Position.Top} id="t-2" style={hs("t-2", { left: "30%" })} />
      <Handle type="target" position={Position.Top} id="t-3" style={hs("t-3", { left: "50%" })} />
      <Handle type="target" position={Position.Top} id="t-4" style={hs("t-4", { left: "70%" })} />
      <Handle type="target" position={Position.Top} id="t-5" style={hs("t-5", { left: "88%" })} />
      {/* Source handles along bottom edge */}
      <Handle type="source" position={Position.Bottom} id="b-1" style={hs("b-1", { left: "12%" })} />
      <Handle type="source" position={Position.Bottom} id="b-2" style={hs("b-2", { left: "30%" })} />
      <Handle type="source" position={Position.Bottom} id="b-3" style={hs("b-3", { left: "50%" })} />
      <Handle type="source" position={Position.Bottom} id="b-4" style={hs("b-4", { left: "70%" })} />
      <Handle type="source" position={Position.Bottom} id="b-5" style={hs("b-5", { left: "88%" })} />
      {/* Side handles — both source and target on each side */}
      <Handle type="target" position={Position.Left} id="left" style={hs("left")} />
      <Handle type="source" position={Position.Left} id="left-src" style={hs("left-src")} />
      <Handle type="source" position={Position.Right} id="right" style={hs("right")} />
      <Handle type="target" position={Position.Right} id="right-tgt" style={hs("right-tgt")} />
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

const C4EdgeComponent = (
  { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps,
) => {
    const theme = useTheme();
    const edgeData = data as C4EdgeData | undefined;
    const connectedToHovered = edgeData?.connectedToHovered ?? false;
    const isHovered = (edgeData as Record<string, unknown>)?.isHovered === true;
    const active = edgeData?.highlightMode
      ? connectedToHovered
      : isHovered || connectedToHovered;
    const isDark = theme.palette.mode === "dark";
    const baseColor = isDark ? "#aaa" : "#777";
    const hoverColor = isDark ? "#4fc3f7" : "#1976d2";
    const color = active ? hoverColor : baseColor;

    const rawOffset = edgeData?.pathOffset ?? 20;
    const verticalGap = Math.abs(targetY - sourceY);
    const clampedOffset = Math.min(rawOffset, Math.max(10, verticalGap * 0.4));
    const [path, lx, ly] = getSmoothStepPath({
      sourceX, sourceY, targetX, targetY,
      sourcePosition, targetPosition,
      borderRadius: 8,
      offset: clampedOffset,
    });

    const label = edgeData?.relLabel || "";
    const labelT = edgeData?.labelT ?? 0.5;
    const labelBg = isDark ? "#121212" : "#ffffff";
    const labelColor = active
      ? (isDark ? "#4fc3f7" : "#1976d2")
      : (isDark ? "#aaa" : "#666");
    const labelBorder = active
      ? (isDark ? "#4fc3f7" : "#1976d2")
      : (isDark ? "#444" : "#ccc");

    // Measure on-path label position using SVGPathElement
    const pathRef = useRef<SVGPathElement>(null);
    const [labelPos, setLabelPos] = useState<{ x: number; y: number } | null>(null);

    useEffect(() => {
      const el = pathRef.current;
      if (!el || !label) return;
      el.setAttribute("d", path);
      const total = el.getTotalLength();
      const pt = el.getPointAtLength(total * labelT);
      setLabelPos({ x: pt.x, y: pt.y });
    }, [path, labelT, label]);

    const finalLx = labelPos?.x ?? lx;
    const finalLy = labelPos?.y ?? ly;

    // Estimate SVG text width (~5.8px per char at 10px font + 12px padding)
    const maxChars = 24;
    const displayLabel = label.length > maxChars
      ? label.slice(0, maxChars - 1) + "\u2026"
      : label;
    const estW = displayLabel.length * 5.8 + 12;
    const labelH = 18;

    return (
      <>
        {/* Hidden path for label position measurement */}
        <path ref={pathRef} fill="none" stroke="none" visibility="hidden" />
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
            strokeWidth: active ? 2 : 1.2,
            strokeDasharray: active ? "none" : "5 3",
            transition: "stroke 0.15s, stroke-width 0.15s",
          }}
        />
        {label && (
          <>
            <rect
              x={finalLx - estW / 2}
              y={finalLy - labelH / 2}
              width={estW}
              height={labelH}
              rx={4}
              fill={labelBg}
              fillOpacity={0.8}
              stroke={labelBorder}
              strokeWidth={1}
            />
            <text
              x={finalLx}
              y={finalLy}
              textAnchor="middle"
              dominantBaseline="central"
              fill={labelColor}
              fontSize={10}
              fontFamily="inherit"
              style={{ pointerEvents: "none" }}
            >
              {displayLabel}
            </text>
          </>
        )}
      </>
    );
  };

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

  // Highlight mode: click highlights connections instead of opening card
  const [highlightMode, setHighlightMode] = useState(false);

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (node.type === "c4Node") {
        if (_longPressFired) {
          _longPressFired = false;
          return; // already handled by long-press
        }
        if (highlightMode) {
          // Cancel any pending mouse-leave timer to prevent race
          if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
          // Toggle: tap same card clears, tap different card highlights it
          setHoveredNode((prev) => (prev === node.id ? null : node.id));
          return;
        }
        // Clear highlight before navigating so it doesn't persist when coming back
        setHoveredNode(null);
        if (event.shiftKey && onNodeShiftClick) {
          onNodeShiftClick(node.id);
        } else {
          onNodeClick(node.id);
        }
      }
    },
    [onNodeClick, onNodeShiftClick, highlightMode],
  );

  // In highlight mode, clicking the canvas (not a node) dismisses the highlight
  const handlePaneClick = useCallback(() => {
    if (highlightMode) setHoveredNode(null);
  }, [highlightMode]);

  // Bring hovered edge to front by reordering
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const handleEdgeMouseEnter = useCallback((_: React.MouseEvent, edge: Edge) => {
    setHoveredEdge(edge.id);
  }, []);
  const handleEdgeMouseLeave = useCallback(() => {
    setHoveredEdge(null);
  }, []);

  // Highlight all connections when hovering a card node
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleNodeMouseEnter = useCallback((_: React.MouseEvent, node: Node) => {
    if (highlightMode) return; // hover disabled in highlight mode
    if (node.type === "c4Node") {
      if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
      setHoveredNode(node.id);
    }
  }, [highlightMode]);
  const handleNodeMouseLeave = useCallback(() => {
    if (highlightMode) return; // hover disabled in highlight mode
    // Use rAF instead of setTimeout: clears on next frame unless a new
    // mouseEnter cancels it first — fast enough to avoid stale highlights
    // but doesn't cause DOM churn that swallows the next card's mouseenter.
    leaveTimer.current = setTimeout(() => setHoveredNode(null), 0);
  }, [highlightMode]);

  // Set of nodes connected to the hovered node (for dimming others)
  const hoveredNeighbors = useMemo(() => {
    if (!hoveredNode) return null;
    const s = new Set<string>([hoveredNode]);
    for (const e of rfEdges) {
      if (e.source === hoveredNode) s.add(e.target);
      if (e.target === hoveredNode) s.add(e.source);
    }
    return s;
  }, [hoveredNode, rfEdges]);

  // Inject hover state into edges + reorder for z-index
  const orderedEdges = useMemo(() => {
    let result = rfEdges.map((e) => ({
      ...e,
      data: {
        ...e.data,
        connectedToHovered: hoveredNode
          ? e.source === hoveredNode || e.target === hoveredNode
          : false,
        isHovered: e.id === hoveredEdge,
        highlightMode,
      },
    }));
    if (hoveredEdge) {
      const rest = result.filter((e) => e.id !== hoveredEdge);
      const h = result.find((e) => e.id === hoveredEdge);
      result = h ? [...rest, h] : result;
    } else if (hoveredNode) {
      const notConn = result.filter((e) => !e.data.connectedToHovered);
      const conn = result.filter((e) => e.data.connectedToHovered);
      result = [...notConn, ...conn];
    }
    return result;
  }, [rfEdges, hoveredEdge, hoveredNode, highlightMode]);

  // CSS-based dimming avoids recreating node objects (which causes flickering)
  const hoverStyle = useMemo(() => {
    if (!hoveredNeighbors) return "";
    const keep = [...hoveredNeighbors]
      .map((id) => `.react-flow__node[data-id="${id}"]`)
      .join(",");
    return [
      `.c4-hover-active .react-flow__node-c4Node { opacity: 0.35; transition: opacity 0.15s; }`,
      `${keep} { opacity: 1 !important; }`,
    ].join("\n");
  }, [hoveredNeighbors]);

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
      <Box sx={{ height: 600 }} className={hoveredNode ? "c4-hover-active" : undefined}>
        {hoverStyle && <style>{hoverStyle}</style>}
        <ReactFlow
          nodes={rfNodes}
          edges={orderedEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          onNodeMouseEnter={handleNodeMouseEnter}
          onNodeMouseLeave={handleNodeMouseLeave}
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
          <Controls showInteractive={false}>
            <ControlButton
              title={t("dependency.highlightMode")}
              onClick={() => {
                setHighlightMode((v) => !v);
                if (highlightMode) setHoveredNode(null);
              }}
              style={{
                background: highlightMode ? theme.palette.primary.main : undefined,
                color: highlightMode ? theme.palette.primary.contrastText : undefined,
              }}
            >
              <MaterialSymbol icon="highlight" size={18} />
            </ControlButton>
          </Controls>
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
