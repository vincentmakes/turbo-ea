import { useState } from "react";
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
        Create Card
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
        <TextField
          select
          label="Type"
          size="small"
          fullWidth
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
        >
          {visibleTypes.map((t) => (
            <MenuItem key={t.key} value={t.key}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: t.color,
                    flexShrink: 0,
                  }}
                />
                {t.label}
              </Box>
            </MenuItem>
          ))}
        </TextField>

        <TextField
          label="Name"
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
          label="Description (optional)"
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
            Will be added to the diagram as a pending{" "}
            <strong style={{ color: typeInfo.color }}>{typeInfo.label}</strong>.
            Synchronise to save it to the inventory.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button variant="contained" disabled={!valid} onClick={handleCreate}>
          Add to Diagram
        </Button>
      </DialogActions>
    </Dialog>
  );
}
