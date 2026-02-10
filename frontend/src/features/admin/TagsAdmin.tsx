import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Chip from "@mui/material/Chip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { TagGroup } from "@/types";

export default function TagsAdmin() {
  const [groups, setGroups] = useState<TagGroup[]>([]);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [addTagGroupId, setAddTagGroupId] = useState<string | null>(null);
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#1976d2");

  const load = () => api.get<TagGroup[]>("/tag-groups").then(setGroups);

  useEffect(() => { load(); }, []);

  const createGroup = async () => {
    await api.post("/tag-groups", { name: groupName });
    setGroupName("");
    setCreateGroupOpen(false);
    load();
  };

  const createTag = async () => {
    if (!addTagGroupId) return;
    await api.post(`/tag-groups/${addTagGroupId}/tags`, { name: tagName, color: tagColor });
    setTagName("");
    setAddTagGroupId(null);
    load();
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
        <Typography variant="h5" fontWeight={600}>Tag Management</Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" startIcon={<MaterialSymbol icon="add" size={18} />} onClick={() => setCreateGroupOpen(true)}>
          New Tag Group
        </Button>
      </Box>

      {groups.map((g) => (
        <Card key={g.id} sx={{ mb: 2 }}>
          <CardContent>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
              <Typography variant="subtitle1" fontWeight={600}>{g.name}</Typography>
              <Chip size="small" label={g.mode} variant="outlined" />
              <Box sx={{ flex: 1 }} />
              <Button size="small" onClick={() => setAddTagGroupId(g.id)}>Add Tag</Button>
            </Box>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {g.tags.map((t) => (
                <Chip key={t.id} label={t.name} sx={t.color ? { bgcolor: t.color, color: "#fff" } : {}} />
              ))}
              {g.tags.length === 0 && <Typography variant="body2" color="text.secondary">No tags</Typography>}
            </Box>
          </CardContent>
        </Card>
      ))}

      <Dialog open={createGroupOpen} onClose={() => setCreateGroupOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New Tag Group</DialogTitle>
        <DialogContent>
          <TextField fullWidth label="Group Name" value={groupName} onChange={(e) => setGroupName(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateGroupOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={createGroup} disabled={!groupName.trim()}>Create</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!addTagGroupId} onClose={() => setAddTagGroupId(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Tag</DialogTitle>
        <DialogContent>
          <TextField fullWidth label="Tag Name" value={tagName} onChange={(e) => setTagName(e.target.value)} sx={{ mt: 1, mb: 2 }} />
          <TextField fullWidth label="Color" type="color" value={tagColor} onChange={(e) => setTagColor(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddTagGroupId(null)}>Cancel</Button>
          <Button variant="contained" onClick={createTag} disabled={!tagName.trim()}>Add</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
