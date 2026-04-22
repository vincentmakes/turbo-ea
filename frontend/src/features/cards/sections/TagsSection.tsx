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
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { Card, TagGroup, TagRef } from "@/types";

interface TagOption {
  id: string;
  name: string;
  color?: string;
  group_id: string;
  group_name: string;
  group_mode: string;
  group_mandatory: boolean;
}

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

  // Filter groups to those applicable to this card type
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

  const allOptions: TagOption[] = useMemo(
    () =>
      applicableGroups.flatMap((g) =>
        g.tags.map((tg) => ({
          id: tg.id,
          name: tg.name,
          color: tg.color,
          group_id: g.id,
          group_name: g.name,
          group_mode: g.mode,
          group_mandatory: g.mandatory,
        })),
      ),
    [applicableGroups],
  );

  // Group current tags by group_name for display
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
      const oldIds = new Set(card.tags.map((tg) => tg.id));
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

  // Enforce single-mode: when a tag from a single-mode group is added,
  // drop any previously selected tag from the same group.
  const handlePickerChange = (next: TagOption[]) => {
    const nextIds: string[] = [];
    const singleModeGroupsSeen = new Map<string, string>(); // group_id -> kept tag id
    // Walk the new selection; if two tags share a single-mode group, keep the
    // later one (the one the user just clicked).
    for (const opt of next) {
      if (opt.group_mode === "single") {
        singleModeGroupsSeen.set(opt.group_id, opt.id);
      } else {
        nextIds.push(opt.id);
      }
    }
    nextIds.push(...singleModeGroupsSeen.values());
    setDraftIds(nextIds);
  };

  const currentOptions = allOptions.filter((o) => draftIds.includes(o.id));

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
                    {tags.map((tg) => (
                      <Chip
                        key={tg.id}
                        label={tg.name}
                        size="small"
                        sx={tg.color ? { bgcolor: tg.color, color: "#fff" } : {}}
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
          <Autocomplete
            multiple
            options={allOptions}
            value={currentOptions}
            onChange={(_, next) => handlePickerChange(next as TagOption[])}
            groupBy={(o) => `${o.group_name}${o.group_mode === "single" ? ` · ${t("tags.singleMode")}` : ""}`}
            getOptionLabel={(o) => o.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                {option.color && (
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      bgcolor: option.color,
                      mr: 1,
                      flexShrink: 0,
                    }}
                  />
                )}
                {option.name}
              </li>
            )}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => {
                const { key, ...chipProps } = getTagProps({ index });
                return (
                  <Chip
                    key={key}
                    label={`${option.group_name}: ${option.name}`}
                    size="small"
                    sx={option.color ? { bgcolor: option.color, color: "#fff" } : {}}
                    {...chipProps}
                  />
                );
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label={t("tags.pickerLabel")}
                placeholder={t("tags.pickerPlaceholder")}
                sx={{ mt: 1 }}
              />
            )}
          />
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
