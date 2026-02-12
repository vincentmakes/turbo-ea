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
}

export default function MetricCard({ label, value, icon, iconColor = "#1976d2", subtitle, color }: Props) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        minWidth: 150,
        flex: "1 1 150px",
        borderLeft: color ? `4px solid ${color}` : undefined,
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
