import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { PHASE_LABELS } from "@/features/cards/sections/cardDetailUtils";
import type { EventEntry } from "@/types";

// ── Tab: History ────────────────────────────────────────────────
const EVENT_META: Record<string, { label: string; icon: string; color: string }> = {
  "card.created": { label: "Created", icon: "add_circle", color: "#4caf50" },
  "card.updated": { label: "Updated", icon: "edit", color: "#1976d2" },
  "card.archived": { label: "Archived", icon: "archive", color: "#ff9800" },
  "card.restored": { label: "Restored", icon: "restore", color: "#4caf50" },
  "card.deleted": { label: "Deleted", icon: "delete", color: "#f44336" },
  "card.approval_status.approve": { label: "Approved", icon: "verified", color: "#4caf50" },
  "card.approval_status.reject": { label: "Rejected", icon: "cancel", color: "#f44336" },
  "card.approval_status.reset": { label: "Reset to Draft", icon: "restart_alt", color: "#9e9e9e" },
};

const FIELD_LABELS: Record<string, string> = {
  name: "Name", description: "Description", subtype: "Subtype",
  lifecycle: "Lifecycle", parent_id: "Parent", alias: "Alias",
  external_id: "External ID", approval_status: "Approval Status",
};

function fmtVal(val: unknown): string {
  if (val == null || val === "") return "\u2014";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) return val.map(fmtVal).join(", ");
  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>).filter(([, v]) => v != null && v !== "");
    if (entries.length === 0) return "\u2014";
    return entries.map(([k, v]) => `${PHASE_LABELS[k] || k}: ${v}`).join(", ");
  }
  return String(val);
}

interface ChangeRow { field: string; oldVal: string; newVal: string }

function parseChanges(changes: Record<string, unknown>): ChangeRow[] {
  const rows: ChangeRow[] = [];
  for (const [field, change] of Object.entries(changes)) {
    if (!change || typeof change !== "object" || !("old" in change) || !("new" in change)) {
      // Legacy stringified format -- skip non-parsable
      continue;
    }
    const c = change as { old: unknown; new: unknown };
    if (field === "attributes" && typeof c.old === "object" && typeof c.new === "object") {
      const oldA = (c.old || {}) as Record<string, unknown>;
      const newA = (c.new || {}) as Record<string, unknown>;
      for (const key of new Set([...Object.keys(oldA), ...Object.keys(newA)])) {
        if (JSON.stringify(oldA[key]) !== JSON.stringify(newA[key])) {
          rows.push({ field: key, oldVal: fmtVal(oldA[key]), newVal: fmtVal(newA[key]) });
        }
      }
    } else if (field === "lifecycle" && typeof c.old === "object" && typeof c.new === "object") {
      const oldL = (c.old || {}) as Record<string, unknown>;
      const newL = (c.new || {}) as Record<string, unknown>;
      for (const key of new Set([...Object.keys(oldL), ...Object.keys(newL)])) {
        if (oldL[key] !== newL[key]) {
          rows.push({ field: PHASE_LABELS[key] || key, oldVal: fmtVal(oldL[key]), newVal: fmtVal(newL[key]) });
        }
      }
    } else {
      rows.push({ field: FIELD_LABELS[field] || field, oldVal: fmtVal(c.old), newVal: fmtVal(c.new) });
    }
  }
  return rows;
}

function HistoryTab({ fsId }: { fsId: string }) {
  const [events, setEvents] = useState<EventEntry[]>([]);
  useEffect(() => {
    api.get<EventEntry[]>(`/cards/${fsId}/history`).then(setEvents).catch(() => {});
  }, [fsId]);

  if (events.length === 0) {
    return <Typography color="text.secondary" variant="body2">No history yet.</Typography>;
  }

  return (
    <Box>
      {events.map((e) => {
        const meta = EVENT_META[e.event_type] || { label: e.event_type, icon: "info", color: "#9e9e9e" };
        const changes = e.data?.changes as Record<string, unknown> | undefined;
        const rows = changes ? parseChanges(changes) : [];

        return (
          <Box key={e.id} sx={{ display: "flex", gap: 1.5, mb: 2 }}>
            {/* Timeline dot */}
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", pt: 0.25 }}>
              <Box sx={{ width: 28, height: 28, borderRadius: "50%", bgcolor: meta.color + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <MaterialSymbol icon={meta.icon} size={16} color={meta.color} />
              </Box>
              <Box sx={{ width: 2, flex: 1, bgcolor: "divider", mt: 0.5 }} />
            </Box>

            {/* Content */}
            <Box sx={{ flex: 1, pb: 1, minWidth: 0 }}>
              {/* Header row */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Typography variant="body2" fontWeight={600}>{meta.label}</Typography>
                <Typography variant="body2" color="text.secondary">
                  by {e.user_display_name || "System"}
                </Typography>
                <Typography variant="caption" color="text.disabled" sx={{ ml: "auto", whiteSpace: "nowrap" }}>
                  {e.created_at ? new Date(e.created_at).toLocaleString() : ""}
                </Typography>
              </Box>

              {/* Change rows */}
              {rows.length > 0 && (
                <Box sx={{ mt: 0.75, display: "flex", flexDirection: "column", gap: 0.25 }}>
                  {rows.map((row, i) => (
                    <Box
                      key={i}
                      sx={{
                        display: "flex", alignItems: "center", gap: 1,
                        bgcolor: "action.hover", borderRadius: 1, px: 1, py: 0.5,
                      }}
                    >
                      <Typography variant="caption" fontWeight={600} sx={{ minWidth: 90, color: "text.secondary", flexShrink: 0 }}>
                        {row.field}
                      </Typography>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0, flexWrap: "wrap" }}>
                        {row.oldVal !== "\u2014" && (
                          <Typography
                            variant="caption"
                            sx={{
                              color: "#c62828", bgcolor: "#ffebee", borderRadius: 0.5, px: 0.75, py: 0.125,
                              textDecoration: "line-through", maxWidth: 250, overflow: "hidden",
                              textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}
                          >
                            {row.oldVal}
                          </Typography>
                        )}
                        <MaterialSymbol icon="arrow_right_alt" size={16} color="#9e9e9e" />
                        <Typography
                          variant="caption"
                          sx={{
                            color: "#1b5e20", bgcolor: "#e8f5e9", borderRadius: 0.5, px: 0.75, py: 0.125,
                            fontWeight: 500, maxWidth: 250, overflow: "hidden",
                            textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}
                        >
                          {row.newVal}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export default HistoryTab;
