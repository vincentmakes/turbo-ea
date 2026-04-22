import { useState, useEffect, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import TagPicker from "@/components/TagPicker";
import { api } from "@/api/client";
import type { Card, TagGroup, TagRef } from "@/types";

interface Props {
  card: Card;
  onUpdate: () => void;
  canEdit?: boolean;
  initialExpanded?: boolean;
}

export default function TagsSection({
  card,
  onUpdate,
  canEdit = true,
  initialExpanded = true,
}: Props) {
  const { t } = useTranslation(["cards", "common"]);
  const [groups, setGroups] = useState<TagGroup[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<TagGroup[]>("/tag-groups").then(setGroups).catch(() => {});
  }, []);

  const applicableGroups = useMemo(
    () =>
      groups.filter(
        (g) =>
          !g.restrict_to_types ||
          g.restrict_to_types.length === 0 ||
          g.restrict_to_types.includes(card.type),
      ),
    [groups, card.type],
  );

  const grouped = useMemo(() => {
    const by: Record<string, TagRef[]> = {};
    for (const tag of card.tags) {
      const key = tag.group_name || t("tags.ungrouped");
      (by[key] ||= []).push(tag);
    }
    return by;
  }, [card.tags, t]);

  const openEdit = () => {
    setDraftIds(card.tags.map((tag) => tag.id));
    setEditOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const oldIds = new Set(card.tags.map((tag) => tag.id));
      const newIds = new Set(draftIds);
      const toAdd = [...newIds].filter((id) => !oldIds.has(id));
      const toRemove = [...oldIds].filter((id) => !newIds.has(id));
      if (toAdd.length > 0) {
        await api.post(`/cards/${card.id}/tags`, toAdd);
      }
      for (const id of toRemove) {
        await api.delete(`/cards/${card.id}/tags/${id}`);
      }
      setEditOpen(false);
      onUpdate();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Accordion defaultExpanded={initialExpanded} sx={{ mb: 2 }}>
      <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            {t("sections.tags")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            ({card.tags.length})
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
          <Box sx={{ flex: 1 }}>
            {card.tags.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t("tags.noTagsYet")}
              </Typography>
            ) : (
              Object.entries(grouped).map(([groupName, tags]) => (
                <Box key={groupName} sx={{ mb: 1.5 }}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mb: 0.5 }}
                  >
                    {groupName}
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                    {tags.map((tag) => (
                      <Chip
                        key={tag.id}
                        label={tag.name}
                        size="small"
                        sx={tag.color ? { bgcolor: tag.color, color: "#fff" } : {}}
                      />
                    ))}
                  </Box>
                </Box>
              ))
            )}
          </Box>
          {canEdit && applicableGroups.length > 0 && (
            <IconButton
              size="small"
              aria-label={t("tags.edit")}
              title={t("tags.edit")}
              onClick={openEdit}
            >
              <MaterialSymbol icon="edit" size={18} />
            </IconButton>
          )}
        </Box>
      </AccordionDetails>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t("tags.edit")}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1 }}>
            <TagPicker
              groups={groups}
              value={draftIds}
              onChange={setDraftIds}
              typeKey={card.type}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)} disabled={saving}>
            {t("common:actions.cancel")}
          </Button>
          <Button variant="contained" onClick={save} disabled={saving}>
            {t("common:actions.save")}
          </Button>
        </DialogActions>
      </Dialog>
    </Accordion>
  );
}
