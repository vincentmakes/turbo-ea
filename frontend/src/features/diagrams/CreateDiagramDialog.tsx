import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import type { Card } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Card IDs to pre-link the new diagram to (e.g., a selected initiative). */
  initialCardIds?: string[];
  /** Default `true` — navigate to `/diagrams/{id}/edit` after creation. */
  navigateOnCreate?: boolean;
  /** Called with the new diagram ID after successful creation. */
  onCreated?: (diagramId: string) => void;
}

export default function CreateDiagramDialog({
  open,
  onClose,
  initialCardIds,
  navigateOnCreate = true,
  onCreated,
}: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const navigate = useNavigate();
  const { types: metamodelTypes } = useMetamodel();
  const typeLabel = useTypeLabel();

  const [allCards, setAllCards] = useState<Card[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cardIds, setCardIds] = useState<string[]>(initialCardIds ?? []);
  const [submitting, setSubmitting] = useState(false);

  // Reset form whenever the dialog (re)opens, seeded with `initialCardIds`.
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setCardIds(initialCardIds ?? []);
    }
  }, [open, initialCardIds]);

  // Lazy-load cards the first time the dialog opens.
  useEffect(() => {
    if (!open || allCards.length > 0) return;
    let cancelled = false;
    api
      .get<{ items: Card[] }>("/cards?page_size=500")
      .then((res) => {
        if (!cancelled) setAllCards(res.items);
      })
      .catch(() => {
        // Linking is optional — silent fall-through is acceptable.
      });
    return () => {
      cancelled = true;
    };
  }, [open, allCards.length]);

  const typeMap = useMemo(
    () => Object.fromEntries(metamodelTypes.map((mt) => [mt.key, mt])),
    [metamodelTypes],
  );

  const handleCreate = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      const created = await api.post<{ id: string }>("/diagrams", {
        name: name.trim(),
        description: description.trim() || undefined,
        card_ids: cardIds.length > 0 ? cardIds : undefined,
      });
      onCreated?.(created.id);
      onClose();
      if (navigateOnCreate) {
        navigate(`/diagrams/${created.id}/edit`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t("gallery.newDiagram")}</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          label={t("common:labels.name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mt: 1, mb: 2 }}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) handleCreate();
          }}
        />
        <TextField
          fullWidth
          label={t("common:labels.description")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          multiline
          rows={2}
          sx={{ mb: 2 }}
        />
        <Autocomplete
          multiple
          options={allCards}
          getOptionLabel={(opt) => opt.name}
          groupBy={(opt) => typeLabel(typeMap[opt.type]) || opt.type}
          value={allCards.filter((c) => cardIds.includes(c.id))}
          onChange={(_, newVal) => setCardIds(newVal.map((v) => v.id))}
          disableCloseOnSelect
          renderOption={(props, option, { selected }) => (
            <li {...props} key={option.id}>
              <Checkbox size="small" checked={selected} sx={{ mr: 1 }} />
              <MaterialSymbol
                icon={typeMap[option.type]?.icon || "apps"}
                size={18}
                color={typeMap[option.type]?.color}
              />
              <Box component="span" sx={{ ml: 0.5 }}>
                {option.name}
              </Box>
            </li>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              label={t("gallery.linkedCards")}
              helperText={t("gallery.linkedCardsHelperText")}
            />
          )}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={!name.trim() || submitting}
        >
          {t("common:actions.create")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
