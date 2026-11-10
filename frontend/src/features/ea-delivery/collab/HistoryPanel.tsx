/**
 * The History tab of a decision or SoAW: what happened to it, newest first
 * (who, when, what; a rejection's reason and a signing note shown), a page
 * at a time. Readers allowed to see versions (editors and the document's
 * signatories) can open a saved version and compare two; on a draft, an
 * editor can restore one. A restore asks first, says that unsaved edits are
 * discarded and that links are not restored, and hands the server's
 * document back to the page, which applies it as it applies a save.
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
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useDateFormat } from "@/hooks/useDateFormat";
import type { DocumentHistoryEntry, DocumentOwner } from "@/types";
import {
  actorName,
  canRestore,
  defaultComparePair,
  entryNote,
  newestFirst,
  restoreErrorMessage,
  timelineIcon,
  timelineLabelKey,
  type ComparePair,
} from "./historyModel";
import { useDocumentHistory } from "./useDocumentHistory";
import VersionViewDialog from "./VersionViewDialog";

// Loads the `diff` package with it, only when a comparison is opened.
const VersionCompareDialog = lazy(() => import("./VersionCompareDialog"));

interface Props<D> {
  owner: DocumentOwner;
  /** The document's status: restore is offered on a draft only. */
  status: string;
  /** Re-read the timeline when this changes (the page saved). */
  refreshKey?: string | number;
  /** Whether the page holds edits it has not saved (they are discarded by a restore). */
  isDirty?: () => boolean;
  /** The document as the restore left it. */
  onRestored?: (detail: D) => void;
}

export default function HistoryPanel<D>({ owner, status, refreshKey, isDirty, onRestored }: Props<D>) {
  const { t } = useTranslation(["delivery", "common"]);
  const { formatDateTime } = useDateFormat();
  const history = useDocumentHistory(owner, refreshKey);
  const [viewing, setViewing] = useState<DocumentHistoryEntry | null>(null);
  const [comparing, setComparing] = useState<ComparePair | null>(null);
  const [restoring, setRestoring] = useState<{ entry: DocumentHistoryEntry; dirty: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const page = history.page;
  if (!page) {
    if (history.error) {
      return <Alert severity="error">{history.error.message || t("collab.history.loadFailed")}</Alert>;
    }
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  const entries = newestFirst(history.entries);

  const confirmRestore = async () => {
    if (!restoring) return;
    setBusy(true);
    setError("");
    try {
      const detail = await history.restore<D>(restoring.entry.id);
      onRestored?.(detail);
      setRestoring(null);
      setNotice(t("collab.history.restored"));
    } catch (err) {
      setRestoring(null);
      setError(restoreErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {error && (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" onClose={() => setNotice("")}>
          {notice}
        </Alert>
      )}
      {!page.can_view_versions && entries.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          {t("collab.history.versionsHidden")}
        </Typography>
      )}
      {entries.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {t("collab.history.empty")}
        </Typography>
      )}
      <Box component="ol" sx={{ listStyle: "none", p: 0, m: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        {entries.map((entry) => {
          const note = entryNote(entry, history.entries, t, formatDateTime);
          const versioned = page.can_view_versions && entry.has_content;
          return (
            <Box
              component="li"
              key={entry.id}
              data-testid={`history-${entry.id}`}
              sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}
            >
              <Box sx={{ pt: 0.25, color: "text.secondary", display: "flex" }}>
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
                {versioned && (
                  <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                    <Button size="small" onClick={() => setViewing(entry)}>
                      {t("common:actions.view")}
                    </Button>
                    <Button
                      size="small"
                      disabled={defaultComparePair(entry.id, history.entries) === null}
                      onClick={() => setComparing(defaultComparePair(entry.id, history.entries))}
                    >
                      {t("collab.history.compare")}
                    </Button>
                    {canRestore(page.can_restore, status, entry) && (
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() => setRestoring({ entry, dirty: isDirty?.() ?? false })}
                      >
                        {t("common:actions.restore")}
                      </Button>
                    )}
                  </Box>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
      {history.hasMore && (
        <Button size="small" onClick={history.loadMore} disabled={history.loadingMore} sx={{ alignSelf: "center" }}>
          {history.loadingMore ? t("collab.history.loading") : t("collab.history.loadMore")}
        </Button>
      )}

      {viewing && (
        <VersionViewDialog owner={owner} entry={viewing} onClose={() => setViewing(null)} />
      )}
      {comparing && (
        <Suspense fallback={null}>
          <VersionCompareDialog
            owner={owner}
            entries={history.entries}
            initial={comparing}
            onClose={() => setComparing(null)}
          />
        </Suspense>
      )}

      <Dialog open={restoring !== null} onClose={() => setRestoring(null)} maxWidth="xs" fullWidth disableRestoreFocus>
        <DialogTitle>{t("collab.history.restoreTitle")}</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Typography variant="body2">
            {restoring &&
              t("collab.history.restoreBody", { date: formatDateTime(restoring.entry.created_at) })}
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
    </Box>
  );
}
