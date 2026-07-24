import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useAuthContext } from "@/hooks/AuthContext";

interface Props {
  permission: string | string[];
  children: React.ReactNode;
}

export function hasPermission(
  perms: Record<string, boolean> | undefined,
  permission: string | string[],
): boolean {
  if (!perms) return false;
  if (perms["*"]) return true;
  if (Array.isArray(permission)) return permission.some((p) => !!perms[p]);
  return !!perms[permission];
}

export default function RequirePermission({ permission, children }: Props) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const { user } = useAuthContext();

  if (hasPermission(user?.permissions, permission)) {
    return <>{children}</>;
  }

  return (
    <Box sx={{ maxWidth: 640, mx: "auto", mt: { xs: 4, sm: 8 }, px: 2 }}>
      <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
        <Stack alignItems="center" spacing={2}>
          <MaterialSymbol icon="block" size={56} color="#888" />
          <Typography variant="h5" fontWeight={600}>
            {t("accessDenied.title")}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t("accessDenied.body")}
          </Typography>
          <Button variant="contained" onClick={() => navigate("/")} sx={{ mt: 1 }}>
            {t("moduleDisabled.backToDashboard")}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
