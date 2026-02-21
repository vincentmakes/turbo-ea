import { useState, useMemo, memo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type {
  CardType as FSType,
  RelationType as RType,
} from "@/types";
import { truncate } from "./helpers";
import {
  CATEGORIES,
  LAYER_ORDER,
  NODE_W,
  NODE_H,
  NODE_RX,
  NODE_GAP_X,
  LAYER_GAP_Y,
  PAD_X,
  PAD_Y,
  LAYER_LABEL_W,
  TRACK_GAP,
  TRACK_MARGIN,
  SAME_LAYER_ARC_BASE,
  SAME_LAYER_ARC_STEP,
  CORNER_R,
  LABEL_W,
  LABEL_H,
} from "./constants";

/* ------------------------------------------------------------------ */
/*  Edge routing types                                                 */
/* ------------------------------------------------------------------ */

interface ClassifiedEdge {
  rel: RType;
  srcLayerIdx: number;
  tgtLayerIdx: number;
  direction: "down" | "up" | "same";
  /** Gap indices the edge must route through (ordered src->tgt) */
  gapsUsed: number[];
  /** One track Y per gap, filled during assignment */
  trackY: number[];
}

interface GapInfo {
  topY: number;
  bottomY: number;
}

interface Corridor {
  centerX: number;
  width: number;
}

/* ------------------------------------------------------------------ */
/*  Edge routing helpers                                               */
/* ------------------------------------------------------------------ */

/**
 * Convert a polyline of waypoints into an SVG path with rounded corners.
 * Adjacent co-linear segments are collapsed automatically.
 */
function segmentsToPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  const parts: string[] = [`M${pts[0].x},${pts[0].y}`];

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = i < pts.length - 1 ? pts[i + 1] : null;

    if (
      !next ||
      (prev.x === curr.x && curr.x === next.x) ||
      (prev.y === curr.y && curr.y === next.y)
    ) {
      parts.push(`L${curr.x},${curr.y}`);
    } else {
      // Corner — apply rounding
      const legA = Math.max(Math.abs(curr.x - prev.x), Math.abs(curr.y - prev.y));
      const legB = Math.max(Math.abs(next.x - curr.x), Math.abs(next.y - curr.y));
      const r = Math.min(CORNER_R, legA / 2, legB / 2);
      if (r < 1) {
        parts.push(`L${curr.x},${curr.y}`);
        continue;
      }
      const dx1 = Math.sign(curr.x - prev.x);
      const dy1 = Math.sign(curr.y - prev.y);
      const dx2 = Math.sign(next.x - curr.x);
      const dy2 = Math.sign(next.y - curr.y);
      const ax = curr.x - (dx1 !== 0 ? dx1 * r : 0);
      const ay = curr.y - (dy1 !== 0 ? dy1 * r : 0);
      const bx = curr.x + (dx2 !== 0 ? dx2 * r : 0);
      const by = curr.y + (dy2 !== 0 ? dy2 * r : 0);
      parts.push(`L${ax},${ay}`);
      parts.push(`Q${curr.x},${curr.y} ${bx},${by}`);
    }
  }
  return parts.join(" ");
}

/* ------------------------------------------------------------------ */
/*  Metamodel Graph  (SVG)                                             */
/* ------------------------------------------------------------------ */

export interface GraphProps {
  types: FSType[];
  relationTypes: RType[];
  onNodeClick: (key: string) => void;
}

const MetamodelGraph = memo(function MetamodelGraph({ types, relationTypes, onNodeClick }: GraphProps) {
  const visibleTypes = useMemo(() => types.filter((t) => !t.is_hidden), [types]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  /* ================================================================ */
  /*  Build layers                                                     */
  /* ================================================================ */
  const layers = useMemo(() => {
    const byCategory: Record<string, FSType[]> = {};
    for (const t of visibleTypes) {
      const cat = CATEGORIES.includes(t.category || "")
        ? t.category!
        : "Other";
      (byCategory[cat] ??= []).push(t);
    }
    return LAYER_ORDER.map((cat) => ({
      category: cat,
      nodes: byCategory[cat] || [],
    })).filter((l) => l.nodes.length > 0);
  }, [visibleTypes]);

  /* ================================================================ */
  /*  Compute node positions                                           */
  /* ================================================================ */
  const layout = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    const maxNodes = Math.max(...layers.map((l) => l.nodes.length), 1);
    const contentW = maxNodes * NODE_W + (maxNodes - 1) * NODE_GAP_X;
    const svgW = contentW + PAD_X * 2 + LAYER_LABEL_W;

    layers.forEach((layer, li) => {
      const n = layer.nodes.length;
      const layerW = n * NODE_W + (n - 1) * NODE_GAP_X;
      const startX = LAYER_LABEL_W + PAD_X + (contentW - layerW) / 2;
      const y = PAD_Y + li * (NODE_H + LAYER_GAP_Y);
      layer.nodes.forEach((node, ni) => {
        map[node.key] = {
          x: startX + ni * (NODE_W + NODE_GAP_X),
          y,
        };
      });
    });

    return { map, svgW, contentW };
  }, [layers]);

  /* ================================================================ */
  /*  Build edges — track-based routing                                */
  /* ================================================================ */
  const edges = useMemo(() => {
    const visible = relationTypes.filter(
      (r) => layout.map[r.source_type_key] && layout.map[r.target_type_key],
    );
    if (visible.length === 0) return [];

    // -- Build layer-index lookup --
    const layerIdx: Record<string, number> = {};
    layers.forEach((layer, li) => {
      layer.nodes.forEach((n) => { layerIdx[n.key] = li; });
    });

    // -- Classify edges --
    const classified: ClassifiedEdge[] = visible.map((r) => {
      const sli = layerIdx[r.source_type_key];
      const tli = layerIdx[r.target_type_key];
      const direction: ClassifiedEdge["direction"] =
        sli < tli ? "down" : sli > tli ? "up" : "same";
      const gapsUsed: number[] = [];
      if (direction === "down") {
        for (let g = sli; g < tli; g++) gapsUsed.push(g);
      } else if (direction === "up") {
        // ordered from source toward target (high->low)
        for (let g = sli - 1; g >= tli; g--) gapsUsed.push(g);
      }
      return { rel: r, srcLayerIdx: sli, tgtLayerIdx: tli, direction, gapsUsed, trackY: [] };
    });

    // -- Compute gap geometry --
    const gaps: GapInfo[] = [];
    for (let i = 0; i < layers.length - 1; i++) {
      const topY = PAD_Y + i * (NODE_H + LAYER_GAP_Y) + NODE_H + TRACK_MARGIN;
      const bottomY = PAD_Y + (i + 1) * (NODE_H + LAYER_GAP_Y) - TRACK_MARGIN;
      gaps.push({ topY, bottomY });
    }

    // -- Compute corridors per layer (vertical pass-through between nodes) --
    const corridorsPerLayer: Corridor[][] = layers.map((layer) => {
      const positions = layer.nodes
        .map((n) => layout.map[n.key])
        .filter(Boolean)
        .sort((a, b) => a.x - b.x);
      const corrs: Corridor[] = [];
      // Left margin corridor
      if (positions.length > 0) {
        const leftBound = LAYER_LABEL_W;
        if (positions[0].x - leftBound > 20) {
          corrs.push({ centerX: (leftBound + positions[0].x) / 2, width: positions[0].x - leftBound });
        }
      }
      // Inter-node corridors
      for (let i = 0; i < positions.length - 1; i++) {
        const right = positions[i].x + NODE_W;
        const left = positions[i + 1].x;
        corrs.push({ centerX: (right + left) / 2, width: left - right });
      }
      // Right margin corridor
      if (positions.length > 0) {
        const lastRight = positions[positions.length - 1].x + NODE_W;
        const svgRight = layout.svgW - PAD_X;
        if (svgRight - lastRight > 20) {
          corrs.push({ centerX: (lastRight + svgRight) / 2, width: svgRight - lastRight });
        }
      }
      return corrs;
    });

    // -- Port assignment --
    const bottomPorts: Record<string, string[]> = {};
    const topPorts: Record<string, string[]> = {};

    for (const e of classified) {
      const r = e.rel;
      if (e.direction === "same") {
        // Same-layer edges exit/enter from the top
        (topPorts[r.source_type_key] ??= []).push(r.key);
        if (r.source_type_key !== r.target_type_key) {
          (topPorts[r.target_type_key] ??= []).push(r.key);
        }
      } else if (e.direction === "down") {
        (bottomPorts[r.source_type_key] ??= []).push(r.key);
        (topPorts[r.target_type_key] ??= []).push(r.key);
      } else {
        (topPorts[r.source_type_key] ??= []).push(r.key);
        (bottomPorts[r.target_type_key] ??= []).push(r.key);
      }
    }

    // Sort ports by the x-position of the other end for minimal crossings
    const sortPorts = (ports: Record<string, string[]>) => {
      for (const nodeKey of Object.keys(ports)) {
        ports[nodeKey].sort((a, b) => {
          const ra = visible.find((v) => v.key === a)!;
          const rb = visible.find((v) => v.key === b)!;
          const otherA = ra.source_type_key === nodeKey ? ra.target_type_key : ra.source_type_key;
          const otherB = rb.source_type_key === nodeKey ? rb.target_type_key : rb.source_type_key;
          return (layout.map[otherA]?.x ?? 0) - (layout.map[otherB]?.x ?? 0);
        });
      }
    };
    sortPorts(bottomPorts);
    sortPorts(topPorts);

    const portXOffset = (nodeKey: string, edgeKey: string, side: "top" | "bottom"): number => {
      const ports = side === "bottom" ? bottomPorts[nodeKey] : topPorts[nodeKey];
      if (!ports) return NODE_W / 2;
      const idx = ports.indexOf(edgeKey);
      const n = ports.length;
      const margin = NODE_W * 0.15;
      const span = NODE_W - 2 * margin;
      return margin + (n === 1 ? span / 2 : (idx / (n - 1)) * span);
    };

    // -- Assign tracks (unique Y per edge per gap) --
    for (let g = 0; g < gaps.length; g++) {
      const gap = gaps[g];
      const inGap = classified.filter((e) => e.gapsUsed.includes(g));
      if (inGap.length === 0) continue;

      // Sort by interpolated X at this gap for minimal crossings
      inGap.sort((a, b) => {
        const interp = (e: ClassifiedEdge) => {
          const srcX = layout.map[e.rel.source_type_key].x + NODE_W / 2;
          const tgtX = layout.map[e.rel.target_type_key].x + NODE_W / 2;
          const total = e.gapsUsed.length;
          const pos = e.gapsUsed.indexOf(g);
          const t = total === 1 ? 0.5 : (pos + 0.5) / total;
          return srcX + (tgtX - srcX) * t;
        };
        return interp(a) - interp(b);
      });

      const n = inGap.length;
      const totalH = (n - 1) * TRACK_GAP;
      const centerY = (gap.topY + gap.bottomY) / 2;
      const startY = centerY - totalH / 2;

      inGap.forEach((edge, i) => {
        const localIdx = edge.gapsUsed.indexOf(g);
        edge.trackY[localIdx] = startY + i * TRACK_GAP;
      });
    }

    // -- Choose corridor X for multi-gap edges passing through intermediate layers --
    // Track usage per corridor per layer so parallel verticals don't overlap
    const corridorUsage: Record<string, number> = {};

    const chooseCorridorX = (intermediateLayerIdx: number, idealX: number): number => {
      const corrs = corridorsPerLayer[intermediateLayerIdx];
      if (!corrs || corrs.length === 0) return idealX; // fallback
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < corrs.length; i++) {
        const dist = Math.abs(corrs[i].centerX - idealX);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      const key = `${intermediateLayerIdx}-${bestIdx}`;
      const used = corridorUsage[key] ?? 0;
      corridorUsage[key] = used + 1;
      // Spread parallel verticals within the corridor
      const maxInCorridor = Math.max(1, Math.floor(corrs[bestIdx].width / 8));
      const offset = (used - (maxInCorridor - 1) / 2) * 6;
      return corrs[bestIdx].centerX + Math.max(-corrs[bestIdx].width / 2 + 4, Math.min(corrs[bestIdx].width / 2 - 4, offset));
    };

    // -- Build paths --
    const sameLayerCount: Record<number, number> = {};

    const rawEdges = classified.map((edge) => {
      const r = edge.rel;
      const srcPos = layout.map[r.source_type_key];
      const tgtPos = layout.map[r.target_type_key];
      let d: string;
      let labelX: number;
      let labelY: number;

      if (edge.direction === "same") {
        // Same-layer arc above the nodes
        const arcIdx = sameLayerCount[edge.srcLayerIdx] ?? 0;
        sameLayerCount[edge.srcLayerIdx] = arcIdx + 1;

        const srcPx = srcPos.x + portXOffset(r.source_type_key, r.key, "top");
        const tgtPx = tgtPos.x + portXOffset(r.target_type_key, r.key, "top");
        const nodeTopY = srcPos.y;
        const arcY = nodeTopY - SAME_LAYER_ARC_BASE - arcIdx * SAME_LAYER_ARC_STEP;

        // Self-loop (same type to same type)
        if (r.source_type_key === r.target_type_key) {
          const cx = srcPos.x + NODE_W / 2;
          const loopW = 24;
          const pts = [
            { x: cx - loopW, y: nodeTopY },
            { x: cx - loopW, y: arcY },
            { x: cx + loopW, y: arcY },
            { x: cx + loopW, y: nodeTopY },
          ];
          d = segmentsToPath(pts);
          labelX = cx;
          labelY = arcY;
        } else {
          const pts = [
            { x: srcPx, y: nodeTopY },
            { x: srcPx, y: arcY },
            { x: tgtPx, y: arcY },
            { x: tgtPx, y: nodeTopY },
          ];
          d = segmentsToPath(pts);
          labelX = (srcPx + tgtPx) / 2;
          labelY = arcY;
        }
      } else {
        // Cross-layer edge (single-gap or multi-gap)
        const goingDown = edge.direction === "down";
        const srcSide = goingDown ? "bottom" : "top";
        const tgtSide = goingDown ? "top" : "bottom";
        const srcPx = srcPos.x + portXOffset(r.source_type_key, r.key, srcSide);
        const tgtPx = tgtPos.x + portXOffset(r.target_type_key, r.key, tgtSide);
        const srcEdgeY = goingDown ? srcPos.y + NODE_H : srcPos.y;
        const tgtEdgeY = goingDown ? tgtPos.y : tgtPos.y + NODE_H;

        const pts: { x: number; y: number }[] = [{ x: srcPx, y: srcEdgeY }];
        let curX = srcPx;

        for (let gi = 0; gi < edge.gapsUsed.length; gi++) {
          const trackAtGap = edge.trackY[gi];

          // Vertical from current position to the track
          pts.push({ x: curX, y: trackAtGap });

          if (gi < edge.gapsUsed.length - 1) {
            // Multi-gap: route through intermediate layer via a corridor
            const gapIdx = edge.gapsUsed[gi];
            const nextGapIdx = edge.gapsUsed[gi + 1];
            // The intermediate layer is between these two gaps
            const intermediateLayer = goingDown
              ? Math.max(gapIdx, nextGapIdx)   // the lower gap index + 1
              : Math.min(gapIdx, nextGapIdx) + 1;

            const idealX = srcPx + (tgtPx - srcPx) * ((gi + 1) / edge.gapsUsed.length);
            const corridorX = chooseCorridorX(intermediateLayer, idealX);

            // Horizontal to corridor
            pts.push({ x: corridorX, y: trackAtGap });
            curX = corridorX;
            // The next iteration will draw vertical from corridorX to the next track
          } else {
            // Last gap: horizontal to target port X
            pts.push({ x: tgtPx, y: trackAtGap });
            curX = tgtPx;
          }
        }

        // Final vertical to target
        pts.push({ x: curX, y: tgtEdgeY });

        d = segmentsToPath(pts);

        // Label at the middle gap's track
        const midGap = Math.floor(edge.gapsUsed.length / 2);
        labelY = edge.trackY[midGap];
        // Label X at the midpoint of the horizontal segment in that gap
        if (edge.gapsUsed.length === 1) {
          labelX = (srcPx + tgtPx) / 2;
        } else {
          labelX = (srcPx + tgtPx) / 2;
        }
      }

      return { key: r.key, d, label: r.label, labelX, labelY, srcType: r.source_type_key, tgtType: r.target_type_key };
    });

    // -- Resolve label overlaps --
    type Rect = { x: number; y: number; w: number; h: number };
    const rectsOverlap = (a: Rect, b: Rect) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

    const nodeRects: Rect[] = Object.values(layout.map).map((pos) => ({
      x: pos.x, y: pos.y, w: NODE_W, h: NODE_H,
    }));

    const placedLabels: Rect[] = [];
    for (const edge of rawEdges) {
      let lx = edge.labelX - LABEL_W / 2;
      let ly = edge.labelY - LABEL_H / 2;
      let labelRect: Rect = { x: lx, y: ly, w: LABEL_W, h: LABEL_H };

      const allBlocked = [...nodeRects, ...placedLabels];
      const hasOverlap = allBlocked.some((r) => rectsOverlap(labelRect, r));

      if (hasOverlap) {
        let resolved = false;
        for (let dy = -LABEL_H; dy <= LABEL_H * 3; dy += 6) {
          if (dy === 0) continue;
          const tryRect: Rect = { x: lx, y: ly + dy, w: LABEL_W, h: LABEL_H };
          if (!allBlocked.some((r) => rectsOverlap(tryRect, r))) {
            ly += dy;
            labelRect = tryRect;
            resolved = true;
            break;
          }
        }
        if (!resolved) {
          for (let dx = LABEL_W; dx <= LABEL_W * 3; dx += LABEL_W * 0.5) {
            for (const sign of [1, -1]) {
              const tryRect: Rect = { x: lx + dx * sign, y: ly, w: LABEL_W, h: LABEL_H };
              if (!allBlocked.some((r) => rectsOverlap(tryRect, r))) {
                lx += dx * sign;
                labelRect = tryRect;
                resolved = true;
                break;
              }
            }
            if (resolved) break;
          }
        }
      }

      placedLabels.push(labelRect);
      edge.labelX = lx + LABEL_W / 2;
      edge.labelY = ly + LABEL_H / 2;
    }

    return rawEdges;
  }, [relationTypes, layout, layers]);

  /* ================================================================ */
  /*  Derived layout values                                            */
  /* ================================================================ */
  const layerLabels = useMemo(() => {
    return layers.map((layer, li) => ({
      label: layer.category,
      y: PAD_Y + li * (NODE_H + LAYER_GAP_Y),
    }));
  }, [layers]);

  // Compute dynamic SVG height accounting for same-layer arcs above layer 0
  const svgDimensions = useMemo(() => {
    // Count same-layer edges per layer to determine arc space needed above layer 0
    const layerIdx: Record<string, number> = {};
    layers.forEach((layer, li) => {
      layer.nodes.forEach((n) => { layerIdx[n.key] = li; });
    });
    let maxArcLift = 0;
    const sameCountPerLayer: Record<number, number> = {};
    for (const r of relationTypes) {
      if (!layout.map[r.source_type_key] || !layout.map[r.target_type_key]) continue;
      const sli = layerIdx[r.source_type_key];
      const tli = layerIdx[r.target_type_key];
      if (sli === tli) {
        sameCountPerLayer[sli] = (sameCountPerLayer[sli] ?? 0) + 1;
      }
    }
    for (const [, count] of Object.entries(sameCountPerLayer)) {
      const lift = SAME_LAYER_ARC_BASE + (count - 1) * SAME_LAYER_ARC_STEP;
      if (lift > maxArcLift) maxArcLift = lift;
    }
    const effectivePadY = Math.max(PAD_Y, maxArcLift + 24);

    const svgH =
      layers.length * NODE_H +
      (layers.length - 1) * LAYER_GAP_Y +
      effectivePadY + PAD_Y;

    return { svgW: layout.svgW, svgH };
  }, [layers, layout, relationTypes]);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  if (visibleTypes.length === 0) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <Typography color="text.secondary">
          No visible types to display. Create some card types first.
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        overflow: "auto",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        bgcolor: "#fafbfc",
      }}
    >
      <svg
        width={svgDimensions.svgW}
        height={svgDimensions.svgH}
        style={{ display: "block", minWidth: svgDimensions.svgW }}
      >
        <style>{`
          .mm-edge:hover > path, .mm-edge-hl > path { stroke: #e67700; stroke-width: 2; }
          .mm-edge:hover > path[marker-end], .mm-edge-hl > path[marker-end] { marker-end: url(#mm-arrow-hover); }
          .mm-edge:hover .mm-edge-label rect, .mm-edge-hl .mm-edge-label rect { fill: #e67700; fill-opacity: 1; stroke: #c45d00; }
          .mm-edge:hover .mm-edge-label text, .mm-edge-hl .mm-edge-label text { fill: #fff; font-weight: 600; }
        `}</style>
        <defs>
          <marker
            id="mm-arrow"
            markerWidth="9"
            markerHeight="6"
            refX="9"
            refY="3"
            orient="auto"
          >
            <path d="M0,0.5 L9,3 L0,5.5 Z" fill="#b0b8c4" />
          </marker>
          <marker
            id="mm-arrow-hover"
            markerWidth="9"
            markerHeight="6"
            refX="9"
            refY="3"
            orient="auto"
          >
            <path d="M0,0.5 L9,3 L0,5.5 Z" fill="#e67700" />
          </marker>
          <filter
            id="mm-shadow"
            x="-8%"
            y="-8%"
            width="120%"
            height="140%"
          >
            <feDropShadow
              dx="0"
              dy="2"
              stdDeviation="4"
              floodColor="#000"
              floodOpacity="0.12"
            />
          </filter>
        </defs>

        {/* ---- Layer backgrounds + labels ---- */}
        {layerLabels.map((ll) => (
          <g key={ll.label}>
            <rect
              x={LAYER_LABEL_W - 4}
              y={ll.y - 16}
              width={svgDimensions.svgW - LAYER_LABEL_W + 4 - PAD_X + 20}
              height={NODE_H + 32}
              rx={10}
              fill="#f0f1f3"
              stroke="#e2e4e8"
              strokeWidth={1}
              strokeDasharray="6 3"
            />
            <text
              x={16}
              y={ll.y + NODE_H / 2 + 5}
              fontSize={12}
              fontWeight={600}
              fill="#8a8f98"
              fontFamily="Inter, Roboto, system-ui, sans-serif"
            >
              {ll.label}
            </text>
          </g>
        ))}

        {/* ---- Edges ---- */}
        {edges.map((e) => (
          <g key={e.key} className={`mm-edge${hoveredNode && (e.srcType === hoveredNode || e.tgtType === hoveredNode) ? " mm-edge-hl" : ""}`}>
            <path
              d={e.d}
              fill="none"
              stroke="#c8ccd4"
              strokeWidth={1.2}
              markerEnd="url(#mm-arrow)"
            />
            {/* Invisible wider hit area for hover */}
            <path
              d={e.d}
              fill="none"
              stroke="transparent"
              strokeWidth={12}
            />
            <g className="mm-edge-label">
              <rect
                x={e.labelX - 42}
                y={e.labelY - 10}
                width={84}
                height={20}
                rx={5}
                fill="#fff"
                fillOpacity={0.92}
                stroke="#e0e2e6"
                strokeWidth={0.5}
              />
              <text
                x={e.labelX}
                y={e.labelY + 4}
                textAnchor="middle"
                fontSize={10}
                fill="#777"
                fontFamily="Inter, Roboto, system-ui, sans-serif"
              >
                {truncate(e.label, 16)}
              </text>
            </g>
          </g>
        ))}

        {/* ---- Nodes ---- */}
        {visibleTypes.map((t) => {
          const pos = layout.map[t.key];
          if (!pos) return null;
          return (
            <g
              key={t.key}
              style={{ cursor: "pointer" }}
              onClick={() => onNodeClick(t.key)}
              onMouseEnter={() => setHoveredNode(t.key)}
              onMouseLeave={() => setHoveredNode(null)}
            >
              <rect
                x={pos.x}
                y={pos.y}
                width={NODE_W}
                height={NODE_H}
                rx={NODE_RX}
                fill={t.color}
                filter="url(#mm-shadow)"
              />
              {/* Icon via Material Symbols font */}
              <text
                x={pos.x + 14}
                y={pos.y + NODE_H / 2 + 7}
                fontFamily="Material Symbols Outlined"
                fontSize={22}
                fill="rgba(255,255,255,0.92)"
              >
                {t.icon}
              </text>
              {/* Label */}
              <text
                x={pos.x + 42}
                y={pos.y + NODE_H / 2 + 5}
                fontSize={12}
                fontWeight={600}
                fill="#fff"
                fontFamily="Inter, Roboto, system-ui, sans-serif"
              >
                {truncate(t.label, 14)}
              </text>
            </g>
          );
        })}
      </svg>
    </Box>
  );
});

export default MetamodelGraph;
