/**
 * What changed in an extension release, opened from the bell.
 *
 * A sibling of `ReleaseNotesDialog` rather than a fourth branch inside it:
 * that one already resolves three different core sources, and an extension's
 * notes come from a different endpoint keyed on an extension rather than on
 * the instance. The two share the part that matters — `ExtensionChangelog`,
 * and through it core's own markdown renderer.
 *
 * The notes are **fetched**, never read out of the notification row: freezing
 * markdown into every row would grow the notifications table by notes × users
 * × release, so the row carries only the versions and this resolves the rest.
 */
import { useEffect, useState } from "react";

import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { Alert, LinearProgress } from "@mui/material";
import { useTranslation } from "react-i18next";

import { api } from "@/api/client";
import ExtensionChangelog from "@/components/ExtensionChangelog";

interface ExtensionNotes {
  version: string;
  from_version?: string | null;
  notes: string;
  source: string;
}

interface Props {
  extKey: string;
  /** Display name from the notification payload — the API answers about notes. */
  name: string;
  version: string;
  fromVersion?: string;
  onClose: () => void;
}

export default function ExtensionReleaseNotesDialog({
  extKey,
  name,
  version,
  fromVersion,
  onClose,
}: Props) {
  const { t } = useTranslation(["notifications", "common", "admin"]);
  const [loaded, setLoaded] = useState<ExtensionNotes | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    // Cleared per open so a previous extension's notes can never title the
    // spinner for this one — the same reason ReleaseNotesDialog does it.
    setLoaded(null);
    setFailed(false);
    (async () => {
      try {
        const params = new URLSearchParams({ version });
        if (fromVersion) params.set("from_version", fromVersion);
        const data = await api.get<ExtensionNotes>(
          `/extensions/${encodeURIComponent(extKey)}/release-notes?${params}`,
        );
        if (alive) setLoaded(data);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [extKey, version, fromVersion]);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle>
        {t("releaseNotes.extensionTitle", "What's new in {{name}} {{version}}", {
          name,
          version,
        })}
      </DialogTitle>
      <DialogContent dividers>
        {!loaded && !failed && <LinearProgress />}
        {failed && (
          <Alert severity="warning" variant="outlined">
            {t("releaseNotes.loadFailed", "Could not load the release notes.")}
          </Alert>
        )}
        {loaded && (
          <ExtensionChangelog
            notes={loaded.notes}
            version={loaded.version}
            fromVersion={loaded.from_version}
            name={name}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.close", "Close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
