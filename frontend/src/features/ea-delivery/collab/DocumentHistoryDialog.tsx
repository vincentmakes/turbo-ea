/**
 * A decision's or SoAW's History, opened from the History button at the top
 * of its page: one wide view with the timeline on the left (what happened,
 * who, when, a note; newest first, a page at a time) and the selected saved
 * version on the right, shown as it was (Version) or as what changed
 * (Changes: against the version before it by default, or any other one
 * picked). On a draft, an editor restores the selected version from here: a
 * confirmation says that unsaved edits are discarded and that links are not
 * restored, then the page applies the server's document as it applies a
 * save, and the view closes.
 *
 * A reader who may not see versions (only editors and the document's
 * signatories may) gets the timeline only. Below `md` the view is full
 * screen and shows one pane at a time: the timeline, then the version with a
 * Back control.
 *
 * Mounted while open, so the timeline is read when it opens, and again on
 * `refreshKey` (the page saved, a review action) while it is open.
 *
 * Not the SoAW's hand-kept "Document Version History" table.
 */
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useDateFormat } from "@/hooks/useDateFormat";
import type { DocumentHistoryEntry, DocumentOwner } from "@/types";
import {
  actorName,
  canRestore,
  changesView,
  compareOptions,
  entryNote,
  entryTitle,
  newestFirst,
  otherSide,
  restoreErrorMessage,
  selectedVersion,
  timelineIcon,
  timelineLabelKey,
} from "./historyModel";
import { useDocumentHistory } from "./useDocumentHistory";
import VersionViewPane from "./VersionViewPane";

// Loads the `diff` package with it, the first time Changes is shown.
const VersionChangesPane = lazy(() => import("./VersionChangesPane"));

type Mode = "version" | "changes";

interface Props<D> {
  owner: DocumentOwner;
  /** What the document is called, under the title. */
  label: string;
  /** The document's status: restore is offered on a draft only. */
  status: string;
  /** Re-read the timeline when this changes (the page saved). */
  refreshKey?: string | number;
  /** Whether the page holds edits it has not saved (they are discarded by a restore). */
  isDirty?: () => boolean;
  /** The document as the restore left it. */
  onRestored?: (detail: D) => void;
  onClose: () => void;
}

function Centered() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
      <CircularProgress size={24} />
    </Box>
  );
}

export default function DocumentHistoryDialog<D>({
  owner,
  label,
  status,
  refreshKey,
  isDirty,
  onRestored,
  onClose,
}: Props<D>) {
  const { t } = useTranslation(["delivery", "common"]);
  const { formatDateTime } = useDateFormat();
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down("md"));
  const history = useDocumentHistory(owner, refreshKey);
  // The version on the right, pinned once chosen (the newest when the first
  // page arrives) so a re-read of the timeline never moves it.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("version");
  const [compareWith, setCompareWith] = useState<string | null>(null);
  // Below `md`: which of the two panes is on screen.
  const [showVersion, setShowVersion] = useState(false);
  const [restoring, setRestoring] = useState<{ entry: DocumentHistoryEntry; dirty: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const page = history.page;
  const entries = newestFirst(history.entries);
  const canView = page?.can_view_versions ?? false;
  const selected = canView ? selectedVersion(pickedId, history.entries) : null;
  if (selected && selected.id !== pickedId) {
    // First page arrived (pin the newest), or the pinned version is no longer
    // listed (fall back to the newest, quietly).
    setPickedId(selected.id);
    if (pickedId !== null) setCompareWith(null);
  }
  const changes = selected ? changesView(selected.id, compareWith, history.entries, history.hasMore) : null;

  const pick = (entry: DocumentHistoryEntry) => {
    setPickedId(entry.id);
    setCompareWith(null);
    setShowVersion(true);
  };

  const confirmRestore = async () => {
    if (!restoring) return;
    setBusy(true);
    setError("");
    try {
      const detail = await history.restore<D>(restoring.entry.id);
      setRestoring(null);
      onRestored?.(detail);
      onClose();
    } catch (err) {
      setRestoring(null);
      setError(restoreErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const loadMore = (
    <Button size="small" onClick={history.loadMore} disabled={history.loadingMore}>
      {history.loadingMore ? t("collab.history.loading") : t("collab.history.loadMore")}
    </Button>
  );
  // Said wherever only the loaded versions can be compared.
  const earlierNotLoaded = (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }} data-testid="earlier-not-loaded">
      <Typography variant="body2" color="text.secondary">
        {t("collab.compare.earlierNotLoaded")}
      </Typography>
      {loadMore}
    </Box>
  );

  const timeline = !page ? (
    history.error ? (
      <Alert severity="error">{history.error.message || t("collab.history.loadFailed")}</Alert>
    ) : (
      <Centered />
    )
  ) : entries.length === 0 ? (
    <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
      {t("collab.history.empty")}
    </Typography>
  ) : (
    <>
      <List dense disablePadding aria-label={t("collab.panel.history")}>
        {entries.map((entry) => {
          const note = entryNote(entry, history.entries, t, formatDateTime);
          const versioned = canView && entry.has_content;
          const body = (
            <>
              <Box sx={{ pt: 0.25, mr: 1, color: "text.secondary", display: "flex" }}>
                <MaterialSymbol icon={timelineIcon(entry.kind)} size={18} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t(timelineLabelKey(entry.kind))}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  {t("collab.history.byOn", { name: actorName(entry, t), date: formatDateTime(entry.created_at) })}
                </Typography>
                {note && (
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mt: 0.25 }}>
                    {note}
                  </Typography>
                )}
              </Box>
              {versioned && (
                <Tooltip title={t("collab.history.hasVersion")}>
                  <Box
                    component="span"
                    aria-label={t("collab.history.hasVersion")}
                    sx={{ color: "primary.main", display: "flex", pt: 0.25, ml: 1 }}
                  >
                    <MaterialSymbol icon="description" size={18} />
                  </Box>
                </Tooltip>
              )}
            </>
          );
          return versioned ? (
            <ListItem key={entry.id} disablePadding data-testid={`history-${entry.id}`}>
              <ListItemButton
                selected={selected?.id === entry.id}
                aria-current={selected?.id === entry.id ? "true" : undefined}
                onClick={() => pick(entry)}
                sx={{ alignItems: "flex-start", borderRadius: 1 }}
              >
                {body}
              </ListItemButton>
            </ListItem>
          ) : (
            <ListItem key={entry.id} data-testid={`history-${entry.id}`} sx={{ alignItems: "flex-start" }}>
              {body}
            </ListItem>
          );
        })}
      </List>
      {history.hasMore && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 1 }}>{loadMore}</Box>
      )}
    </>
  );

  const options = selected ? compareOptions(selected.id, history.entries) : [];
  const optionLabel = (e: DocumentHistoryEntry) => `${entryTitle(e, t, formatDateTime)} · ${actorName(e, t)}`;

  const version = !page ? (
    history.error ? null : (
      <Centered />
    )
  ) : !canView ? (
    <Typography variant="body2" color="text.secondary">
      {t("collab.history.versionsHidden")}
    </Typography>
  ) : !selected ? (
    <Typography variant="body2" color="text.secondary">
      {t("collab.history.noVersions")}
    </Typography>
  ) : (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }} data-testid="selected-version">
            {entryTitle(selected, t, formatDateTime)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {actorName(selected, t)}
          </Typography>
        </Box>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={mode}
          onChange={(_e, next: Mode | null) => next && setMode(next)}
        >
          <ToggleButton value="version" sx={{ textTransform: "none" }}>
            {t("collab.history.modeVersion")}
          </ToggleButton>
          <ToggleButton value="changes" sx={{ textTransform: "none" }}>
            {t("collab.history.modeChanges")}
          </ToggleButton>
        </ToggleButtonGroup>
        {canRestore(page.can_restore, status, selected) && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<MaterialSymbol icon="restore" size={18} />}
            sx={{ textTransform: "none" }}
            disabled={busy}
            onClick={() => setRestoring({ entry: selected, dirty: isDirty?.() ?? false })}
          >
            {t("collab.history.restoreThis")}
          </Button>
        )}
      </Box>
      {mode === "version" ? (
        <VersionViewPane owner={owner} entryId={selected.id} />
      ) : changes?.kind === "earlierNotLoaded" ? (
        earlierNotLoaded
      ) : changes?.kind !== "pair" ? (
        <Typography variant="body2" color="text.secondary">
          {t("collab.compare.onlyOne")}
        </Typography>
      ) : (
        <>
          <TextField
            select
            size="small"
            label={t("collab.compare.with")}
            value={otherSide(selected.id, changes.pair)}
            onChange={(e) => setCompareWith(e.target.value)}
            sx={{ maxWidth: 420 }}
          >
            {options.map((e) => (
              <MenuItem key={e.id} value={e.id}>
                {optionLabel(e)}
              </MenuItem>
            ))}
          </TextField>
          {history.hasMore && earlierNotLoaded}
          <Suspense fallback={<Centered />}>
            <VersionChangesPane owner={owner} pair={changes.pair} />
          </Suspense>
        </>
      )}
    </Box>
  );

  const showTimeline = !narrow || !showVersion;
  const showRight = !narrow || showVersion;

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth fullScreen={narrow}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <MaterialSymbol icon="history" size={22} />
        <Box sx={{ minWidth: 0 }}>
          {t("collab.panel.history")}
          <Typography variant="body2" color="text.secondary" noWrap>
            {label}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, display: "flex", minHeight: 0, height: { md: "75vh" } }}>
        {showTimeline && (
          <Box
            data-testid="history-timeline"
            sx={{
              width: { xs: "100%", md: "34%" },
              flexShrink: 0,
              overflowY: "auto",
              p: 1,
              borderRight: { md: 1 },
              borderColor: { md: "divider" },
            }}
          >
            {narrow && page && !canView && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                {t("collab.history.versionsHidden")}
              </Typography>
            )}
            {narrow && page && canView && !selected && entries.length > 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                {t("collab.history.noVersions")}
              </Typography>
            )}
            {timeline}
          </Box>
        )}
        {showRight && (
          <Box data-testid="history-version" sx={{ flex: 1, minWidth: 0, overflowY: "auto", p: 2 }}>
            {narrow && (
              <Button
                size="small"
                startIcon={<MaterialSymbol icon="arrow_back" size={18} />}
                sx={{ textTransform: "none", mb: 1 }}
                onClick={() => setShowVersion(false)}
              >
                {t("common:actions.back")}
              </Button>
            )}
            {error && (
              <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            {version}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
      </DialogActions>

      <Dialog open={restoring !== null} onClose={() => setRestoring(null)} maxWidth="xs" fullWidth disableRestoreFocus>
        <DialogTitle>{t("collab.history.restoreTitle")}</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Typography variant="body2">
            {restoring && t("collab.history.restoreBody", { date: formatDateTime(restoring.entry.created_at) })}
          </Typography>
          {restoring?.dirty && <Alert severity="warning">{t("collab.history.restoreDiscards")}</Alert>}
          <Typography variant="body2" color="text.secondary">
            {t("collab.history.restoreNoLinks")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestoring(null)} disabled={busy}>
            {t("common:actions.cancel")}
          </Button>
          <Button variant="contained" onClick={() => void confirmRestore()} disabled={busy}>
            {t("common:actions.restore")}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
