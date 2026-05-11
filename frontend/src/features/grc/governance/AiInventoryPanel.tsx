import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";

export default function AiInventoryPanel() {
  const { t } = useTranslation("grc");
  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <MaterialSymbol icon="smart_toy" size={22} color="#1976d2" />
        <Typography variant="h6" fontWeight={600}>
          {t("governance.ai.title")}
        </Typography>
      </Box>
      <Alert severity="info" variant="outlined" icon={<MaterialSymbol icon="schedule" size={20} />}>
        <AlertTitle>{t("governance.ai.comingSoon")}</AlertTitle>
        <Typography variant="body2" color="text.secondary">
          {t("governance.ai.comingSoonHint")}
        </Typography>
      </Alert>
    </Box>
  );
}
