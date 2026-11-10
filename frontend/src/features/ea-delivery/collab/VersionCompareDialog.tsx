/**
 * Two saved versions side by side as one list of changes: per field or
 * section, the words removed and added (`versionDiff`), a "formatting only"
 * note where the words are the same, and dates, names and people as old →
 * new. Opens on the version picked and the one saved before it; either can
 * be changed. Loaded on demand (it brings the `diff` package).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { alpha, type Theme } from "@mui/material/styles";
import { api } from "@/api/client";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import type {
  DecisionVersionContent,
  DocumentHistoryEntry,
  DocumentOwner,
  DocumentVersion,
  SoawVersionContent,
} from "@/types";
import { useMentionLabels } from "../mentions/mentionLabels";
import { getTemplateSections } from "../soawTemplate";
import {
  actorName,
  contentEntries,
  entryTitle,
  newestFirst,
  orderPair,
  versionPath,
  type ComparePair,
} from "./historyModel";
import { decisionDiff, soawDiff, type DiffRow, type DiffSegment } from "./versionDiff";

const ADDED_SX = {
  bgcolor: (theme: Theme) => alpha(theme.palette.success.main, 0.18),
  color: "success.dark",
  textDecoration: "none",
  borderRadius: 0.5,
} as const;

const REMOVED_SX = {
  bgcolor: (theme: Theme) => alpha(theme.palette.error.main, 0.14),
  color: "error.dark",
  textDecoration: "line-through",
  borderRadius: 0.5,
} as const;

function Segment({ segment }: { segment: DiffSegment }) {
  if (segment.added) {
    return (
      <Box component="ins" data-diff="added" sx={ADDED_SX}>
        {segment.text}
      </Box>
    );
  }
  if (segment.removed) {
    return (
      <Box component="del" data-diff="removed" sx={REMOVED_SX}>
        {segment.text}
      </Box>
    );
  }
  return <span>{segment.text}</span>;
}

function Row({ row }: { row: DiffRow }) {
  const { t } = useTranslation("delivery");
  return (
    <Box data-testid={`diff-${row.key}`} sx={{ py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {row.label}
      </Typography>
      {row.formattingOnly && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
          {t("collab.compare.formattingOnly")}
        </Typography>
      )}
      <Typography
        variant="body2"
        component="div"
        sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: row.formattingOnly ? "text.secondary" : undefined }}
      >
        {row.kind === "value"
          ? row.segments.map((s, i) => (
              <Box key={i} component="span" sx={{ mr: 1 }}>
                {i > 0 && (
                  <Box component="span" sx={{ mr: 1, color: "text.secondary" }} aria-hidden>
                    →
                  </Box>
                )}
                <Segment segment={s} />
              </Box>
            ))
          : row.segments.map((s, i) => <Segment key={i} segment={s} />)}
      </Typography>
    </Box>
  );
}

interface Props {
  owner: DocumentOwner;
  /** The loaded timeline rows: the versions offered are those with content. */
  entries: DocumentHistoryEntry[];
  initial: ComparePair;
  onClose: () => void;
}

export default function VersionCompareDialog({ owner, entries, initial, onClose }: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const { formatDate, formatDateTime } = useDateFormat();
  const labels = useMentionLabels();
  const [pair, setPair] = useState<ComparePair>(initial);
  const [versions, setVersions] = useState<{ pair: ComparePair; from: DocumentVersion; to: DocumentVersion } | null>(
    null,
  );
  const [error, setError] = useState("");
  const options = newestFirst(contentEntries(entries));
  // Changes always read from the older version to the newer, whichever select holds which.
  const ordered = orderPair(pair.from, pair.to, entries);

  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      setError("");
      try {
        const [from, to] = await Promise.all([
          api.get<DocumentVersion>(versionPath(owner, ordered.from), { signal }),
          api.get<DocumentVersion>(versionPath(owner, ordered.to), { signal }),
        ]);
        if (isCurrent()) setVersions({ pair: ordered, from, to });
      } catch (err) {
        if (isCurrent()) setError(err instanceof Error && err.message ? err.message : t("collab.history.versionFailed"));
      }
    },
    [owner.kind, owner.id, ordered.from, ordered.to],
  );

  const current =
    versions && versions.pair.from === ordered.from && versions.pair.to === ordered.to ? versions : null;
  const rows = useMemo(() => {
    if (!current) return null;
    const opts = { t, labels, formatDate };
    if (owner.kind === "soaw") {
      const sectionTitles = Object.fromEntries(getTemplateSections().map((d) => [d.id, d.title]));
      return soawDiff(current.from.content as SoawVersionContent, current.to.content as SoawVersionContent, {
        ...opts,
        sectionTitles,
      });
    }
    return decisionDiff(
      current.from.content as DecisionVersionContent,
      current.to.content as DecisionVersionContent,
      opts,
    );
  }, [current, owner.kind, t, labels, formatDate]);

  const optionLabel = (e: DocumentHistoryEntry) => `${entryTitle(e, t, formatDateTime)} · ${actorName(e, t)}`;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth disableRestoreFocus>
      <DialogTitle>{t("collab.compare.title")}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 2, pt: 1 }}>
          <TextField
            select
            size="small"
            label={t("collab.compare.from")}
            value={pair.from}
            onChange={(e) => setPair((p) => ({ ...p, from: e.target.value }))}
            sx={{ minWidth: 240, flex: 1 }}
          >
            {options.map((e) => (
              <MenuItem key={e.id} value={e.id}>
                {optionLabel(e)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("collab.compare.to")}
            value={pair.to}
            onChange={(e) => setPair((p) => ({ ...p, to: e.target.value }))}
            sx={{ minWidth: 240, flex: 1 }}
          >
            {options.map((e) => (
              <MenuItem key={e.id} value={e.id}>
                {optionLabel(e)}
              </MenuItem>
            ))}
          </TextField>
        </Box>
        {error ? (
          <Alert severity="error">{error}</Alert>
        ) : rows === null ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("collab.compare.noChanges")}
          </Typography>
        ) : (
          rows.map((row) => <Row key={row.key} row={row} />)
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
