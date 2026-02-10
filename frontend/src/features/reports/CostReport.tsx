import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import LinearProgress from "@mui/material/LinearProgress";
import { api } from "@/api/client";

interface CostItem {
  id: string;
  name: string;
  cost: number;
}

export default function CostReport() {
  const [data, setData] = useState<{ items: CostItem[]; total: number } | null>(null);

  useEffect(() => {
    api.get<{ items: CostItem[]; total: number }>("/reports/cost?type=Application").then(setData);
  }, []);

  if (!data) return <LinearProgress />;

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>Cost Report</Typography>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" color="text.secondary">Total Annual Cost</Typography>
          <Typography variant="h4" fontWeight={700}>
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(data.total)}
          </Typography>
        </CardContent>
      </Card>

      {data.items.map((item) => (
        <Box key={item.id} sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
          <Typography variant="body2" sx={{ width: 200, flexShrink: 0 }}>{item.name}</Typography>
          <Box sx={{ flex: 1 }}>
            <LinearProgress
              variant="determinate"
              value={data.total ? (item.cost / data.total) * 100 : 0}
              sx={{ height: 20, borderRadius: 1 }}
            />
          </Box>
          <Typography variant="body2" fontWeight={600} sx={{ width: 100, textAlign: "right" }}>
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(item.cost)}
          </Typography>
        </Box>
      ))}

      {data.items.length === 0 && (
        <Typography color="text.secondary">No cost data available. Add totalAnnualCost to your applications.</Typography>
      )}
    </Box>
  );
}
