import { useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useResolveMetaLabel } from "@/hooks/useResolveLabel";
import type { CardType } from "@/types";

interface Props {
  open: boolean;
  types: CardType[];
  onClose: () => void;
  onCreate: (data: { type: string; name: string; description?: string }) => void;
}

/**
 * Lightweight dialog for creating a new card directly from the diagram.
 * Only asks for type + name (+ optional description).  The actual API call is
 * deferred until the user synchronises from the sync panel.
 */
export default function CreateOnDiagramDialog({ open, types, onClose, onCreate }: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const rml = useResolveMetaLabel();
  const [selectedType, setSelectedType] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const visibleTypes = types.filter((t) => !t.is_hidden);
  const typeInfo = visibleTypes.find((t) => t.key === selectedType);
  const valid = selectedType && name.trim().length > 0;

  const handleCreate = () => {
    if (!valid) return;
    onCreate({
      type: selectedType,
      name: name.trim(),
      description: description.trim() || undefined,
    });
    // Reset form
    setSelectedType("");
    setName("");
    setDescription("");
  };

  const handleClose = () => {
    setSelectedType("");
    setName("");
    setDescription("");
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <MaterialSymbol icon="note_add" size={22} color="#6a1b9a" />
        {t("createOnDiagram.title")}
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
        <TextField
          select
          label={t("common:labels.type")}
          size="small"
          fullWidth
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
        >
          {visibleTypes.map((tp) => (
            <MenuItem key={tp.key} value={tp.key}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: tp.color,
                    flexShrink: 0,
                  }}
                />
                {rml(tp.label, tp.translations, "label")}
              </Box>
            </MenuItem>
          ))}
        </TextField>

        <TextField
          label={t("common:labels.name")}
          size="small"
          fullWidth
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid) handleCreate();
          }}
        />

        <TextField
          label={t("createOnDiagram.descriptionOptional")}
          size="small"
          fullWidth
          multiline
          minRows={2}
          maxRows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {typeInfo && (
          <Typography variant="caption" color="text.disabled">
            {t("createOnDiagram.pendingHintPre")}{" "}
            <strong style={{ color: typeInfo.color }}>{rml(typeInfo.label, typeInfo.translations, "label")}</strong>.{" "}
            {t("createOnDiagram.pendingHintPost")}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t("common:actions.cancel")}</Button>
        <Button variant="contained" disabled={!valid} onClick={handleCreate}>
          {t("createOnDiagram.addToDiagram")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
