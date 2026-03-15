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
  EdgeLabelRenderer,
  ReactFlowProvider,
  useNodes,
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

  /* ---- Click + long-press via pointer events ---- */
  /* React Flow v12 swallows click events on custom nodes, but pointer
     events still fire reliably — the same layer long-press already uses. */
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pressing, setPressing] = useState(false);
  const downPos = useRef<{ x: number; y: number; shift: boolean } | null>(null);

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

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      downPos.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
      if (!data.onLongPress || !data.nodeId) return;
      _longPressFired = false;
      showTimerRef.current = setTimeout(() => setPressing(true), 150);
      fireTimerRef.current = setTimeout(() => {
        _longPressFired = true;
        setPressing(false);
        data.onLongPress!(data.nodeId!);
      }, 1000);
    },
    [data],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      clearTimer();
      if (_longPressFired) { _longPressFired = false; downPos.current = null; return; }
      const d = downPos.current;
      downPos.current = null;
      if (!d) return;
      if (Math.abs(e.clientX - d.x) > 5 || Math.abs(e.clientY - d.y) > 5) return;
      // Stop propagation so React Flow doesn't also fire its own click handler
      e.stopPropagation();
      if (data.onClick && data.nodeId) data.onClick(data.nodeId, d.shift);
    },
    [data, clearTimer],
  );

  return (
    <Box
      onClick={(e) => e.stopPropagation()}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={clearTimer}
      onPointerLeave={clearTimer}
      sx={{
        width: C4_NODE_W,
        height: C4_NODE_H,
        borderRadius: "8px",
        border: data.proposed ? `2px dashed ${color}` : `1.5px solid ${color}`,
        bgcolor: data.proposed ? (isDark ? `rgba(${r},${g},${b},0.06)` : `rgba(${r},${g},${b},0.06)`) : bg,
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
      {/* Proposed "NEW" badge */}
      {data.proposed && (
        <Box sx={{
          position: "absolute", top: -8, left: 8,
          bgcolor: "#4caf50", color: "#fff",
          fontSize: 9, fontWeight: 700, lineHeight: 1,
          px: 0.7, py: 0.25, borderRadius: "4px",
          textTransform: "uppercase", letterSpacing: 0.5,
        }}>
          NEW
        </Box>
      )}
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
    // Use parent-managed hover state to prevent stale highlights when
    // React Flow reorders SVG elements (local useState would go stale).
    const isHovered = edgeData?.isHovered === true;
    const active = edgeData?.highlightMode
      ? connectedToHovered
      : isHovered || connectedToHovered;
    const isDark = theme.palette.mode === "dark";
    const baseColor = isDark ? "#aaa" : "#777";
    const hoverColor = isDark ? "#4fc3f7" : "#1976d2";
    const color = active ? hoverColor : baseColor;

    const rawOffset = edgeData?.pathOffset ?? 20;
    const minOffset = edgeData?.minOffset ?? 0;
    const verticalGap = Math.abs(targetY - sourceY);
    // If the edge must clear an obstruction, use at least minOffset; otherwise
    // clamp to 48% of the vertical gap so the horizontal segment stays within
    // the inter-group band. The layout engine already staggers offsets, so we
    // use a generous fraction to preserve the staggering.
    const offset = minOffset > 0
      ? Math.max(rawOffset, minOffset)
      : Math.min(rawOffset, Math.max(10, verticalGap * 0.48));
    const [path, lx, ly] = getSmoothStepPath({
      sourceX, sourceY, targetX, targetY,
      sourcePosition, targetPosition,
      borderRadius: 8,
      offset,
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

    // Build node + group-label bounding boxes from React Flow nodes for overlap detection
    const rfNodes = useNodes();
    const obstacleBounds = useMemo(() => {
      const bounds: { x1: number; y1: number; x2: number; y2: number }[] = [];
      for (const n of rfNodes) {
        if (n.type === "c4Node" && n.parentId) {
          const parent = rfNodes.find((p) => p.id === n.parentId);
          if (!parent) continue;
          const w = (n.style?.width as number) ?? C4_NODE_W;
          const h = (n.style?.height as number) ?? C4_NODE_H;
          const ax = parent.position.x + n.position.x;
          const ay = parent.position.y + n.position.y;
          bounds.push({ x1: ax, y1: ay, x2: ax + w, y2: ay + h });
        } else if (n.type === "c4Group") {
          // Group label text area (top-left corner of group box)
          const gx = n.position.x;
          const gy = n.position.y;
          const gw = (n.style?.width as number) ?? 0;
          // Label sits at top:8 left:14, ~13px font, covers roughly top 30px
          // Use full group width for the label strip to avoid any overlap
          bounds.push({ x1: gx, y1: gy, x2: gx + gw, y2: gy + 34 });
        }
      }
      return bounds;
    }, [rfNodes]);

    // Find a label position along the path that doesn't overlap any node
    const pathRef = useRef<SVGPathElement>(null);
    const [labelPos, setLabelPos] = useState<{ x: number; y: number } | null>(null);

    const maxChars = 24;
    const displayLabel = label.length > maxChars
      ? label.slice(0, maxChars - 1) + "\u2026"
      : label;
    const labelW = displayLabel.length * 6.5 + 16;
    const labelH = 20;
    const margin = 6;

    useEffect(() => {
      const el = pathRef.current;
      if (!el || !label) return;
      el.setAttribute("d", path);
      const total = el.getTotalLength();

      // Check if a point overlaps any node
      const overlaps = (px: number, py: number) => {
        const lx1 = px - labelW / 2 - margin;
        const lx2 = px + labelW / 2 + margin;
        const ly1 = py - labelH / 2 - margin;
        const ly2 = py + labelH / 2 + margin;
        for (const b of obstacleBounds) {
          if (lx1 < b.x2 && lx2 > b.x1 && ly1 < b.y2 && ly2 > b.y1) return true;
        }
        return false;
      };

      // Try the preferred position first
      const preferred = el.getPointAtLength(total * labelT);
      if (!overlaps(preferred.x, preferred.y)) {
        setLabelPos({ x: preferred.x, y: preferred.y });
        return;
      }

      // Sample 20 positions along the path, find the one closest to labelT
      // that doesn't overlap any node. Skip the ends (near source/target nodes).
      let bestPt: { x: number; y: number } | null = null;
      let bestDist = Infinity;
      const steps = 20;
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (t < 0.08 || t > 0.92) continue; // skip near endpoints
        const pt = el.getPointAtLength(total * t);
        if (!overlaps(pt.x, pt.y)) {
          const dist = Math.abs(t - labelT);
          if (dist < bestDist) {
            bestDist = dist;
            bestPt = { x: pt.x, y: pt.y };
          }
        }
      }

      setLabelPos(bestPt ?? { x: preferred.x, y: preferred.y });
    }, [path, labelT, label, obstacleBounds, labelW, labelH]);

    const finalLx = labelPos?.x ?? lx;
    const finalLy = labelPos?.y ?? ly;

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
          style={{ cursor: "pointer", pointerEvents: "stroke" }}
          onMouseEnter={edgeData?.onHover}
          onMouseLeave={edgeData?.onLeave}
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
          <EdgeLabelRenderer>
            <div
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${finalLx}px, ${finalLy}px)`,
                pointerEvents: "none",
                fontSize: 10,
                fontFamily: "inherit",
                color: labelColor,
                background: labelBg,
                opacity: active ? 1 : 0.8,
                border: `1px solid ${labelBorder}`,
                borderRadius: 4,
                padding: "2px 6px",
                whiteSpace: "nowrap",
                lineHeight: "14px",
                zIndex: active ? 2 : 1,
              }}
            >
              {displayLabel}
            </div>
          </EdgeLabelRenderer>
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
  onNodeExpand?: (id: string) => void;
  onExpandReset?: () => void;
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
  onNodeExpand,
  onExpandReset,
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

  // Interaction mode: "normal" (default), "highlight" (sticky hover), "expand" (add relations)
  type InteractionMode = "normal" | "highlight" | "expand";
  const [mode, setMode] = useState<InteractionMode>("normal");
  // Ref so the node-level click callback always reads the latest mode
  const modeRef = useRef<InteractionMode>(mode);
  modeRef.current = mode;

  // Derived booleans for style props (read from state, not ref)
  const highlightMode = mode === "highlight";
  const expandMode = mode === "expand";

  // Click handler injected into each c4Node via data.onClick —
  // uses modeRef so the callback always reads the latest mode.
  const handleC4NodeClick = useCallback(
    (nodeId: string, shiftKey: boolean) => {
      const currentMode = modeRef.current;
      if (currentMode === "highlight") {
        if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
        setHoveredNode((prev) => (prev === nodeId ? null : nodeId));
      } else if (currentMode === "expand" && onNodeExpand) {
        onNodeExpand(nodeId);
      } else if (shiftKey && onNodeShiftClick) {
        setHoveredNode(null);
        onNodeShiftClick(nodeId);
      } else {
        setHoveredNode(null);
        onNodeClick(nodeId);
      }
    },
    [onNodeClick, onNodeShiftClick, onNodeExpand],
  );

  // Inject click + long-press callbacks into c4Node data
  const rfNodes = useMemo(
    () =>
      builtNodes.map((n) =>
        n.type === "c4Node"
          ? {
              ...n,
              data: {
                ...n.data,
                nodeId: n.id,
                onClick: handleC4NodeClick,
                ...(onNodeShiftClick && { onLongPress: onNodeShiftClick }),
              },
            }
          : n,
      ),
    [builtNodes, handleC4NodeClick, onNodeShiftClick],
  );

  // In highlight mode, clicking the canvas (not a node) dismisses the highlight
  const handlePaneClick = useCallback(() => {
    if (modeRef.current === "highlight") setHoveredNode(null);
  }, []);

  // Bring hovered edge to front by reordering
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const handleEdgeMouseEnter = useCallback((_: React.MouseEvent, edge: Edge) => {
    setHoveredEdge(edge.id);
  }, []);
  const handleEdgeMouseLeave = useCallback(() => {
    setHoveredEdge(null);
  }, []);

  // Stable per-edge hover callbacks (memoised map to avoid re-creating on each render)
  const edgeHoverCbs = useRef(new Map<string, { onHover: () => void; onLeave: () => void }>());
  const getEdgeHoverCbs = useCallback((edgeId: string) => {
    let cbs = edgeHoverCbs.current.get(edgeId);
    if (!cbs) {
      cbs = {
        onHover: () => setHoveredEdge(edgeId),
        onLeave: () => setHoveredEdge((prev) => (prev === edgeId ? null : prev)),
      };
      edgeHoverCbs.current.set(edgeId, cbs);
    }
    return cbs;
  }, []);

  // Highlight all connections when hovering a card node
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleNodeMouseEnter = useCallback((_: React.MouseEvent, node: Node) => {
    if (modeRef.current !== "normal") return; // hover only in normal mode
    if (node.type === "c4Node") {
      if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
      setHoveredNode(node.id);
    }
  }, []);
  const handleNodeMouseLeave = useCallback(() => {
    if (modeRef.current !== "normal") return; // hover only in normal mode
    leaveTimer.current = setTimeout(() => setHoveredNode(null), 0);
  }, []);

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

  // Inject hover state + callbacks into edges + reorder for z-index
  const orderedEdges = useMemo(() => {
    let result = rfEdges.map((e) => {
      const cbs = getEdgeHoverCbs(e.id);
      return {
        ...e,
        data: {
          ...e.data,
          connectedToHovered: hoveredNode
            ? e.source === hoveredNode || e.target === hoveredNode
            : false,
          isHovered: e.id === hoveredEdge,
          highlightMode,
          onHover: cbs.onHover,
          onLeave: cbs.onLeave,
        },
      };
    });
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
  }, [rfEdges, hoveredEdge, hoveredNode, highlightMode, getEdgeHoverCbs]);

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
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 2,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 400,
      }}
    >
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
          flexShrink: 0,
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
      <Box sx={{ flex: 1, minHeight: 0 }} className={hoveredNode ? "c4-hover-active" : undefined}>
        {hoverStyle && <style>{hoverStyle}</style>}
        <ReactFlow
          nodes={rfNodes}
          edges={orderedEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
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
          elementsSelectable={false}
          colorMode={theme.palette.mode}
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false}>
            <ControlButton
              title={t("dependency.highlightMode")}
              onClick={() => {
                setMode((m) => {
                  if (m === "highlight") {
                    setHoveredNode(null);
                    return "normal";
                  }
                  return "highlight";
                });
              }}
              style={{
                background: highlightMode ? theme.palette.primary.main : undefined,
                color: highlightMode ? theme.palette.primary.contrastText : undefined,
              }}
            >
              <MaterialSymbol icon="highlight" size={18} />
            </ControlButton>
            <ControlButton
              title={t("dependency.expandMode")}
              onClick={() => {
                setMode((m) => {
                  if (m === "expand") {
                    if (onExpandReset) onExpandReset();
                    return "normal";
                  }
                  return "expand";
                });
              }}
              style={{
                background: expandMode ? theme.palette.primary.main : undefined,
                color: expandMode ? theme.palette.primary.contrastText : undefined,
              }}
            >
              <MaterialSymbol icon="alt_route" size={18} />
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
