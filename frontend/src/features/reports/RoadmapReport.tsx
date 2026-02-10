import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";

interface RoadmapItem {
  id: string;
  name: string;
  type: string;
  lifecycle: Record<string, string>;
}

const PHASE_COLORS: Record<string, string> = {
  plan: "#9e9e9e",
  phaseIn: "#2196f3",
  active: "#4caf50",
  phaseOut: "#ff9800",
  endOfLife: "#f44336",
};

export default function RoadmapReport() {
  const navigate = useNavigate();
  const { types } = useMetamodel();
  const [type, setType] = useState("");
  const [items, setItems] = useState<RoadmapItem[]>([]);

  useEffect(() => {
    const params = type ? `?type=${type}` : "";
    api.get<{ items: RoadmapItem[] }>(`/reports/roadmap${params}`).then((d) => setItems(d.items));
  }, [type]);

  // Calculate time range
  const allDates = items.flatMap((i) => Object.values(i.lifecycle).filter(Boolean)).sort();
  const minDate = allDates[0] || new Date().toISOString().slice(0, 10);
  const maxDate = allDates[allDates.length - 1] || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  const rangeMs = new Date(maxDate).getTime() - new Date(minDate).getTime() || 1;

  const toPercent = (d: string) => {
    return ((new Date(d).getTime() - new Date(minDate).getTime()) / rangeMs) * 100;
  };

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>Roadmap</Typography>
      <FormControl size="small" sx={{ minWidth: 180, mb: 3 }}>
        <InputLabel>Type</InputLabel>
        <Select value={type} label="Type" onChange={(e) => setType(e.target.value)}>
          <MenuItem value="">All Types</MenuItem>
          {types.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
        </Select>
      </FormControl>

      <Box sx={{ position: "relative", minHeight: items.length * 40 + 40 }}>
        {items.map((item) => {
          const phases = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"];
          const segments: { phase: string; start: number; end: number }[] = [];
          for (let i = 0; i < phases.length; i++) {
            const start = item.lifecycle[phases[i]];
            if (!start) continue;
            const endPhase = phases.slice(i + 1).find((p) => item.lifecycle[p]);
            const end = endPhase ? item.lifecycle[endPhase] : maxDate;
            segments.push({ phase: phases[i], start: toPercent(start), end: toPercent(end) });
          }

          return (
            <Box key={item.id} sx={{ display: "flex", alignItems: "center", height: 36, mb: 0.5 }}>
              <Typography
                variant="body2"
                sx={{ width: 200, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer", "&:hover": { color: "#1976d2" } }}
                onClick={() => navigate(`/fact-sheets/${item.id}`)}
              >
                {item.name}
              </Typography>
              <Box sx={{ flex: 1, position: "relative", height: 20, bgcolor: "#f0f0f0", borderRadius: 1 }}>
                {segments.map((seg) => (
                  <Tooltip key={seg.phase} title={seg.phase}>
                    <Box
                      sx={{
                        position: "absolute",
                        left: `${seg.start}%`,
                        width: `${Math.max(seg.end - seg.start, 1)}%`,
                        height: "100%",
                        bgcolor: PHASE_COLORS[seg.phase] || "#999",
                        borderRadius: 1,
                      }}
                    />
                  </Tooltip>
                ))}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
