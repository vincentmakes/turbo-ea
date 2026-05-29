/**
 * Confirm + capture notes when closing an open occurrence.
 *
 * Used for both "complete" and "skip" actions — the parent component
 * passes ``mode`` and an action label.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { MitigationTask, MitigationTaskOccurrence } from "@/types";

export type CompleteMode = "complete" | "skip";

interface Props {
  open: boolean;
  mode: CompleteMode;
  task: MitigationTask | null;
  occurrence: MitigationTaskOccurrence | null;
  onClose: () => void;
  onSubmit: (notes: string | null) => Promise<void>;
}

export default function CompleteOccurrenceDialog({
  open,
  mode,
  task,
  occurrence,
  onClose,
  onSubmit,
}: Props) {
  const { t } = useTranslation("grc");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setNotes("");
  }, [open]);

  if (!task || !occurrence) return null;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit(notes.trim() ? notes.trim() : null);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const titleKey =
    mode === "complete"
      ? "risks.tasks.complete.title"
      : "risks.tasks.skip.title";
  const submitKey =
    mode === "complete"
      ? "risks.tasks.complete.confirm"
      : "risks.tasks.skip.confirm";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      disableRestoreFocus
    >
      <DialogTitle>{t(titleKey)}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2">
            <strong>{task.title}</strong>
          </Typography>
          {occurrence.due_date && (
            <Typography variant="caption" color="text.secondary">
              {t("risks.tasks.complete.dueLabel")}: {occurrence.due_date}
            </Typography>
          )}
          {occurrence.assigned_owner_name && (
            <Typography variant="caption" color="text.secondary">
              {t("risks.tasks.complete.assigneeLabel")}: {occurrence.assigned_owner_name}
            </Typography>
          )}
          <TextField
            label={t("risks.tasks.field.completionNotes")}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={submitting}
            multiline
            minRows={3}
            fullWidth
            placeholder={t("risks.tasks.complete.notesPlaceholder") ?? ""}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {t("risks.tasks.dialog.cancel")}
        </Button>
        <Button
          variant="contained"
          color={mode === "complete" ? "success" : "warning"}
          onClick={handleSubmit}
          disabled={submitting}
        >
          {t(submitKey)}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
