/**
 * An extension's release notes, rendered.
 *
 * Purely presentational: notes and versions in, markup out. Two very different
 * callers share it so they cannot drift — the confirmation an administrator
 * reads *before* applying an update, and the dialog a user opens from the bell
 * *after* one landed. Both are answering the same question.
 *
 * Rendering goes through core's own `renderReleaseNotes`, the hand-rolled
 * markdown subset the app-update dialog already uses: no markdown engine, no
 * `dangerouslySetInnerHTML`, unsupported syntax degrading to literal text.
 */
import { Alert, Box, Link, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

import MaterialSymbol from "@/components/MaterialSymbol";
import { renderReleaseNotes } from "@/components/releaseNotesMarkdown";

interface Props {
  /** Keep-a-Changelog markdown, or "" when no source had anything to say. */
  notes: string;
  /** The version being described. */
  version: string;
  /** The version being upgraded from, when this is an update. */
  fromVersion?: string | null;
  /** Extension display name, for the "from → to" line. */
  name?: string;
  /**
   * Scroll cap on the notes. The default suits a confirmation dialog; a
   * caller that already scrolls (the store details column) passes `"none"`
   * so the notes do not become a scroller inside a scroller.
   */
  maxHeight?: number | string;
  /**
   * The store listing's own page, carrying the complete changelog. The notes
   * here are deliberately the two most recent releases — this link is where
   * the rest lives, so it is offered under the notes and under the empty
   * state alike (the page may say what the bundle did not).
   */
  changelogUrl?: string | null;
}

export default function ExtensionChangelog({
  notes,
  version,
  fromVersion,
  name,
  maxHeight = 360,
  changelogUrl,
}: Props) {
  const { t } = useTranslation(["admin", "notifications"]);

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {fromVersion
          ? t("extensions.changelog.span", "{{name}} {{from}} → {{to}}", {
              name: name ?? "",
              from: fromVersion,
              to: version,
            }).trim()
          : t("extensions.changelog.single", "{{name}} {{version}}", {
              name: name ?? "",
              version,
            }).trim()}
      </Typography>

      {notes ? (
        <Box sx={{ maxHeight, overflowY: "auto", pr: 1 }}>
          {renderReleaseNotes(notes)}
        </Box>
      ) : (
        // An honest empty state rather than an invented one: a bundle
        // published before per-extension changelogs existed simply has none,
        // and an air-gapped instance cannot reach the store's copy.
        <Alert severity="info" variant="outlined">
          {t(
            "extensions.changelog.empty",
            "This release ships no notes. The vendor's store page may say more.",
          )}
        </Alert>
      )}

      {changelogUrl && (
        <Link
          href={changelogUrl}
          target="_blank"
          rel="noopener noreferrer"
          variant="body2"
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, alignSelf: "flex-start" }}
        >
          {t("extensions.changelog.full", "Full changelog")}
          <MaterialSymbol icon="open_in_new" size={16} />
        </Link>
      )}
    </Stack>
  );
}
