/**
 * Create / edit dialog for a single mitigation task.
 *
 * Inline-rendered from the Risk Detail page (which is itself navigated
 * to from the register), so we set ``disableRestoreFocus`` to keep MUI
 * from logging aria-hidden focus warnings when the outer page rerenders.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import type { MitigationTask, RecurrenceUnit } from "@/types";
import { defaultLeadTimeDays } from "@/lib/recurrence/leadTime";
import { RECURRENCE_UNIT_OPTIONS } from "@/lib/recurrence/recurrenceLabel";

interface UserOption {
  id: string;
  email: string;
  display_name: string;
}

export interface MitigationTaskDialogPayload {
  title: string;
  description: string | null;
  owner_id: string | null;
  due_date: string | null;
  recurrence_unit: RecurrenceUnit;
  recurrence_interval: number;
  /** Days before due_date that the cycle opens (and the Todo lands).
   *  Server picks a smart default per unit when omitted on create. */
  lead_time_days: number;
}

interface Props {
  open: boolean;
  task: MitigationTask | null;
  users: UserOption[];
  onClose: () => void;
  onSubmit: (payload: MitigationTaskDialogPayload) => Promise<void>;
}

export default function MitigationTaskDialog({
  open,
  task,
  users,
  onClose,
  onSubmit,
}: Props) {
  const { t } = useTranslation("grc");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string>("");
  const [recurring, setRecurring] = useState(false);
  const [recurrenceUnit, setRecurrenceUnit] = useState<RecurrenceUnit>("months");
  const [recurrenceInterval, setRecurrenceInterval] = useState(6);
  const [leadTimeDays, setLeadTimeDays] = useState(0);
  // Tracks whether the user has manually edited the lead time. When
  // false, the field auto-updates as the user changes recurrence
  // unit/interval; once they touch it explicitly, we stop overwriting.
  const [leadTimeDirty, setLeadTimeDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Sync local form state when the dialog opens for a different task.
  useEffect(() => {
    if (!open) return;
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setOwnerId(task.owner_id);
      // For edit mode, derive a usable default due_date from the latest
      // active occurrence (scheduled or open) — terminal occurrences
      // are immutable per the audit contract.
      const liveOcc = task.occurrences.find(
        (o) => o.status === "open" || o.status === "scheduled",
      );
      setDueDate(liveOcc?.due_date ?? "");
      const isRec = task.recurrence_unit !== "none";
      setRecurring(isRec);
      setRecurrenceUnit(isRec ? task.recurrence_unit : "months");
      setRecurrenceInterval(isRec ? task.recurrence_interval : 6);
      // Persisted lead-time lands in the field as-is; treat it as
      // already user-customised so toggling unit/interval doesn't blow
      // away their stored value.
      setLeadTimeDays(task.lead_time_days);
      setLeadTimeDirty(true);
    } else {
      setTitle("");
      setDescription("");
      setOwnerId(null);
      setDueDate("");
      setRecurring(false);
      setRecurrenceUnit("months");
      setRecurrenceInterval(6);
      // Start with the smart default for a "months / every 6" task —
      // matches the unit/interval defaults above so the displayed hint
      // is internally consistent at first paint.
      setLeadTimeDays(defaultLeadTimeDays("months", 6));
      setLeadTimeDirty(false);
    }
  }, [open, task]);

  // Re-sync the lead-time suggestion when the user changes unit /
  // interval — but only while they haven't touched the field themselves.
  // This gives the helpful "monthly tasks ship 7 day lead" hint without
  // overriding a user who explicitly set 30.
  useEffect(() => {
    if (!recurring) return;
    if (leadTimeDirty) return;
    setLeadTimeDays(defaultLeadTimeDays(recurrenceUnit, recurrenceInterval));
  }, [recurring, recurrenceUnit, recurrenceInterval, leadTimeDirty]);

  const ownerValue = useMemo(
    () => users.find((u) => u.id === ownerId) ?? null,
    [users, ownerId],
  );

  const canSubmit = title.trim().length > 0 && recurrenceInterval >= 1;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        owner_id: ownerId,
        due_date: dueDate || null,
        recurrence_unit: recurring ? recurrenceUnit : "none",
        recurrence_interval: recurring ? recurrenceInterval : 1,
        // One-shot tasks have no roll-forward to gate; send 0 so the
        // backend doesn't apply the per-unit default to a non-recurring
        // task. Recurring tasks send whatever the user (or the smart
        // default suggestion) picked.
        lead_time_days: recurring ? Math.max(0, leadTimeDays) : 0,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      disableRestoreFocus
    >
      <DialogTitle>
        {task ? t("risks.tasks.dialog.editTitle") : t("risks.tasks.dialog.createTitle")}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label={t("risks.tasks.field.title")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={submitting}
            required
            fullWidth
            inputProps={{ maxLength: 500 }}
            autoFocus
          />
          <TextField
            label={t("risks.tasks.field.description")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={submitting}
            multiline
            minRows={3}
            fullWidth
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <Autocomplete
              size="small"
              options={users}
              getOptionLabel={(u) => `${u.display_name} (${u.email})`}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              value={ownerValue}
              onChange={(_, v) => setOwnerId(v?.id ?? null)}
              disabled={submitting}
              renderInput={(params) => (
                <TextField {...params} label={t("risks.tasks.field.owner")} />
              )}
              sx={{ flex: 1 }}
            />
            <TextField
              label={t("risks.tasks.field.dueDate")}
              type="date"
              size="small"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={submitting}
              InputLabelProps={{ shrink: true }}
              sx={{ flex: 1 }}
            />
          </Stack>

          <FormControlLabel
            control={
              <Switch
                checked={recurring}
                onChange={(_, checked) => setRecurring(checked)}
                disabled={submitting}
              />
            }
            label={t("risks.tasks.field.recurring")}
          />
          {recurring && (
            <>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box>{t("risks.tasks.field.recurrenceEvery")}</Box>
                <TextField
                  size="small"
                  type="number"
                  value={recurrenceInterval}
                  onChange={(e) =>
                    setRecurrenceInterval(Math.max(1, parseInt(e.target.value, 10) || 1))
                  }
                  disabled={submitting}
                  inputProps={{ min: 1, max: 365, style: { width: 64 } }}
                />
                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <InputLabel>{t("risks.tasks.field.recurrenceUnit")}</InputLabel>
                  <Select
                    label={t("risks.tasks.field.recurrenceUnit")}
                    value={recurrenceUnit}
                    onChange={(e) => setRecurrenceUnit(e.target.value as RecurrenceUnit)}
                    disabled={submitting}
                  >
                    {RECURRENCE_UNIT_OPTIONS.map((u) => (
                      <MenuItem key={u} value={u}>
                        {t(`risks.tasks.unit.${u}`)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
              <TextField
                size="small"
                type="number"
                label={t("risks.tasks.field.leadTime")}
                helperText={t("risks.tasks.field.leadTimeHelp")}
                value={leadTimeDays}
                onChange={(e) => {
                  setLeadTimeDirty(true);
                  const v = parseInt(e.target.value, 10);
                  setLeadTimeDays(Number.isNaN(v) ? 0 : Math.max(0, v));
                }}
                disabled={submitting}
                inputProps={{ min: 0, max: 3650 }}
                sx={{ maxWidth: 260 }}
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {t("risks.tasks.dialog.cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
        >
          {task ? t("risks.tasks.dialog.save") : t("risks.tasks.dialog.create")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
