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
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { RecurrenceUnit, Todo, User } from "@/types";
import { defaultLeadTimeDays } from "@/lib/recurrence/leadTime";
import { formatRecurrence, RECURRENCE_UNIT_OPTIONS } from "@/lib/recurrence/recurrenceLabel";

// ── Tab: Todos ──────────────────────────────────────────────────
function TodosTab({ fsId }: { fsId: string }) {
  const { t } = useTranslation(["cards", "common"]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Recurrence state for the Add dialog.
  const [recurring, setRecurring] = useState(false);
  const [recurrenceUnit, setRecurrenceUnit] = useState<RecurrenceUnit>("months");
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [leadTimeDays, setLeadTimeDays] = useState(defaultLeadTimeDays("months", 1));
  const [leadTimeDirty, setLeadTimeDirty] = useState(false);

  const load = useCallback(() => {
    api
      .get<Todo[]>(`/cards/${fsId}/todos`)
      .then(setTodos)
      .catch(() => {});
  }, [fsId]);
  useEffect(load, [load]);

  useEffect(() => {
    api
      .get<User[]>("/users")
      .then(setUsers)
      .catch(() => {});
  }, []);

  // Keep the lead-time suggestion in sync with the recurrence rule until the
  // user explicitly edits it (mirrors MitigationTaskDialog).
  useEffect(() => {
    if (!recurring || leadTimeDirty) return;
    setLeadTimeDays(defaultLeadTimeDays(recurrenceUnit, recurrenceInterval));
  }, [recurring, recurrenceUnit, recurrenceInterval, leadTimeDirty]);

  const resetDialog = () => {
    setNewDesc("");
    setNewAssignee("");
    setNewDueDate("");
    setRecurring(false);
    setRecurrenceUnit("months");
    setRecurrenceInterval(1);
    setLeadTimeDirty(false);
    setLeadTimeDays(defaultLeadTimeDays("months", 1));
  };

  const handleAdd = async () => {
    if (!newDesc.trim() || saving) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { description: newDesc };
      if (newAssignee) payload.assigned_to = newAssignee;
      if (newDueDate) payload.due_date = newDueDate;
      if (recurring) {
        payload.recurrence_unit = recurrenceUnit;
        payload.recurrence_interval = recurrenceInterval;
        payload.lead_time_days = leadTimeDays;
      }
      await api.post(`/cards/${fsId}/todos`, payload);
      resetDialog();
      setDialogOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (todo: Todo) => {
    const newStatus = todo.status === "open" ? "done" : "open";
    await api.patch(`/todos/${todo.id}`, { status: newStatus });
    // Reload so a completed recurring todo's freshly-spawned next occurrence
    // shows up in the list.
    load();
  };

  const promote = async (todo: Todo) => {
    await api.post(`/todos/${todo.id}/promote`, {});
    load();
  };

  const handleDelete = async (todoId: string) => {
    await api.delete(`/todos/${todoId}`);
    load();
  };

  const isRecurring = (todo: Todo) => !!todo.recurrence_unit && todo.recurrence_unit !== "none";

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
          {t("todos.add")}
        </Button>
      </Box>
      <List dense>
        {todos.map((td) => {
          const scheduled = td.status === "scheduled";
          return (
            <ListItem
              key={td.id}
              secondaryAction={
                <IconButton size="small" onClick={() => handleDelete(td.id)}>
                  <MaterialSymbol icon="close" size={16} />
                </IconButton>
              }
            >
              <IconButton
                size="small"
                onClick={() => (scheduled ? promote(td) : toggleStatus(td))}
                sx={{ mr: 1 }}
                title={scheduled ? t("todos.activateNow") : undefined}
              >
                <MaterialSymbol
                  icon={
                    scheduled
                      ? "event_upcoming"
                      : td.status === "done"
                        ? "check_circle"
                        : "radio_button_unchecked"
                  }
                  size={20}
                  color={td.status === "done" ? "#4caf50" : undefined}
                />
              </IconButton>
              <ListItemText
                primary={td.description}
                secondary={
                  <Box component="span" sx={{ display: "flex", gap: 1, mt: 0.25, flexWrap: "wrap" }}>
                    {td.assignee_name && (
                      <Chip
                        size="small"
                        label={td.assignee_name}
                        icon={<MaterialSymbol icon="person" size={14} />}
                        variant="outlined"
                        sx={{ height: 20, fontSize: "0.7rem" }}
                      />
                    )}
                    {td.due_date && (
                      <Chip
                        size="small"
                        label={td.due_date}
                        icon={<MaterialSymbol icon="event" size={14} />}
                        variant="outlined"
                        sx={{ height: 20, fontSize: "0.7rem" }}
                      />
                    )}
                    {isRecurring(td) && (
                      <Chip
                        size="small"
                        label={formatRecurrence(
                          td.recurrence_unit as RecurrenceUnit,
                          td.recurrence_interval ?? 1,
                          t,
                          "todos.recurrence",
                        )}
                        icon={<MaterialSymbol icon="repeat" size={14} />}
                        variant="outlined"
                        sx={{ height: 20, fontSize: "0.7rem" }}
                      />
                    )}
                    {scheduled && (
                      <Chip
                        size="small"
                        label={t("todos.scheduled")}
                        icon={<MaterialSymbol icon="schedule" size={14} />}
                        variant="outlined"
                        color="info"
                        sx={{ height: 20, fontSize: "0.7rem" }}
                      />
                    )}
                  </Box>
                }
                sx={{
                  textDecoration: td.status === "done" ? "line-through" : "none",
                }}
              />
            </ListItem>
          );
        })}
        {todos.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
            {t("todos.empty")}
          </Typography>
        )}
      </List>

      {/* Add Todo Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => {
          resetDialog();
          setDialogOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t("todos.add")}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label={t("common:labels.description")}
            fullWidth
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
          />
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
            <Autocomplete
              options={users.filter((u) => u.is_active)}
              getOptionLabel={(u) => u.display_name}
              value={users.find((u) => u.id === newAssignee) || null}
              onChange={(_, val) => setNewAssignee(val?.id ?? "")}
              renderInput={(params) => (
                <TextField {...params} label={t("todos.assignTo")} size="small" />
              )}
              size="small"
            />
            <TextField
              label={t("todos.dueDate")}
              type="date"
              size="small"
              InputLabelProps={{ shrink: true }}
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
            />
          </Box>

          <FormControlLabel
            sx={{ mt: 1.5 }}
            control={
              <Switch checked={recurring} onChange={(_, checked) => setRecurring(checked)} />
            }
            label={t("todos.recurring")}
          />
          {recurring && (
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box component="span">{t("todos.recurrenceEvery")}</Box>
                <TextField
                  size="small"
                  type="number"
                  value={recurrenceInterval}
                  onChange={(e) =>
                    setRecurrenceInterval(Math.max(1, parseInt(e.target.value, 10) || 1))
                  }
                  inputProps={{ min: 1, max: 365, style: { width: 64 } }}
                />
                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <InputLabel>{t("todos.recurrenceUnit")}</InputLabel>
                  <Select
                    label={t("todos.recurrenceUnit")}
                    value={recurrenceUnit}
                    onChange={(e) => setRecurrenceUnit(e.target.value as RecurrenceUnit)}
                  >
                    {RECURRENCE_UNIT_OPTIONS.map((u) => (
                      <MenuItem key={u} value={u}>
                        {t(`todos.unit.${u}`)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
              <TextField
                size="small"
                type="number"
                label={t("todos.leadTime")}
                helperText={t("todos.leadTimeHelp")}
                value={leadTimeDays}
                onChange={(e) => {
                  setLeadTimeDirty(true);
                  const v = parseInt(e.target.value, 10);
                  setLeadTimeDays(Number.isNaN(v) ? 0 : Math.max(0, v));
                }}
                inputProps={{ min: 0, max: 3650 }}
                sx={{ maxWidth: 260 }}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              resetDialog();
              setDialogOpen(false);
            }}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button variant="contained" disabled={!newDesc.trim() || saving} onClick={handleAdd}>
            {saving ? t("todos.adding") : t("common:actions.add")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default TodosTab;
