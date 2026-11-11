/**
 * The History view's "Changes" pane: two saved versions as one list of
 * changes, per field or section, the words removed and added
 * (`versionDiff`), a "formatting only" note where the words are the same,
 * and dates, names and people as old → new. The dialog picks the pair
 * (`comparePairFor`, older first). Loaded on demand, the first time Changes
 * is shown: it brings the `diff` package.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { alpha, type Theme } from "@mui/material/styles";
import { api } from "@/api/client";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import type {
  DecisionVersionContent,
  DocumentOwner,
  DocumentVersion,
  SoawVersionContent,
} from "@/types";
import { useMentionLabels } from "../mentions/mentionLabels";
import { getTemplateSections } from "../soawTemplate";
import { versionPath, type ComparePair } from "./historyModel";
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
  /** The two versions, older first. */
  pair: ComparePair;
}

export default function VersionChangesPane({ owner, pair }: Props) {
  const { t } = useTranslation("delivery");
  const { formatDate } = useDateFormat();
  const labels = useMentionLabels();
  const [versions, setVersions] = useState<{ pair: ComparePair; from: DocumentVersion; to: DocumentVersion } | null>(
    null,
  );
  const [error, setError] = useState<{ pair: ComparePair; message: string } | null>(null);
  const same = (p: ComparePair | undefined) => p?.from === pair.from && p?.to === pair.to;

  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      const asked = { from: pair.from, to: pair.to };
      // A failure belongs to the read that failed: a new read starts clean.
      if (isCurrent()) setError(null);
      try {
        const [from, to] = await Promise.all([
          api.get<DocumentVersion>(versionPath(owner, asked.from), { signal }),
          api.get<DocumentVersion>(versionPath(owner, asked.to), { signal }),
        ]);
        if (isCurrent()) setVersions({ pair: asked, from, to });
      } catch (err) {
        if (isCurrent()) {
          setError({
            pair: asked,
            message: err instanceof Error && err.message ? err.message : t("collab.history.versionFailed"),
          });
        }
      }
    },
    [owner.kind, owner.id, pair.from, pair.to],
  );

  const current = versions && same(versions.pair) ? versions : null;
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

  if (error && same(error.pair)) return <Alert severity="error">{error.message}</Alert>;
  if (rows === null) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t("collab.compare.noChanges")}
      </Typography>
    );
  }
  return (
    <Box>
      {rows.map((row) => (
        <Row key={row.key} row={row} />
      ))}
    </Box>
  );
}
