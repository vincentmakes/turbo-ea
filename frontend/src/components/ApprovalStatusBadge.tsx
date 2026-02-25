import { useState } from "react";
import Chip from "@mui/material/Chip";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "./MaterialSymbol";

interface Props {
  status: string;
  size?: "small" | "medium";
  canChange?: boolean;
  onAction?: (action: "approve" | "reject" | "reset") => void;
}

const STATUS_CONFIG: Record<
  string,
  { color: "default" | "success" | "warning" | "error"; icon: string }
> = {
  DRAFT: { color: "default", icon: "edit_note" },
  APPROVED: { color: "success", icon: "verified" },
  BROKEN: { color: "warning", icon: "warning" },
  REJECTED: { color: "error", icon: "cancel" },
};

export default function ApprovalStatusBadge({
  status,
  size = "small",
  canChange,
  onAction,
}: Props) {
  const { t } = useTranslation("common");
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const cfg = STATUS_CONFIG[status];
  if (!cfg) return null;

  const interactive = canChange && onAction;

  return (
    <>
      <Chip
        size={size}
        label={t(`status.${status.toLowerCase()}`)}
        color={cfg.color}
        variant="outlined"
        icon={<MaterialSymbol icon={cfg.icon} size={16} />}
        deleteIcon={
          interactive ? (
            <MaterialSymbol icon="arrow_drop_down" size={18} />
          ) : undefined
        }
        onDelete={interactive ? (e) => setAnchorEl(e.currentTarget.closest(".MuiChip-root")) : undefined}
        onClick={interactive ? (e) => setAnchorEl(e.currentTarget) : undefined}
        sx={interactive ? { cursor: "pointer" } : undefined}
      />
      {interactive && (
        <Menu
          anchorEl={anchorEl}
          open={!!anchorEl}
          onClose={() => setAnchorEl(null)}
        >
          <MenuItem
            onClick={() => { onAction("approve"); setAnchorEl(null); }}
            disabled={status === "APPROVED"}
          >
            <MaterialSymbol icon="verified" size={18} color="#4caf50" />
            <Typography sx={{ ml: 1 }}>{t("actions.approve")}</Typography>
          </MenuItem>
          <MenuItem
            onClick={() => { onAction("reject"); setAnchorEl(null); }}
            disabled={status === "REJECTED"}
          >
            <MaterialSymbol icon="cancel" size={18} color="#f44336" />
            <Typography sx={{ ml: 1 }}>{t("actions.reject")}</Typography>
          </MenuItem>
          <MenuItem
            onClick={() => { onAction("reset"); setAnchorEl(null); }}
            disabled={status === "DRAFT"}
          >
            <MaterialSymbol icon="restart_alt" size={18} color="#9e9e9e" />
            <Typography sx={{ ml: 1 }}>
              {t("actions.resetToDraft")}
            </Typography>
          </MenuItem>
        </Menu>
      )}
    </>
  );
}
