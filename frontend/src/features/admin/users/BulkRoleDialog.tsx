import { useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import type { AppRole } from "@/types";

interface BulkRoleDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (roleKey: string) => Promise<void>;
  roles: AppRole[];
  selectedCount: number;
}

export default function BulkRoleDialog({
  open,
  onClose,
  onConfirm,
  roles,
  selectedCount,
}: BulkRoleDialogProps) {
  const { t } = useTranslation(["admin", "common"]);
  const activeRoles = roles.filter((r) => !r.is_archived);
  const [roleKey, setRoleKey] = useState(activeRoles[0]?.key ?? "member");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    try {
      setSubmitting(true);
      setError(null);
      await onConfirm(roleKey);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:errors.generic"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !submitting && onClose()} maxWidth="xs" fullWidth>
      <DialogTitle>{t("users.bulk.changeRoleTitle")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t("users.bulk.changeRoleHelp", { count: selectedCount })}
          </Typography>
          <FormControl fullWidth size="small">
            <InputLabel>{t("users.columns.role")}</InputLabel>
            <Select
              label={t("users.columns.role")}
              value={roleKey}
              onChange={(e) => setRoleKey(e.target.value as string)}
            >
              {activeRoles.map((r) => (
                <MenuItem key={r.key} value={r.key}>
                  <Chip
                    size="small"
                    label={r.label}
                    sx={{
                      bgcolor: r.color + "22",
                      color: r.color,
                      fontWeight: 600,
                      border: `1px solid ${r.color}44`,
                      pointerEvents: "none",
                    }}
                  />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={submitting}>
          {t("common:actions.cancel")}
        </Button>
        <Button variant="contained" onClick={handleConfirm} disabled={submitting}>
          {submitting ? t("users.edit.saving") : t("common:actions.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
