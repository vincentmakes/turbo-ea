/**
 * The signer's two dialogs on a decision or SoAW in review, and the warning
 * every review step shows while discussion threads are open. The warning
 * never blocks: a signer may sign over an open thread.
 *
 * - Sign: an optional note, kept as a signing note in the discussion.
 * - Reject: a reason is required (at most `REJECT_REASON_MAX` characters);
 *   it opens a thread to resolve.
 *
 * A refusal (`error`) is shown inside the dialog, which stays open with what
 * was typed, so the signer can read why and try again or cancel.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";
import { REJECT_REASON_MAX, SIGN_NOTE_MAX } from "./discussionModel";

/** "N open discussion threads" as a warning; nothing when there are none. */
export function OpenThreadsWarning({ count, sx }: { count: number | undefined; sx?: SxProps<Theme> }) {
  const { t } = useTranslation("delivery");
  if (!count || count <= 0) return null;
  return (
    <Alert severity="warning" data-testid="open-threads-warning" sx={sx}>
      {t("collab.openThreadsWarning", { count })}
    </Alert>
  );
}

interface SignProps {
  open: boolean;
  onClose: () => void;
  /** Called with the trimmed note (`""` for none). */
  onSign: (note: string) => Promise<void> | void;
  title: string;
  description: string;
  openThreadCount?: number;
  busy?: boolean;
  /** Why the last attempt was refused; shown in the dialog. */
  error?: string;
  onDismissError?: () => void;
}

/** A refusal inside a review dialog. */
function DialogError({ error, onDismiss }: { error?: string; onDismiss?: () => void }) {
  if (!error) return null;
  return (
    <Alert severity="error" onClose={onDismiss} data-testid="review-dialog-error">
      {error}
    </Alert>
  );
}

export function SignDocumentDialog({
  open,
  onClose,
  onSign,
  title,
  description,
  openThreadCount,
  busy,
  error,
  onDismissError,
}: SignProps) {
  const { t } = useTranslation(["delivery", "common"]);
  const [note, setNote] = useState("");
  const tooLong = note.length > SIGN_NOTE_MAX;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      TransitionProps={{ onExited: () => setNote("") }}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography variant="body2">{description}</Typography>
        <OpenThreadsWarning count={openThreadCount} />
        <DialogError error={error} onDismiss={onDismissError} />
        <TextField
          label={t("collab.sign.noteLabel")}
          fullWidth
          multiline
          minRows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={tooLong}
          helperText={t("collab.sign.noteHelp", { length: note.length, max: SIGN_NOTE_MAX })}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          color="success"
          disabled={busy || tooLong}
          onClick={() => void onSign(note.trim())}
        >
          {t("collab.sign.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface RejectProps {
  open: boolean;
  onClose: () => void;
  /** Called with the trimmed reason (never empty). */
  onReject: (reason: string) => Promise<void> | void;
  title: string;
  description: string;
  label: string;
  submitLabel: string;
  openThreadCount?: number;
  busy?: boolean;
  /** Why the last attempt was refused; shown in the dialog. */
  error?: string;
  onDismissError?: () => void;
}

export function RejectDocumentDialog({
  open,
  onClose,
  onReject,
  title,
  description,
  label,
  submitLabel,
  openThreadCount,
  busy,
  error,
  onDismissError,
}: RejectProps) {
  const { t } = useTranslation(["delivery", "common"]);
  const [reason, setReason] = useState("");
  const tooLong = reason.length > REJECT_REASON_MAX;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      TransitionProps={{ onExited: () => setReason("") }}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          {description}
        </Typography>
        <OpenThreadsWarning count={openThreadCount} />
        <DialogError error={error} onDismiss={onDismissError} />
        <TextField
          autoFocus
          label={label}
          fullWidth
          multiline
          minRows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={tooLong}
          helperText={t("collab.reject.reasonHelp", { length: reason.length, max: REJECT_REASON_MAX })}
          sx={{ mt: 2 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          color="error"
          disabled={!reason.trim() || tooLong || busy}
          onClick={() => void onReject(reason.trim())}
        >
          {submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
