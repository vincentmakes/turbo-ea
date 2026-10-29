/**
 * The chrome around one dashboard widget: the card and title (unless the
 * widget draws its own surface), the drag handle and the configure / remove
 * buttons in customize mode, and an error boundary so one broken widget never
 * takes the dashboard down. The grid gives the frame a fixed height; the body
 * fills what the header leaves (`flex: 1, minHeight: 0`) so charts size to it
 * and long lists scroll inside it.
 *
 * Customize mode looks like live mode plus the controls. A titled or carded
 * widget keeps its header, with the drag handle around the title and the
 * buttons at its end. A widget that draws its own surface (`self` chrome:
 * every KPI tile and every workspace / admin section) gets no header and no
 * card from the frame in either mode: the frame hands it the handle and the
 * buttons through context (`useWidgetControls`) and the widget places them in
 * its own top row. Should it fail to render, the frame draws them above the
 * error instead, so a broken widget can still be moved and removed.
 *
 * In customize mode a widget carries a faint shadow (`CARD_SHADOW.soft`), the
 * cue that it can be picked up and moved: on the frame's card, or for a
 * widget that draws its own surface on the frame's box, which that surface
 * fills. Not on the surface itself: it sits in the body, whose `overflow`
 * (long sections scroll in it) would clip a shadow drawn outside it. The
 * widget being dragged lifts higher (`CARD_SHADOW.lifted`, `gridHandles.ts`).
 */
import { createContext, useContext, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ErrorBoundary from "@/components/ErrorBoundary";
import MaterialSymbol from "@/components/MaterialSymbol";
import { CARD_SHADOW } from "@/theme/tokens";
import type { DashboardWidget } from "@/types";
import { WIDGET_META, isKnownWidgetType, widgetTitle, type WidgetChrome } from "./widgetMeta";

/** The class react-grid-layout's `dragConfig.handle` selects. */
export const DRAG_HANDLE_CLASS = "dashboard-widget-drag-handle";

/** The customize-mode controls a widget that draws its own surface places in its top row. */
export interface WidgetControls {
  /** The drag handle: the grip glyph, carrying `DRAG_HANDLE_CLASS`. */
  handle: ReactNode;
  /** The configure and remove buttons (each only when the grid offers it). */
  actions: ReactNode;
}

interface WidgetEditingState {
  editing: boolean;
  /** Set only in customize mode, and only for a widget that draws its own surface. */
  controls: WidgetControls | null;
}

const WidgetEditingContext = createContext<WidgetEditingState>({ editing: false, controls: null });

/** Whether the enclosing frame is in customize mode. */
export function useWidgetEditing(): boolean {
  return useContext(WidgetEditingContext).editing;
}

/**
 * The drag handle and buttons a widget that draws its own surface places in
 * its own top row; `null` outside customize mode and inside a frame that
 * draws its own header.
 */
export function useWidgetControls(): WidgetControls | null {
  return useContext(WidgetEditingContext).controls;
}

/** The customize-mode shadow, faded in as the mode is entered. */
const EDITING_SHADOW = { boxShadow: CARD_SHADOW.soft, transition: "box-shadow 150ms" } as const;

interface Props {
  widget: DashboardWidget;
  editing: boolean;
  onConfigure?: () => void;
  onRemove?: () => void;
  children: ReactNode;
}

export default function WidgetFrame({ widget, editing, onConfigure, onRemove, children }: Props) {
  const { t } = useTranslation("common");
  const chrome: WidgetChrome = isKnownWidgetType(widget.type) ? WIDGET_META[widget.type].chrome : "titled";
  const title = widgetTitle(widget, t);
  const ownSurface = chrome === "self";

  // The grip and the buttons, built once: placed in the frame's own header,
  // or handed to a widget that draws its own surface.
  const grip = <MaterialSymbol icon="drag_indicator" size={18} />;
  const actions = (
    <>
      {onConfigure && (
        <Tooltip title={t("dashboard.widgets.configure")}>
          <IconButton size="small" aria-label={t("dashboard.widgets.configure")} onClick={onConfigure}>
            <MaterialSymbol icon="tune" size={18} />
          </IconButton>
        </Tooltip>
      )}
      {onRemove && (
        <Tooltip title={t("dashboard.widgets.remove")}>
          <IconButton size="small" aria-label={t("dashboard.widgets.remove")} onClick={onRemove}>
            <MaterialSymbol icon="close" size={18} />
          </IconButton>
        </Tooltip>
      )}
    </>
  );
  const handle = (content: ReactNode, grow: boolean) => (
    <Box
      className={DRAG_HANDLE_CLASS}
      data-testid="widget-drag-handle"
      title={t("dashboard.widgets.dragToMove")}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        minWidth: 0,
        cursor: "grab",
        ...(grow ? { flex: 1 } : { flexShrink: 0 }),
      }}
    >
      {content}
    </Box>
  );

  // A carded widget shows its title only while arranging, as a caption; so
  // does a failed widget that draws its own surface, above the error.
  const titleText = (
    <Typography
      variant={chrome === "titled" ? "subtitle1" : "caption"}
      fontWeight={600}
      color={chrome === "titled" ? "text.primary" : "text.secondary"}
      noWrap
      sx={{ flex: 1, minWidth: 0 }}
    >
      {title}
    </Typography>
  );
  const headerRow = (mb: number) => (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb, minHeight: 28 }}>
      {editing ? (
        handle(
          <>
            {grip}
            {titleText}
          </>,
          true,
        )
      ) : (
        titleText
      )}
      {editing && actions}
    </Box>
  );

  const controls: WidgetControls | null = editing && ownSurface ? { handle: handle(grip, false), actions } : null;

  const body = (
    <Box
      data-testid="widget-body"
      sx={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        // A section that sizes itself to `height: 100%` grows with its
        // content instead of spilling past its own border.
        "& > .MuiPaper-root": { height: "auto", minHeight: "100%", flex: "1 0 auto" },
      }}
    >
      <ErrorBoundary inline label={title} fallbackHeader={controls ? headerRow(0.5) : undefined}>
        <WidgetEditingContext.Provider value={{ editing, controls }}>{children}</WidgetEditingContext.Provider>
      </ErrorBoundary>
    </Box>
  );

  // The widget is the card, in customize mode as in live mode: no header and
  // no card from the frame, only the box the shadow is drawn on.
  if (ownSurface) {
    return (
      <Box
        data-widget-id={widget.id}
        sx={{ height: "100%", display: "flex", flexDirection: "column", borderRadius: 1, ...(editing && EDITING_SHADOW) }}
      >
        {body}
      </Box>
    );
  }

  return (
    <Card
      data-widget-id={widget.id}
      sx={{ height: "100%", display: "flex", flexDirection: "column", ...(editing && EDITING_SHADOW) }}
    >
      <CardContent
        sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", "&:last-child": { pb: 2 } }}
      >
        {chrome === "titled" || editing ? headerRow(1) : null}
        {body}
      </CardContent>
    </Card>
  );
}
