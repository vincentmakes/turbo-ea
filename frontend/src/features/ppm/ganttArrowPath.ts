/**
 * Dependency-arrow routing for a gantt chart.
 *
 * Lifted out of the PPM gantt so anything drawing a finish-to-start arrow
 * between two points draws the SAME arrow — the shape is a convention, and a
 * second implementation is a second convention. Pure geometry: it takes two
 * points in one coordinate space and returns an SVG path, with no React, no
 * DOM and no knowledge of what the points mean.
 *
 * Routing follows the milestone-planner conventions:
 *   • Forward (source ends before target starts): three segments H–V–H with
 *     two rounded corners (SVG arc, r = 6px).
 *   • Loop-back (overlapping): five segments routing around to the LEFT of
 *     both points, with four rounded corners.
 *   • Same row: a single horizontal segment.
 */

/**
 * @param clickSafe  Return the "click target" variant of the same shape,
 *   inset to stay clear of the relation handles that sit just outside each
 *   endpoint. A transparent click stroke laid over the visible path covers
 *   those handles, so once a bar has any outgoing dependency its handle
 *   becomes ungrabbable — this is what keeps the two concerns apart. Routing
 *   decisions still use the original endpoints, so visible and clickable
 *   paths follow the exact same shape.
 */
export function buildGanttArrowPath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  clickSafe = false,
): string {
  const RADIUS = 6;
  const STUB = 14; // horizontal exit/entry length for loop-back routing
  const DETOUR_PAD = 18; // gap between detour line and bars
  const SAFE = 18; // clear zone in px around each bar's relation handle

  // Same row → one straight segment. Inset both ends linearly.
  if (Math.abs(toY - fromY) < 1) {
    const sx = clickSafe ? fromX + SAFE : fromX;
    const ex = clickSafe ? toX - SAFE : toX;
    return `M ${sx} ${fromY} H ${ex}`;
  }

  const vDir = toY > fromY ? 1 : -1; // +1 down, -1 up

  // Forward routing — clean 3-segment H/V/H with 2 rounded corners
  if (toX > fromX + 2 * RADIUS) {
    const midX = (fromX + toX) / 2;
    const r = Math.min(
      RADIUS,
      (toX - fromX) / 4,
      Math.abs(toY - fromY) / 2,
    );
    // Cap inset so the click M never crosses past the first arc /
    // the click H never crosses past the last arc — otherwise the
    // segment would double back over the bar's edge.
    const sx = clickSafe ? Math.min(fromX + SAFE, midX - r) : fromX;
    const ex = clickSafe ? Math.max(toX - SAFE, midX + r) : toX;
    if (r < 1) {
      return `M ${sx} ${fromY} H ${midX} V ${toY} H ${ex}`;
    }
    // sweep flags: R→D=1, D→R=0; flip both for vDir=-1
    const s1 = vDir > 0 ? 1 : 0;
    const s2 = vDir > 0 ? 0 : 1;
    return [
      `M ${sx} ${fromY}`,
      `H ${midX - r}`,
      `A ${r} ${r} 0 0 ${s1} ${midX} ${fromY + vDir * r}`,
      `V ${toY - vDir * r}`,
      `A ${r} ${r} 0 0 ${s2} ${midX + r} ${toY}`,
      `H ${ex}`,
    ].join(" ");
  }

  // Loop-back — exit right, drop past source row, run LEFT past both
  // bars, drop to target row, re-enter target.
  const r = RADIUS;
  const exitX = fromX + STUB;
  const turnY = fromY + vDir * STUB;
  const detourX = Math.min(fromX, toX) - DETOUR_PAD;
  // Sweep flags by direction:
  //   vDir +1 (down):  R→D=1, D→L=1, L→D=0, D→R=0
  //   vDir -1 (up):    R→U=0, U→L=0, L→U=1, U→R=1
  const s1 = vDir > 0 ? 1 : 0;
  const s2 = vDir > 0 ? 1 : 0;
  const s3 = vDir > 0 ? 0 : 1;
  const s4 = vDir > 0 ? 0 : 1;
  const ex = clickSafe ? toX - SAFE : toX;
  // For the click path in loop-back routing we skip the first three
  // segments (H exit → arc down → V) entirely. Those segments hug the
  // source bar's row (only ~6 px below the bar centre) and any click
  // stroke covering them would still overlap the source's right
  // relation handle. Starting the click path at the END of the second
  // arc — where the path begins running LEFT under both bars — keeps
  // the bar's hover region completely clear.
  if (clickSafe) {
    return [
      `M ${exitX - r} ${turnY}`,
      `H ${detourX + r}`,
      `A ${r} ${r} 0 0 ${s3} ${detourX} ${turnY + vDir * r}`,
      `V ${toY - vDir * r}`,
      `A ${r} ${r} 0 0 ${s4} ${detourX + r} ${toY}`,
      `H ${ex}`,
    ].join(" ");
  }
  return [
    `M ${fromX} ${fromY}`,
    `H ${exitX - r}`,
    `A ${r} ${r} 0 0 ${s1} ${exitX} ${fromY + vDir * r}`,
    `V ${turnY - vDir * r}`,
    `A ${r} ${r} 0 0 ${s2} ${exitX - r} ${turnY}`,
    `H ${detourX + r}`,
    `A ${r} ${r} 0 0 ${s3} ${detourX} ${turnY + vDir * r}`,
    `V ${toY - vDir * r}`,
    `A ${r} ${r} 0 0 ${s4} ${detourX + r} ${toY}`,
    `H ${ex}`,
  ].join(" ");
}
