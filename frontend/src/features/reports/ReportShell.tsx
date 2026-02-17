import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import MaterialSymbol from "@/components/MaterialSymbol";

interface Props {
  title: string;
  icon: string;
  iconColor?: string;
  /** Filter toolbar rendered below title row */
  toolbar?: ReactNode;
  /** Legend rendered below visualization */
  legend?: ReactNode;
  /** Whether to show chart/table toggle (default true) */
  hasTableToggle?: boolean;
  view?: "chart" | "table";
  onViewChange?: (v: "chart" | "table") => void;
  /** Called when user clicks "Save Report" — parent should open SaveReportDialog */
  onSaveReport?: () => void;
  /** If viewing a saved report, show banner with name and reset option */
  savedReportName?: string;
  onResetSavedReport?: () => void;
  /** The ref to the chart container for thumbnail capture */
  chartRef?: React.RefObject<HTMLDivElement | null>;
  /** Override the max width of the report container (default 1200) */
  maxWidth?: number | string;
  children: ReactNode;
}

export default function ReportShell({
  title,
  icon,
  iconColor = "#1976d2",
  toolbar,
  legend,
  hasTableToggle = true,
  view = "chart",
  onViewChange,
  onSaveReport,
  savedReportName,
  onResetSavedReport,
  chartRef,
  maxWidth = 1200,
  children,
}: Props) {
  const navigate = useNavigate();
  const [exportMenu, setExportMenu] = useState<HTMLElement | null>(null);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setExportMenu(null);
  };

  return (
    <Box sx={{ maxWidth, mx: "auto" }}>
      {/* Saved report banner */}
      {savedReportName && (
        <Alert
          severity="info"
          icon={<MaterialSymbol icon="bookmark" size={20} />}
          sx={{ mb: 2 }}
          action={
            onResetSavedReport && (
              <Button size="small" onClick={onResetSavedReport} sx={{ textTransform: "none" }}>
                Reset to defaults
              </Button>
            )
          }
        >
          Viewing saved report: <strong>{savedReportName}</strong>
        </Alert>
      )}

      {/* Title bar */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1, flexWrap: "wrap" }}>
        <MaterialSymbol icon={icon} size={26} color={iconColor} />
        <Typography variant="h5" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }} noWrap>
          {title}
        </Typography>

        {hasTableToggle && onViewChange && (
          <ToggleButtonGroup
            value={view}
            exclusive
            size="small"
            onChange={(_, v) => v && onViewChange(v)}
          >
            <ToggleButton value="chart">
              <Tooltip title="Chart view">
                <Box sx={{ display: "flex" }}>
                  <MaterialSymbol icon="bar_chart" size={18} />
                </Box>
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="table">
              <Tooltip title="Table view">
                <Box sx={{ display: "flex" }}>
                  <MaterialSymbol icon="table_rows" size={18} />
                </Box>
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
        )}

        {onSaveReport && (
          <Tooltip title="Save report">
            <IconButton size="small" onClick={onSaveReport}>
              <MaterialSymbol icon="bookmark_add" size={20} />
            </IconButton>
          </Tooltip>
        )}

        <Tooltip title="More actions">
          <IconButton size="small" onClick={(e) => setExportMenu(e.currentTarget)}>
            <MaterialSymbol icon="more_vert" size={20} />
          </IconButton>
        </Tooltip>

        <Menu
          anchorEl={exportMenu}
          open={!!exportMenu}
          onClose={() => setExportMenu(null)}
        >
          <MenuItem onClick={handleCopyLink}>
            <ListItemIcon><MaterialSymbol icon="link" size={18} /></ListItemIcon>
            <ListItemText>Copy link</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => {
              setExportMenu(null);
              navigate("/reports/saved");
            }}
          >
            <ListItemIcon><MaterialSymbol icon="bookmarks" size={18} /></ListItemIcon>
            <ListItemText>View all saved reports</ListItemText>
          </MenuItem>
        </Menu>
      </Box>

      {/* Filter toolbar */}
      {toolbar && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2, flexWrap: "wrap" }}>
          {toolbar}
        </Box>
      )}

      {/* Main content */}
      <Box ref={chartRef} sx={{ minHeight: 300 }}>{children}</Box>

      {/* Legend */}
      {legend && (
        <Box sx={{ mt: 2, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
          {legend}
        </Box>
      )}
    </Box>
  );
}
