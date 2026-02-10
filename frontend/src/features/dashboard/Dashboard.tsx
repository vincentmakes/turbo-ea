import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Card,
  CardContent,
  Grid,
  Typography,
  Chip,
} from "@mui/material";
import { MaterialSymbol } from "../../components/MaterialSymbol";
import { api } from "../../api/client";
import { useEventStream } from "../../hooks/useEventStream";
import {
  FactSheetType,
  FACT_SHEET_TYPE_LABELS,
  FACT_SHEET_TYPE_ICONS,
} from "../../types/fact-sheet";

interface TypeCount {
  type: FactSheetType;
  count: number;
}

interface RecentEvent {
  id: string;
  type: string;
  entity_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<TypeCount[]>([]);
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);

  const factSheetTypes: FactSheetType[] = [
    "application",
    "business_capability",
    "it_component",
    "organization",
    "provider",
    "interface",
    "initiative",
  ];

  useEffect(() => {
    loadCounts();
    loadRecentEvents();
  }, []);

  useEventStream((event) => {
    setRecentEvents((prev) => [event as RecentEvent, ...prev.slice(0, 9)]);
    loadCounts();
  });

  async function loadCounts() {
    const results: TypeCount[] = [];
    for (const type of factSheetTypes) {
      try {
        const data = await api.get<{ total: number }>("/fact-sheets", {
          type,
          page_size: "1",
        });
        results.push({ type, count: data.total });
      } catch {
        results.push({ type, count: 0 });
      }
    }
    setCounts(results);
  }

  async function loadRecentEvents() {
    try {
      const data = await api.get<{ items: RecentEvent[] }>("/events", {
        limit: "10",
      });
      setRecentEvents(data.items);
    } catch {
      // events may be empty on first load
    }
  }

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Dashboard
      </Typography>

      <Grid container spacing={2} sx={{ mb: 4 }}>
        {counts.map(({ type, count }) => (
          <Grid key={type} item xs={12} sm={6} md={3}>
            <Card
              sx={{ cursor: "pointer", "&:hover": { boxShadow: 4 } }}
              onClick={() => navigate(`/fact-sheets?type=${type}`)}
            >
              <CardContent sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <MaterialSymbol
                  icon={FACT_SHEET_TYPE_ICONS[type]}
                  size={36}
                />
                <Box>
                  <Typography variant="h5">{count}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {FACT_SHEET_TYPE_LABELS[type]}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Typography variant="h5" sx={{ mb: 2 }}>
        Recent Activity
      </Typography>
      <Card>
        <CardContent>
          {recentEvents.length === 0 ? (
            <Typography color="text.secondary">
              No recent activity. Create your first fact sheet to get started.
            </Typography>
          ) : (
            recentEvents.map((event) => (
              <Box
                key={event.id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  py: 1,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  "&:last-child": { borderBottom: "none" },
                }}
              >
                <Chip
                  label={event.type.replace(".", " ")}
                  size="small"
                  color={event.type.includes("created") ? "success" : "default"}
                />
                <Typography variant="body2">
                  {(event.payload?.name as string) || event.entity_type}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                  {new Date(event.created_at).toLocaleString()}
                </Typography>
              </Box>
            ))
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
