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
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { SavedReport, User } from "@/types";

interface Props {
  open: boolean;
  report: SavedReport | null;
  onClose: () => void;
  onUpdated: () => void;
}

export default function EditReportDialog({ open, report, onClose, onUpdated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public" | "shared">("private");
  const [sharedWith, setSharedWith] = useState<User[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && report) {
      setName(report.name);
      setDescription(report.description || "");
      setVisibility(report.visibility);
      // Pre-select shared users
      if (report.shared_with_users) {
        setSharedWith(report.shared_with_users.map((u) => ({
          id: u.id,
          display_name: u.display_name,
          email: u.email,
          role: "",
          is_active: true,
        })));
      }
    }
  }, [open, report]);

  useEffect(() => {
    if (open && visibility === "shared" && users.length === 0) {
      api.get<User[]>("/users").then(setUsers).catch(() => {});
    }
  }, [open, visibility, users.length]);

  const handleSave = async () => {
    if (!report || !name.trim()) return;
    setSaving(true);
    try {
      await api.patch(`/saved-reports/${report.id}`, {
        name: name.trim(),
        description: description.trim() || null,
        visibility,
        shared_with: visibility === "shared" ? sharedWith.map((u) => u.id) : [],
      });
      onUpdated();
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
        <MaterialSymbol icon="edit" size={22} color="#1976d2" />
        Edit Saved Report
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
        />
        <TextField
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
          multiline
          rows={2}
          size="small"
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
            isOptionEqualToValue={(o, v) => o.id === v.id}
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
