import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";

interface Props {
  label: string;
  value: string | number;
  icon?: string;
  iconColor?: string;
  subtitle?: string;
  color?: string;
  /** Makes the tile a drill-down affordance (e.g. opening the cards behind
   * the number). Left unset the tile stays a plain read-only KPI. */
  onClick?: () => void;
}

export default function MetricCard({ label, value, icon, iconColor = "#1976d2", subtitle, color, onClick }: Props) {
  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        p: 2,
        minWidth: 150,
        flex: "1 1 150px",
        borderLeft: color ? `4px solid ${color}` : undefined,
        ...(onClick && {
          cursor: "pointer",
          transition: "background-color 120ms",
          "&:hover": { bgcolor: "action.hover" },
        }),
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        {icon && <MaterialSymbol icon={icon} size={18} color={iconColor} />}
        <Typography variant="caption" color="text.secondary" noWrap>
          {label}
        </Typography>
      </Box>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        {value}
      </Typography>
      {subtitle && (
        <Typography variant="caption" color="text.secondary">
          {subtitle}
        </Typography>
      )}
    </Paper>
  );
}
