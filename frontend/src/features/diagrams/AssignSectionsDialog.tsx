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
import type { DiagramSection, DiagramSummary } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  diagram: DiagramSummary | null;
  sections: DiagramSection[];
  /** Called with the diagram's new section ids so the gallery can update at once. */
  onSaved: (sectionIds: string[]) => void;
  /** Re-fetch sections after an inline create. */
  onSectionsChanged: () => void;
}

export default function AssignSectionsDialog({
  open,
  onClose,
  diagram,
  sections,
  onSaved,
  onSectionsChanged,
}: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && diagram) {
      setSelected(new Set(diagram.section_ids || []));
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
    const created = await api.post<DiagramSection>("/diagram-sections", {
      name: newName.trim(),
      sort_order: sections.length,
    });
    setNewName("");
    setSelected((prev) => new Set(prev).add(created.id));
    onSectionsChanged();
  }, [newName, sections.length, onSectionsChanged]);

  const save = useCallback(async () => {
    if (!diagram) return;
    setSaving(true);
    try {
      const ids = Array.from(selected);
      await api.put(`/diagrams/${diagram.id}/sections`, { section_ids: ids });
      onSaved(ids);
      onClose();
    } finally {
      setSaving(false);
    }
  }, [diagram, selected, onSaved, onClose]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth disableRestoreFocus>
      <DialogTitle>{t("assignSections.title")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t("assignSections.subtitle", { name: diagram?.name || "" })}
        </Typography>

        {sections.length === 0 ? (
          <Typography color="text.secondary" sx={{ mb: 1 }}>
            {t("assignSections.empty")}
          </Typography>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column" }}>
            {sections.map((s) => (
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
            placeholder={t("assignSections.createPlaceholder")}
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
            {t("assignSections.create")}
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
