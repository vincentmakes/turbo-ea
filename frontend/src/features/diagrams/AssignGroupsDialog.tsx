import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { DiagramGroup, DiagramSummary } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  diagram: DiagramSummary | null;
  groups: DiagramGroup[];
  /** Called with the diagram's new group ids so the gallery can update at once. */
  onSaved: (groupIds: string[]) => void;
  /** Re-fetch groups after an inline create. */
  onGroupsChanged: () => void;
}

export default function AssignGroupsDialog({
  open,
  onClose,
  diagram,
  groups,
  onSaved,
  onGroupsChanged,
}: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && diagram) {
      setSelected(new Set(diagram.group_ids || []));
      setNewName("");
    }
  }, [open, diagram]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createInline = useCallback(async () => {
    if (!newName.trim()) return;
    const created = await api.post<DiagramGroup>("/diagram-groups", {
      name: newName.trim(),
      sort_order: groups.length,
    });
    setNewName("");
    setSelected((prev) => new Set(prev).add(created.id));
    onGroupsChanged();
  }, [newName, groups.length, onGroupsChanged]);

  const save = useCallback(async () => {
    if (!diagram) return;
    setSaving(true);
    try {
      const ids = Array.from(selected);
      await api.put(`/diagrams/${diagram.id}/groups`, { group_ids: ids });
      onSaved(ids);
      onClose();
    } finally {
      setSaving(false);
    }
  }, [diagram, selected, onSaved, onClose]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth disableRestoreFocus>
      <DialogTitle>{t("assignGroups.title")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t("assignGroups.subtitle", { name: diagram?.name || "" })}
        </Typography>

        {groups.length === 0 ? (
          <Typography color="text.secondary" sx={{ mb: 1 }}>
            {t("assignGroups.empty")}
          </Typography>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column" }}>
            {groups.map((s) => (
              <FormControlLabel
                key={s.id}
                control={
                  <Checkbox
                    size="small"
                    checked={selected.has(s.id)}
                    onChange={() => toggle(s.id)}
                  />
                }
                label={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: "3px",
                        bgcolor: s.color || "action.selected",
                      }}
                    />
                    <span>{s.name}</span>
                  </Box>
                }
              />
            ))}
          </Box>
        )}

        {/* Inline create */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 2 }}>
          <TextField
            size="small"
            fullWidth
            placeholder={t("assignGroups.createPlaceholder")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) createInline();
            }}
          />
          <Button
            startIcon={<MaterialSymbol icon="add" size={16} />}
            onClick={createInline}
            disabled={!newName.trim()}
          >
            {t("assignGroups.create")}
          </Button>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button variant="contained" onClick={save} disabled={saving}>
          {t("common:actions.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
