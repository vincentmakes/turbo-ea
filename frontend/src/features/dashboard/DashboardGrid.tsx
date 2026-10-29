/**
 * The dashboard's widget grid: react-grid-layout on 12 columns with 60 px
 * rows. Only the 12-column layout is stored; on narrower screens it is
 * scaled and reflowed onto 6 or 2 columns (`reflowLayout`), and moving
 * widgets there is switched off so a phone never rewrites the desktop layout.
 *
 * react-grid-layout has no right-to-left mode, so in an RTL locale the grid
 * is laid out `dir="ltr"` and every item's `x` is mirrored on the way in and
 * out (`mirrorLayout`); each widget keeps the document direction inside.
 *
 * A width change adjusts the widget beside it (`fitRowNeighbour`): the
 * library only pushes a collided neighbour down to the next row, and leaves a
 * hole when a widget shrinks. Heights stay the library's: rows below move
 * down and compact back up on their own.
 *
 * While arranging, the library's resize and drag handles respond to touch
 * as well as a mouse, the corner mark follows the theme and the edge marks
 * are hidden (`handleStyles`).
 *
 * Layout changes go to the parent's local state only — the page saves.
 */
import { useCallback, useMemo, useRef } from "react";
import {
  Responsive,
  getBreakpointFromWidth,
  useContainerWidth,
  type Layout,
  type LayoutItem,
} from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import Box from "@mui/material/Box";
import { useTheme } from "@mui/material/styles";
import { useIsRtl } from "@/hooks/useIsRtl";
import type { DashboardWidget } from "@/types";
import {
  BREAKPOINTS,
  COLS,
  FULL_WIDTH,
  GRID_COLS,
  MARGIN,
  RESIZE_HANDLES,
  ROW_HEIGHT,
  applyGridLayout,
  fitRowNeighbour,
  mirrorLayout,
  reflowLayout,
  toGridItem,
  type GridItem,
} from "./layoutUtils";
import { configKind } from "./customize/widgetConfigModel";
import { handleStyles } from "./gridHandles";
import { WIDGET_REGISTRY, isKnownWidgetType } from "./widgets/registry";
import WidgetFrame, { DRAG_HANDLE_CLASS } from "./widgets/WidgetFrame";


function sameLayout(a: readonly GridItem[], b: readonly GridItem[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((item) => [item.i, item]));
  return b.every((item) => {
    const other = byId.get(item.i);
    return !!other && other.x === item.x && other.y === item.y && other.w === item.w && other.h === item.h;
  });
}

interface Props {
  widgets: DashboardWidget[];
  editing: boolean;
  onLayoutChange: (widgets: DashboardWidget[]) => void;
  onConfigure: (widget: DashboardWidget) => void;
  onRemove: (widget: DashboardWidget) => void;
}

export default function DashboardGrid({ widgets, editing, onLayoutChange, onConfigure, onRemove }: Props) {
  const isRtl = useIsRtl();
  const theme = useTheme();
  const { width, containerRef, mounted } = useContainerWidth();
  const breakpoint = getBreakpointFromWidth(BREAKPOINTS, width);

  const items = useMemo<GridItem[]>(() => widgets.map(toGridItem), [widgets]);
  const layout = useMemo<GridItem[]>(() => (isRtl ? mirrorLayout(items, GRID_COLS) : items), [items, isRtl]);

  // The stored layout serves both 12-column breakpoints as it is; the narrow
  // ones get it scaled and flowed in reading order (`reflowLayout`) instead of
  // the library's clamp, which piles a row of tiles into the last column.
  // The reflow runs on the left-to-right layout and is mirrored afterwards, so
  // in a right-to-left locale the first widget still opens the top-right row.
  const layouts = useMemo(() => {
    const narrow = (cols: number) => {
      const flowed = reflowLayout(items, GRID_COLS, cols);
      return isRtl ? mirrorLayout(flowed, cols) : flowed;
    };
    return { lg: layout, md: layout, sm: narrow(COLS.sm), xs: narrow(COLS.xs) };
  }, [items, layout, isRtl]);

  const canArrange = editing && FULL_WIDTH.has(breakpoint);
  const handleSx = useMemo(() => handleStyles(theme, canArrange), [theme, canArrange]);

  // The layout as it was when a resize started, and the library's own result
  // for that resize once a neighbour was adjusted: the library reports the
  // unadjusted layout through `onLayoutChange` right after `onResizeStop`,
  // and that echo must not overwrite the adjustment.
  const resizeStartRef = useRef<readonly GridItem[] | null>(null);
  const adjustedFromRef = useRef<readonly GridItem[] | null>(null);

  const write = useCallback(
    (items: readonly GridItem[]) => {
      const ltr = isRtl ? mirrorLayout(items, GRID_COLS) : items;
      const updated = applyGridLayout(widgets, ltr);
      if (updated !== widgets) onLayoutChange(updated);
    },
    [isRtl, widgets, onLayoutChange],
  );

  const handleLayoutChange = useCallback(
    (next: Layout) => {
      // Mount-time compaction and narrow-screen reflows are not the admin's
      // doing; only a 12-column change while customising is written back.
      if (!editing || !FULL_WIDTH.has(breakpoint)) return;
      const items = next as readonly GridItem[];
      if (adjustedFromRef.current && sameLayout(adjustedFromRef.current, items)) {
        adjustedFromRef.current = null;
        return;
      }
      adjustedFromRef.current = null;
      write(items);
    },
    [editing, breakpoint, write],
  );

  const handleResizeStart = useCallback((layout: Layout) => {
    resizeStartRef.current = layout as readonly GridItem[];
  }, []);

  const handleResizeStop = useCallback(
    (layout: Layout, oldItem: LayoutItem | null, newItem: LayoutItem | null) => {
      const before = resizeStartRef.current;
      resizeStartRef.current = null;
      if (!canArrange || !before || !oldItem || !newItem) return;
      const after = layout as readonly GridItem[];
      const fitted = fitRowNeighbour(before, after, oldItem as GridItem, newItem as GridItem);
      if (fitted === after) return;
      adjustedFromRef.current = after;
      write(fitted);
    },
    [canArrange, write],
  );

  return (
    <Box ref={containerRef} className="dashboard-grid" dir="ltr" sx={handleSx}>
      {mounted && (
        <Responsive
          width={width}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          layouts={layouts}
          rowHeight={ROW_HEIGHT}
          margin={MARGIN}
          containerPadding={[0, 0]}
          dragConfig={{ enabled: canArrange, handle: `.${DRAG_HANDLE_CLASS}` }}
          resizeConfig={{ enabled: canArrange, handles: RESIZE_HANDLES }}
          onLayoutChange={handleLayoutChange}
          onResizeStart={handleResizeStart}
          onResizeStop={handleResizeStop}
        >
          {widgets.map((widget) => {
            const Component = isKnownWidgetType(widget.type) ? WIDGET_REGISTRY[widget.type].Component : null;
            const configurable = configKind(widget) !== null;
            return (
              <div key={widget.id} data-testid={`grid-item-${widget.id}`} dir={isRtl ? "rtl" : undefined}>
                <WidgetFrame
                  widget={widget}
                  editing={editing}
                  onConfigure={configurable ? () => onConfigure(widget) : undefined}
                  onRemove={() => onRemove(widget)}
                >
                  {Component && <Component widget={widget} />}
                </WidgetFrame>
              </div>
            );
          })}
        </Responsive>
      )}
    </Box>
  );
}
