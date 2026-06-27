import {
  useMemo,
  useCallback,
  useState,
  useRef,
  useEffect,
  memo,
  createContext,
  useContext,
} from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Popover from "@mui/material/Popover";
import Switch from "@mui/material/Switch";
import Divider from "@mui/material/Divider";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import { lighten, useTheme } from "@mui/material/styles";
import { toPng, toSvg } from "html-to-image";
import { saveAs } from "file-saver";
import MaterialSymbol from "@/components/MaterialSymbol";
import { getCurrentPhase } from "@/components/LifecycleBadge";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  ControlButton,
  Handle,
  Position,
  getNodesBounds,
  getViewportForBounds,
  type NodeProps,
  type EdgeProps,
  type Edge,
  type Node,
  getSmoothStepPath,
  BaseEdge,
  EdgeLabelRenderer,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useResolveMetaLabel, useResolveLabel } from "@/hooks/useResolveLabel";
import { useLdvSettings, type LdvBackgroundStyle } from "./ldvDisplaySettings";
import type { CardType } from "@/types";
import {
  buildLdvFlow,
  filterEndOfLifeNodes,
  LDV_NODE_W,
  LDV_NODE_H,
  type GNode,
  type GEdge,
  type LdvNodeData,
  type LdvGroupData,
  type LdvEdgeData,
} from "./layeredDependencyLayout";

/* ------------------------------------------------------------------ */
/*  Card display settings (persisted, shared store)                    */
/* ------------------------------------------------------------------ */

type BackgroundStyle = LdvBackgroundStyle;

/** How many of the chosen extra fields render directly on the card body.
 *  The rest still appear in the hover tooltip. */
const MAX_CARD_LINES = 2;

/** Lifecycle-phase → dot colour (hex, theme-independent). Mirrors LifecycleBadge. */
const PHASE_DOT: Record<string, string> = {
  plan: "#9e9e9e",
  phaseIn: "#1976d2",
  active: "#2e7d32",
  phaseOut: "#ed6c02",
  endOfLife: "#d32f2f",
};

interface FieldMeta {
  key: string;
  label: string;
  translations?: Record<string, string>;
  type: string;
  options?: { key: string; label: string; translations?: Record<string, string> }[];
}

/** A single label/value line displayed on a card and/or its tooltip. */
interface DisplayLine {
  label: string;
  value: string;
}

/* Obstacle boxes (cards + group-label strips) that edge labels must avoid.
   Computed once per render in the parent and shared with every edge through
   context. Previously each edge recomputed this from the full node list with a
   `.find()` inside the loop — O(E·N²) on every drag frame. */
type ObstacleBounds = { x1: number; y1: number; x2: number; y2: number };
const LdvObstaclesContext = createContext<ObstacleBounds[]>([]);

function computeObstacles(nodeList: Node[]): ObstacleBounds[] {
  const byId = new Map(nodeList.map((n) => [n.id, n]));
  const bounds: ObstacleBounds[] = [];
  for (const n of nodeList) {
    if (n.type === "ldvNode" && n.parentId) {
      const parent = byId.get(n.parentId);
      if (!parent) continue;
      const w = (n.style?.width as number) ?? LDV_NODE_W;
      const h = (n.style?.height as number) ?? LDV_NODE_H;
      const ax = parent.position.x + n.position.x;
      const ay = parent.position.y + n.position.y;
      bounds.push({ x1: ax, y1: ay, x2: ax + w, y2: ay + h });
    } else if (n.type === "ldvGroup") {
      // Group label strip across the top of the box.
      const gx = n.position.x;
      const gy = n.position.y;
      const gw = (n.style?.width as number) ?? 0;
      bounds.push({ x1: gx, y1: gy, x2: gx + gw, y2: gy + 34 });
    }
  }
  return bounds;
}

/** Collect a de-duplicated, sorted catalogue of attribute fields across the
 *  card types currently present in the graph — drives the "extra fields" picker. */
function buildFieldCatalog(types: CardType[], presentTypeKeys: Set<string>): FieldMeta[] {
  const out: FieldMeta[] = [];
  const seen = new Set<string>();
  for (const ct of types) {
    if (!presentTypeKeys.has(ct.key)) continue;
    for (const sec of ct.fields_schema || []) {
      for (const f of sec.fields || []) {
        if (seen.has(f.key)) continue;
        seen.add(f.key);
        out.push({
          key: f.key,
          label: f.label || f.key,
          translations: f.translations,
          type: f.type,
          options: f.options?.map((o) => ({
            key: o.key,
            label: o.label || o.key,
            translations: o.translations,
          })),
        });
      }
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/* ------------------------------------------------------------------ */
/*  Custom Layered Dependency View Node                                */
/* ------------------------------------------------------------------ */

const LP_CIRCUMFERENCE = 2 * Math.PI * 15; // ~94.25

/**
 * Returns a card-type color that reads cleanly against the active theme.
 * Card-type metamodel colors (e.g. `#003399` for BusinessCapability,
 * `#774fcc` for DataObject) are tuned for white-ish backgrounds — on the
 * dark theme paper they fall below 4.5:1 contrast and the borders / type
 * labels become unreadable. We lighten them to a fixed brightness in dark
 * mode while passing the original through untouched in light mode.
 */
export function readableTypeColor(hex: string, isDark: boolean): string {
  if (!isDark) return hex;
  try {
    return lighten(hex, 0.45);
  } catch {
    return hex;
  }
}

const LdvNode = memo(({ data }: NodeProps<Node<LdvNodeData>>) => {
  const rml = useResolveMetaLabel();
  const { t } = useTranslation("reports");
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  // Fall back to a neutral grey if the type colour isn't a #rrggbb hex, so the
  // tint maths below can't produce rgb(NaN,…).
  const color = /^#[0-9a-fA-F]{6}$/.test(data.typeColor) ? data.typeColor : "#9e9e9e";
  // Lightened version for borders and caption text — keeps darker
  // card-type colors (BusinessCapability navy, DataObject purple, etc.)
  // readable against the dark-theme paper.
  const accent = readableTypeColor(color, isDark);

  // Light tint for background
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * (isDark ? 0.92 : 0.88));
  const bg = isDark
    ? `rgba(${r},${g},${b},0.12)`
    : `rgb(${mix(r)},${mix(g)},${mix(b)})`;

  const name = data.name.length > 26 ? data.name.slice(0, 25) + "\u2026" : data.name;

  // Display extensions injected by the parent (see rfNodes memo)
  const lifecyclePhase = (data.lifecyclePhase as string | null | undefined) ?? null;
  const extraLines = (data.extraLines as DisplayLine[] | undefined) ?? [];
  const showType = data.showType !== false;
  const detailText = (data.detailText as string | undefined) ?? data.name;
  const dotColor = lifecyclePhase ? PHASE_DOT[lifecyclePhase] ?? "#9e9e9e" : null;

  const usedSet = useMemo(() => new Set(data.usedHandles ?? []), [data.usedHandles]);
  const hs = (id: string, extra?: React.CSSProperties) => {
    // Mirrored handles (ts-N, bt-N) share visibility with their base (t-N, b-N)
    const baseId = id.startsWith("ts-")
      ? "t-" + id.slice(3)
      : id.startsWith("bt-")
        ? "b-" + id.slice(3)
        : id;
    const isUsed = usedSet.has(id) || usedSet.has(baseId);
    return {
      background: isUsed ? color : "transparent",
      width: 5,
      height: 5,
      border: "none",
      opacity: isUsed ? 1 : 0,
      ...extra,
    } as const;
  };

  /* ---- Click + long-press via pointer events ---- */
  /* React Flow v12 swallows click events on custom nodes, but pointer
     events still fire reliably — the same layer long-press already uses. */
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pressing, setPressing] = useState(false);
  const downPos = useRef<{ x: number; y: number; shift: boolean } | null>(null);
  // Per-node long-press flag (was a module global, which let one card's
  // long-press suppress another card's click under multi-touch).
  const longPressFiredRef = useRef(false);

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

  const { onClick, onLongPress, nodeId } = data;
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      downPos.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
      if (!onLongPress || !nodeId) return;
      longPressFiredRef.current = false;
      showTimerRef.current = setTimeout(() => setPressing(true), 150);
      fireTimerRef.current = setTimeout(() => {
        longPressFiredRef.current = true;
        setPressing(false);
        onLongPress(nodeId);
      }, 1000);
    },
    [onLongPress, nodeId],
  );

  // Cancel the long-press (and the click) as soon as the pointer is dragged:
  // moving a card must not also trigger its long-press "centre on this card".
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = downPos.current;
      if (!d) return;
      if (Math.abs(e.clientX - d.x) > 5 || Math.abs(e.clientY - d.y) > 5) {
        clearTimer();
        downPos.current = null;
      }
    },
    [clearTimer],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      clearTimer();
      if (longPressFiredRef.current) {
        longPressFiredRef.current = false;
        downPos.current = null;
        return;
      }
      const d = downPos.current;
      downPos.current = null;
      if (!d) return;
      if (Math.abs(e.clientX - d.x) > 5 || Math.abs(e.clientY - d.y) > 5) return;
      // Stop propagation so React Flow doesn't also fire its own click handler
      e.stopPropagation();
      if (onClick && nodeId) onClick(nodeId, d.shift);
    },
    [onClick, nodeId, clearTimer],
  );

  return (
    <Box
      title={detailText}
      role="button"
      tabIndex={0}
      aria-label={detailText}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Keyboard equivalent of a tap: Enter/Space activates the card.
        if ((e.key === "Enter" || e.key === " ") && onClick && nodeId) {
          e.preventDefault();
          onClick(nodeId, e.shiftKey);
        }
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={clearTimer}
      onPointerLeave={clearTimer}
      sx={{
        width: LDV_NODE_W,
        height: LDV_NODE_H,
        borderRadius: "8px",
        border: data.proposed ? `2px dashed ${accent}` : `1.5px solid ${accent}`,
        bgcolor: data.proposed ? (isDark ? `rgba(${r},${g},${b},0.06)` : `rgba(${r},${g},${b},0.06)`) : bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        px: 1,
        // Cards are draggable: use the grab/grabbing cursor so it doesn't
        // flicker against React Flow's drag cursor (the previous "pointer" did).
        cursor: "grab",
        "&:active": { cursor: "grabbing" },
        position: "relative",
        transition: "box-shadow 0.15s, opacity 0.15s",
        touchAction: "none",
        "&:hover": { boxShadow: 4 },
      }}
    >
      {/* Card-type icon from the metamodel (top-left corner). Tagged
          `ldv-type-icon` so image export can drop it — it's a Material Symbols
          font ligature, which html-to-image can't rasterise (it would emit the
          raw icon name as text). */}
      {data.typeIcon && (
        <Box
          className="ldv-type-icon"
          sx={{
            position: "absolute",
            top: 5,
            left: 6,
            display: "flex",
            lineHeight: 0,
            opacity: 0.9,
            pointerEvents: "none",
          }}
        >
          <MaterialSymbol icon={data.typeIcon} size={16} color={accent} />
        </Box>
      )}
      {/* Lifecycle status dot (top-right corner) */}
      {dotColor && (
        <Box
          sx={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 9,
            height: 9,
            borderRadius: "50%",
            bgcolor: dotColor,
            border: "1.5px solid",
            borderColor: isDark ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.85)",
          }}
        />
      )}
      {/* Proposed "NEW" badge */}
      {data.proposed && (
        <Box sx={{
          position: "absolute", top: -8, left: 8,
          bgcolor: "#4caf50", color: "#fff",
          fontSize: 9, fontWeight: 700, lineHeight: 1,
          px: 0.7, py: 0.25, borderRadius: "4px",
          textTransform: "uppercase", letterSpacing: 0.5,
        }}>
          {t("dependency.proposedBadge")}
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
                animation: "ldv-lp-ring 850ms linear forwards",
                transformOrigin: "center",
                transform: "rotate(-90deg)",
              }}
            />
          </svg>
        </Box>
      )}
      <style>{`@keyframes ldv-lp-ring{to{stroke-dashoffset:0}}`}</style>
      {/* Top edge: target handles + source mirrors for flipped (upward) edges */}
      <Handle type="target" position={Position.Top} id="t-1" style={hs("t-1", { left: "12%" })} />
      <Handle type="target" position={Position.Top} id="t-2" style={hs("t-2", { left: "30%" })} />
      <Handle type="target" position={Position.Top} id="t-3" style={hs("t-3", { left: "50%" })} />
      <Handle type="target" position={Position.Top} id="t-4" style={hs("t-4", { left: "70%" })} />
      <Handle type="target" position={Position.Top} id="t-5" style={hs("t-5", { left: "88%" })} />
      <Handle type="source" position={Position.Top} id="ts-1" style={hs("ts-1", { left: "12%" })} />
      <Handle type="source" position={Position.Top} id="ts-2" style={hs("ts-2", { left: "30%" })} />
      <Handle type="source" position={Position.Top} id="ts-3" style={hs("ts-3", { left: "50%" })} />
      <Handle type="source" position={Position.Top} id="ts-4" style={hs("ts-4", { left: "70%" })} />
      <Handle type="source" position={Position.Top} id="ts-5" style={hs("ts-5", { left: "88%" })} />
      {/* Bottom edge: source handles + target mirrors for flipped (upward) edges */}
      <Handle type="source" position={Position.Bottom} id="b-1" style={hs("b-1", { left: "12%" })} />
      <Handle type="source" position={Position.Bottom} id="b-2" style={hs("b-2", { left: "30%" })} />
      <Handle type="source" position={Position.Bottom} id="b-3" style={hs("b-3", { left: "50%" })} />
      <Handle type="source" position={Position.Bottom} id="b-4" style={hs("b-4", { left: "70%" })} />
      <Handle type="source" position={Position.Bottom} id="b-5" style={hs("b-5", { left: "88%" })} />
      <Handle type="target" position={Position.Bottom} id="bt-1" style={hs("bt-1", { left: "12%" })} />
      <Handle type="target" position={Position.Bottom} id="bt-2" style={hs("bt-2", { left: "30%" })} />
      <Handle type="target" position={Position.Bottom} id="bt-3" style={hs("bt-3", { left: "50%" })} />
      <Handle type="target" position={Position.Bottom} id="bt-4" style={hs("bt-4", { left: "70%" })} />
      <Handle type="target" position={Position.Bottom} id="bt-5" style={hs("bt-5", { left: "88%" })} />
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
      {extraLines.length > 0 ? (
        extraLines.slice(0, MAX_CARD_LINES).map((line) => (
          <Typography
            key={line.label}
            variant="caption"
            sx={{
              lineHeight: 1.25,
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "text.secondary",
            }}
          >
            <Box component="span" sx={{ color: accent, fontWeight: 600 }}>
              {line.label}:
            </Box>{" "}
            {line.value}
          </Typography>
        ))
      ) : showType ? (
        <Typography
          variant="caption"
          sx={{
            color: accent,
            fontStyle: "italic",
            lineHeight: 1.2,
            mt: 0.25,
          }}
        >
          [{rml(data.typeKey, undefined, "label") || data.typeLabel}]
        </Typography>
      ) : null}
    </Box>
  );
});
LdvNode.displayName = "LdvNode";

/* ------------------------------------------------------------------ */
/*  Custom Layered Dependency View Group (layer boundary)              */
/* ------------------------------------------------------------------ */

const LdvGroup = memo(({ data }: NodeProps<Node<LdvGroupData>>) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const accent = readableTypeColor(data.color, isDark);

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        border: `1.5px dashed ${accent}`,
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
          color: accent,
          fontSize: "0.8rem",
        }}
      >
        {data.label}
      </Typography>
    </Box>
  );
});
LdvGroup.displayName = "LdvGroup";

/* ------------------------------------------------------------------ */
/*  Custom Layered Dependency View Edge (smoothstep + hover highlight) */
/* ------------------------------------------------------------------ */

const LdvEdgeComponent = memo(
  ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    markerEnd,
    markerStart,
  }: EdgeProps) => {
    const theme = useTheme();
    const edgeData = data as LdvEdgeData | undefined;
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

    // Node + group-label bounding boxes for label-overlap avoidance, computed
    // once in the parent and shared via context (see LdvObstaclesContext).
    const obstacleBounds = useContext(LdvObstaclesContext);

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
          markerStart={markerStart}
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
  },
);
LdvEdgeComponent.displayName = "LdvEdgeComponent";

/* ------------------------------------------------------------------ */
/*  Node types registry                                                */
/* ------------------------------------------------------------------ */

const nodeTypes = {
  ldvNode: LdvNode,
  ldvGroup: LdvGroup,
};

const edgeTypes = {
  ldvEdge: LdvEdgeComponent,
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
  /** Id of the centered/target card — always kept visible by the end-of-life filter. */
  centerId?: string;
}

/* ------------------------------------------------------------------ */
/*  Inner component (needs ReactFlowProvider ancestor)                 */
/* ------------------------------------------------------------------ */

function LayeredDependencyInner({
  nodes: rawNodes,
  edges: rawEdges,
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
  centerId,
}: Props) {
  const { t } = useTranslation(["reports", "common"]);
  const theme = useTheme();
  const rl = useResolveLabel();
  const { fitView, getNodes } = useReactFlow();

  /* ---- Card display settings (persisted, shared with the card-detail section) ---- */
  const [settings, updateSettings] = useLdvSettings();

  /* ---- Hide end-of-life related cards unless toggled on (centre always kept) ---- */
  const { nodes, edges } = useMemo(
    () =>
      settings.showEndOfLife
        ? { nodes: rawNodes, edges: rawEdges }
        : filterEndOfLifeNodes(rawNodes, rawEdges, centerId),
    [rawNodes, rawEdges, settings.showEndOfLife, centerId],
  );

  // When "show hierarchy" is on, synthesise containment edges (parent → child)
  // for any node whose parent is also present, so the parent slots into the
  // same layered layout as a normal edge (routed + labelled by the engine).
  const effectiveEdges = useMemo(() => {
    if (!settings.showHierarchy) return edges;
    const idSet = new Set(nodes.map((n) => n.id));
    const hierEdges: GEdge[] = [];
    for (const n of nodes) {
      if (n.parent_id && idSet.has(n.parent_id)) {
        hierEdges.push({
          source: n.parent_id,
          target: n.id,
          type: "hierarchy",
          label: t("dependency.hierarchyContains"),
          reverse_label: t("dependency.hierarchyPartOf"),
        });
      }
    }
    return hierEdges.length > 0 ? [...edges, ...hierEdges] : edges;
  }, [edges, nodes, settings.showHierarchy, t]);

  const { nodes: builtNodes, edges: rfEdges } = useMemo(
    () => buildLdvFlow(nodes, effectiveEdges, types),
    [nodes, effectiveEdges, types],
  );

  /* ---- Original card data (attributes/lifecycle) by id + field catalogue ---- */
  const gnodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const fieldCatalog = useMemo(() => {
    const present = new Set(nodes.map((n) => n.type));
    return buildFieldCatalog(types, present);
  }, [types, nodes]);
  const fieldMetaByKey = useMemo(
    () => new Map(fieldCatalog.map((f) => [f.key, f])),
    [fieldCatalog],
  );

  const formatVal = useCallback(
    (raw: unknown, meta?: FieldMeta): string => {
      if (raw === null || raw === undefined || raw === "") return "—";
      if (typeof raw === "boolean") return raw ? t("common:labels.yes") : t("common:labels.no");
      const optLabel = (x: unknown) => {
        const o = meta?.options?.find((opt) => opt.key === x);
        return o ? rl(o.label || o.key, o.translations) : String(x);
      };
      if (Array.isArray(raw)) return raw.map(optLabel).join(", ");
      if (meta?.options) return optLabel(raw);
      if (typeof raw === "object") return JSON.stringify(raw);
      return String(raw);
    },
    [rl, t],
  );

  /* ---- Node state ----
     React Flow owns the live node list (positions, drag state, measured sizes)
     via useNodesState/applyNodeChanges. Rebuilding the array by hand on every
     render — the previous approach — dropped React Flow's per-node measurements
     mid-drag, which made cards and their edges vanish until a reload. The
     builder is assigned below (once the display helpers exist); resetLayout and
     the re-seed effect call through this ref so they always use the latest one. */
  const [flowNodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const buildNodesRef = useRef<() => Node[]>(() => []);

  /* ---- Fullscreen ---- */
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const h = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else containerRef.current?.requestFullscreen?.();
  }, []);

  /* ---- Toolbar menus ---- */
  const [settingsAnchor, setSettingsAnchor] = useState<HTMLElement | null>(null);
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);

  /* ---- Background style cycle (lines → dots → none) ---- */
  const cycleBackground = useCallback(() => {
    const order: BackgroundStyle[] = ["dots", "lines", "none"];
    const idx = order.indexOf(settings.background);
    updateSettings({ background: order[(idx + 1) % order.length] });
  }, [settings.background, updateSettings]);

  /* ---- Reset manual layout ---- */
  const resetLayout = useCallback(() => {
    setNodes(buildNodesRef.current());
    window.setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 30);
  }, [setNodes, fitView]);

  /* ---- Re-fit after entering/leaving fullscreen ---- */
  useEffect(() => {
    const handle = window.setTimeout(() => fitView({ padding: 0.15, duration: 200 }), 150);
    return () => window.clearTimeout(handle);
  }, [isFullscreen, fitView]);

  /* ---- Export the diagram as a PNG / SVG image ---- */
  const exportImage = useCallback(
    async (format: "png" | "svg") => {
      setExportAnchor(null);
      const exportNodes = getNodes();
      if (exportNodes.length === 0) return;
      // Flatten child coordinates to absolute so bounds cover the whole graph.
      const byId = new Map(exportNodes.map((n) => [n.id, n]));
      const absNodes = exportNodes.map((n) => {
        if (n.parentId) {
          const p = byId.get(n.parentId);
          if (p) {
            return {
              ...n,
              parentId: undefined,
              position: { x: p.position.x + n.position.x, y: p.position.y + n.position.y },
            };
          }
        }
        return n;
      });
      const bounds = getNodesBounds(absNodes);
      const pad = 48;
      const imageWidth = Math.min(6000, Math.max(800, Math.round((bounds.width + pad * 2) * 2)));
      const imageHeight = Math.min(6000, Math.max(600, Math.round((bounds.height + pad * 2) * 2)));
      const vp = getViewportForBounds(bounds, imageWidth, imageHeight, 0.2, 4, 0.06);
      const viewportEl = containerRef.current?.querySelector(
        ".react-flow__viewport",
      ) as HTMLElement | null;
      if (!viewportEl) return;
      const opts = {
        backgroundColor: theme.palette.background.paper,
        width: imageWidth,
        height: imageHeight,
        // Drop the metamodel card-type icons: they're Material Symbols font
        // ligatures that html-to-image renders as their raw icon name (e.g.
        // "apps"). The card keeps its colour, label and lifecycle dot.
        filter: (node: HTMLElement) =>
          !(node.classList && node.classList.contains("ldv-type-icon")),
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
        },
      };
      const fname = `${(centerName || "dependency").replace(/[^\w.-]+/g, "_")}.${format}`;
      try {
        const dataUrl =
          format === "png" ? await toPng(viewportEl, opts) : await toSvg(viewportEl, opts);
        saveAs(dataUrl, fname);
      } catch {
        /* image export failed — ignore */
      }
    },
    [getNodes, theme.palette.background.paper, centerName],
  );

  // ReactFlow's `fitView` prop only fits on the initial render. When the parent
  // navigates to a new centre, the new graph is laid out at different coordinates
  // and the user sees an empty (off-screen) canvas until the page is refreshed.
  // Re-fit imperatively whenever the underlying data changes.
  const initialFitDone = useRef(false);
  useEffect(() => {
    // Skip the very first effect run — the static `fitView` prop handles the
    // initial mount with the right timing (after measure-and-layout).
    if (!initialFitDone.current) {
      initialFitDone.current = true;
      return;
    }
    // Defer one tick so React Flow has time to apply the new node positions
    // before computing the bounding box.
    const handle = window.setTimeout(
      () => fitView({ padding: 0.15, duration: 300 }),
      50,
    );
    return () => window.clearTimeout(handle);
  }, [builtNodes, rfEdges, fitView]);

  // Interaction mode: "normal" (default), "highlight" (sticky hover), "expand" (add relations)
  type InteractionMode = "normal" | "highlight" | "expand";
  const [mode, setMode] = useState<InteractionMode>("normal");
  // Ref so the node-level click callback always reads the latest mode
  const modeRef = useRef<InteractionMode>(mode);
  modeRef.current = mode;

  // Derived booleans for style props (read from state, not ref)
  const highlightMode = mode === "highlight";
  const expandMode = mode === "expand";

  // Click handler injected into each ldvNode via data.onClick —
  // uses modeRef so the callback always reads the latest mode.
  const handleLdvNodeClick = useCallback(
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

  // Long-press fires onNodeShiftClick directly from the LdvNode pointer-down
  // timer without going through handleLdvNodeClick. Wrap it here so we still
  // clear the hover state — otherwise the parent's `ldv-hover-active` dimming
  // sticks around and the re-centred graph looks empty (only the long-pressed
  // card stays at full opacity, all neighbours are dimmed to 0.35).
  const handleLongPress = useCallback(
    (nodeId: string) => {
      setHoveredNode(null);
      onNodeShiftClick?.(nodeId);
    },
    [onNodeShiftClick],
  );

  // Per-card display data derived from the current display settings. Computed
  // here so it can be both baked into freshly-built nodes and patched onto
  // already-positioned nodes (see the patch effect below) without disturbing
  // their drag positions.
  const cardDisplayData = useCallback(
    (n: Node) => {
      const g = gnodeById.get(n.id);
      const phase = settings.showLifecycle ? getCurrentPhase(g?.lifecycle) : null;

      // Resolve every chosen extra field to a label/value line (skips empties).
      const lines: DisplayLine[] = [];
      for (const fk of settings.extraFields) {
        const meta = fieldMetaByKey.get(fk);
        const value = formatVal(g?.attributes?.[fk], meta);
        if (value === "—") continue;
        lines.push({ label: meta ? rl(meta.label, meta.translations) : fk, value });
      }

      // Plain-text tooltip (native title) with the full detail set.
      const typeLabelText = (n.data as LdvNodeData).typeLabel || (n.data as LdvNodeData).typeKey;
      const detailParts = [g?.name ?? (n.data as LdvNodeData).name, `[${typeLabelText}]`];
      if (phase)
        detailParts.push(`${t("dependency.lifecycleLabel")}: ${t(`common:lifecycle.${phase}`)}`);
      for (const l of lines) detailParts.push(`${l.label}: ${l.value}`);

      return {
        showType: settings.showType,
        lifecyclePhase: phase,
        extraLines: lines,
        detailText: detailParts.join("\n"),
      };
    },
    [
      gnodeById,
      settings.showLifecycle,
      settings.showType,
      settings.extraFields,
      fieldMetaByKey,
      formatVal,
      rl,
      t,
    ],
  );

  // Build the full node list from the layout: structure + position, plus click /
  // long-press callbacks and display data. Layer (group) boxes are draggable so
  // a whole layer can be moved; cards stay clamped to their layer via extent.
  const buildDisplayNodes = useCallback(
    (): Node[] =>
      builtNodes.map((n) => {
        if (n.type !== "ldvNode") {
          if (n.type === "ldvGroup") return { ...n, draggable: true };
          return n;
        }
        return {
          ...n,
          draggable: true,
          data: {
            ...n.data,
            nodeId: n.id,
            onClick: handleLdvNodeClick,
            ...(onNodeShiftClick && { onLongPress: handleLongPress }),
            ...cardDisplayData(n),
          },
        };
      }),
    [builtNodes, handleLdvNodeClick, onNodeShiftClick, handleLongPress, cardDisplayData],
  );
  buildNodesRef.current = buildDisplayNodes;

  // Re-seed nodes whenever the layout changes (data / navigation / hierarchy /
  // expand). Manual drag positions reset here by design. Keyed on builtNodes
  // only — display-setting changes go through the patch effect so they don't
  // wipe the user's drags. The freshly-built nodes already carry current
  // display data, so suppress the patch effect for that same commit.
  const skipPatchRef = useRef(false);
  useEffect(() => {
    skipPatchRef.current = true;
    setNodes(buildNodesRef.current());
  }, [builtNodes, setNodes]);

  // Patch display data onto the live nodes when display settings change, keeping
  // each node's current (possibly dragged) position and React Flow measurement.
  useEffect(() => {
    if (skipPatchRef.current) {
      skipPatchRef.current = false;
      return;
    }
    setNodes((prev) =>
      prev.map((n) =>
        n.type === "ldvNode" ? { ...n, data: { ...n.data, ...cardDisplayData(n) } } : n,
      ),
    );
  }, [cardDisplayData, setNodes]);

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
  // Drop cached hover callbacks for edges that no longer exist (navigation /
  // expand / collapse) so the map can't grow unbounded over a long session.
  useEffect(() => {
    const live = new Set(rfEdges.map((e) => e.id));
    for (const id of edgeHoverCbs.current.keys()) {
      if (!live.has(id)) edgeHoverCbs.current.delete(id);
    }
  }, [rfEdges]);

  // Highlight all connections when hovering a card node
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleNodeMouseEnter = useCallback((_: React.MouseEvent, node: Node) => {
    if (modeRef.current !== "normal") return; // hover only in normal mode
    if (node.type === "ldvNode") {
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
      `.ldv-hover-active .react-flow__node-ldvNode { opacity: 0.35; transition: opacity 0.15s; }`,
      `${keep} { opacity: 1 !important; }`,
    ].join("\n");
  }, [hoveredNeighbors]);

  // Obstacle boxes for edge-label placement — computed once here and shared
  // with every edge via context (each edge no longer walks the node list).
  const obstacles = useMemo(() => computeObstacles(flowNodes), [flowNodes]);

  if (builtNodes.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 6, textAlign: "center", borderRadius: 2 }}>
        <Typography color="text.disabled">{t("dependency.ldvNoData")}</Typography>
      </Paper>
    );
  }

  return (
    <LdvObstaclesContext.Provider value={obstacles}>
    <Paper
      ref={containerRef}
      variant="outlined"
      sx={{
        borderRadius: 2,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        bgcolor: "background.paper",
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
        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 0.25 }}>
          <Typography
            variant="caption"
            sx={{
              color: "text.disabled",
              whiteSpace: "nowrap",
              fontSize: "0.68rem",
              mr: 0.5,
              display: { xs: "none", md: "block" },
            }}
          >
            {t("dependency.shiftClickHint")}
          </Typography>
          <Tooltip title={t("dependency.displaySettings")} arrow>
            <IconButton size="small" onClick={(e) => setSettingsAnchor(e.currentTarget)}>
              <MaterialSymbol icon="tune" size={19} />
            </IconButton>
          </Tooltip>
          <Tooltip
            title={t("dependency.backgroundStyle", {
              style: t(`dependency.background_${settings.background}`),
            })}
            arrow
          >
            <IconButton size="small" onClick={cycleBackground}>
              <MaterialSymbol
                icon={
                  settings.background === "none"
                    ? "grid_off"
                    : settings.background === "dots"
                      ? "grain"
                      : "grid_on"
                }
                size={19}
              />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("dependency.resetLayout")} arrow>
            <IconButton size="small" onClick={resetLayout}>
              <MaterialSymbol icon="restart_alt" size={19} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("dependency.exportImage")} arrow>
            <IconButton size="small" onClick={(e) => setExportAnchor(e.currentTarget)}>
              <MaterialSymbol icon="download" size={19} />
            </IconButton>
          </Tooltip>
          <Tooltip
            title={isFullscreen ? t("dependency.exitFullscreen") : t("dependency.fullscreen")}
            arrow
          >
            <IconButton size="small" onClick={toggleFullscreen}>
              <MaterialSymbol icon={isFullscreen ? "fullscreen_exit" : "fullscreen"} size={20} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0 }} className={hoveredNode ? "ldv-hover-active" : undefined}>
        {hoverStyle && <style>{hoverStyle}</style>}
        <ReactFlow
          nodes={flowNodes}
          edges={orderedEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
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
          nodesDraggable
          nodesConnectable={false}
          edgesReconnectable={false}
          elementsSelectable={false}
          colorMode={theme.palette.mode}
        >
          {settings.background !== "none" && (
            // Dots replicate the original pre-toolbar background exactly
            // (`gap={16} size={1}`, React Flow's default theme-aware dot colour).
            // Lines are the new alternative and use a faint custom colour.
            <Background
              variant={
                settings.background === "dots" ? BackgroundVariant.Dots : BackgroundVariant.Lines
              }
              gap={settings.background === "dots" ? 16 : 28}
              size={1}
              color={
                settings.background === "dots"
                  ? undefined
                  : theme.palette.mode === "dark"
                    ? "#2a2a2a"
                    : "#e9ebee"
              }
            />
          )}
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

      {/* Export menu */}
      <Menu
        anchorEl={exportAnchor}
        open={Boolean(exportAnchor)}
        onClose={() => setExportAnchor(null)}
        container={isFullscreen ? containerRef.current : undefined}
      >
        <MenuItem onClick={() => exportImage("png")}>
          <ListItemIcon>
            <MaterialSymbol icon="image" size={18} />
          </ListItemIcon>
          <ListItemText>{t("dependency.exportPng")}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => exportImage("svg")}>
          <ListItemIcon>
            <MaterialSymbol icon="shape_line" size={18} />
          </ListItemIcon>
          <ListItemText>{t("dependency.exportSvg")}</ListItemText>
        </MenuItem>
      </Menu>

      {/* Card display settings */}
      <Popover
        anchorEl={settingsAnchor}
        open={Boolean(settingsAnchor)}
        onClose={() => setSettingsAnchor(null)}
        container={isFullscreen ? containerRef.current : undefined}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { p: 2, width: 320, maxWidth: "90vw" } } }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
          {t("dependency.displaySettings")}
        </Typography>
        {(
          [
            { key: "showType", label: t("dependency.showType") },
            { key: "showLifecycle", label: t("dependency.showLifecycle") },
            {
              key: "showHierarchy",
              label: t("dependency.showHierarchy"),
              hint: t("dependency.showHierarchyHint"),
            },
            {
              key: "showEndOfLife",
              label: t("dependency.showEndOfLife"),
              hint: t("dependency.showEndOfLifeHint"),
            },
          ] as const
        ).map((row) => (
          <Box
            key={row.key}
            sx={{
              display: "flex",
              alignItems: "hint" in row && row.hint ? "flex-start" : "center",
              justifyContent: "space-between",
              gap: 2,
              py: 0.5,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2">{row.label}</Typography>
              {"hint" in row && row.hint && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", lineHeight: 1.35, mt: 0.25 }}
                >
                  {row.hint}
                </Typography>
              )}
            </Box>
            <Switch
              size="small"
              checked={settings[row.key]}
              onChange={(e) => updateSettings({ [row.key]: e.target.checked })}
              inputProps={{ "aria-label": row.label }}
              sx={{ flexShrink: 0, mt: "hint" in row && row.hint ? "2px" : 0 }}
            />
          </Box>
        ))}
        <Divider sx={{ my: 1.5 }} />
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          {t("dependency.extraFieldsHint", { count: MAX_CARD_LINES })}
        </Typography>
        <Autocomplete
          multiple
          size="small"
          options={fieldCatalog}
          value={fieldCatalog.filter((f) => settings.extraFields.includes(f.key))}
          getOptionLabel={(f) => rl(f.label, f.translations)}
          isOptionEqualToValue={(a, b) => a.key === b.key}
          onChange={(_, vals) => updateSettings({ extraFields: vals.map((v) => v.key) })}
          renderInput={(params) => (
            <TextField {...params} placeholder={t("dependency.extraFields")} />
          )}
          renderTags={(vals, getTagProps) =>
            vals.map((v, i) => (
              <Chip {...getTagProps({ index: i })} key={v.key} label={rl(v.label, v.translations)} size="small" />
            ))
          }
          noOptionsText={t("dependency.noFields")}
        />
      </Popover>
    </Paper>
    </LdvObstaclesContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Exported wrapper with ReactFlowProvider                            */
/* ------------------------------------------------------------------ */

export default function LayeredDependencyView(props: Props) {
  return (
    <ReactFlowProvider>
      <LayeredDependencyInner {...props} />
    </ReactFlowProvider>
  );
}
