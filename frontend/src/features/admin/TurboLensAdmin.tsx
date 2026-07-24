/**
 * TurboLens settings panel — embedded as a tab in SettingsAdmin.
 *
 * Provides:
 *  - Module enable/disable toggle (persisted to app settings)
 *  - Standard third-party data-exchange warning shared by all AI features
 *  - AI configuration status + link to the TurboLens analysis pages
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useTurboLensReady } from "@/hooks/useTurboLensReady";
import type { TurboLensStatus } from "@/features/turbolens/utils";

export default function TurboLensAdmin() {
  const { t } = useTranslation(["admin", "common"]);
  const navigate = useNavigate();
  const { invalidateTurboLens } = useTurboLensReady();
  const [status, setStatus] = useState<TurboLensStatus | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<TurboLensStatus>("/turbolens/status")
      .then((res) => {
        setStatus(res);
        setEnabled(res.enabled ?? true);
      })
      .catch(() => {});
  }, []);

  const handleToggle = async (checked: boolean) => {
    setSaving(true);
    setError("");
    try {
      await api.patch("/settings/turbolens-enabled", { enabled: checked });
      setEnabled(checked);
      setStatus((prev) =>
        prev ? { ...prev, enabled: checked, ready: prev.ai_configured && checked } : prev,
      );
      invalidateTurboLens();
      setSnack(t("turbolens_toggle_saved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("turbolens_settings_description")}
      </Typography>

      <Alert severity="warning" icon={<MaterialSymbol icon="policy" size={20} />} sx={{ mb: 2 }}>
        <AlertTitle>{t("ai_third_party_warning_title")}</AlertTitle>
        {t("ai_third_party_warning_body")}
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {status && !status.ai_configured && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t("turbolens_ai_required")}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
          <MaterialSymbol icon="psychology" size={32} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" fontWeight="bold">
              {t("turbolens_title")}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
              <Chip
                size="small"
                label={enabled ? t("turbolens_module_enabled") : t("turbolens_module_disabled")}
                color={enabled ? "success" : "default"}
              />
              <Chip
                size="small"
                label={
                  status?.ai_configured
                    ? t("turbolens_ai_configured")
                    : t("turbolens_ai_not_configured")
                }
                color={status?.ai_configured ? "success" : "default"}
              />
              <Chip
                size="small"
                label={status?.ready ? t("turbolens_ready") : t("turbolens_not_ready")}
                color={status?.ready ? "success" : "default"}
              />
            </Stack>
          </Box>
          {saving && <CircularProgress size={20} />}
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("turbolens_description")}
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={enabled}
              onChange={(e) => handleToggle(e.target.checked)}
              disabled={saving || !status}
            />
          }
          label={enabled ? t("turbolens_module_enabled") : t("turbolens_module_disabled")}
          sx={{ mb: 2, display: "block" }}
        />

        <Button
          variant="contained"
          onClick={() => navigate("/turbolens")}
          disabled={!status?.ready}
          startIcon={<MaterialSymbol icon="open_in_new" size={18} />}
        >
          {t("turbolens_open_dashboard")}
        </Button>
      </Paper>

      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack("")}
        message={snack}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}
