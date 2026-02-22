import { useState, useCallback, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Autocomplete from "@mui/material/Autocomplete";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { Todo, User } from "@/types";

// ── Tab: Todos ──────────────────────────────────────────────────
function TodosTab({ fsId }: { fsId: string }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api
      .get<Todo[]>(`/cards/${fsId}/todos`)
      .then(setTodos)
      .catch(() => {});
  }, [fsId]);
  useEffect(load, [load]);

  useEffect(() => {
    api.get<User[]>("/users").then(setUsers).catch(() => {});
  }, []);

  const handleAdd = async () => {
    if (!newDesc.trim() || saving) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { description: newDesc };
      if (newAssignee) payload.assigned_to = newAssignee;
      if (newDueDate) payload.due_date = newDueDate;
      await api.post(`/cards/${fsId}/todos`, payload);
      setNewDesc("");
      setNewAssignee("");
      setNewDueDate("");
      setDialogOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (todo: Todo) => {
    const newStatus = todo.status === "open" ? "done" : "open";
    await api.patch(`/todos/${todo.id}`, { status: newStatus });
    setTodos(
      todos.map((t) => (t.id === todo.id ? { ...t, status: newStatus } : t))
    );
  };

  const handleDelete = async (todoId: string) => {
    await api.delete(`/todos/${todoId}`);
    load();
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
        <Button
          variant="contained"
          size="small"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          sx={{ textTransform: "none" }}
          onClick={() => setDialogOpen(true)}
        >
          Add Todo
        </Button>
      </Box>
      <List dense>
        {todos.map((t) => (
          <ListItem
            key={t.id}
            secondaryAction={
              <IconButton size="small" onClick={() => handleDelete(t.id)}>
                <MaterialSymbol icon="close" size={16} />
              </IconButton>
            }
          >
            <IconButton
              size="small"
              onClick={() => toggleStatus(t)}
              sx={{ mr: 1 }}
            >
              <MaterialSymbol
                icon={
                  t.status === "done"
                    ? "check_circle"
                    : "radio_button_unchecked"
                }
                size={20}
                color={t.status === "done" ? "#4caf50" : undefined}
              />
            </IconButton>
            <ListItemText
              primary={t.description}
              secondary={
                <Box component="span" sx={{ display: "flex", gap: 1, mt: 0.25 }}>
                  {t.assignee_name && (
                    <Chip
                      size="small"
                      label={t.assignee_name}
                      icon={<MaterialSymbol icon="person" size={14} />}
                      variant="outlined"
                      sx={{ height: 20, fontSize: "0.7rem" }}
                    />
                  )}
                  {t.due_date && (
                    <Chip
                      size="small"
                      label={t.due_date}
                      icon={<MaterialSymbol icon="event" size={14} />}
                      variant="outlined"
                      sx={{ height: 20, fontSize: "0.7rem" }}
                    />
                  )}
                </Box>
              }
              sx={{
                textDecoration: t.status === "done" ? "line-through" : "none",
              }}
            />
          </ListItem>
        ))}
        {todos.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
            No todos yet.
          </Typography>
        )}
      </List>

      {/* Add Todo Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Todo</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Description"
            fullWidth
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            sx={{ mt: 1, mb: 2 }}
          />
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
            <Autocomplete
              options={users.filter((u) => u.is_active)}
              getOptionLabel={(u) => u.display_name}
              value={users.find((u) => u.id === newAssignee) || null}
              onChange={(_, val) => setNewAssignee(val?.id ?? "")}
              renderInput={(params) => (
                <TextField {...params} label="Assign to" size="small" />
              )}
              size="small"
            />
            <TextField
              label="Due date"
              type="date"
              size="small"
              InputLabelProps={{ shrink: true }}
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!newDesc.trim() || saving} onClick={handleAdd}>
            {saving ? "Adding\u2026" : "Add"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default TodosTab;
