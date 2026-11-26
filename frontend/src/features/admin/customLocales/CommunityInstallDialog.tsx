/**
 * Install (or update) a language from the community library. Says plainly what
 * happens before anything is downloaded — the pack is community-provided and
 * not reviewed, it is checked by the same rules as an imported file, a new
 * language is added switched off — offers to also replace strings corrected by
 * hand on an update, and then shows the merge report of an import.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import type { CommunityInstallResult, CommunityLanguage } from "@/types";
import ImportReport from "./ImportReport";
import { addResult, emptyReport, errorMessage, installPath } from "./customLocaleUtils";

interface Props {
  language: CommunityLanguage;
  onClose: () => void;
  /** Called once the server installed the pack (whatever it applied). */
  onInstalled: (code: string) => void;
}

export default function CommunityInstallDialog({ language, onClose, onInstalled }: Props) {
  const { t } = useTranslation(["admin", "common"]);
  const update = language.installed;
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CommunityInstallResult | null>(null);

  const handleInstall = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await api.post<CommunityInstallResult>(installPath(language.code), {
        overwrite_manual: update && overwrite,
      });
      setResult(res);
      onInstalled(language.code);
    } catch (e) {
      setError(errorMessage(e, t, t("customLocales.community.installFailed")));
    } finally {
      setBusy(false);
    }
  };

  const report = emptyReport();
  if (result) addResult(report, result);

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {t(update ? "customLocales.community.updateTitle" : "customLocales.community.installTitle", {
          name: language.name,
        })}
      </DialogTitle>
      <DialogContent>
        {!result && (
          <>
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t("customLocales.community.unreviewedWarning")}
            </Alert>
            <Typography variant="body2">
              {t(
                update
                  ? "customLocales.community.updateExplain"
                  : "customLocales.community.installExplain",
              )}
            </Typography>
            {update && (
              <FormControlLabel
                sx={{ mt: 1 }}
                control={
                  <Checkbox
                    checked={overwrite}
                    disabled={busy}
                    onChange={(e) => setOverwrite(e.target.checked)}
                  />
                }
                label={t("customLocales.community.overwriteManual")}
              />
            )}
          </>
        )}
        {busy && (
          <LinearProgress sx={{ mt: 2 }} aria-label={t("customLocales.community.installing")} />
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
        {result && (
          <>
            <Alert severity="info">
              {t(
                result.created
                  ? "customLocales.community.addedDisabled"
                  : "customLocales.community.updated",
                { name: language.name },
              )}
            </Alert>
            {result.kept_manual > 0 && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                {t("customLocales.community.keptManual", { count: result.kept_manual })}
              </Typography>
            )}
            <ImportReport report={report} />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t("common:actions.close")}
        </Button>
        {!result && (
          <Button variant="contained" onClick={handleInstall} disabled={busy}>
            {t(update ? "customLocales.community.update" : "customLocales.community.install")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
