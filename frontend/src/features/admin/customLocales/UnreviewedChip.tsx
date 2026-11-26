/**
 * The "Community-provided, not reviewed" marker of a language from the
 * community library, with what that means in its tooltip. Shown in the
 * library's list and on an installed community language's row.
 */
import { useTranslation } from "react-i18next";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";

export default function UnreviewedChip() {
  const { t } = useTranslation("admin");
  return (
    <Tooltip title={t("customLocales.community.unreviewedHint")}>
      <Chip
        // Focusable, so the explanation is not for mouse users only.
        tabIndex={0}
        size="small"
        color="warning"
        variant="outlined"
        icon={<MaterialSymbol icon="groups" size={16} />}
        label={t("customLocales.community.unreviewed")}
      />
    </Tooltip>
  );
}
