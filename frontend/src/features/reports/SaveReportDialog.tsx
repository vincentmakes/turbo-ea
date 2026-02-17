import { useState, useEffect } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Autocomplete from "@mui/material/Autocomplete";
import Chip from "@mui/material/Chip";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { User } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  reportType: string;
  config: Record<string, unknown>;
  thumbnail?: string;
  onSaved?: (id: string) => void;
}

export default function SaveReportDialog({ open, onClose, reportType, config, thumbnail, onSaved }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public" | "shared">("private");
  const [sharedWith, setSharedWith] = useState<User[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && visibility === "shared" && users.length === 0) {
      api.get<User[]>("/users").then(setUsers).catch(() => {});
    }
  }, [open, visibility, users.length]);

  // Reset form on open
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setVisibility("private");
      setSharedWith([]);
    }
  }, [open]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await api.post<{ id: string }>("/saved-reports", {
        name: name.trim(),
        description: description.trim() || null,
        report_type: reportType,
        config,
        thumbnail: thumbnail || null,
        visibility,
        shared_with: visibility === "shared" ? sharedWith.map((u) => u.id) : null,
      });
      onSaved?.(res.id);
      onClose();
    } catch {
      // error handled by api client
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <MaterialSymbol icon="bookmark_add" size={22} color="#1976d2" />
        Save Report
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          required
          autoFocus
          size="small"
          placeholder="e.g. Q1 Application Portfolio"
        />
        <TextField
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
          multiline
          rows={2}
          size="small"
          placeholder="Optional description of this report view"
        />
        <TextField
          select
          label="Visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as "private" | "public" | "shared")}
          fullWidth
          size="small"
        >
          <MenuItem value="private">
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <MaterialSymbol icon="lock" size={16} />
              Private — Only me
            </Box>
          </MenuItem>
          <MenuItem value="public">
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <MaterialSymbol icon="public" size={16} />
              Public — All users
            </Box>
          </MenuItem>
          <MenuItem value="shared">
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <MaterialSymbol icon="group" size={16} />
              Shared — Specific users
            </Box>
          </MenuItem>
        </TextField>

        {visibility === "shared" && (
          <Autocomplete
            multiple
            options={users.filter((u) => u.is_active)}
            getOptionLabel={(u) => `${u.display_name} (${u.email})`}
            value={sharedWith}
            onChange={(_, v) => setSharedWith(v)}
            renderTags={(value, getTagProps) =>
              value.map((u, idx) => (
                <Chip label={u.display_name} size="small" {...getTagProps({ index: idx })} key={u.id} />
              ))
            }
            renderInput={(params) => (
              <TextField {...params} label="Share with" size="small" placeholder="Search users..." />
            )}
            size="small"
          />
        )}

        {thumbnail && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
              Preview
            </Typography>
            <Box
              component="img"
              src={thumbnail}
              alt="Report preview"
              sx={{ width: "100%", maxHeight: 150, objectFit: "contain", borderRadius: 1, border: "1px solid", borderColor: "divider" }}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!name.trim() || saving}
          startIcon={saving ? <CircularProgress size={16} /> : <MaterialSymbol icon="save" size={18} />}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
