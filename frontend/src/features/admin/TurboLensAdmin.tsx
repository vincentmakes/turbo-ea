/**
 * TurboLens status panel — embedded as a tab in SettingsAdmin.
 * Shows AI configuration status and links to TurboLens analysis pages.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { TurboLensStatus } from "@/features/turbolens/utils";

export default function TurboLensAdmin() {
  const { t } = useTranslation("admin");
  const navigate = useNavigate();
  const [status, setStatus] = useState<TurboLensStatus | null>(null);

  useEffect(() => {
    api.get<TurboLensStatus>("/turbolens/status").then(setStatus).catch(() => {});
  }, []);

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("turbolens_settings_description")}
      </Typography>

      {status && !status.ai_configured && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t("turbolens_ai_required")}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
          <MaterialSymbol icon="psychology" size={32} />
          <Box>
            <Typography variant="subtitle1" fontWeight="bold">
              {t("turbolens_title")}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
              <Chip
                size="small"
                label={status?.ai_configured ? t("turbolens_ai_configured") : t("turbolens_ai_not_configured")}
                color={status?.ai_configured ? "success" : "default"}
              />
              <Chip
                size="small"
                label={status?.ready ? t("turbolens_ready") : t("turbolens_not_ready")}
                color={status?.ready ? "success" : "default"}
              />
            </Stack>
          </Box>
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("turbolens_description")}
        </Typography>

        <Button
          variant="contained"
          onClick={() => navigate("/turbolens")}
          disabled={!status?.ready}
          startIcon={<MaterialSymbol icon="open_in_new" size={18} />}
        >
          {t("turbolens_open_dashboard")}
        </Button>
      </Paper>
    </Box>
  );
}
