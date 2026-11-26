/**
 * Translate a custom language with the configured AI provider: pick new &
 * changed strings or everything, start the background job, follow it by
 * polling the language every few seconds while it runs, and cancel it.
 * Unavailable, with the reason, while no AI provider is configured.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import LinearProgress from "@mui/material/LinearProgress";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useAiStatus } from "@/hooks/useAiStatus";
import type {
  CustomLocale,
  CustomLocaleDetail,
  CustomLocaleJob,
  CustomLocaleTranslateMode,
} from "@/types";
import { errorMessage, formatCount, percent } from "./customLocaleUtils";

/** How often a running job is polled. */
export const POLL_INTERVAL_MS = 3000;

interface Props {
  locale: CustomLocale;
  onClose: () => void;
  /** Called once a job was started, so the caller can follow it too. */
  onStarted: () => void;
  /** Called when a job this dialog followed stops running. */
  onFinished: () => void;
}

export default function TranslateDialog({ locale, onClose, onStarted, onFinished }: Props) {
  const { t, i18n } = useTranslation(["admin", "common"]);
  const { aiStatus, aiStatusLoaded } = useAiStatus();
  const [mode, setMode] = useState<CustomLocaleTranslateMode>("missing");
  const [includeManual, setIncludeManual] = useState(false);
  const [job, setJob] = useState<CustomLocaleJob | null>(locale.job);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const path = `/custom-locales/${encodeURIComponent(locale.code)}`;
  const { data: detail, loading, refetch } = useApiQuery<CustomLocaleDetail>(path);

  useEffect(() => {
    if (detail) setJob(detail.job ?? null);
  }, [detail]);

  const running = job?.status === "running";

  // Poll while the job runs, one read at a time: the next read is armed only
  // once the previous one settled (a read slower than the interval would
  // otherwise be aborted by the next forever). The timer dies with the dialog.
  useEffect(() => {
    if (!running || loading) return;
    const id = setTimeout(refetch, POLL_INTERVAL_MS);
    return () => clearTimeout(id);
  }, [running, loading, detail, refetch]);

  // A job seen running that no longer is has finished: refresh the caller.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) onFinished();
    wasRunning.current = running;
  }, [running, onFinished]);

  // No stats: the server has no English catalogue, so nothing can be sent.
  const stats = detail ? detail.stats : locale.stats;
  const toSend = !stats ? 0 : mode === "missing" ? stats.missing + stats.stale : stats.total;
  const configured = aiStatus.configured;

  const handleStart = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await api.post<{ job: CustomLocaleJob }>(`${path}/translate`, {
        mode,
        include_manual: mode === "all" && includeManual,
      });
      setJob(res.job);
      refetch();
      onStarted();
    } catch (e) {
      setError(errorMessage(e, t, t("customLocales.translate.startFailed")));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await api.post<{ job: CustomLocaleJob }>(`${path}/translate/cancel`);
      setJob(res.job);
    } catch (e) {
      setError(errorMessage(e, t, t("customLocales.translate.cancelFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("customLocales.translate.title", { name: locale.name })}</DialogTitle>
      <DialogContent>
        {aiStatusLoaded && !configured && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t("customLocales.translate.notConfigured")}
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {!stats && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {t("customLocales.errors.catalog_unavailable")}
          </Alert>
        )}
        <RadioGroup
          value={mode}
          onChange={(e) => setMode(e.target.value as CustomLocaleTranslateMode)}
        >
          <FormControlLabel
            value="missing"
            control={<Radio size="small" />}
            label={t("customLocales.translate.modeMissing")}
            disabled={running}
          />
          <FormControlLabel
            value="all"
            control={<Radio size="small" />}
            label={t("customLocales.translate.modeAll")}
            disabled={running}
          />
        </RadioGroup>
        {mode === "all" && (
          <FormControlLabel
            sx={{ ml: 3 }}
            control={
              <Checkbox
                size="small"
                checked={includeManual}
                onChange={(e) => setIncludeManual(e.target.checked)}
                disabled={running}
              />
            }
            label={t("customLocales.translate.includeManual")}
          />
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("customLocales.translate.count", { count: toSend })}
        </Typography>

        {job && (
          <Box sx={{ mt: 3 }} data-testid="translate-job">
            <Typography variant="subtitle2">
              {t(`customLocales.jobStatus.${job.status}`)}
            </Typography>
            <LinearProgress
              variant={running && job.total === 0 ? "indeterminate" : "determinate"}
              value={percent(job.done, job.total)}
              aria-label={t("customLocales.translate.progress")}
              sx={{ my: 1 }}
            />
            {/* No number until the job has counted its strings: 0 of 0 says nothing. */}
            {job.total > 0 && (
              <Typography variant="body2" color="text.secondary" data-testid="translate-progress-text">
                {t("customLocales.translate.progressText", {
                  percent: percent(job.done, job.total),
                  done: formatCount(job.done, i18n.language),
                  total: formatCount(job.total, i18n.language),
                  failed: formatCount(job.failed, i18n.language),
                })}
              </Typography>
            )}
            {job.error && (
              <Alert severity="error" sx={{ mt: 1 }}>
                <Typography variant="body2" fontWeight={600} component="span">
                  {t("customLocales.translate.providerAnswered")}
                </Typography>{" "}
                <span data-testid="translate-job-error">{job.error}</span>
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
        {running ? (
          <Button color="warning" onClick={handleCancel} disabled={busy}>
            {t("customLocales.translate.cancelJob")}
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={handleStart}
            disabled={busy || !configured || toSend === 0}
          >
            {t("customLocales.translate.start")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
