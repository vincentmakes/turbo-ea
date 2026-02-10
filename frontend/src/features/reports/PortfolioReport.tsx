import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Tooltip from "@mui/material/Tooltip";
import { api } from "@/api/client";

interface PortfolioItem {
  id: string;
  name: string;
  x: string | null;
  y: string | null;
  size: number;
  color: string | null;
}

const FIT_LABELS: Record<string, string> = {
  unreasonable: "Unreasonable",
  inappropriate: "Inappropriate",
  insufficient: "Insufficient",
  adequate: "Adequate",
  appropriate: "Appropriate",
  fullyAppropriate: "Fully Appropriate",
  perfect: "Perfect",
};

const CRIT_COLORS: Record<string, string> = {
  missionCritical: "#d32f2f",
  businessCritical: "#f57c00",
  businessOperational: "#fbc02d",
  administrative: "#9e9e9e",
};

export default function PortfolioReport() {
  const navigate = useNavigate();
  const [items, setItems] = useState<PortfolioItem[]>([]);

  useEffect(() => {
    api.get<{ items: PortfolioItem[] }>("/reports/portfolio").then((d) => setItems(d.items));
  }, []);

  const gridSize = 4;
  const xLabels = ["unreasonable", "insufficient", "appropriate", "perfect"];
  const yLabels = ["inappropriate", "unreasonable", "adequate", "fullyAppropriate"];

  const getCell = (xi: number, yi: number) =>
    items.filter((item) => {
      const xIdx = xLabels.indexOf(item.x || "");
      const yIdx = yLabels.indexOf(item.y || "");
      return xIdx === xi && yIdx === yi;
    });

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
        Application Portfolio
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Functional Fit (X) vs Technical Fit (Y). Bubble color = Business Criticality.
      </Typography>

      <Card>
        <CardContent>
          <Box sx={{ display: "grid", gridTemplateColumns: `80px repeat(${gridSize}, 1fr)`, gap: 0.5 }}>
            <Box /> {/* empty corner */}
            {xLabels.map((x) => (
              <Box key={x} sx={{ textAlign: "center", py: 1 }}>
                <Typography variant="caption" fontWeight={600}>{FIT_LABELS[x] || x}</Typography>
              </Box>
            ))}
            {yLabels.map((y, yi) => (
              <>
                <Box key={`label-${y}`} sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", pr: 1 }}>
                  <Typography variant="caption" fontWeight={600}>{FIT_LABELS[y] || y}</Typography>
                </Box>
                {xLabels.map((x, xi) => {
                  const cellItems = getCell(xi, gridSize - 1 - yi);
                  return (
                    <Box
                      key={`${x}-${y}`}
                      sx={{
                        border: "1px solid #e0e0e0",
                        borderRadius: 1,
                        minHeight: 80,
                        p: 0.5,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 0.5,
                        bgcolor: "#fafafa",
                      }}
                    >
                      {cellItems.map((item) => (
                        <Tooltip key={item.id} title={item.name}>
                          <Box
                            onClick={() => navigate(`/fact-sheets/${item.id}`)}
                            sx={{
                              width: 24 + Math.min((item.size || 0) / 10000, 20),
                              height: 24 + Math.min((item.size || 0) / 10000, 20),
                              borderRadius: "50%",
                              bgcolor: CRIT_COLORS[item.color || ""] || "#1976d2",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              "&:hover": { opacity: 0.8 },
                            }}
                          >
                            <Typography variant="caption" sx={{ color: "#fff", fontSize: 8 }}>
                              {item.name.slice(0, 2)}
                            </Typography>
                          </Box>
                        </Tooltip>
                      ))}
                    </Box>
                  );
                })}
              </>
            ))}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
