import { useState, useEffect, useMemo, useCallback } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Chip from "@mui/material/Chip";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { CardType, Card, CardListResponse } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onInsert: (card: Card, cardTypeKey: CardType) => void;
}

export default function CardPickerDialog({
  open,
  onClose,
  onInsert,
}: Props) {
  const [types, setTypes] = useState<CardType[]>([]);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);

  // Load types once
  useEffect(() => {
    if (!open) return;
    api
      .get<CardType[]>("/metamodel/types")
      .then((t) => setTypes(t.filter((x) => !x.is_hidden)));
  }, [open]);

  // Search cards when type or search changes
  useEffect(() => {
    if (!open) return;
    const params = new URLSearchParams({ page_size: "100" });
    if (selectedType) params.set("type", selectedType);
    if (search.trim()) params.set("search", search.trim());

    if (!selectedType && !search.trim()) {
      setCards([]);
      return;
    }

    setLoading(true);
    api
      .get<CardListResponse>(`/cards?${params}`)
      .then((r) => setCards(r.items))
      .finally(() => setLoading(false));
  }, [open, selectedType, search]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedType(null);
      setSearch("");
      setCards([]);
    }
  }, [open]);

  const typeMap = useMemo(
    () => new Map(types.map((t) => [t.key, t])),
    [types]
  );

  const handleSelect = useCallback(
    (card: Card) => {
      const cardTypeKey = typeMap.get(card.type);
      if (cardTypeKey) {
        onInsert(card, cardTypeKey);
        onClose();
      }
    },
    [typeMap, onInsert, onClose]
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>Insert Card</DialogTitle>
      <DialogContent>
        {/* Search */}
        <TextField
          autoFocus
          size="small"
          fullWidth
          placeholder="Search cards..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ mb: 2 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <MaterialSymbol icon="search" size={18} color="#999" />
              </InputAdornment>
            ),
          }}
        />

        {/* Type filter chips */}
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 2 }}>
          {types.map((t) => (
            <Chip
              key={t.key}
              label={t.label}
              size="small"
              icon={
                <MaterialSymbol
                  icon={t.icon}
                  size={16}
                  color={selectedType === t.key ? "#fff" : t.color}
                />
              }
              variant={selectedType === t.key ? "filled" : "outlined"}
              sx={
                selectedType === t.key
                  ? { bgcolor: t.color, color: "#fff" }
                  : {}
              }
              onClick={() =>
                setSelectedType((prev) => (prev === t.key ? null : t.key))
              }
            />
          ))}
        </Box>

        {/* Results */}
        <Box
          sx={{
            maxHeight: 360,
            overflow: "auto",
            border: "1px solid #e0e0e0",
            borderRadius: 1,
          }}
        >
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : cards.length === 0 ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ textAlign: "center", py: 4 }}
            >
              {selectedType || search.trim()
                ? "No cards found"
                : "Select a type or search to browse"}
            </Typography>
          ) : (
            <List dense disablePadding>
              {cards.map((card) => {
                const t = typeMap.get(card.type);
                return (
                  <ListItemButton key={card.id} onClick={() => handleSelect(card)}>
                    {t && (
                      <MaterialSymbol
                        icon={t.icon}
                        size={18}
                        color={t.color}
                      />
                    )}
                    <ListItemText
                      primary={card.name}
                      secondary={t?.label}
                      primaryTypographyProps={{ noWrap: true, ml: 1 }}
                      secondaryTypographyProps={{
                        noWrap: true,
                        ml: 1,
                        fontSize: 11,
                      }}
                    />
                  </ListItemButton>
                );
              })}
            </List>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
