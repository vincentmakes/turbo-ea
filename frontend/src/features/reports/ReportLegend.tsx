import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

interface LegendItem {
  label: string;
  color: string;
}

interface Props {
  items: LegendItem[];
  title?: string;
}

export default function ReportLegend({ items, title }: Props) {
  if (!items.length) return null;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
      {title && (
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
      )}
      {items.map((item) => (
        <Box key={item.label} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              bgcolor: item.color,
              flexShrink: 0,
            }}
          />
          <Typography variant="caption" color="text.secondary">
            {item.label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
