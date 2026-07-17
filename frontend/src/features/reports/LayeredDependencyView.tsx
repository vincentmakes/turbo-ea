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
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { useTheme } from "@mui/material/styles";
import { toBlob, toSvg } from "html-to-image";
import { saveAs } from "file-saver";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { readableTypeColor } from "@/lib/color";
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
import { useTypeLabel, useFieldLabel } from "@/hooks/useResolveLabel";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useLdvSettings, type LdvBackgroundStyle } from "./ldvDisplaySettings";
import type { CardType } from "@/types";
import {
  buildLdvDiagramXml,
  type DiagramCardInput,
  type DiagramRelInput,
  type DiagramLayerInput,
} from "@/features/diagrams/drawio-shapes";
import {
  buildLdvFlow,
  relationValueSuffix,
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

/** Neutral stroke colour for relation edges on a generated DrawIO diagram,
 *  matching the LDV's muted edge styling. */
const LDV_EDGE_COLOR = "#8a93a3";

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

// Shared with every other card-type color consumer — see lib/color.ts for the
// luminance-gating rationale. Re-exported for existing importers.
export { readableTypeColor };

const LdvNode = memo(({ data }: NodeProps<Node<LdvNodeData>>) => {
  const typeLabel = useTypeLabel();
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
  // Minimalistic hierarchy affordances: a hidden parent (above) / hidden
  // children (below) the card can surface via the Reveal toolbar tools.
  const hiddenParent = data.hiddenParent === true;
  const hiddenChildren = data.hiddenChildren === true;

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
      {/* Hierarchy markers: a chevron hint when the card has a parent (above)
          or children (below) that aren't on the diagram yet. Decorative only.
          Drawn as inline SVG (not a Material Symbols font glyph) so they
          rasterise identically in the live view and in PNG/SVG image export —
          `skipFonts: true` during export means a font ligature would otherwise
          leak through as its raw icon name ("expand_less"/"expand_more"). */}
      {hiddenParent && (
        <Box
          className="ldv-hierarchy-marker"
          title={t("dependency.hasHiddenParent")}
          sx={{
            position: "absolute",
            top: -1,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            lineHeight: 0,
            opacity: 0.5,
            pointerEvents: "none",
          }}
        >
          <LdvChevron dir="up" color={accent} />
        </Box>
      )}
      {hiddenChildren && (
        <Box
          className="ldv-hierarchy-marker"
          title={t("dependency.hasHiddenChildren")}
          sx={{
            position: "absolute",
            bottom: -1,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            lineHeight: 0,
            opacity: 0.5,
            pointerEvents: "none",
          }}
        >
          <LdvChevron dir="down" color={accent} />
        </Box>
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
          [{typeLabel({ key: data.typeKey, label: data.typeLabel }) || data.typeLabel}]
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

/**
 * Relation flow-direction indicator drawn as a vector SVG arrow (→ / ↔ / ←).
 * Rendered as SVG shapes — not a Unicode glyph — so it rasterises identically
 * in the live view and in PNG/SVG image export. (The previous ↔/→/← text
 * glyphs relied on a system-font fallback that html-to-image cannot embed, so
 * they came out blank/tofu in exports.)
 */
const LdvDirectionArrow = memo(
  ({ dir }: { dir: "forward" | "reverse" | "bidirectional" }) => (
    <svg
      width={14}
      height={8}
      viewBox="0 0 14 8"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      aria-hidden
    >
      <line x1={1} y1={4} x2={13} y2={4} />
      {dir !== "reverse" && <polyline points="9.5,1 13,4 9.5,7" />}
      {dir !== "forward" && <polyline points="4.5,1 1,4 4.5,7" />}
    </svg>
  ),
);
LdvDirectionArrow.displayName = "LdvDirectionArrow";

/**
 * Hierarchy hint chevron (▲ hidden parent / ▼ hidden children) drawn as a
 * vector SVG rather than a Material Symbols font glyph, so it rasterises
 * identically in the live view and in PNG/SVG image export (export runs with
 * `skipFonts: true`, so a font ligature would leak through as its raw icon
 * name). Same rationale as `LdvDirectionArrow`.
 */
const LdvChevron = memo(({ dir, color }: { dir: "up" | "down"; color: string }) => (
  <svg
    width={14}
    height={8}
    viewBox="0 0 14 8"
    fill="none"
    stroke={color}
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0 }}
    aria-hidden
  >
    <polyline points={dir === "up" ? "1,6 7,2 13,6" : "1,2 7,6 13,2"} />
  </svg>
));
LdvChevron.displayName = "LdvChevron";

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

    const flowDir = edgeData?.flowDirection;
    const maxChars = 24;
    const displayLabel = label.length > maxChars
      ? label.slice(0, maxChars - 1) + "\u2026"
      : label;
    const labelW = displayLabel.length * 6.5 + 16 + (flowDir ? 17 : 0);
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
                display: "flex",
                alignItems: "center",
                gap: 3,
              }}
            >
              {flowDir && <LdvDirectionArrow dir={flowDir} />}
              <span>{displayLabel}</span>
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
  /** Reveal a clicked card's hierarchical parent or direct children (targeted
   *  siblings of expand). The consumer holds the full graph and decides which
   *  nodes to surface. Revealed cards persist until the view is re-centred (so
   *  parents and children can be layered in the same view). */
  onNodeReveal?: (id: string, kind: "parents" | "children") => void;
  /** Full reset of the view: clears expand + reveal exploration and returns to
   *  the base centre. Fired by the toolbar Reset button (in addition to the
   *  view's own layout-position reset). */
  onReset?: () => void;
  onHome: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  centerName?: string;
  /** Id of the centered/target card — always kept visible by the end-of-life filter. */
  centerId?: string;
  /** When true, show the "Create diagram" toolbar action (gated on `diagrams.manage`
   *  by the parent). Only enable in consumers whose nodes are real inventory cards. */
  canCreateDiagram?: boolean;
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
  onNodeReveal,
  onReset,
  onHome,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  centerName,
  centerId,
  canCreateDiagram,
}: Props) {
  const { t } = useTranslation(["reports", "common"]);
  const theme = useTheme();
  const fieldLabel = useFieldLabel();
  const navigate = useNavigate();
  const { fitView, getNodes, zoomIn, zoomOut } = useReactFlow();

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

  /* ---- Resolve a relation's single-select attribute value(s) into a
         bracketed label suffix (e.g. " [Leading]"), using the metamodel's
         relation-type attribute schemas. flowDirection is excluded — it is
         shown as a direction arrow, not a bracket. ---- */
  const { relationTypes } = useMetamodel();
  const relTypeByKey = useMemo(
    () => new Map(relationTypes.map((rt) => [rt.key, rt])),
    [relationTypes],
  );
  const relValueResolver = useCallback(
    (edge: GEdge): string | undefined =>
      relationValueSuffix(edge, relTypeByKey, (opt) => fieldLabel(opt)),
    [relTypeByKey, fieldLabel],
  );

  const { nodes: builtNodes, edges: rfEdges } = useMemo(
    () =>
      buildLdvFlow(
        nodes,
        edges,
        types,
        settings.showRelationValues ? relValueResolver : undefined,
      ),
    [nodes, edges, types, settings.showRelationValues, relValueResolver],
  );

  /* ---- Original card data (attributes/lifecycle) by id + field catalogue ---- */
  const gnodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Minimalistic hierarchy markers: per card, whether it has a parent / children
  // that are NOT currently on the diagram (so the marker points to something the
  // Reveal tools can surface, and disappears once revealed). Empty when the
  // display toggle is off.
  const hierarchyMarkers = useMemo(() => {
    const m = new Map<string, { hiddenParent: boolean; hiddenChildren: boolean }>();
    // Markers are affordances for the Reveal tools — only surface them where the
    // consumer wires those tools up (the static TurboLens views don't).
    if (!settings.showHierarchyMarkers || !onNodeReveal) return m;
    const visibleIds = new Set(nodes.map((n) => n.id));
    const parentsWithVisibleChild = new Set<string>();
    for (const n of nodes) if (n.parent_id) parentsWithVisibleChild.add(n.parent_id);
    for (const n of nodes) {
      const hiddenParent = !!n.parent_id && !visibleIds.has(n.parent_id);
      const hiddenChildren = !!n.hasChildren && !parentsWithVisibleChild.has(n.id);
      if (hiddenParent || hiddenChildren) m.set(n.id, { hiddenParent, hiddenChildren });
    }
    return m;
  }, [nodes, settings.showHierarchyMarkers, onNodeReveal]);

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
        return o ? fieldLabel(o) : String(x);
      };
      if (Array.isArray(raw)) return raw.map(optLabel).join(", ");
      if (meta?.options) return optLabel(raw);
      if (typeof raw === "object") return JSON.stringify(raw);
      return String(raw);
    },
    [fieldLabel, t],
  );

  /* ---- Node state ----
     React Flow owns the live node list (positions, drag state, measured sizes)
     via useNodesState/applyNodeChanges. Rebuilding the array by hand on every
     render — the previous approach — dropped React Flow's per-node measurements
     mid-drag, which made cards and their edges vanish until a reload. The
     builder is assigned below (once the display helpers exist); resetView and
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

  /* ---- Full view reset: clears exploration (expand + reveals) via the
     consumer, undoes manual drags, and re-fits. ---- */
  const resetView = useCallback(() => {
    onReset?.();
    setNodes(buildNodesRef.current());
    window.setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 30);
  }, [onReset, setNodes, fitView]);

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

      // Keep the rasterised SVG image *and* the canvas within WebKit's hard
      // limits. html-to-image renders the diagram into an <img> sized
      // imageWidth×imageHeight, then draws it onto a canvas sized
      // (imageWidth×pixelRatio)×(imageHeight×pixelRatio). iOS/iPadOS WebKit caps
      // canvas/image area at ~16.7M px and rejects oversized SVG images with a
      // "Load failed" error (desktop Chrome/FF allow far more). So we pick
      // device-aware caps and fit the FINAL canvas inside both a per-dimension
      // and a total-area budget. Desktop output is unchanged for normal diagrams.
      const isAppleMobile =
        /iP(hone|ad|od)/.test(navigator.userAgent) ||
        (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
      const maxDim = isAppleMobile ? 4096 : 6000;
      const maxArea = isAppleMobile ? 16_000_000 : 64_000_000;
      const pixelRatio = isAppleMobile ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      // Supersample the logical bounds (×2) for crispness, as before.
      const rawW = Math.max(800, Math.round((bounds.width + pad * 2) * 2));
      const rawH = Math.max(600, Math.round((bounds.height + pad * 2) * 2));
      // Scale so the final canvas (raw × pixelRatio) fits maxDim per side and maxArea total.
      const finalW = rawW * pixelRatio;
      const finalH = rawH * pixelRatio;
      let fit = Math.min(1, maxDim / finalW, maxDim / finalH);
      if (finalW * fit * (finalH * fit) > maxArea) {
        fit *= Math.sqrt(maxArea / (finalW * fit * (finalH * fit)));
      }
      const imageWidth = Math.max(1, Math.round(rawW * fit));
      const imageHeight = Math.max(1, Math.round(rawH * fit));
      const vp = getViewportForBounds(bounds, imageWidth, imageHeight, 0.2, 4, 0.06);
      const viewportEl = containerRef.current?.querySelector(
        ".react-flow__viewport",
      ) as HTMLElement | null;
      if (!viewportEl) return;
      const opts = {
        backgroundColor: theme.palette.background.paper,
        width: imageWidth,
        height: imageHeight,
        // Don't inline remote web fonts: the page loads Inter + Material Symbols
        // from fonts.googleapis.com, and html-to-image's font-embedding step
        // tries to fetch them — blocked by the CSP `connect-src 'self'` (noisy
        // console errors on desktop, and a harder failure on iOS Safari). We
        // don't need them: icons are dropped below, direction is vector SVG, and
        // label text rasterises with the browser's locally-resolved fonts.
        skipFonts: true,
        cacheBust: true,
        pixelRatio,
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
        // Download via a Blob (not a data URL): file-saver honours the filename
        // for Blobs through URL.createObjectURL, so the .png/.svg extension is
        // always correct. A data URL whose rasterisation fails comes back as the
        // type-less "data:," string, which the browser saves as text/plain → a
        // bogus .txt download; a Blob path makes that impossible.
        let blob: Blob | null;
        if (format === "png") {
          blob = await toBlob(viewportEl, opts);
        } else {
          // Decode the SVG data URL directly instead of fetch()-ing it: toSvg
          // builds `data:image/svg+xml;charset=utf-8,<encodeURIComponent(svg)>`,
          // and fetch() on a data URL is itself a known iOS "Load failed" source.
          const dataUrl = await toSvg(viewportEl, opts);
          const svgText = decodeURIComponent(dataUrl.slice(dataUrl.indexOf(",") + 1));
          blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
        }
        if (!blob || blob.size === 0) return; // rasterisation produced nothing — don't save a bad file
        saveAs(blob, fname);
      } catch {
        /* image export failed — ignore */
      }
    },
    [getNodes, theme.palette.background.paper, centerName],
  );

  /* ---- Create an editable DrawIO diagram from the current graph ----
     Turns the on-screen LDV into a real diagram in the Diagram module. Card
     shapes carry cardId/cardType so they stay connected to the inventory;
     relation edges are display-only (never marked pending → no duplicate
     relations created). Layer swim-lanes render as background boxes. */
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);

  // Real relation-type key per displayed card pair (one type per ordered pair
  // in the metamodel). Synthetic hierarchy edges are excluded — they render as
  // plain labelled lines, not relations.
  const relTypeByPair = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of edges) {
      if (!e.type || e.type === "hierarchy") continue;
      const k = [e.source, e.target].sort().join("|");
      if (!m.has(k)) m.set(k, e.type);
    }
    return m;
  }, [edges]);

  const openCreateDialog = useCallback(() => {
    setCreateError(false);
    setCreateName(
      t("dependency.createDiagramDefaultName", { name: centerName || t("dependency.title") }),
    );
    setCreateOpen(true);
  }, [centerName, t]);

  const submitCreateDiagram = useCallback(async () => {
    const name = createName.trim();
    if (!name || creating) return;
    setCreating(true);
    setCreateError(false);
    try {
      // Flatten child (card) coordinates to absolute — child nodes are
      // positioned relative to their layer group (mirrors exportImage).
      const live = getNodes();
      const byId = new Map(live.map((n) => [n.id, n]));
      const absOf = (n: Node) => {
        const p = n.parentId ? byId.get(n.parentId) : undefined;
        return p
          ? { x: p.position.x + n.position.x, y: p.position.y + n.position.y }
          : { x: n.position.x, y: n.position.y };
      };

      const cards: DiagramCardInput[] = [];
      const layers: DiagramLayerInput[] = [];
      const included = new Set<string>();
      for (const n of live) {
        if (n.type === "ldvNode") {
          const d = n.data as LdvNodeData;
          if (d.proposed) continue; // proposed cards have no inventory id
          const p = absOf(n);
          cards.push({
            cardId: n.id,
            cardType: d.typeKey,
            name: d.name,
            color: d.typeColor,
            icon: d.typeIcon,
            x: p.x,
            y: p.y,
            w: (n.style?.width as number) ?? LDV_NODE_W,
            h: (n.style?.height as number) ?? LDV_NODE_H,
          });
          included.add(n.id);
        } else if (n.type === "ldvGroup") {
          const d = n.data as LdvGroupData;
          layers.push({
            label: d.label,
            color: d.color,
            x: n.position.x,
            y: n.position.y,
            w: (n.style?.width as number) ?? 0,
            h: (n.style?.height as number) ?? 0,
          });
        }
      }

      const rels: DiagramRelInput[] = [];
      for (const e of rfEdges) {
        if (!included.has(e.source) || !included.has(e.target)) continue;
        const d = e.data as LdvEdgeData | undefined;
        rels.push({
          sourceCardId: e.source,
          targetCardId: e.target,
          relationType: relTypeByPair.get([e.source, e.target].sort().join("|")) ?? "",
          label: d?.relLabel ?? "",
          color: LDV_EDGE_COLOR,
        });
      }

      if (cards.length === 0) {
        setCreateError(true);
        setCreating(false);
        return;
      }

      const xml = buildLdvDiagramXml(cards, rels, layers);
      const created = await api.post<{ id: string }>("/diagrams", {
        name,
        data: { xml },
      });
      setCreateOpen(false);
      navigate(`/diagrams/${created.id}/edit`);
    } catch {
      setCreateError(true);
    } finally {
      setCreating(false);
    }
  }, [createName, creating, getNodes, rfEdges, relTypeByPair, navigate]);

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

  // Interaction mode: "normal" (default), "highlight" (sticky hover),
  // "expand" (add all neighbours), "parents"/"children" (add hierarchy parent/children)
  type InteractionMode = "normal" | "highlight" | "expand" | "parents" | "children";
  const [mode, setMode] = useState<InteractionMode>("normal");
  // Ref so the node-level click callback always reads the latest mode
  const modeRef = useRef<InteractionMode>(mode);
  modeRef.current = mode;

  // Derived booleans for style props (read from state, not ref)
  const highlightMode = mode === "highlight";
  const expandMode = mode === "expand";
  const parentsMode = mode === "parents";
  const childrenMode = mode === "children";

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
      } else if (currentMode === "parents" && onNodeReveal) {
        onNodeReveal(nodeId, "parents");
      } else if (currentMode === "children" && onNodeReveal) {
        onNodeReveal(nodeId, "children");
      } else if (shiftKey && onNodeShiftClick) {
        setHoveredNode(null);
        onNodeShiftClick(nodeId);
      } else {
        setHoveredNode(null);
        onNodeClick(nodeId);
      }
    },
    [onNodeClick, onNodeShiftClick, onNodeExpand, onNodeReveal],
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
        lines.push({ label: meta ? fieldLabel(meta) : fk, value });
      }

      // Plain-text tooltip (native title) with the full detail set.
      const typeLabelText = (n.data as LdvNodeData).typeLabel || (n.data as LdvNodeData).typeKey;
      const detailParts = [g?.name ?? (n.data as LdvNodeData).name, `[${typeLabelText}]`];
      if (phase)
        detailParts.push(`${t("dependency.lifecycleLabel")}: ${t(`common:lifecycle.${phase}`)}`);
      for (const l of lines) detailParts.push(`${l.label}: ${l.value}`);

      const marker = hierarchyMarkers.get(n.id);

      return {
        showType: settings.showType,
        lifecyclePhase: phase,
        extraLines: lines,
        detailText: detailParts.join("\n"),
        hiddenParent: marker?.hiddenParent ?? false,
        hiddenChildren: marker?.hiddenChildren ?? false,
      };
    },
    [
      gnodeById,
      hierarchyMarkers,
      settings.showLifecycle,
      settings.showType,
      settings.extraFields,
      fieldMetaByKey,
      formatVal,
      fieldLabel,
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
          <Tooltip title={t("dependency.exportImage")} arrow>
            <IconButton size="small" onClick={(e) => setExportAnchor(e.currentTarget)}>
              <MaterialSymbol icon="download" size={19} />
            </IconButton>
          </Tooltip>
          {canCreateDiagram && (
            <Tooltip title={t("dependency.createDiagram")} arrow>
              <IconButton size="small" onClick={openCreateDialog}>
                <MaterialSymbol icon="note_add" size={19} />
              </IconButton>
            </Tooltip>
          )}
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
          {/* Default zoom + fitView controls are disabled so we can order the
              whole navigation group ourselves (fullscreen first) and swap the
              fitView frame icon — which looked too much like Fullscreen — for a
              map-pin re-center button. */}
          <Controls showInteractive={false} showZoom={false} showFitView={false}>
            {/* --- Navigation / view group: fullscreen, zoom, recenter, reset --- */}
            <ControlButton
              title={isFullscreen ? t("dependency.exitFullscreen") : t("dependency.fullscreen")}
              onClick={toggleFullscreen}
            >
              <MaterialSymbol icon={isFullscreen ? "fullscreen_exit" : "fullscreen"} size={18} />
            </ControlButton>
            <ControlButton title={t("dependency.zoomIn")} onClick={() => zoomIn({ duration: 200 })}>
              <MaterialSymbol icon="add" size={18} />
            </ControlButton>
            <ControlButton
              title={t("dependency.zoomOut")}
              onClick={() => zoomOut({ duration: 200 })}
            >
              <MaterialSymbol icon="remove" size={18} />
            </ControlButton>
            <ControlButton
              title={t("dependency.recenter")}
              onClick={() => fitView({ padding: 0.15, duration: 300 })}
            >
              <MaterialSymbol icon="location_on" size={18} />
            </ControlButton>
            <ControlButton title={t("dependency.resetView")} onClick={resetView}>
              <MaterialSymbol icon="restart_alt" size={18} />
            </ControlButton>
            {/* Divider between the view and exploration groups. A full-width
                filled band (no horizontal margin, so the canvas never shows
                through) with thin top/bottom rules — reads as a clean section
                break rather than a transparent gap. */}
            <div
              aria-hidden
              style={{
                height: 6,
                background: theme.palette.mode === "dark" ? "#2b2b2b" : "#eceef0",
                borderTop: `1px solid ${theme.palette.mode === "dark" ? "#444" : "#d7dade"}`,
                borderBottom: `1px solid ${theme.palette.mode === "dark" ? "#444" : "#d7dade"}`,
              }}
            />
            {/* --- Exploration group: highlight, expand, reveal parent/children --- */}
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
            {onNodeReveal && (
              <>
                <ControlButton
                  title={t("dependency.revealParentsMode")}
                  onClick={() => {
                    // Toggling off only stops click-to-reveal — revealed cards
                    // stay so parents + children can be layered in one view.
                    // They clear on re-center (see consumer center-change reset).
                    setMode((m) => (m === "parents" ? "normal" : "parents"));
                  }}
                  style={{
                    background: parentsMode ? theme.palette.primary.main : undefined,
                    color: parentsMode ? theme.palette.primary.contrastText : undefined,
                  }}
                >
                  <MaterialSymbol icon="move_up" size={18} />
                </ControlButton>
                <ControlButton
                  title={t("dependency.revealChildrenMode")}
                  onClick={() => {
                    setMode((m) => (m === "children" ? "normal" : "children"));
                  }}
                  style={{
                    background: childrenMode ? theme.palette.primary.main : undefined,
                    color: childrenMode ? theme.palette.primary.contrastText : undefined,
                  }}
                >
                  <MaterialSymbol icon="move_down" size={18} />
                </ControlButton>
              </>
            )}
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

      {/* Create-diagram name dialog */}
      <Dialog
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        maxWidth="xs"
        fullWidth
        disableRestoreFocus
        container={isFullscreen ? containerRef.current : undefined}
      >
        <DialogTitle>{t("dependency.createDiagramTitle")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("dependency.createDiagramHint")}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label={t("dependency.createDiagramNameLabel")}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreateDiagram();
            }}
            error={createError}
            helperText={createError ? t("dependency.createDiagramError") : undefined}
            disabled={creating}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={creating}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="contained"
            onClick={submitCreateDiagram}
            disabled={creating || !createName.trim()}
            startIcon={creating ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {t("dependency.createDiagramSubmit")}
          </Button>
        </DialogActions>
      </Dialog>

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
              key: "showHierarchyMarkers",
              label: t("dependency.showHierarchyMarkers"),
              hint: t("dependency.showHierarchyMarkersHint"),
            },
            {
              key: "showEndOfLife",
              label: t("dependency.showEndOfLife"),
              hint: t("dependency.showEndOfLifeHint"),
            },
            {
              key: "showRelationValues",
              label: t("dependency.showRelationValues"),
              hint: t("dependency.showRelationValuesHint"),
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
          getOptionLabel={(f) => fieldLabel(f)}
          isOptionEqualToValue={(a, b) => a.key === b.key}
          onChange={(_, vals) => updateSettings({ extraFields: vals.map((v) => v.key) })}
          renderInput={(params) => (
            <TextField {...params} placeholder={t("dependency.extraFields")} />
          )}
          renderTags={(vals, getTagProps) =>
            vals.map((v, i) => (
              <Chip {...getTagProps({ index: i })} key={v.key} label={fieldLabel(v)} size="small" />
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
