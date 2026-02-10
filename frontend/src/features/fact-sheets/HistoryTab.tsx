import { useEffect, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Chip,
  Typography,
} from "@mui/material";
import { api } from "../../api/client";

interface EventItem {
  id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  created_at: string;
}

interface HistoryTabProps {
  factSheetId: string;
}

export default function HistoryTab({ factSheetId }: HistoryTabProps) {
  const [events, setEvents] = useState<EventItem[]>([]);

  useEffect(() => {
    loadEvents();
  }, [factSheetId]);

  async function loadEvents() {
    try {
      const data = await api.get<{ items: EventItem[] }>("/events", {
        entity_type: "fact_sheet",
        entity_id: factSheetId,
        limit: "50",
      });
      setEvents(data.items);
    } catch {
      // handle
    }
  }

  const eventColor: Record<string, "success" | "info" | "warning" | "error" | "default"> = {
    "fact_sheet.created": "success",
    "fact_sheet.updated": "info",
    "fact_sheet.archived": "warning",
    "fact_sheet.deleted": "error",
  };

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>
        History ({events.length})
      </Typography>

      {events.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 4 }}>
            <Typography color="text.secondary">No history yet.</Typography>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent sx={{ p: 0 }}>
            {events.map((event) => (
              <Box
                key={event.id}
                sx={{
                  px: 2,
                  py: 1.5,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  "&:last-child": { borderBottom: "none" },
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                  <Chip
                    label={event.type.replace("fact_sheet.", "")}
                    size="small"
                    color={eventColor[event.type] || "default"}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                    {new Date(event.created_at).toLocaleString()}
                  </Typography>
                </Box>
                {event.changes && Object.keys(event.changes).length > 0 && (
                  <Box sx={{ pl: 1, mt: 0.5 }}>
                    {Object.entries(event.changes).map(([field, change]) => (
                      <Typography key={field} variant="caption" display="block" color="text.secondary">
                        <strong>{field}</strong>: {String(change.old ?? "empty")} → {String(change.new ?? "empty")}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Box>
            ))}
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
