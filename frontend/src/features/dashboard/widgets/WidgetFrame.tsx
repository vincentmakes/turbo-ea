/**
 * The chrome around one dashboard widget: the card and title (unless the
 * widget brings its own surface), the drag handle and the configure / remove
 * buttons in customize mode, and an error boundary so one broken widget never
 * takes the dashboard down. The grid gives the frame a fixed height; the body
 * fills what the header leaves (`flex: 1, minHeight: 0`) so charts size to it
 * and long lists scroll inside it.
 */
import { createContext, useContext, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";
import ErrorBoundary from "@/components/ErrorBoundary";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { DashboardWidget } from "@/types";
import { WIDGET_META, isKnownWidgetType, widgetTitle, type WidgetChrome } from "./widgetMeta";

/** The class react-grid-layout's `dragConfig.handle` selects. */
export const DRAG_HANDLE_CLASS = "dashboard-widget-drag-handle";

/**
 * Whether the enclosing frame is in customize mode. A widget that brings its
 * own surface (a KPI tile) loses the toolbar's row of height while editing and
 * reads this to draw itself compactly instead of clipping its last line.
 */
const WidgetEditingContext = createContext(false);

export function useWidgetEditing(): boolean {
  return useContext(WidgetEditingContext);
}

interface Props {
  widget: DashboardWidget;
  editing: boolean;
  onConfigure?: () => void;
  onRemove?: () => void;
  children: ReactNode;
}

const editOutline = (theme: Theme) => `1px dashed ${theme.palette.primary.main}`;

export default function WidgetFrame({ widget, editing, onConfigure, onRemove, children }: Props) {
  const { t } = useTranslation("common");
  const chrome: WidgetChrome = isKnownWidgetType(widget.type) ? WIDGET_META[widget.type].chrome : "titled";
  const title = widgetTitle(widget, t);

  const showHeader = chrome === "titled" || editing;
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

  const header = showHeader ? (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: chrome === "none" ? 0.5 : 1, minHeight: 28 }}>
      {editing ? (
        <Box
          className={DRAG_HANDLE_CLASS}
          data-testid="widget-drag-handle"
          title={t("dashboard.widgets.dragToMove")}
          sx={{ display: "flex", alignItems: "center", gap: 0.5, flex: 1, minWidth: 0, cursor: "grab" }}
        >
          <MaterialSymbol icon="drag_indicator" size={18} />
          {titleText}
        </Box>
      ) : (
        titleText
      )}
      {editing && onConfigure && (
        <Tooltip title={t("dashboard.widgets.configure")}>
          <IconButton size="small" aria-label={t("dashboard.widgets.configure")} onClick={onConfigure}>
            <MaterialSymbol icon="tune" size={18} />
          </IconButton>
        </Tooltip>
      )}
      {editing && onRemove && (
        <Tooltip title={t("dashboard.widgets.remove")}>
          <IconButton size="small" aria-label={t("dashboard.widgets.remove")} onClick={onRemove}>
            <MaterialSymbol icon="close" size={18} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  ) : null;

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
      <ErrorBoundary inline label={title}>
        <WidgetEditingContext.Provider value={editing}>{children}</WidgetEditingContext.Provider>
      </ErrorBoundary>
    </Box>
  );

  if (chrome === "none") {
    return (
      <Box
        data-widget-id={widget.id}
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          borderRadius: 1,
          ...(editing && { outline: editOutline, outlineOffset: 2 }),
        }}
      >
        {header}
        {body}
      </Box>
    );
  }

  return (
    <Card
      data-widget-id={widget.id}
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        ...(editing && { outline: editOutline, outlineOffset: 2 }),
      }}
    >
      <CardContent
        sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", "&:last-child": { pb: 2 } }}
      >
        {header}
        {body}
      </CardContent>
    </Card>
  );
}
