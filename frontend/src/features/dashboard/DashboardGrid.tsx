/**
 * The dashboard's widget grid: react-grid-layout on 12 columns with 60 px
 * rows. Only the 12-column layout is stored; on narrower screens the library
 * derives a 6- or 2-column one, and moving widgets there is switched off so
 * a phone never rewrites the desktop layout.
 *
 * react-grid-layout has no right-to-left mode, so in an RTL locale the grid
 * is laid out `dir="ltr"` and every item's `x` is mirrored on the way in and
 * out (`mirrorLayout`); each widget keeps the document direction inside.
 *
 * Layout changes go to the parent's local state only — the page saves.
 */
import { useCallback, useMemo } from "react";
import { Responsive, getBreakpointFromWidth, useContainerWidth, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import Box from "@mui/material/Box";
import { useIsRtl } from "@/hooks/useIsRtl";
import type { DashboardWidget } from "@/types";
import {
  BREAKPOINTS,
  COLS,
  FULL_WIDTH,
  GRID_COLS,
  MARGIN,
  ROW_HEIGHT,
  applyGridLayout,
  mirrorLayout,
  toGridItem,
  type GridItem,
} from "./layoutUtils";
import { configKind } from "./customize/widgetConfigModel";
import { WIDGET_REGISTRY, isKnownWidgetType } from "./widgets/registry";
import WidgetFrame, { DRAG_HANDLE_CLASS } from "./widgets/WidgetFrame";


interface Props {
  widgets: DashboardWidget[];
  editing: boolean;
  onLayoutChange: (widgets: DashboardWidget[]) => void;
  onConfigure: (widget: DashboardWidget) => void;
  onRemove: (widget: DashboardWidget) => void;
}

export default function DashboardGrid({ widgets, editing, onLayoutChange, onConfigure, onRemove }: Props) {
  const isRtl = useIsRtl();
  const { width, containerRef, mounted } = useContainerWidth();
  const breakpoint = getBreakpointFromWidth(BREAKPOINTS, width);

  const layout = useMemo<GridItem[]>(() => {
    const items = widgets.map(toGridItem);
    return isRtl ? mirrorLayout(items, GRID_COLS) : items;
  }, [widgets, isRtl]);

  // The same layout serves both 12-column breakpoints.
  const layouts = useMemo(() => ({ lg: layout, md: layout }), [layout]);

  const canArrange = editing && FULL_WIDTH.has(breakpoint);

  const handleLayoutChange = useCallback(
    (next: Layout) => {
      // Mount-time compaction and narrow-screen reflows are not the admin's
      // doing; only a 12-column change while customising is written back.
      if (!editing || !FULL_WIDTH.has(breakpoint)) return;
      const items = next as readonly GridItem[];
      const ltr = isRtl ? mirrorLayout(items, GRID_COLS) : items;
      const updated = applyGridLayout(widgets, ltr);
      if (updated !== widgets) onLayoutChange(updated);
    },
    [editing, breakpoint, isRtl, widgets, onLayoutChange],
  );

  return (
    <Box ref={containerRef} className="dashboard-grid" dir="ltr">
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
          resizeConfig={{ enabled: canArrange }}
          onLayoutChange={handleLayoutChange}
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
