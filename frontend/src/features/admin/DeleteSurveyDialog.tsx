import { useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { Survey, SurveyDeleteImpact } from "@/types";

interface Props {
  /** The survey to delete; `null` keeps the dialog closed. */
  survey: Pick<Survey, "id" | "name"> | null;
  onClose: () => void;
  /** Called once the survey is gone, so the caller can refresh or navigate. */
  onDeleted: () => void;
}

/**
 * Confirm deleting a survey, whatever its status. The counts come from
 * `GET /surveys/{id}/delete-impact`, so the dialog says what the delete takes
 * with it: pending requests are withdrawn, answers are lost, and changes
 * already applied stay on the cards (whose history keeps naming the survey).
 */
export default function DeleteSurveyDialog({ survey, onClose, onDeleted }: Props) {
  const { t } = useTranslation(["admin", "common"]);
  const { data: impact, loading } = useApiQuery<SurveyDeleteImpact>(
    survey ? `/surveys/${survey.id}/delete-impact` : null,
  );
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    if (deleting) return;
    setError("");
    onClose();
  };

  const confirm = async () => {
    if (!survey) return;
    setDeleting(true);
    setError("");
    try {
      await api.delete(`/surveys/${survey.id}`);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={!!survey} onClose={close} maxWidth="xs" fullWidth disableRestoreFocus>
      <DialogTitle>{t("surveysAdmin.delete.title")}</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>
          {t("surveysAdmin.delete.confirm", { name: survey?.name ?? "" })}
        </Typography>
        {loading && !impact ? (
          <CircularProgress size={20} />
        ) : impact ? (
          <>
            {/* Only an active survey's pending requests are "withdrawn" by the
                delete: once a survey is closed nobody could answer them anyway. */}
            {impact.status === "active" && impact.pending > 0 && (
              <Alert severity="warning" sx={{ mb: 1 }}>
                {t("surveysAdmin.delete.pending", { count: impact.pending })}
              </Alert>
            )}
            {impact.answered - impact.applied > 0 && (
              <Alert severity="warning" sx={{ mb: 1 }}>
                {t("surveysAdmin.delete.unapplied", {
                  count: impact.answered - impact.applied,
                })}
              </Alert>
            )}
            {impact.applied > 0 && (
              <Alert severity="info" sx={{ mb: 1 }}>
                {t("surveysAdmin.delete.applied", { count: impact.applied })}
              </Alert>
            )}
          </>
        ) : null}
        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={deleting}>
          {t("common:actions.cancel")}
        </Button>
        <Button color="error" variant="contained" onClick={confirm} disabled={deleting || !survey}>
          {deleting ? t("surveysAdmin.delete.deleting") : t("common:actions.delete")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
