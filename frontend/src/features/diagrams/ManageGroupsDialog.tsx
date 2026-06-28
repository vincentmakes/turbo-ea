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
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import Chip from "@mui/material/Chip";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColorPicker from "@/components/ColorPicker";
import { api } from "@/api/client";
import type { DiagramGroup } from "@/types";

const DEFAULT_COLOR = "#60a5fa";

interface Props {
  open: boolean;
  onClose: () => void;
  groups: DiagramGroup[];
  onChanged: () => void;
}

export default function ManageGroupsDialog({ open, onClose, groups, onChanged }: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_COLOR);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    if (open) {
      setNewName("");
      setNewColor(DEFAULT_COLOR);
      setEditId(null);
    }
  }, [open]);

  const create = useCallback(async () => {
    if (!newName.trim()) return;
    await api.post("/diagram-groups", {
      name: newName.trim(),
      color: newColor,
      sort_order: groups.length,
    });
    setNewName("");
    setNewColor(DEFAULT_COLOR);
    onChanged();
  }, [newName, newColor, groups.length, onChanged]);

  const saveEdit = useCallback(async () => {
    if (!editId || !editName.trim()) return;
    await api.patch(`/diagram-groups/${editId}`, { name: editName.trim() });
    setEditId(null);
    onChanged();
  }, [editId, editName, onChanged]);

  const updateColor = useCallback(
    async (id: string, color: string) => {
      await api.patch(`/diagram-groups/${id}`, { color });
      onChanged();
    },
    [onChanged],
  );

  const remove = useCallback(
    async (s: DiagramGroup) => {
      if (!window.confirm(t("manageGroups.deleteConfirm", { name: s.name }))) return;
      await api.delete(`/diagram-groups/${s.id}`);
      onChanged();
    },
    [t, onChanged],
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t("manageGroups.title")}</DialogTitle>
      <DialogContent>
        {/* Create new */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1, mb: 2 }}>
          <ColorPicker value={newColor} onChange={setNewColor} compact />
          <TextField
            size="small"
            fullWidth
            placeholder={t("manageGroups.newName")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) create();
            }}
          />
          <Button variant="contained" onClick={create} disabled={!newName.trim()}>
            {t("manageGroups.add")}
          </Button>
        </Box>

        {groups.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
            {t("manageGroups.empty")}
          </Typography>
        ) : (
          <List dense disablePadding>
            {groups.map((s) => (
              <ListItem
                key={s.id}
                disableGutters
                secondaryAction={
                  <Box sx={{ display: "flex", gap: 0.5 }}>
                    {editId === s.id ? (
                      <IconButton size="small" onClick={saveEdit} color="primary">
                        <MaterialSymbol icon="check" size={18} />
                      </IconButton>
                    ) : (
                      <IconButton
                        size="small"
                        onClick={() => {
                          setEditId(s.id);
                          setEditName(s.name);
                        }}
                        title={t("manageGroups.rename")}
                      >
                        <MaterialSymbol icon="edit" size={18} />
                      </IconButton>
                    )}
                    <IconButton
                      size="small"
                      onClick={() => remove(s)}
                      sx={{ color: "error.main" }}
                    >
                      <MaterialSymbol icon="delete" size={18} />
                    </IconButton>
                  </Box>
                }
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1, pr: 8 }}>
                  <ColorPicker
                    value={s.color || DEFAULT_COLOR}
                    onChange={(c) => updateColor(s.id, c)}
                    compact
                  />
                  {editId === s.id ? (
                    <TextField
                      size="small"
                      fullWidth
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editName.trim()) saveEdit();
                      }}
                      autoFocus
                    />
                  ) : (
                    <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                      {s.name}
                    </Typography>
                  )}
                  <Chip
                    size="small"
                    label={t("manageGroups.diagramCount", { count: s.diagram_count })}
                    variant="outlined"
                  />
                </Box>
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
