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
 * A width change adjusts the widget beside it while the pointer moves
 * (`fitRowNeighbour`, in `onResize`): left alone, the library pushes a
 * collided neighbour down to the next row and leaves a hole when a widget
 * shrinks. The fit goes into the layout the library is about to compact and
 * keep, so its own `onLayoutChange` at the end reports the fitted layout.
 * Heights stay the library's: rows below move down and compact back up on
 * their own. The grid's width is held still for the length of a resize or a
 * drag (`gestureWidth`). The widget being resized is drawn at its snapped
 * size (`snapSizePx`) instead of the library's pointer size, so it grows and
 * shrinks column by column in step with its neighbour and never overlaps it.
 *
 * While arranging, the library's resize and drag handles respond to touch
 * as well as a mouse, the corner mark follows the theme and the edge marks
 * are hidden, the landing area is a rounded blue dotted outline and the
 * dragged widget lifts (`handleStyles`), and four empty rows sit under the
 * last widget.
 *
 * Layout changes go to the parent's local state only — the page saves.
 */
import { useCallback, useMemo, useRef, useState } from "react";
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
  rowNeighbour,
  snapSizePx,
  toGridItem,
  type GridItem,
} from "./layoutUtils";
import { configKind } from "./customize/widgetConfigModel";
import { handleStyles } from "./gridHandles";
import { WIDGET_REGISTRY, isKnownWidgetType } from "./widgets/registry";
import WidgetFrame, { DRAG_HANDLE_CLASS } from "./widgets/WidgetFrame";

/**
 * Empty room under the last row while arranging: four rows and a gutter. The
 * window is the page's scroll container, so the page otherwise ends at the
 * last widget's bottom edge and its bottom handle sits at the bottom of the
 * viewport with nowhere to be dragged. react-resizable sizes from `clientY`
 * deltas, so scrolling the page under a still pointer would not help: the
 * fix is room, not scrolling.
 */
const ROOM_BELOW = `${ROW_HEIGHT * 4 + MARGIN[1]}px`;

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
  // The width the grid lays out at, held at its value when a resize or a drag
  // starts until it ends. A scrollbar appearing mid-gesture (a widget pushed
  // a row down lengthens the page) narrows the container, which changes the
  // column width under a still pointer, which changes the item's size, which
  // takes the scrollbar away again — and the layout oscillates. The breakpoint
  // reads the same width, so `canArrange` cannot flip mid-gesture either.
  const [gestureWidth, setGestureWidth] = useState<number | null>(null);
  const gridWidth = gestureWidth ?? width;
  const breakpoint = getBreakpointFromWidth(BREAKPOINTS, gridWidth);

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

  // The snapped pixel size of the widget being resized, while a resize is
  // under way. react-grid-layout draws the item at the pointer's size (its
  // `GridItem` keeps the unsnapped size) while the neighbour, fitted on every
  // move, snaps to columns, so between two snap points the resized widget
  // spills over its neighbour. The library writes the pointer size inline,
  // hence `!important`; its own `.resizing { transition: none }` is replaced
  // so the card grows in step with the neighbour's 200 ms transition.
  const [snap, setSnap] = useState<{ width: number; height: number } | null>(null);
  // The size last set, read by the resize handler so a move inside one cell
  // sets no state at all and re-renders nothing.
  const snapRef = useRef<{ width: number; height: number } | null>(null);
  const setSnapSize = useCallback((size: { width: number; height: number } | null) => {
    const current = snapRef.current;
    if (current === size || (current && size && current.width === size.width && current.height === size.height)) {
      return;
    }
    snapRef.current = size;
    setSnap(size);
  }, []);

  const canArrange = editing && FULL_WIDTH.has(breakpoint);
  const gridSx = useMemo(
    () =>
      canArrange
        ? {
            ...handleStyles(theme, true),
            ...(snap && {
              "& .react-grid-item.resizing": {
                width: `${snap.width}px !important`,
                height: `${snap.height}px !important`,
                transition: "width 200ms ease, height 200ms ease",
              },
            }),
            paddingBottom: ROOM_BELOW,
          }
        : handleStyles(theme, false),
    [theme, canArrange, snap],
  );

  // The layout as it was when the current resize started: every fit during
  // the gesture is measured from it, not from the previous move. A copy of
  // each item, because the library's compaction moves the items of the arrays
  // it is handed in place, and those include the ones of its stored layout.
  const resizeStartRef = useRef<readonly GridItem[] | null>(null);

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
      write(next as readonly GridItem[]);
    },
    [editing, breakpoint, write],
  );

  const handleGestureStart = useCallback(() => setGestureWidth(width), [width]);
  const handleGestureStop = useCallback(() => setGestureWidth(null), []);

  const handleResizeStart = useCallback(
    (layout: Layout) => {
      resizeStartRef.current = layout.map((item) => ({ ...item }));
      handleGestureStart();
    },
    [handleGestureStart],
  );

  // Fit the row neighbour on every pointer move. react-grid-layout 2.3.0
  // calls `onResize` with a fresh array, then compacts that very array and
  // keeps the result as its layout (`onResize` in
  // `react-grid-layout/dist/chunk-CUP5Y2ZG.js`: `onResizeProp(finalLayout, …)`
  // followed by `compactor.compact(finalLayout, cols)` and `setLayout`). So an
  // element replaced in it here takes effect on this move: the neighbour
  // narrows (or slides and widens) instead of being pushed below and lifted
  // back. Only elements are replaced, each with a new object; no item the
  // library holds is changed.
  const handleResize = useCallback(
    (layout: Layout, oldItem: LayoutItem | null, newItem: LayoutItem | null) => {
      const before = resizeStartRef.current;
      if (!canArrange || !before || !oldItem || !newItem) return;
      setSnapSize(snapSizePx(newItem, gridWidth, GRID_COLS, MARGIN, ROW_HEIGHT));
      const neighbour = rowNeighbour(before, oldItem as GridItem);
      if (!neighbour) return;
      const after = layout as GridItem[];
      // An earlier move of this gesture may already have fitted the
      // neighbour. Give it back its starting column and width first, so a
      // widget dragged back to its starting width leaves no hole and one grown
      // past what the neighbour can give pushes it below at its own width.
      const at = after.findIndex((item) => item.i === neighbour.i);
      if (at < 0) return;
      const current = after[at];
      if (current.x !== neighbour.x || current.w !== neighbour.w) {
        after[at] = { ...current, x: neighbour.x, w: neighbour.w };
      }
      const fitted = fitRowNeighbour(before, after, oldItem as GridItem, newItem as GridItem);
      if (fitted === after) return;
      for (let i = 0; i < after.length; i++) {
        if (fitted[i] !== after[i]) after[i] = fitted[i];
      }
    },
    [canArrange, gridWidth, setSnapSize],
  );

  const handleResizeStop = useCallback(() => {
    resizeStartRef.current = null;
    setSnapSize(null);
    handleGestureStop();
  }, [handleGestureStop, setSnapSize]);

  return (
    <Box ref={containerRef} className="dashboard-grid" dir="ltr" sx={gridSx}>
      {mounted && (
        <Responsive
          width={gridWidth}
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
          onResize={handleResize}
          onResizeStop={handleResizeStop}
          onDragStart={handleGestureStart}
          onDragStop={handleGestureStop}
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
