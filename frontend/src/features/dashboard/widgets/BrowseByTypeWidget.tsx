/**
 * The Overview's "Browse by type" list: every type the viewer may read that
 * has cards, plus the four core types even when empty. A click opens the
 * inventory on that type.
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useReadableCardTypes } from "@/hooks/useReadableCardTypes";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import { useDashboardSource } from "../DashboardSources";

/** Shown even with no cards, as the homepage always did. */
const ALWAYS_SHOWN = ["Application", "BusinessCapability", "ITComponent", "Initiative"];

export default function BrowseByTypeWidget() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const typeLabel = useTypeLabel();
  const readableTypes = useReadableCardTypes("module");
  const { data, loading, error } = useDashboardSource("reports.dashboard");

  if (error && !data) return <Alert severity="error">{error.message || t("errors.generic")}</Alert>;
  if (loading && !data) return <LinearProgress sx={{ my: 2 }} />;
  const byType = data?.by_type ?? {};

  // A type the user may not see gets no row — not even an empty one for the
  // four always-shown types.
  const rows = readableTypes.filter(
    (ct) => !ct.is_hidden && ((byType[ct.key] ?? 0) > 0 || ALWAYS_SHOWN.includes(ct.key)),
  );

  return (
    <Box>
      {rows.map((ct) => (
        <Box
          key={ct.key}
          role="link"
          tabIndex={0}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            py: 1,
            cursor: "pointer",
            "&:hover": { bgcolor: "action.hover" },
            borderRadius: 1,
            px: 1,
          }}
          onClick={() => navigate(`/inventory?type=${ct.key}`)}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigate(`/inventory?type=${ct.key}`);
          }}
        >
          <MaterialSymbol icon={ct.icon} size={20} color={ct.color} />
          <Typography variant="body2" sx={{ flex: 1 }}>
            {typeLabel(ct)}
          </Typography>
          <Chip size="small" label={byType[ct.key] || 0} />
        </Box>
      ))}
    </Box>
  );
}
