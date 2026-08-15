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
import type { UpdateStatus, WhatsNewResponse } from "@/types";

/**
 * `available` — an update exists but has not been installed. Notes come from
 *   the GitHub release the daily check cached, and the dialog offers a link to
 *   that release page.
 * `installed` — the upgrade has landed. Notes come from the changelog bundled
 *   in the image, spanning every version the instance jumped across, and there
 *   is no external page to point at.
 */
export type ReleaseNotesVariant = "available" | "installed";

interface Content {
  headline: string;
  subtitle: string | null;
  notes: string;
  releaseUrl: string | null;
}

/**
 * Shows what changed in a release without sending anyone off to github.com.
 * Both variants read from a server-side cache, so opening this costs no
 * outbound request and works unchanged on an air-gapped instance.
 */
export default function ReleaseNotesDialog({
  open,
  onClose,
  variant = "available",
}: {
  open: boolean;
  onClose: () => void;
  variant?: ReleaseNotesVariant;
}) {
  const { t } = useTranslation(["notifications", "common"]);
  const [content, setContent] = useState<Content | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true);
    setError("");

    const load =
      variant === "installed"
        ? api.get<WhatsNewResponse>("/settings/whats-new").then((res) => ({
            headline: t("releaseNotes.installedTitle", { version: res.version }),
            subtitle: res.from_version
              ? t("releaseNotes.updatedFrom", { version: res.from_version })
              : null,
            notes: res.notes ?? "",
            releaseUrl: null,
          }))
        : api.get<UpdateStatus>("/settings/update-status").then((res) => ({
            headline: res.latest_version
              ? t("releaseNotes.title", { version: res.latest_version })
              : t("releaseNotes.titleFallback"),
            subtitle: res.current_version
              ? t("releaseNotes.running", { version: res.current_version })
              : null,
            notes: res.release_notes ?? "",
            releaseUrl: res.release_url,
          }));

    load
      .then((next) => {
        if (current) setContent(next);
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
  }, [open, variant, t]);

  const notes = content?.notes.trim() ?? "";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth scroll="paper">
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <MaterialSymbol
            icon={variant === "installed" ? "auto_awesome" : "system_update_alt"}
            size={22}
          />
          <Box sx={{ flex: 1 }}>{content?.headline ?? t("releaseNotes.titleFallback")}</Box>
        </Box>
        {content?.subtitle && (
          <Chip size="small" variant="outlined" sx={{ mt: 1 }} label={content.subtitle} />
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
        {content?.releaseUrl && (
          <Button
            href={content.releaseUrl}
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
