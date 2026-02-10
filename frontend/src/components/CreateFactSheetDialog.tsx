import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type { FactSheet } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (fs: FactSheet) => void;
  initialType?: string;
}

export default function CreateFactSheetDialog({ open, onClose, onCreate, initialType }: Props) {
  const { types } = useMetamodel();
  const [selectedType, setSelectedType] = useState(initialType || "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [attributes, setAttributes] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);

  const typeConfig = types.find((t) => t.key === selectedType);

  const handleCreate = async () => {
    if (!selectedType || !name.trim()) return;
    setLoading(true);
    try {
      const fs = await api.post<FactSheet>("/fact-sheets", {
        type: selectedType,
        name: name.trim(),
        description: description.trim() || undefined,
        attributes,
      });
      onCreate(fs);
      // Reset
      setName("");
      setDescription("");
      setAttributes({});
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const setAttr = (key: string, value: unknown) => {
    setAttributes((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <MaterialSymbol icon="add_circle" size={24} color="#1976d2" />
        Create Fact Sheet
      </DialogTitle>
      <DialogContent>
        <FormControl fullWidth sx={{ mt: 1, mb: 2 }}>
          <InputLabel>Fact Sheet Type</InputLabel>
          <Select
            value={selectedType}
            label="Fact Sheet Type"
            onChange={(e) => {
              setSelectedType(e.target.value);
              setAttributes({});
            }}
          >
            {types.map((t) => (
              <MenuItem key={t.key} value={t.key}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <MaterialSymbol icon={t.icon} size={18} color={t.color} />
                  {t.label}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          fullWidth
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          multiline
          rows={3}
          sx={{ mb: 2 }}
        />

        {typeConfig && typeConfig.fields_schema.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            {typeConfig.fields_schema.map((section) => (
              <Box key={section.section} sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  {section.section}
                </Typography>
                {section.fields.map((field) => {
                  if (field.type === "single_select" && field.options) {
                    return (
                      <FormControl fullWidth key={field.key} sx={{ mb: 1.5 }}>
                        <InputLabel>{field.label}</InputLabel>
                        <Select
                          value={(attributes[field.key] as string) || ""}
                          label={field.label}
                          onChange={(e) => setAttr(field.key, e.target.value)}
                        >
                          <MenuItem value="">
                            <em>None</em>
                          </MenuItem>
                          {field.options.map((opt) => (
                            <MenuItem key={opt.key} value={opt.key}>
                              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                {opt.color && (
                                  <Box
                                    sx={{
                                      width: 12,
                                      height: 12,
                                      borderRadius: "50%",
                                      bgcolor: opt.color,
                                    }}
                                  />
                                )}
                                {opt.label}
                              </Box>
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    );
                  }
                  if (field.type === "number") {
                    return (
                      <TextField
                        key={field.key}
                        fullWidth
                        label={field.label}
                        type="number"
                        value={attributes[field.key] ?? ""}
                        onChange={(e) => setAttr(field.key, e.target.value ? Number(e.target.value) : undefined)}
                        sx={{ mb: 1.5 }}
                      />
                    );
                  }
                  if (field.type === "boolean") {
                    return (
                      <FormControlLabel
                        key={field.key}
                        control={
                          <Switch
                            checked={!!attributes[field.key]}
                            onChange={(e) => setAttr(field.key, e.target.checked)}
                          />
                        }
                        label={field.label}
                        sx={{ mb: 1 }}
                      />
                    );
                  }
                  if (field.type === "date") {
                    return (
                      <TextField
                        key={field.key}
                        fullWidth
                        label={field.label}
                        type="date"
                        value={(attributes[field.key] as string) || ""}
                        onChange={(e) => setAttr(field.key, e.target.value)}
                        InputLabelProps={{ shrink: true }}
                        sx={{ mb: 1.5 }}
                      />
                    );
                  }
                  return (
                    <TextField
                      key={field.key}
                      fullWidth
                      label={field.label}
                      value={(attributes[field.key] as string) || ""}
                      onChange={(e) => setAttr(field.key, e.target.value)}
                      sx={{ mb: 1.5 }}
                    />
                  );
                })}
              </Box>
            ))}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={!selectedType || !name.trim() || loading}
        >
          {loading ? "Creating..." : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
