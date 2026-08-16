/**
 * The confirmation a drag-fill opens when the user releases the handle.
 *
 * Three states in one dialog, so the user never loses the thread between
 * "about to write" and "here is what happened":
 *
 *   1. confirm  — names the column, the value and the row count;
 *   2. applying — the dialog STAYS OPEN with a determinate bar, because a
 *                 30-row fill is 30 requests and a closed dialog would leave
 *                 the user watching an unchanged grid;
 *   3. report   — only when something failed: "k updated, n failed" plus the
 *                 failed rows as links, a structural copy of the mass-edit
 *                 blocker list. A clean fill closes instead of reporting.
 *
 * Deliberately entity-agnostic — it takes labels and hrefs, never a card. The
 * same discipline `CellPickTarget` follows in `useCellContextMenu`, so this
 * dialog serves any grid that adopts the hook.
 *
 * Shape (suppressed close while in flight, `[Cancel][contained primary]`)
 * follows `features/cards/BulkRestoreDialog.tsx` and UI_GUIDELINES §3.4.
 */
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";

/** Longest failure list rendered before collapsing into "…and n more". */
export const MAX_LISTED_FAILURES = 50;

/** One row the page could not write, reported back by `onFill`. */
export interface FillFailure {
  /** Stable identity — the React key. */
  rowId: string;
  label: string;
  message: string;
  /** Optional deep link to the row's own page. */
  href?: string;
}

export interface FillOutcome {
  succeeded: number;
  failures: FillFailure[];
}

export interface DragFillConfirmDialogProps {
  open: boolean;
  /** Header text of the column being filled. */
  columnLabel: string;
  /** WYSIWYG source value; "" renders as the translated "(empty)". */
  valueLabel: string;
  count: number;
  /** Non-null only while the writes are in flight — drives the bar. */
  progress: { done: number; total: number } | null;
  /** Non-null once the writes settle with at least one failure. */
  outcome: FillOutcome | null;
  onConfirm: () => void;
  onClose: () => void;
}

export default function DragFillConfirmDialog({
  open,
  columnLabel,
  valueLabel,
  count,
  progress,
  outcome,
  onConfirm,
  onClose,
}: DragFillConfirmDialogProps) {
  const { t } = useTranslation(["common"]);
  const applying = progress !== null;
  const reporting = outcome !== null;
  const shownFailures = outcome?.failures.slice(0, MAX_LISTED_FAILURES) ?? [];
  const hiddenFailures = (outcome?.failures.length ?? 0) - shownFailures.length;

  return (
    <Dialog
      open={open}
      // A fill is N sequential writes; dismissing mid-flight would orphan the
      // progress and leave the user unsure how far it got.
      onClose={applying ? undefined : onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>{t("common:grid.fill.dialogTitle")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {!reporting && (
            <>
              <Typography variant="body2">
                {t("common:grid.fill.confirmBody", { count, column: columnLabel })}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("common:grid.fill.valuePreview", {
                  value: valueLabel || t("common:grid.fill.emptyValue"),
                })}
              </Typography>
            </>
          )}

          {applying && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("common:grid.fill.progress", {
                  done: progress.done,
                  total: progress.total,
                })}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0}
                sx={{ mt: 0.5 }}
              />
            </Box>
          )}

          {reporting && (
            <Alert severity={outcome.succeeded > 0 ? "warning" : "error"}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t("common:grid.fill.partialSummary", {
                  succeeded: outcome.succeeded,
                  failed: outcome.failures.length,
                })}
              </Typography>
              <Box
                component="ul"
                sx={{ m: 0, mt: 1, pl: 2, maxHeight: 220, overflowY: "auto" }}
              >
                {shownFailures.map((failure) => (
                  <Box component="li" key={failure.rowId} sx={{ mb: 0.5 }}>
                    {failure.href ? (
                      <Link href={failure.href} target="_blank" rel="noopener">
                        {failure.label}
                      </Link>
                    ) : (
                      <Typography component="span" variant="body2">
                        {failure.label}
                      </Typography>
                    )}
                    <Typography component="span" variant="body2">
                      {` — ${failure.message}`}
                    </Typography>
                  </Box>
                ))}
                {hiddenFailures > 0 && (
                  <Box component="li">
                    <Typography component="span" variant="body2">
                      {t("common:grid.fill.andMore", { count: hiddenFailures })}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {!reporting && (
          <Button onClick={onClose} disabled={applying}>
            {t("common:actions.cancel")}
          </Button>
        )}
        {reporting ? (
          <Button variant="contained" color="primary" onClick={onClose}>
            {t("common:actions.close")}
          </Button>
        ) : (
          <Button
            variant="contained"
            color="primary"
            onClick={onConfirm}
            disabled={applying}
            startIcon={<MaterialSymbol icon="format_color_fill" size={18} />}
          >
            {applying
              ? t("common:grid.fill.applying")
              : t("common:grid.fill.apply", { count })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
