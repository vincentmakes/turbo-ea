/**
 * Geometry of the connector that joins a branch line of the query strip to
 * the card it hangs from. Every value is in the lines container's frame and
 * measured from its inline-start edge (the left in LTR, the right in RTL), so
 * one computation serves both directions; the strip maps `start` onto `left`
 * or `right` when it draws.
 */

/** The horizontal run between the connector's drop and the line's badge. */
export const CONNECTOR_STUB = 12;
/** The least room a branch line keeps for itself on a narrow strip. */
export const MIN_LINE_WIDTH = 240;

/** The connector's way back along the strip's padding, outside every line. */
export const CONNECTOR_GUTTER = -6;
/** How far below its row of chips the connector turns toward the gutter. */
const GUTTER_DROP = 3;

/**
 * A box on the strip — a chip, an arrow with its verb — by its inline start
 * and end, top and bottom. `origin` names the branch origin whose arrow the
 * box holds, if any: that box is where the connector starts, not in its way.
 */
export interface ConnectorBox {
  start: number;
  end: number;
  top: number;
  bottom: number;
  origin?: string;
}

/**
 * Where the connector leaves: the arrow after the origin card (`key` is that
 * card's path key), its centre and the top of the arrow and the bottom edge
 * of the marker under it.
 */
export interface ConnectorOrigin {
  key: string;
  x: number;
  top: number;
  bottom: number;
}

/** The AND / OR badge the connector runs into: its inline-start edge, top and bottom. */
export interface ConnectorBadge {
  start: number;
  top: number;
  bottom: number;
}

/**
 * One drawn piece of a connector: a box whose `side` edge (inline start or
 * end) and, when `bottom`, bottom edge are the line; the corner where the two
 * meet is rounded.
 */
export interface ConnectorSegment {
  start: number;
  top: number;
  width: number;
  height: number;
  side: "start" | "end";
  bottom: boolean;
}

/**
 * Where a branch line starts: under the marker on its origin's arrow, so the drop
 * turns straight into it — but never so far along that less than
 * `MIN_LINE_WIDTH` is left for the line on a narrow strip.
 */
export function branchLineOffset(originX: number, containerWidth: number): number {
  return Math.max(0, Math.min(originX, containerWidth - MIN_LINE_WIDTH));
}

/** Does the line `segment` draws (its side edge, and its bottom edge when set) cross `box`? */
function crosses(segment: ConnectorSegment, box: ConnectorBox): boolean {
  const x = segment.side === "start" ? segment.start : segment.start + segment.width;
  const y = segment.top + segment.height;
  const down = box.start <= x && box.end >= x && box.top < y && box.bottom > segment.top;
  const along =
    segment.bottom &&
    box.top <= y &&
    box.bottom >= y &&
    box.start < segment.start + segment.width &&
    box.end > segment.start;
  return down || along;
}

/** Is `route` clear of every box of the strip (a chip, an arrow with its verb)? */
export function routeIsClear(route: ConnectorSegment[], boxes: ConnectorBox[]): boolean {
  return route.every((segment) => !boxes.some((box) => crosses(segment, box)));
}

/**
 * The connector from `origin` to `badge`, the first of these shapes that
 * crosses none of `boxes`:
 * - the badge lies ahead of the marker (the line starts under its arrow):
 *   one corner, down to the badge's middle, then along into it;
 * - the line was pulled back on a narrow strip: the connector turns in the
 *   gap above the line, back to just inside the badge's leading edge and
 *   down onto it;
 * - otherwise (the origin's line wraps and goes on below it, or the turn
 *   would cut through chips) it turns in the gap under the origin's row of
 *   chips — below the tallest of them — back to the gutter in the strip's
 *   padding, down it, and along into the badge.
 * The box holding the origin's own arrow is never in the way: a long verb
 * beside the arrow may wrap below it.
 */
export function connectorSegments(
  origin: ConnectorOrigin,
  badge: ConnectorBadge,
  boxes: ConnectorBox[] = [],
): ConnectorSegment[] {
  const others = boxes.filter((b) => b.origin !== origin.key);
  const middle = Math.round((badge.top + badge.bottom) / 2);
  const direct: ConnectorSegment[] =
    badge.start > origin.x
      ? [
          {
            start: origin.x,
            top: origin.bottom,
            width: badge.start - origin.x,
            height: middle - origin.bottom,
            side: "start",
            bottom: true,
          },
        ]
      : pulledBack(origin, badge);
  if (routeIsClear(direct, others)) return direct;
  // The origin's row of chips: every box beside the arrow, top to bottom.
  const row = others.filter((b) => b.top < origin.bottom && b.bottom > origin.top);
  const turn = Math.max(origin.bottom, ...row.map((b) => b.bottom)) + GUTTER_DROP;
  return [
    {
      start: CONNECTOR_GUTTER,
      top: origin.bottom,
      width: origin.x - CONNECTOR_GUTTER,
      height: turn - origin.bottom,
      side: "end",
      bottom: true,
    },
    {
      start: CONNECTOR_GUTTER,
      top: turn,
      width: badge.start - CONNECTOR_GUTTER,
      height: middle - turn,
      side: "start",
      bottom: true,
    },
  ];
}

/** The way into a badge that starts before the marker: turning in the gap above its line. */
function pulledBack(origin: ConnectorOrigin, badge: ConnectorBadge): ConnectorSegment[] {
  const turn = Math.round((origin.bottom + badge.top) / 2);
  const enter = Math.min(badge.start + CONNECTOR_STUB, origin.x);
  return [
    {
      start: enter,
      top: origin.bottom,
      width: origin.x - enter,
      height: turn - origin.bottom,
      side: "end",
      bottom: true,
    },
    { start: enter, top: turn, width: 0, height: badge.top - turn, side: "start", bottom: false },
  ];
}
