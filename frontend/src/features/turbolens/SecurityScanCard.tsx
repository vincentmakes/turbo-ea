/**
 * SecurityScanCard — one-scan status card with progress bar, trigger button
 * and optional per-scan settings (e.g. regulation checkboxes for compliance).
 *
 * Used twice on the Security Overview: once for the CVE scan, once for the
 * compliance scan.
 */
import { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { SecurityScanRun } from "@/types";

interface Props {
  title: string;
  description: string;
  icon: string;
  run: SecurityScanRun | null;
  running: boolean;
  onRun: () => void;
  buttonLabel: string;
  runningLabel: string;
  neverScannedLabel: string;
  summaryLabel?: (summary: Record<string, unknown>) => string;
  phaseLabel: (phase: string) => string;
  disabled?: boolean;
  children?: ReactNode;
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function SecurityScanCard({
  title,
  description,
  icon,
  run,
  running,
  onRun,
  buttonLabel,
  runningLabel,
  neverScannedLabel,
  summaryLabel,
  phaseLabel,
  disabled,
  children,
}: Props) {
  const { t } = useTranslation("admin");
  const progress = running ? run?.progress : null;
  // Percentage: 0 if total is 0 (e.g. the "loading_cards" phase).
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : undefined;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        justifyContent="space-between"
        alignItems={{ sm: "center" }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <MaterialSymbol icon={icon} size={28} />
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
              {description}
            </Typography>
          </Box>
        </Stack>
        <Button
          variant="contained"
          onClick={onRun}
          disabled={disabled || running}
          startIcon={
            running ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              <MaterialSymbol icon="play_arrow" size={18} />
            )
          }
        >
          {running ? runningLabel : buttonLabel}
        </Button>
      </Stack>

      {children && <Box sx={{ mt: 2 }}>{children}</Box>}

      {running && (
        <Box sx={{ mt: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="caption" fontWeight={600}>
              {progress ? phaseLabel(progress.phase) : runningLabel}
            </Typography>
            {progress && progress.total > 0 && (
              <Typography variant="caption" color="text.secondary">
                {progress.current} / {progress.total}
                {progress.note ? ` · ${progress.note}` : ""}
              </Typography>
            )}
            {progress && progress.total === 0 && progress.note && (
              <Typography variant="caption" color="text.secondary">
                {progress.note}
              </Typography>
            )}
          </Stack>
          <LinearProgress
            variant={pct !== undefined ? "determinate" : "indeterminate"}
            value={pct}
          />
        </Box>
      )}

      {!running && (
        <Stack
          direction="row"
          spacing={2}
          sx={{ mt: 2, pt: 1.5, borderTop: 1, borderColor: "divider" }}
          flexWrap="wrap"
          useFlexGap
        >
          {run?.completed_at ? (
            <>
              <Typography variant="caption" color="text.secondary">
                {t("turbolens_security_last_scan")}: {formatTimestamp(run.completed_at)}
              </Typography>
              {run.status === "failed" && run.error && (
                <Tooltip title={run.error}>
                  <Typography variant="caption" color="error.main">
                    {t("turbolens_security_scan_failed")}
                  </Typography>
                </Tooltip>
              )}
              {run.status === "completed" && summaryLabel && run.summary && (
                <Typography variant="caption" color="text.secondary">
                  {summaryLabel(run.summary)}
                </Typography>
              )}
            </>
          ) : (
            <Typography variant="caption" color="text.secondary">
              {neverScannedLabel}
            </Typography>
          )}
        </Stack>
      )}
    </Paper>
  );
}
