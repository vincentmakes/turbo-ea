import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import ColorPicker from "@/components/ColorPicker";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Chip from "@mui/material/Chip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { Tag, TagGroup } from "@/types";

type DeleteTarget =
  | { kind: "group"; id: string; name: string }
  | { kind: "tag"; id: string; groupId: string; name: string };

export default function TagsAdmin() {
  const { t } = useTranslation(["admin", "common"]);
  const [groups, setGroups] = useState<TagGroup[]>([]);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [addTagGroupId, setAddTagGroupId] = useState<string | null>(null);
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#1976d2");

  const [editGroup, setEditGroup] = useState<TagGroup | null>(null);
  const [editGroupDraft, setEditGroupDraft] = useState({
    name: "",
    description: "",
    mode: "multi",
    mandatory: false,
  });
  const [editTag, setEditTag] = useState<Tag | null>(null);
  const [editTagDraft, setEditTagDraft] = useState({ name: "", color: "#1976d2" });
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const load = () => api.get<TagGroup[]>("/tag-groups").then(setGroups);

  useEffect(() => {
    load();
  }, []);

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

  const openEditGroup = (g: TagGroup) => {
    setEditGroup(g);
    setEditGroupDraft({
      name: g.name,
      description: g.description ?? "",
      mode: g.mode,
      mandatory: g.mandatory,
    });
  };

  const updateGroup = async () => {
    if (!editGroup) return;
    await api.patch(`/tag-groups/${editGroup.id}`, editGroupDraft);
    setEditGroup(null);
    load();
  };

  const openEditTag = (tag: Tag) => {
    setEditTag(tag);
    setEditTagDraft({ name: tag.name, color: tag.color ?? "#1976d2" });
  };

  const updateTag = async () => {
    if (!editTag) return;
    await api.patch(`/tag-groups/${editTag.tag_group_id}/tags/${editTag.id}`, editTagDraft);
    setEditTag(null);
    load();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.kind === "group") {
      await api.delete(`/tag-groups/${deleteTarget.id}`);
    } else {
      await api.delete(`/tag-groups/${deleteTarget.groupId}/tags/${deleteTarget.id}`);
    }
    setDeleteTarget(null);
    load();
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
        <Typography variant="h5" fontWeight={600}>{t("tags.title")}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" startIcon={<MaterialSymbol icon="add" size={18} />} onClick={() => setCreateGroupOpen(true)}>
          {t("tags.newGroup")}
        </Button>
      </Box>

      {groups.map((g) => (
        <Card key={g.id} sx={{ mb: 2 }}>
          <CardContent>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
              <Typography variant="subtitle1" fontWeight={600}>{g.name}</Typography>
              <Chip size="small" label={g.mode} variant="outlined" />
              {g.mandatory && <Chip size="small" label={t("tags.mandatory")} color="primary" variant="outlined" />}
              <Box sx={{ flex: 1 }} />
              <Button size="small" onClick={() => setAddTagGroupId(g.id)}>{t("tags.addTag")}</Button>
              <IconButton size="small" aria-label={t("tags.editGroup")} title={t("tags.editGroup")} onClick={() => openEditGroup(g)}>
                <MaterialSymbol icon="edit" size={18} />
              </IconButton>
              <IconButton size="small" color="error" aria-label={t("tags.deleteGroup")} title={t("tags.deleteGroup")} onClick={() => setDeleteTarget({ kind: "group", id: g.id, name: g.name })}>
                <MaterialSymbol icon="delete" size={18} />
              </IconButton>
            </Box>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {g.tags.map((tag) => (
                <Chip
                  key={tag.id}
                  label={tag.name}
                  sx={tag.color ? { bgcolor: tag.color, color: "#fff" } : {}}
                  onClick={() => openEditTag(tag)}
                  onDelete={() => setDeleteTarget({ kind: "tag", id: tag.id, groupId: g.id, name: tag.name })}
                />
              ))}
              {g.tags.length === 0 && <Typography variant="body2" color="text.secondary">{t("tags.noTags")}</Typography>}
            </Box>
          </CardContent>
        </Card>
      ))}

      <Dialog open={createGroupOpen} onClose={() => setCreateGroupOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("tags.newGroup")}</DialogTitle>
        <DialogContent>
          <TextField fullWidth label={t("tags.groupName")} value={groupName} onChange={(e) => setGroupName(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateGroupOpen(false)}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" onClick={createGroup} disabled={!groupName.trim()}>{t("common:actions.create")}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!addTagGroupId} onClose={() => setAddTagGroupId(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("tags.addTag")}</DialogTitle>
        <DialogContent>
          <TextField fullWidth label={t("tags.tagName")} value={tagName} onChange={(e) => setTagName(e.target.value)} sx={{ mt: 1, mb: 2 }} />
          <ColorPicker value={tagColor} onChange={setTagColor} label={t("tags.color")} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddTagGroupId(null)}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" onClick={createTag} disabled={!tagName.trim()}>{t("common:actions.add")}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!editGroup} onClose={() => setEditGroup(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("tags.editGroup")}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label={t("tags.groupName")}
            value={editGroupDraft.name}
            onChange={(e) => setEditGroupDraft((d) => ({ ...d, name: e.target.value }))}
            sx={{ mt: 1, mb: 2 }}
          />
          <TextField
            fullWidth
            multiline
            minRows={2}
            label={t("tags.description")}
            value={editGroupDraft.description}
            onChange={(e) => setEditGroupDraft((d) => ({ ...d, description: e.target.value }))}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            select
            label={t("tags.mode")}
            value={editGroupDraft.mode}
            onChange={(e) => setEditGroupDraft((d) => ({ ...d, mode: e.target.value }))}
            sx={{ mb: 2 }}
          >
            <MenuItem value="single">{t("tags.modeSingle")}</MenuItem>
            <MenuItem value="multi">{t("tags.modeMulti")}</MenuItem>
          </TextField>
          <FormControlLabel
            control={
              <Switch
                checked={editGroupDraft.mandatory}
                onChange={(e) => setEditGroupDraft((d) => ({ ...d, mandatory: e.target.checked }))}
              />
            }
            label={t("tags.mandatory")}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditGroup(null)}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" onClick={updateGroup} disabled={!editGroupDraft.name.trim()}>
            {t("common:actions.save")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!editTag} onClose={() => setEditTag(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("tags.editTag")}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label={t("tags.tagName")}
            value={editTagDraft.name}
            onChange={(e) => setEditTagDraft((d) => ({ ...d, name: e.target.value }))}
            sx={{ mt: 1, mb: 2 }}
          />
          <ColorPicker
            value={editTagDraft.color}
            onChange={(c) => setEditTagDraft((d) => ({ ...d, color: c }))}
            label={t("tags.color")}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditTag(null)}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" onClick={updateTag} disabled={!editTagDraft.name.trim()}>
            {t("common:actions.save")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {deleteTarget?.kind === "group" ? t("tags.deleteGroup") : t("tags.deleteTag")}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {deleteTarget?.kind === "group"
              ? t("tags.deleteGroupConfirm", { name: deleteTarget?.name })
              : t("tags.deleteTagConfirm", { name: deleteTarget?.name })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" color="error" onClick={confirmDelete}>
            {t("common:actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
