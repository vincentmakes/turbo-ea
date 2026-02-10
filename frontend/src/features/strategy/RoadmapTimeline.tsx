import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Card,
  CardContent,
  Chip,
  Tooltip,
  Typography,
} from "@mui/material";
import { MaterialSymbol } from "../../components/MaterialSymbol";
import { api } from "../../api/client";
import { FACT_SHEET_TYPE_ICONS, FACT_SHEET_TYPE_LABELS } from "../../types/fact-sheet";

interface RoadmapEvent {
  id: string;
  name: string;
  fs_type: string;
  phase: string;
  date: string;
  fact_sheet_id: string;
}

const PHASE_COLORS: Record<string, string> = {
  plan: "#9e9e9e",
  phase_in: "#1565c0",
  active: "#2e7d32",
  phase_out: "#ed6c02",
  end_of_life: "#d32f2f",
};

const PHASE_LABELS: Record<string, string> = {
  plan: "Plan",
  phase_in: "Phase In",
  active: "Active",
  phase_out: "Phase Out",
  end_of_life: "End of Life",
};

export default function RoadmapTimeline() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<RoadmapEvent[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const data = await api.get<RoadmapEvent[]>("/strategy/roadmap");
      setEvents(data);
    } catch {
      // handle
    }
  }

  // Group by year-month
  const grouped = useMemo(() => {
    const map = new Map<string, RoadmapEvent[]>();
    for (const event of events) {
      const key = event.date.slice(0, 7); // YYYY-MM
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(event);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [events]);

  const today = new Date().toISOString().slice(0, 7);

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4">Roadmap</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Lifecycle events timeline across all fact sheets.
        </Typography>
      </Box>

      {/* Phase legend */}
      <Box sx={{ display: "flex", gap: 1, mb: 3, flexWrap: "wrap" }}>
        {Object.entries(PHASE_LABELS).map(([phase, label]) => (
          <Chip
            key={phase}
            label={label}
            size="small"
            sx={{
              backgroundColor: `${PHASE_COLORS[phase]}18`,
              color: PHASE_COLORS[phase],
              fontWeight: 600,
            }}
          />
        ))}
      </Box>

      {events.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <MaterialSymbol icon="calendar_month" size={48} />
            <Typography variant="h6" sx={{ mt: 2 }}>No roadmap events</Typography>
            <Typography color="text.secondary">
              Set lifecycle dates on fact sheets to build the roadmap.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ position: "relative", pl: 4 }}>
          {/* Timeline line */}
          <Box
            sx={{
              position: "absolute",
              left: 16,
              top: 0,
              bottom: 0,
              width: 2,
              backgroundColor: "divider",
            }}
          />

          {grouped.map(([yearMonth, monthEvents]) => {
            const [year, month] = yearMonth.split("-");
            const monthLabel = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString("en", {
              year: "numeric",
              month: "long",
            });
            const isPast = yearMonth < today;
            const isCurrent = yearMonth === today;

            return (
              <Box key={yearMonth} sx={{ mb: 3, position: "relative" }}>
                {/* Timeline dot */}
                <Box
                  sx={{
                    position: "absolute",
                    left: -24,
                    top: 4,
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    backgroundColor: isCurrent ? "primary.main" : isPast ? "#bdbdbd" : "primary.light",
                    border: "2px solid white",
                    zIndex: 1,
                  }}
                />

                {/* Month label */}
                <Typography
                  variant="subtitle2"
                  sx={{
                    fontWeight: 700,
                    color: isCurrent ? "primary.main" : isPast ? "text.secondary" : "text.primary",
                    mb: 1,
                  }}
                >
                  {monthLabel}
                  {isCurrent && (
                    <Chip label="NOW" size="small" color="primary" sx={{ ml: 1, height: 20, fontSize: "0.65rem" }} />
                  )}
                </Typography>

                {/* Events */}
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  {monthEvents.map((event) => (
                    <Tooltip
                      key={event.id}
                      title={`${event.name} — ${PHASE_LABELS[event.phase] || event.phase} on ${event.date}`}
                    >
                      <Chip
                        icon={
                          <MaterialSymbol
                            icon={FACT_SHEET_TYPE_ICONS[event.fs_type as keyof typeof FACT_SHEET_TYPE_ICONS] || "circle"}
                            size={16}
                          />
                        }
                        label={`${event.name} → ${PHASE_LABELS[event.phase] || event.phase}`}
                        size="small"
                        onClick={() => navigate(`/fact-sheets/${event.fact_sheet_id}`)}
                        sx={{
                          cursor: "pointer",
                          borderColor: PHASE_COLORS[event.phase],
                          color: PHASE_COLORS[event.phase],
                          opacity: isPast ? 0.6 : 1,
                        }}
                        variant="outlined"
                      />
                    </Tooltip>
                  ))}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
