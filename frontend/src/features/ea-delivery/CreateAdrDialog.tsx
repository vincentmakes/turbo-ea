import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Alert from "@mui/material/Alert";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { Card, ArchitectureDecision } from "@/types";

interface LinkedCard {
  id: string;
  name: string;
  type: string;
}

interface CreateAdrDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (adr: ArchitectureDecision) => void;
  preLinkedCards?: LinkedCard[];
}

export default function CreateAdrDialog({
  open,
  onClose,
  onCreated,
  preLinkedCards = [],
}: CreateAdrDialogProps) {
  const { t } = useTranslation(["delivery", "common"]);

  const [title, setTitle] = useState("");
  const [linkedCards, setLinkedCards] = useState<LinkedCard[]>(preLinkedCards);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // Card search
  const [showSearch, setShowSearch] = useState(false);
  const [cardSearch, setCardSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Card[]>([]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setTitle("");
      setLinkedCards(preLinkedCards);
      setCreating(false);
      setError("");
      setShowSearch(false);
      setCardSearch("");
      setSearchResults([]);
    }
  }, [open, preLinkedCards]);

  const searchCardsHandler = async (q: string) => {
    setCardSearch(q);
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await api.get<{ items: Card[] }>(
        `/cards?search=${encodeURIComponent(q)}&page_size=20`,
      );
      setSearchResults(res.items);
    } catch {
      /* ignore */
    }
  };

  const addCard = (card: Card) => {
    if (linkedCards.some((c) => c.id === card.id)) return;
    setLinkedCards((prev) => [...prev, { id: card.id, name: card.name, type: card.type }]);
    setShowSearch(false);
    setCardSearch("");
    setSearchResults([]);
  };

  const removeCard = (cardId: string) => {
    setLinkedCards((prev) => prev.filter((c) => c.id !== cardId));
  };

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    setError("");
    try {
      const adr = await api.post<ArchitectureDecision>("/adr", {
        title: title.trim(),
      });
      // Link cards sequentially
      for (const card of linkedCards) {
        await api.post(`/adr/${adr.id}/cards`, { card_id: card.id });
      }
      onCreated(adr);
      onClose();
    } catch {
      setError(t("adr.createDialog.error"));
    } finally {
      setCreating(false);
    }
  };

  const linkedIds = new Set(linkedCards.map((c) => c.id));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("adr.createDialog.title")}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
            {error}
          </Alert>
        )}

        <TextField
          autoFocus
          label={t("adr.createDialog.decisionTitle")}
          fullWidth
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          sx={{ mt: 1, mb: 2 }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim() && !creating) handleCreate();
          }}
        />

        {/* ── Linked Cards ── */}
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t("adr.createDialog.linkedCards")}
        </Typography>

        {linkedCards.length > 0 && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
            {linkedCards.map((card) => (
              <Chip
                key={card.id}
                label={card.name}
                size="small"
                onDelete={() => removeCard(card.id)}
              />
            ))}
          </Box>
        )}

        <Button
          size="small"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => {
            setShowSearch(true);
            setCardSearch("");
            setSearchResults([]);
          }}
          sx={{ textTransform: "none", mb: 1 }}
        >
          {t("adr.createDialog.addCard")}
        </Button>

        {showSearch && (
          <Box sx={{ mb: 1 }}>
            <TextField
              autoFocus
              placeholder={t("adr.createDialog.searchCards")}
              fullWidth
              size="small"
              value={cardSearch}
              onChange={(e) => searchCardsHandler(e.target.value)}
              sx={{ mb: 1 }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setShowSearch(false);
                  setCardSearch("");
                  setSearchResults([]);
                }
              }}
            />
            <Box
              sx={{
                minHeight: 120,
                maxHeight: 200,
                overflow: "auto",
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
              }}
            >
              {searchResults.length > 0 ? (
                <List dense disablePadding>
                  {searchResults.map((card) => {
                    const alreadyAdded = linkedIds.has(card.id);
                    return (
                      <ListItemButton
                        key={card.id}
                        onClick={() => !alreadyAdded && addCard(card)}
                        disabled={alreadyAdded}
                      >
                        <ListItemText primary={card.name} secondary={card.type} />
                        {alreadyAdded && (
                          <Chip
                            label={t("adr.createDialog.alreadyAdded")}
                            size="small"
                            variant="outlined"
                            sx={{ height: 20, fontSize: "0.7rem" }}
                          />
                        )}
                      </ListItemButton>
                    );
                  })}
                </List>
              ) : cardSearch.length >= 2 ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ textAlign: "center", py: 3 }}
                >
                  {t("adr.createDialog.noResults")}
                </Typography>
              ) : (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ textAlign: "center", py: 3 }}
                >
                  {t("adr.createDialog.searchCards")}
                </Typography>
              )}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          disabled={!title.trim() || creating}
          onClick={handleCreate}
        >
          {creating ? t("adr.createDialog.creating") : t("common:actions.create")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
