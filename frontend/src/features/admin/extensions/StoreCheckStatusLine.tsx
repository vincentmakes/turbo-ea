/**
 * What the daily store check last did, and a way to make it run now.
 *
 * The check reads the catalogue once a day and notifies administrators about
 * newly published extensions and updates to installed ones — and until this
 * existed, that was the *only* evidence it produced. A store that refused the
 * request recorded the reason in the settings row and nowhere a person could
 * see it, so "I never get notified" had four indistinguishable explanations:
 * the probe never ran, the fetch is failing, the notices are switched off, or
 * it ran fine and genuinely nothing was new. This line separates them, and
 * "Check now" turns verifying the feature from a day's wait into a click.
 */
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useDateFormat } from "@/hooks/useDateFormat";
import type { StoreCheckRun, StoreCheckStatus } from "./types";

export default function StoreCheckStatusLine() {
  const { t } = useTranslation("admin");
  const { formatDateTime } = useDateFormat();
  const [status, setStatus] = useState<StoreCheckStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<StoreCheckRun | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<StoreCheckStatus>("/settings/extension-store-status")
      // Gated on admin.settings, which someone holding admin.manage_extensions
      // need not have — a missing status line is not worth an error banner.
      .then((data) => live && setStatus(data))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const checkNow = async () => {
    setBusy(true);
    setRun(null);
    try {
      const result = await api.post<StoreCheckRun>("/settings/extension-store-check", {});
      setRun(result);
      setStatus(await api.get<StoreCheckStatus>("/settings/extension-store-status"));
    } catch {
      setRun(null);
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="caption" color="text.secondary">
          {status.checked_at
            ? t("extensions.store.checkStatus", "Store checked {{when}} · {{count}} known", {
                when: formatDateTime(status.checked_at),
                count: status.known_count,
              })
            : t("extensions.store.checkNever", "The store has not been checked yet.")}
        </Typography>
        <Button
          size="small"
          color="inherit"
          onClick={checkNow}
          disabled={busy}
          startIcon={
            busy ? (
              <CircularProgress size={14} color="inherit" />
            ) : (
              <MaterialSymbol icon="refresh" size={18} />
            )
          }
        >
          {t("extensions.store.checkNow", "Check now")}
        </Button>
        {run && !run.disabled && (
          <Typography variant="caption" color="text.secondary">
            {t("extensions.store.checkResult", "{{new}} new, {{updates}} updated", {
              new: run.new ?? 0,
              updates: run.updates ?? 0,
            })}
          </Typography>
        )}
      </Stack>
      {run?.disabled && (
        <Alert severity="info" sx={{ mt: 1 }}>
          {t(
            "extensions.store.checkDisabled",
            "Store notices are switched off under Settings → Update notifications, so nothing is checked and no notification is sent.",
          )}
        </Alert>
      )}
      {status.error && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {t("extensions.store.checkError", "The last store check failed: {{error}}", {
            error: status.error,
          })}
        </Alert>
      )}
    </Box>
  );
}
