import { useState, useEffect, useCallback } from "react";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Alert from "@mui/material/Alert";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { Milestone } from "@/types";

// ── Helpers ─────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isOverdue(dateStr: string): boolean {
  return dateStr < new Date().toISOString().slice(0, 10);
}

// ── Form state type ─────────────────────────────────────────────

interface MilestoneForm {
  name: string;
  target_date: string;
  description: string;
}

const EMPTY_FORM: MilestoneForm = { name: "", target_date: "", description: "" };

// ── Component ───────────────────────────────────────────────────

export default function MilestonesSection({ fsId }: { fsId: string }) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Create / Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MilestoneForm>(EMPTY_FORM);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Milestone | null>(null);

  // ── Load ────────────────────────────────────────────────────

  const load = useCallback(() => {
    api
      .get<Milestone[]>(`/milestones?initiative_id=${fsId}`)
      .then((data) => {
        const sorted = [...data].sort(
          (a, b) => a.target_date.localeCompare(b.target_date)
        );
        setMilestones(sorted);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load milestones"));
  }, [fsId]);

  useEffect(load, [load]);

  // ── Open dialog for create / edit ───────────────────────────

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
    setDialogOpen(true);
  };

  const openEdit = (ms: Milestone) => {
    setEditingId(ms.id);
    setForm({
      name: ms.name,
      target_date: ms.target_date,
      description: ms.description || "",
    });
    setError("");
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
  };

  // ── Save (create or update) ─────────────────────────────────

  const handleSave = async () => {
    if (!form.name.trim() || !form.target_date) return;
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        target_date: form.target_date,
      };
      if (form.description.trim()) {
        payload.description = form.description.trim();
      } else {
        payload.description = null;
      }

      if (editingId) {
        await api.patch(`/milestones/${editingId}`, payload);
      } else {
        payload.initiative_id = fsId;
        await api.post("/milestones", payload);
      }

      closeDialog();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save milestone");
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/milestones/${deleteTarget.id}`);
      setDeleteTarget(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete milestone");
      setDeleteTarget(null);
    }
  };

  // ── Render ──────────────────────────────────────────────────

  return (
    <>
      <Accordion disableGutters>
        <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
            <MaterialSymbol icon="flag" size={20} color="#666" />
            <Typography fontWeight={600}>Milestones</Typography>
            <Chip
              size="small"
              label={milestones.length}
              sx={{ ml: 1, height: 20, fontSize: "0.7rem" }}
            />
          </Box>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              openCreate();
            }}
          >
            <MaterialSymbol icon="add" size={18} />
          </IconButton>
        </AccordionSummary>
        <AccordionDetails>
          {error && !dialogOpen && (
            <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {milestones.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
              No milestones defined. Add milestones to mark key dates.
            </Typography>
          ) : (
            <List disablePadding>
              {milestones.map((ms, idx) => {
                const overdue = isOverdue(ms.target_date);
                return (
                  <ListItem
                    key={ms.id}
                    disableGutters
                    sx={{
                      alignItems: "flex-start",
                      pl: 0,
                      "&:hover .ms-actions": { opacity: 1 },
                    }}
                  >
                    {/* Timeline track */}
                    <Box
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        mr: 2,
                        pt: 0.5,
                        minWidth: 20,
                      }}
                    >
                      {/* Diamond marker */}
                      <Box
                        sx={{
                          width: 12,
                          height: 12,
                          transform: "rotate(45deg)",
                          bgcolor: overdue ? "#f44336" : "#1976d2",
                          borderRadius: "2px",
                          flexShrink: 0,
                        }}
                      />
                      {/* Connector line */}
                      {idx < milestones.length - 1 && (
                        <Box
                          sx={{
                            width: 2,
                            flex: 1,
                            bgcolor: "#e0e0e0",
                            mt: 0.5,
                            minHeight: 24,
                          }}
                        />
                      )}
                    </Box>

                    {/* Content */}
                    <ListItemText
                      primary={
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                          <Typography variant="body1" fontWeight={600}>
                            {ms.name}
                          </Typography>
                          <Tooltip title={overdue ? "Overdue" : "Target date"}>
                            <Chip
                              size="small"
                              label={formatDate(ms.target_date)}
                              icon={<MaterialSymbol icon="event" size={14} />}
                              variant="outlined"
                              sx={{
                                height: 22,
                                fontSize: "0.75rem",
                                ...(overdue && {
                                  borderColor: "#f44336",
                                  color: "#f44336",
                                }),
                              }}
                            />
                          </Tooltip>
                        </Box>
                      }
                      secondary={
                        ms.description ? (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ mt: 0.25, whiteSpace: "pre-wrap" }}
                          >
                            {ms.description}
                          </Typography>
                        ) : undefined
                      }
                    />

                    {/* Action icons (visible on hover) */}
                    <Box
                      className="ms-actions"
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                        opacity: 0,
                        transition: "opacity 0.15s",
                        pt: 0.25,
                      }}
                    >
                      <IconButton size="small" onClick={() => openEdit(ms)}>
                        <MaterialSymbol icon="edit" size={16} />
                      </IconButton>
                      <IconButton size="small" onClick={() => setDeleteTarget(ms)}>
                        <MaterialSymbol icon="delete" size={16} color="#f44336" />
                      </IconButton>
                    </Box>
                  </ListItem>
                );
              })}
            </List>
          )}
        </AccordionDetails>
      </Accordion>

      {/* ── Create / Edit Dialog ── */}
      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? "Edit Milestone" : "Add Milestone"}</DialogTitle>
        <DialogContent>
          {error && dialogOpen && (
            <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2, mt: 1 }}>
              {error}
            </Alert>
          )}
          <TextField
            autoFocus
            label="Name"
            fullWidth
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            size="small"
            sx={{ mt: 1, mb: 2 }}
          />
          <TextField
            label="Target Date"
            type="date"
            fullWidth
            required
            value={form.target_date}
            onChange={(e) => setForm({ ...form, target_date: e.target.value })}
            size="small"
            InputLabelProps={{ shrink: true }}
            sx={{ mb: 2 }}
          />
          <TextField
            label="Description"
            fullWidth
            multiline
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            size="small"
            placeholder="Optional details about this milestone..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!form.name.trim() || !form.target_date || saving}
          >
            {saving ? "Saving..." : editingId ? "Update" : "Add"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Milestone</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Are you sure you want to delete the milestone{" "}
            <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
