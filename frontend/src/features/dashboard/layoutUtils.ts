/**
 * Pure layout helpers for the dashboard grid: the bridge between a widget's
 * stored `layout` and react-grid-layout's items, the right-to-left mirror,
 * and where a new widget lands.
 */
import type { DashboardWidget, WidgetLayout } from "@/types";
import { WIDGET_META, isKnownWidgetType } from "./widgets/widgetMeta";

/** Columns of the persisted (`lg`) layout. */
export const GRID_COLS = 12;

export const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480 } as const;
export const COLS = { lg: GRID_COLS, md: GRID_COLS, sm: 6, xs: 2 } as const;
/** Grid row height in px; the stored default sizes assume it. */
export const ROW_HEIGHT = 60;
export const MARGIN: readonly [number, number] = [16, 16];

/** The breakpoints that show the stored 12-column layout as it is. */
export const FULL_WIDTH: ReadonlySet<string> = new Set(["lg", "md"]);

/** Resize from the right edge, the bottom edge or the corner. */
export const RESIZE_HANDLES = ["e", "s", "se"] as const;

/** The subset of a react-grid-layout item the dashboard reads and writes. */
export interface GridItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

/**
 * Mirror a layout horizontally (`x' = cols - x - w`). react-grid-layout has
 * no right-to-left mode, so in an RTL locale the grid is forced `dir="ltr"`
 * and every item is mirrored on the way in and again on the way out — the
 * mirror is its own inverse, so the stored layout stays left-to-right.
 */
export function mirrorLayout<T extends { x: number; w: number }>(layout: readonly T[], cols: number): T[] {
  return layout.map((item) => ({ ...item, x: Math.max(0, cols - item.x - item.w) }));
}

/**
 * The stored 12-column layout scaled and flowed onto a narrower grid.
 *
 * react-grid-layout derives a missing breakpoint's layout by clamping each
 * item (`x = min(x, cols - w)`), which piles a row of narrow widgets into the
 * last column: four 3-wide KPI tiles at x = 0, 3, 6, 9 become x = 0, 3, 3, 3
 * on six columns. Instead, items are taken in reading order (`y`, then `x`),
 * each width is scaled to the new grid (`round(w * toCols / fromCols)`,
 * between 1 and `toCols`; on two columns or fewer every item is full width,
 * so a phone stacks one widget per row), heights are kept, and the items are
 * flowed left to right: one that does not fit beside the previous one starts
 * a new row, under the tallest item of the row before.
 *
 * Returns new items with the same ids and heights and a new `x`, `y` and `w`
 * (a stored `minW` is capped at the new width); the input is not mutated.
 * Only ever used for display: a reflowed layout is never written back.
 */
export function reflowLayout(layout: readonly GridItem[], fromCols: number, toCols: number): GridItem[] {
  const ordered = [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: GridItem[] = [];
  let cursor = 0;
  let rowY = 0;
  let rowBottom = 0;
  for (const item of ordered) {
    const scaled = Math.round((item.w * toCols) / fromCols);
    const w = toCols <= 2 ? toCols : Math.min(toCols, Math.max(1, scaled));
    if (cursor + w > toCols) {
      rowY = rowBottom;
      cursor = 0;
    }
    const next: GridItem = { ...item, x: cursor, y: rowY, w };
    if (item.minW !== undefined) next.minW = Math.min(item.minW, w);
    out.push(next);
    cursor += w;
    rowBottom = Math.max(rowBottom, rowY + item.h);
  }
  return out;
}

/** A widget's grid item, with the catalogue's minimum size when it stores none. */
export function toGridItem(widget: DashboardWidget): GridItem {
  const { x, y, w, h } = widget.layout;
  const defaults = isKnownWidgetType(widget.type) ? WIDGET_META[widget.type].defaultLayout : null;
  const minW = widget.layout.minW ?? defaults?.minW;
  const minH = widget.layout.minH ?? defaults?.minH;
  return {
    i: widget.id,
    x,
    y,
    w,
    h,
    ...(minW !== undefined && { minW: Math.min(minW, w) }),
    ...(minH !== undefined && { minH: Math.min(minH, h) }),
  };
}

/**
 * Apply a grid layout back to the widgets: position and size only, so a
 * stored `minW` / `minH` survives. Returns the same array when nothing moved,
 * so a no-op layout callback never marks the dashboard dirty.
 */
export function applyGridLayout(widgets: DashboardWidget[], layout: readonly GridItem[]): DashboardWidget[] {
  const byId = new Map(layout.map((item) => [item.i, item]));
  let changed = false;
  const next = widgets.map((widget) => {
    const item = byId.get(widget.id);
    if (!item) return widget;
    const { x, y, w, h } = widget.layout;
    if (item.x === x && item.y === y && item.w === w && item.h === h) return widget;
    changed = true;
    const layoutOut: WidgetLayout = { ...widget.layout, x: item.x, y: item.y, w: item.w, h: item.h };
    return { ...widget, layout: layoutOut };
  });
  return changed ? next : widgets;
}

/** The first free row under every widget. */
export function bottomOf(widgets: Pick<DashboardWidget, "layout">[]): number {
  return widgets.reduce((max, w) => Math.max(max, w.layout.y + w.layout.h), 0);
}

/** A new widget's layout: the catalogue's default size, at the bottom, left-aligned. */
export function newWidgetLayout(type: DashboardWidget["type"], widgets: DashboardWidget[]): WidgetLayout {
  const { w, h } = WIDGET_META[type].defaultLayout;
  return { x: 0, y: bottomOf(widgets), w, h };
}

/**
 * A widget id unique within `widgets`: `<type>-<base36 time><random>`. The
 * backend accepts `[A-Za-z0-9_-]{1,40}`; this never looks like a UUID.
 */
export function newWidgetId(type: string, widgets: Pick<DashboardWidget, "id">[]): string {
  const taken = new Set(widgets.map((w) => w.id));
  const prefix = type.replace(/[^A-Za-z0-9]/g, "").slice(0, 16) || "widget";
  for (;;) {
    const id = `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    if (!taken.has(id)) return id;
  }
}

function overlapsRows(item: GridItem, band: GridItem): boolean {
  return item.y < band.y + band.h && item.y + item.h > band.y;
}

/**
 * The widget immediately to the right of `item` on the same row band in
 * `layout`, or undefined. Items below, above or to the left are never a row
 * neighbour: heights are react-grid-layout's own business (it pushes the rows
 * below down and compacts them back up).
 */
export function rowNeighbour(layout: readonly GridItem[], item: GridItem): GridItem | undefined {
  let nearest: GridItem | undefined;
  for (const other of layout) {
    if (other.i === item.i || !overlapsRows(other, item) || other.x < item.x + item.w) continue;
    if (!nearest || other.x < nearest.x) nearest = other;
  }
  return nearest;
}

/**
 * Make the row neighbour absorb a width change, so a resize adjusts the
 * widget beside it instead of pushing it to the next row or leaving a hole.
 *
 * `before` is the layout as it was when the resize started, `after` the one
 * the library produced (the neighbour already pushed down when the widget
 * grew into it). Growing narrows the neighbour and keeps it on its row, but
 * only when it can give up the whole change without going under its minimum
 * width — otherwise the library's result stands and the neighbour wraps
 * below, which is what lets a chart be dragged to full width. Shrinking slides
 * the neighbour left and widens it, so the row stays full. A height-only
 * change, or a widget with nothing to its right, returns `after` as is (same
 * array, so the caller can tell nothing was adjusted).
 */
export function fitRowNeighbour(
  before: readonly GridItem[],
  after: readonly GridItem[],
  oldItem: GridItem,
  newItem: GridItem,
): readonly GridItem[] {
  const delta = newItem.w - oldItem.w;
  if (delta === 0) return after;
  const neighbour = rowNeighbour(before, oldItem);
  if (!neighbour) return after;
  const minW = neighbour.minW ?? 1;
  if (delta > 0 && neighbour.w - delta < minW) return after;
  const fitted: GridItem = {
    ...neighbour,
    x: newItem.x + newItem.w,
    y: neighbour.y,
    w: neighbour.w - delta,
  };
  return after.map((item) => (item.i === neighbour.i ? fitted : item));
}

/**
 * The pixel size react-grid-layout gives an item of `w` × `h` grid units on a
 * grid `width` px wide (its own `calcGridItemWHPx`, container padding
 * `[0, 0]`): `colWidth = (width − marginX × (cols − 1)) / cols`, then
 * `round(colWidth × w + marginX × (w − 1))` and
 * `round(rowHeight × h + marginY × (h − 1))`.
 *
 * The library draws the item being resized at the pointer's unsnapped size
 * while its neighbour already snaps to columns, so between two snap points
 * the resized widget spills over the neighbour; the grid pins the resizing
 * item to this size instead.
 */
export function snapSizePx(
  item: Pick<GridItem, "w" | "h">,
  width: number,
  cols: number,
  margin: readonly [number, number],
  rowHeight: number,
): { width: number; height: number } {
  const colWidth = (width - margin[0] * (cols - 1)) / cols;
  return {
    width: Math.round(colWidth * item.w + margin[0] * Math.max(0, item.w - 1)),
    height: Math.round(rowHeight * item.h + margin[1] * Math.max(0, item.h - 1)),
  };
}
