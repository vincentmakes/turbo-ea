import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import { MaterialSymbol } from "../../components/MaterialSymbol";
import { api } from "../../api/client";
import { useEventStream } from "../../hooks/useEventStream";
import type { FactSheet } from "../../types/fact-sheet";

const LIFECYCLE_COLUMNS = [
  { phase: "plan", label: "Idea / Plan", color: "#9e9e9e" },
  { phase: "phase_in", label: "In Progress", color: "#1565c0" },
  { phase: "active", label: "Active", color: "#2e7d32" },
  { phase: "phase_out", label: "Completed", color: "#ed6c02" },
  { phase: "end_of_life", label: "Retired", color: "#b71c1c" },
] as const;

const INITIATIVE_TYPE_LABELS: Record<string, string> = {
  idea: "Idea",
  project: "Project",
  program: "Program",
  epic: "Epic",
};

function getCurrentPhase(lifecycle: Record<string, string> | null): string {
  if (!lifecycle) return "plan";
  const today = new Date().toISOString().slice(0, 10);
  let current = "plan";
  for (const phase of ["plan", "phase_in", "active", "phase_out", "end_of_life"]) {
    if (lifecycle[phase] && lifecycle[phase] <= today) {
      current = phase;
    }
  }
  return current;
}

export default function InitiativeKanban() {
  const navigate = useNavigate();
  const [initiatives, setInitiatives] = useState<FactSheet[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const loadData = useCallback(async () => {
    try {
      const data = await api.get<{ items: FactSheet[]; total: number }>("/fact-sheets", {
        type: "initiative",
        page_size: "200",
      });
      setInitiatives(data.items);
    } catch {
      // handle
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEventStream(
    useCallback(
      (event) => {
        if (event.entity_type === "fact_sheet") loadData();
      },
      [loadData]
    )
  );

  // Group by lifecycle phase
  const columns = LIFECYCLE_COLUMNS.map((col) => ({
    ...col,
    items: initiatives.filter((i) => getCurrentPhase(i.lifecycle) === col.phase),
  }));

  async function handleCreate() {
    try {
      const fs = await api.post<FactSheet>("/fact-sheets", {
        name: newName,
        type: "initiative",
      });
      setCreateOpen(false);
      setNewName("");
      navigate(`/fact-sheets/${fs.id}`);
    } catch {
      // handle
    }
  }

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Box>
          <Typography variant="h4">Initiative Board</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Initiatives and projects organized by lifecycle phase.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" size={20} />}
          onClick={() => setCreateOpen(true)}
        >
          New Initiative
        </Button>
      </Box>

      {/* Kanban columns */}
      <Box sx={{ display: "flex", gap: 2, overflowX: "auto", pb: 2, minHeight: 400 }}>
        {columns.map((col) => (
          <Box
            key={col.phase}
            sx={{
              flex: "1 1 220px",
              minWidth: 220,
              maxWidth: 320,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Column header */}
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                mb: 1.5,
                px: 1,
              }}
            >
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  backgroundColor: col.color,
                }}
              />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {col.label}
              </Typography>
              <Chip label={col.items.length} size="small" sx={{ ml: "auto", height: 20 }} />
            </Box>

            {/* Cards */}
            <Box
              sx={{
                flex: 1,
                backgroundColor: "#f5f5f5",
                borderRadius: 2,
                p: 1,
                display: "flex",
                flexDirection: "column",
                gap: 1,
                minHeight: 100,
              }}
            >
              {col.items.map((item) => {
                const attrs = item.attributes || {};
                const initType = attrs.initiative_type as string | undefined;
                return (
                  <Card
                    key={item.id}
                    sx={{
                      cursor: "pointer",
                      "&:hover": { boxShadow: 3 },
                      borderLeft: `3px solid ${col.color}`,
                    }}
                    onClick={() => navigate(`/fact-sheets/${item.id}`)}
                  >
                    <CardContent sx={{ py: 1.5, px: 2, "&:last-child": { pb: 1.5 } }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                        {item.name}
                      </Typography>
                      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                        {initType && (
                          <Chip
                            label={INITIATIVE_TYPE_LABELS[initType] || initType}
                            size="small"
                            sx={{ height: 20, fontSize: "0.65rem" }}
                            variant="outlined"
                          />
                        )}
                        {attrs.budget && (
                          <Chip
                            label={`$${Number(attrs.budget).toLocaleString()}`}
                            size="small"
                            sx={{ height: 20, fontSize: "0.65rem" }}
                          />
                        )}
                        {item.completion > 0 && (
                          <Chip
                            label={`${Math.round(item.completion)}%`}
                            size="small"
                            sx={{ height: 20, fontSize: "0.65rem" }}
                            color={item.completion >= 75 ? "success" : "default"}
                          />
                        )}
                      </Box>
                      {item.description && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                          {item.description.length > 80 ? item.description.slice(0, 80) + "..." : item.description}
                        </Typography>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
              {col.items.length === 0 && (
                <Box sx={{ textAlign: "center", py: 4 }}>
                  <Typography variant="caption" color="text.secondary">
                    No initiatives
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        ))}
      </Box>

      {/* Create dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Initiative</DialogTitle>
        <DialogContent>
          <TextField
            label="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            fullWidth
            autoFocus
            margin="dense"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!newName.trim()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
