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
import { useAppTitle } from "@/hooks/useAppTitle";
import type { ReleaseNotesResponse, UpdateStatus, WhatsNewResponse } from "@/types";

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
    }
  /** A named version, resolved from the bundled changelog. Used whenever the
   *  caller knows which release it is asking about — i.e. every click on a
   *  notification, which carries its versions in `data`. */
  | {
      variant: "versioned";
      version: string | null;
      fromVersion: string | null;
      currentVersion: string | null;
      notes: string;
      source: ReleaseNotesResponse["source"];
      releaseUrl: string | null;
      isInstalled: boolean;
    };

/**
 * Shows what changed in a release without sending anyone off to github.com.
 * Every path reads from the changelog bundled in the image or a server-side
 * cache, so opening this costs no outbound request and works unchanged on an
 * air-gapped instance.
 *
 * Pass `version` (and `fromVersion` for an upgrade span) to pin the dialog to
 * one release. Without it the dialog falls back to "whatever is newest", which
 * is only ever right for the most recent notification — an older one clicked a
 * few releases later would otherwise be answered with someone else's notes.
 */
export default function ReleaseNotesDialog({
  open,
  onClose,
  variant = "available",
  version,
  fromVersion,
}: {
  open: boolean;
  onClose: () => void;
  variant?: ReleaseNotesVariant;
  version?: string | null;
  fromVersion?: string | null;
}) {
  const { t } = useTranslation(["notifications", "common"]);
  // Render-phase only — never a loader dependency. `useAppTitle` resolves
  // asynchronously and changes identity once when it does, which inside the
  // effect would refetch the notes mid-read.
  const appTitle = useAppTitle();
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

    const params = new URLSearchParams();
    if (version) params.set("version", version);
    if (fromVersion) params.set("from_version", fromVersion);

    const load: Promise<Loaded> = version
      ? api
          .get<ReleaseNotesResponse>(`/settings/release-notes?${params.toString()}`)
          .then((res) => ({
            variant: "versioned" as const,
            version: res.version ?? null,
            fromVersion: res.from_version ?? null,
            currentVersion: res.current_version ?? null,
            notes: res.notes ?? "",
            source: res.source ?? "none",
            releaseUrl: res.release_url ?? null,
            isInstalled: !!res.is_installed,
          }))
      : variant === "installed"
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
    // `version`/`fromVersion` are plain strings, so unlike `t` they are stable
    // across renders and cannot re-fire this loop.
  }, [open, variant, version, fromVersion]);

  const notes = loaded?.notes.trim() ?? "";

  // Flatten the three payloads into one shape so the headline and chip below
  // each read once instead of three times.
  const shown =
    loaded === null
      ? null
      : loaded.variant === "versioned"
        ? {
            version: loaded.version,
            fromVersion: loaded.fromVersion,
            currentVersion: loaded.currentVersion,
            installed: loaded.isInstalled,
          }
        : loaded.variant === "installed"
          ? {
              version: loaded.version,
              fromVersion: loaded.fromVersion,
              currentVersion: null,
              installed: true,
            }
          : {
              version: loaded.latestVersion,
              fromVersion: null,
              currentVersion: loaded.currentVersion,
              installed: false,
            };

  // Built here rather than in the loader — see `Loaded` above. The wording
  // follows the notification that opened the dialog, not the state of the
  // instance: an update-available notice still reads "X is available" once X
  // has been installed, because that is what it announced. The chip below
  // carries the "you already have this" nuance instead.
  const headline = !shown?.version
    ? t("releaseNotes.titleFallback")
    : variant === "installed"
      ? t("releaseNotes.installedTitle", { app: appTitle, version: shown.version })
      : t("releaseNotes.title", { app: appTitle, version: shown.version });

  const subtitle =
    shown === null
      ? null
      : variant === "installed"
        ? shown.fromVersion
          ? t("releaseNotes.updatedFrom", { version: shown.fromVersion })
          : null
        : shown.installed
          ? t("releaseNotes.alreadyInstalled")
          : shown.currentVersion
            ? t("releaseNotes.running", { version: shown.currentVersion })
            : null;

  // Only ever a URL the server handed us — never one built from a version
  // string, which would fabricate links to tags that may not exist.
  const releaseUrl =
    loaded?.variant === "available" || loaded?.variant === "versioned" ? loaded.releaseUrl : null;

  // Distinguish "this release shipped with no notes" from "this instance
  // cannot describe that version" — the latter is what a stale notice for a
  // release you never installed gets.
  const emptyMessage =
    loaded?.variant === "versioned" && loaded.source === "none" && loaded.version
      ? t("releaseNotes.unavailableForVersion", { version: loaded.version })
      : t("releaseNotes.empty");

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
            {emptyMessage}
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
