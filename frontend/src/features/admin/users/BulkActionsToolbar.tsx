import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MaterialSymbol from "@/components/MaterialSymbol";

interface BulkActionsToolbarProps {
  selectedCount: number;
  onChangeRole: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onDelete: () => void;
  onClear: () => void;
  busy?: boolean;
}

export default function BulkActionsToolbar({
  selectedCount,
  onChangeRole,
  onActivate,
  onDeactivate,
  onDelete,
  onClear,
  busy = false,
}: BulkActionsToolbarProps) {
  const { t } = useTranslation(["admin", "common"]);
  if (selectedCount === 0) return null;

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        p: 1,
        mb: 1.5,
        borderRadius: 1,
        bgcolor: "primary.main",
        color: "primary.contrastText",
        flexWrap: "wrap",
      }}
    >
      <Chip
        size="small"
        label={t("users.bulk.selected", { count: selectedCount })}
        sx={{ bgcolor: "primary.contrastText", color: "primary.main", fontWeight: 600 }}
      />
      <Box sx={{ flex: 1 }} />
      <Button
        size="small"
        variant="outlined"
        disabled={busy}
        onClick={onChangeRole}
        startIcon={<MaterialSymbol icon="badge" size={18} />}
        sx={{ color: "inherit", borderColor: "currentColor" }}
      >
        {t("users.bulk.changeRole")}
      </Button>
      <Button
        size="small"
        variant="outlined"
        disabled={busy}
        onClick={onActivate}
        startIcon={<MaterialSymbol icon="person" size={18} />}
        sx={{ color: "inherit", borderColor: "currentColor" }}
      >
        {t("users.bulk.activate")}
      </Button>
      <Button
        size="small"
        variant="outlined"
        disabled={busy}
        onClick={onDeactivate}
        startIcon={<MaterialSymbol icon="person_off" size={18} />}
        sx={{ color: "inherit", borderColor: "currentColor" }}
      >
        {t("users.bulk.deactivate")}
      </Button>
      <Button
        size="small"
        variant="outlined"
        disabled={busy}
        onClick={onDelete}
        startIcon={<MaterialSymbol icon="delete" size={18} />}
        sx={{ color: "inherit", borderColor: "currentColor" }}
      >
        {t("users.bulk.delete")}
      </Button>
      <Button
        size="small"
        disabled={busy}
        onClick={onClear}
        sx={{ color: "inherit", minWidth: 0 }}
        title={t("users.bulk.clear")}
      >
        <MaterialSymbol icon="close" size={18} />
      </Button>
    </Box>
  );
}
