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

/**
 * The raw payload, kept unformatted on purpose.
 *
 * Formatting it inside the loader would put `t` in that effect's dependency
 * array, and `t` is only referentially stable because react-i18next memoises
 * it. Any caller whose test mocks `useTranslation` inline hands back a fresh
 * `t` per render, which would re-fire the loader on every render — refetching
 * and remounting the notes without end. Headlines are built during render
 * instead, so the loader depends on nothing but `open` and `variant`.
 */
type Loaded =
  | { variant: "installed"; version: string | null; fromVersion: string | null; notes: string }
  | {
      variant: "available";
      latestVersion: string | null;
      currentVersion: string | null;
      notes: string;
      releaseUrl: string | null;
    };

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
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true);
    setFailed(false);
    // Drop the previous payload: the component stays mounted across an
    // open/close cycle, so keeping it would title the spinner with the version
    // read last time -- announcing 2.60.0 while fetching 2.61.0.
    setLoaded(null);

    const load: Promise<Loaded> =
      variant === "installed"
        ? api.get<WhatsNewResponse>("/settings/whats-new").then((res) => ({
            variant: "installed" as const,
            version: res.version ?? null,
            fromVersion: res.from_version ?? null,
            notes: res.notes ?? "",
          }))
        : api.get<UpdateStatus>("/settings/update-status").then((res) => ({
            variant: "available" as const,
            latestVersion: res.latest_version ?? null,
            currentVersion: res.current_version ?? null,
            notes: res.release_notes ?? "",
            releaseUrl: res.release_url ?? null,
          }));

    load
      .then((next) => {
        if (current) setLoaded(next);
      })
      .catch(() => {
        if (current) setFailed(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [open, variant]);

  const notes = loaded?.notes.trim() ?? "";

  // Built here rather than in the loader — see `Loaded` above.
  const headline =
    loaded === null
      ? t("releaseNotes.titleFallback")
      : loaded.variant === "installed"
        ? t("releaseNotes.installedTitle", { version: loaded.version })
        : loaded.latestVersion
          ? t("releaseNotes.title", { version: loaded.latestVersion })
          : t("releaseNotes.titleFallback");

  const subtitle =
    loaded === null
      ? null
      : loaded.variant === "installed"
        ? loaded.fromVersion
          ? t("releaseNotes.updatedFrom", { version: loaded.fromVersion })
          : null
        : loaded.currentVersion
          ? t("releaseNotes.running", { version: loaded.currentVersion })
          : null;

  const releaseUrl = loaded?.variant === "available" ? loaded.releaseUrl : null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth scroll="paper">
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <MaterialSymbol
            icon={variant === "installed" ? "auto_awesome" : "system_update_alt"}
            size={22}
          />
          <Box sx={{ flex: 1 }}>{headline}</Box>
        </Box>
        {subtitle && <Chip size="small" variant="outlined" sx={{ mt: 1 }} label={subtitle} />}
      </DialogTitle>
      <Divider />

      <DialogContent>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 5 }}>
            <CircularProgress size={28} />
          </Box>
        ) : failed ? (
          <Alert severity="error">{t("releaseNotes.loadFailed")}</Alert>
        ) : notes ? (
          renderReleaseNotes(notes)
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            {t("releaseNotes.empty")}
          </Typography>
        )}
      </DialogContent>

      <DialogActions>
        {releaseUrl && (
          <Button
            href={releaseUrl}
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
