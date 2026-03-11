import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { PpmWbs } from "@/types";

interface Props {
  initiativeId: string;
  wbs?: PpmWbs;
  wbsList: PpmWbs[];
  onClose: () => void;
  onSaved: () => void;
}

/** Collect all descendant IDs of a WBS item to prevent circular parents. */
function getDescendantIds(id: string, items: PpmWbs[]): Set<string> {
  const result = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const item of items) {
      if (item.parent_id === cur && !result.has(item.id)) {
        result.add(item.id);
        stack.push(item.id);
      }
    }
  }
  return result;
}

export default function PpmWbsDialog({
  initiativeId,
  wbs,
  wbsList,
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation("ppm");
  const isEdit = !!wbs;

  const [title, setTitle] = useState(wbs?.title || "");
  const [description, setDescription] = useState(wbs?.description || "");
  const [parentId, setParentId] = useState(wbs?.parent_id || "");
  const [startDate, setStartDate] = useState(wbs?.start_date || "");
  const [endDate, setEndDate] = useState(wbs?.end_date || "");
  const [saving, setSaving] = useState(false);

  // Filter parent options: exclude self and descendants
  const excludeIds = wbs ? getDescendantIds(wbs.id, wbsList) : new Set<string>();
  if (wbs) excludeIds.add(wbs.id);
  const parentOptions = wbsList.filter((w) => !excludeIds.has(w.id));

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        parent_id: parentId || null,
        start_date: startDate || null,
        end_date: endDate || null,
      };
      if (isEdit) {
        await api.patch(`/ppm/wbs/${wbs.id}`, payload);
      } else {
        await api.post(`/ppm/initiatives/${initiativeId}/wbs`, payload);
      }
      onSaved();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!wbs) return;
    await api.delete(`/ppm/wbs/${wbs.id}`);
    onSaved();
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle>{isEdit ? t("editWbs") : t("addWbs")}</DialogTitle>
      <DialogContent>
        <Box display="flex" flexDirection="column" gap={2} mt={1}>
          <TextField
            label={t("wbsTitle")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            required
            autoFocus
          />
          <TextField
            label={t("wbsDescription")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={3}
          />
          <FormControl fullWidth size="small">
            <InputLabel>{t("wbsParent")}</InputLabel>
            <Select
              value={parentId}
              label={t("wbsParent")}
              onChange={(e) => setParentId(e.target.value)}
            >
              <MenuItem value="">—</MenuItem>
              {parentOptions.map((w) => (
                <MenuItem key={w.id} value={w.id}>
                  {w.title}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Box display="flex" gap={2}>
            <TextField
              label={t("wbsStartDate")}
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              fullWidth
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label={t("wbsEndDate")}
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              fullWidth
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        {isEdit && (
          <Button color="error" onClick={handleDelete} sx={{ mr: "auto" }}>
            {t("deleteWbs")}
          </Button>
        )}
        <Button onClick={onClose}>{t("common:actions.cancel", "Cancel")}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !title.trim()}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          {isEdit ? t("common:actions.save", "Save") : t("addWbs")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
