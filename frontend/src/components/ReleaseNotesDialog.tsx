import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { renderReleaseNotes } from "@/components/releaseNotesMarkdown";
import { api } from "@/api/client";
import type { UpdateStatus } from "@/types";

/**
 * Shows what changed in the release an administrator is being offered, without
 * sending them off to github.com. The content is whatever the daily check
 * already cached, so opening this costs no outbound request and still works on
 * an instance that has since lost network access.
 */
export default function ReleaseNotesDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation(["notifications", "common"]);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true);
    setError("");
    api
      .get<UpdateStatus>("/settings/update-status")
      .then((res) => {
        if (current) setStatus(res);
      })
      .catch(() => {
        if (current) setError(t("releaseNotes.loadFailed"));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [open, t]);

  const notes = status?.release_notes?.trim() ?? "";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth scroll="paper">
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <MaterialSymbol icon="system_update_alt" size={22} />
          <Box sx={{ flex: 1 }}>
            {status?.latest_version
              ? t("releaseNotes.title", { version: status.latest_version })
              : t("releaseNotes.titleFallback")}
          </Box>
        </Box>
        {status?.current_version && (
          <Chip
            size="small"
            variant="outlined"
            sx={{ mt: 1 }}
            label={t("releaseNotes.running", { version: status.current_version })}
          />
        )}
      </DialogTitle>
      <Divider />

      <DialogContent>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 5 }}>
            <CircularProgress size={28} />
          </Box>
        ) : error ? (
          <Alert severity="error">{error}</Alert>
        ) : notes ? (
          renderReleaseNotes(notes)
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            {t("releaseNotes.empty")}
          </Typography>
        )}
      </DialogContent>

      <DialogActions>
        {status?.release_url && (
          <Button
            href={status.release_url}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ textTransform: "none", mr: "auto" }}
            endIcon={<MaterialSymbol icon="open_in_new" size={16} />}
          >
            {t("releaseNotes.viewOnGithub")}
          </Button>
        )}
        <Button onClick={onClose} variant="contained">
          {t("common:actions.close")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
