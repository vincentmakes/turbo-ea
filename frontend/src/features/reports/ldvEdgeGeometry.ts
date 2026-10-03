import type { XY } from "./ldvEdgeRouting";

/**
 * The geometry rules a Layered Dependency View edge applies at render time,
 * between the layout-time route it was given and the live handle positions
 * React Flow reports.
 */

export interface EdgeAnchors {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

/** How far (px) a live handle may drift from its layout-time anchor before the
 *  stored bends are considered stale. */
export const ANCHOR_TOLERANCE = 4;

/**
 * Channel-routed edges carry an orthogonal waypoint polyline that dodges the
 * rows of cards between their endpoints. It is honoured only while the live
 * handle positions still match the layout-time anchors — a dragged endpoint
 * invalidates the stored bends, and the edge then degrades to the default
 * smoothstep shape instead of a broken polyline.
 *
 * Returns the full polyline (live source, snapped bends, live target), or
 * `null` when there are no fresh waypoints. The first and last bend are snapped
 * onto the live handle along the axis their segment runs on, so every segment
 * is exactly orthogonal despite the few px of live-vs-layout measurement drift
 * the anchor tolerance admits — that drift used to render as visibly tilted
 * "verticals".
 */
export function liveWaypointPolyline(
  waypoints: XY[] | undefined,
  anchors: EdgeAnchors | undefined,
  source: XY,
  target: XY,
): XY[] | null {
  if (!waypoints || waypoints.length === 0 || !anchors) return null;
  const fresh =
    Math.abs(anchors.sx - source.x) < ANCHOR_TOLERANCE &&
    Math.abs(anchors.sy - source.y) < ANCHOR_TOLERANCE &&
    Math.abs(anchors.tx - target.x) < ANCHOR_TOLERANCE &&
    Math.abs(anchors.ty - target.y) < ANCHOR_TOLERANCE;
  if (!fresh) return null;
  const wps = waypoints.map((p) => ({ ...p }));
  const first = wps[0];
  if (Math.abs(first.x - anchors.sx) < 1) first.x = source.x;
  else if (Math.abs(first.y - anchors.sy) < 1) first.y = source.y;
  const last = wps[wps.length - 1];
  if (Math.abs(last.x - anchors.tx) < 1) last.x = target.x;
  else if (Math.abs(last.y - anchors.ty) < 1) last.y = target.y;
  return [source, ...wps, target];
}

/** Default label anchor on a polyline: the midpoint of its longest segment. */
export function longestSegmentMidpoint(pts: XY[]): XY {
  let bi = 0;
  let bl = -1;
  for (let k = 0; k + 1 < pts.length; k++) {
    const l = Math.abs(pts[k + 1].x - pts[k].x) + Math.abs(pts[k + 1].y - pts[k].y);
    if (l > bl) {
      bl = l;
      bi = k;
    }
  }
  return { x: (pts[bi].x + pts[bi + 1].x) / 2, y: (pts[bi].y + pts[bi + 1].y) / 2 };
}

/**
 * The routing engine pins a smoothstep edge's horizontal run to an explicit
 * centerY (staggered against other runs and kept clear of cards). It is
 * honoured only while it still lies between the live handle Ys — after a drag
 * the stored value can go stale, and a centerY outside the span would make
 * the path double back on itself.
 */
export function effectiveCenterY(
  routedCenterY: number | undefined,
  sourceY: number,
  targetY: number,
): number | undefined {
  return routedCenterY !== undefined &&
    routedCenterY > Math.min(sourceY, targetY) + 8 &&
    routedCenterY < Math.max(sourceY, targetY) - 8
    ? routedCenterY
    : undefined;
}

/**
 * The smoothstep bend offset. If the edge must clear an obstruction, at least
 * `minOffset` (large offsets flip the smoothstep into its wrap-around shape,
 * which is what routes around the card); otherwise the offset is kept well
 * inside the handle span so the bend stubs never fight the pinned centerY.
 */
export function effectiveOffset(
  rawOffset: number,
  minOffset: number,
  centerY: number | undefined,
  sourceY: number,
  targetY: number,
): number {
  if (minOffset > 0) return Math.max(rawOffset, minOffset);
  if (centerY !== undefined) {
    return Math.max(
      4,
      Math.min(rawOffset, Math.abs(centerY - sourceY) - 6, Math.abs(targetY - centerY) - 6),
    );
  }
  const verticalGap = Math.abs(targetY - sourceY);
  return Math.min(rawOffset, Math.max(10, verticalGap * 0.48));
}
