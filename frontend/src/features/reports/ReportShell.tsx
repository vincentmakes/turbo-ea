import { type ReactNode, useState } from "react";
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
  children,
}: Props) {
  const [exportMenu, setExportMenu] = useState<HTMLElement | null>(null);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setExportMenu(null);
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto" }}>
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

        <Tooltip title="Export">
          <IconButton size="small" onClick={(e) => setExportMenu(e.currentTarget)}>
            <MaterialSymbol icon="download" size={20} />
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
        </Menu>
      </Box>

      {/* Filter toolbar */}
      {toolbar && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2, flexWrap: "wrap" }}>
          {toolbar}
        </Box>
      )}

      {/* Main content */}
      <Box sx={{ minHeight: 300 }}>{children}</Box>

      {/* Legend */}
      {legend && (
        <Box sx={{ mt: 2, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
          {legend}
        </Box>
      )}
    </Box>
  );
}
