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
