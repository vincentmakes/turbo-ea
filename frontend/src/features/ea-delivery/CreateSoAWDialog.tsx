import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { api } from "@/api/client";
import type { SoAW } from "@/types";

interface InitiativeOption {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Caller decides what to do after a SoAW is created — navigate, refresh, both. */
  onCreated: (soaw: SoAW) => void;
  /**
   * Skip the initiative picker and pin this initiative on submit. Used when
   * the dialog is launched from an Initiative card's SoAW tab.
   */
  fixedInitiativeId?: string;
  /**
   * Initiatives shown in the picker. Required when ``fixedInitiativeId`` is
   * not provided. Pass an empty array to surface "no initiatives yet".
   */
  initiatives?: InitiativeOption[];
}

/**
 * Reusable SoAW creation dialog.
 *
 * Lifted out of the now-deleted EADeliveryPage so the same dialog can power:
 *   - the SoAW tab on Initiative card detail (pinned to that initiative), and
 *   - the EA Delivery report under /reports/ea-delivery (free choice).
 */
export default function CreateSoAWDialog({
  open,
  onClose,
  onCreated,
  fixedInitiativeId,
  initiatives,
}: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const [name, setName] = useState("");
  const [initiativeId, setInitiativeId] = useState(fixedInitiativeId ?? "");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state every time the dialog opens.
  useEffect(() => {
    if (open) {
      setName("");
      setInitiativeId(fixedInitiativeId ?? "");
      setError(null);
    }
  }, [open, fixedInitiativeId]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.post<SoAW>("/soaw", {
        name: name.trim(),
        initiative_id: initiativeId || null,
      });
      onCreated(created);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.createSoaw"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("createDialog.title")}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          label={t("createDialog.documentName")}
          fullWidth
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mt: 1, mb: 2 }}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          error={!!error}
          helperText={error || undefined}
        />
        {!fixedInitiativeId && (
          <TextField
            select
            label={t("createDialog.initiative")}
            fullWidth
            value={initiativeId}
            onChange={(e) => setInitiativeId(e.target.value)}
            helperText={t("createDialog.initiativeHelper")}
          >
            <MenuItem value="">
              <em>{t("common:labels.none")}</em>
            </MenuItem>
            {(initiatives ?? []).map((init) => (
              <MenuItem key={init.id} value={init.id}>
                {init.name}
              </MenuItem>
            ))}
          </TextField>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          disabled={!name.trim() || creating}
          onClick={handleCreate}
        >
          {creating ? t("createDialog.creating") : t("common:actions.create")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
