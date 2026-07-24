import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Snackbar from "@mui/material/Snackbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { Card as CardType } from "@/types";
import CardTypePill from "./CardTypePill";
import SectionPaper, { EmptyState } from "./SectionPaper";

interface FavoriteRow {
  id: string;
  card_id: string;
  created_at: string | null;
}

const MAX_VISIBLE = 8;
const UNDO_TIMEOUT_MS = 6000;

export default function MyFavoritesSection() {
  const { t } = useTranslation(["common", "cards"]);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<CardType[]>([]);
  const [undoSnack, setUndoSnack] = useState<CardType | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const favorites = await api.get<FavoriteRow[]>("/favorites");
      const slice = favorites.slice(0, MAX_VISIBLE);
      const fetched = await Promise.all(
        slice.map((f) => api.get<CardType>(`/cards/${f.card_id}`).catch(() => null)),
      );
      setCards(fetched.filter((c): c is CardType => c !== null));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const removeFavorite = async (card: CardType) => {
    // Optimistic update — show the snackbar and remove the card from the
    // list immediately so iOS users on slower connections don't wait on
    // the network round-trip before the undo affordance appears. Roll
    // back if the request fails.
    setCards((prev) => prev.filter((c) => c.id !== card.id));
    setUndoSnack(card);
    try {
      await api.delete(`/favorites/${card.id}`);
    } catch {
      setCards((prev) =>
        prev.some((c) => c.id === card.id) ? prev : [card, ...prev].slice(0, MAX_VISIBLE),
      );
      setUndoSnack(null);
    }
  };

  const undoRemove = async () => {
    if (!undoSnack) return;
    const card = undoSnack;
    setUndoSnack(null);
    try {
      await api.post(`/favorites/${card.id}`, undefined);
      setCards((prev) =>
        prev.some((c) => c.id === card.id) ? prev : [card, ...prev].slice(0, MAX_VISIBLE),
      );
    } catch {
      // best effort
    }
  };

  return (
    <SectionPaper
      icon="cards_star"
      iconColor="#f5a623"
      title={t("common:dashboard.workspace.myFavorites")}
    >
      {loading ? (
        <LinearProgress />
      ) : cards.length === 0 ? (
        <EmptyState message={t("common:dashboard.workspace.empty.favorites")} />
      ) : (
        <Box>
          {cards.map((card) => (
            <Box
              key={card.id}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                py: 0.75,
                px: 1,
                borderRadius: 1,
                cursor: "pointer",
                "&:hover": { bgcolor: "action.hover" },
              }}
              onClick={() => navigate(`/cards/${card.id}`)}
            >
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {card.name}
              </Typography>
              <CardTypePill typeKey={card.type} />
              <Tooltip title={t("cards:actions.removeFromFavorites")}>
                <IconButton
                  size="small"
                  aria-label={t("cards:actions.removeFromFavorites")}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFavorite(card);
                  }}
                >
                  <MaterialSymbol icon="cards_star" size={18} color="#f5a623" />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </Box>
      )}
      <Snackbar
        open={!!undoSnack}
        autoHideDuration={UNDO_TIMEOUT_MS}
        // iOS Safari fires touchstart on virtually every tap or scroll,
        // which MUI translates into a "clickaway" close — that was
        // dismissing the snackbar after roughly a second on iPhone.
        // Only honour timeouts and the explicit close button.
        onClose={(_event, reason) => {
          if (reason === "clickaway") return;
          setUndoSnack(null);
        }}
        ClickAwayListenerProps={{ mouseEvent: false, touchEvent: false }}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        message={
          undoSnack
            ? t("common:dashboard.workspace.favoriteRemoved", { name: undoSnack.name })
            : ""
        }
        action={
          <>
            <Button color="secondary" size="small" onClick={undoRemove}>
              {t("common:actions.undo")}
            </Button>
            <IconButton
              size="small"
              color="inherit"
              aria-label={t("common:actions.close")}
              onClick={() => setUndoSnack(null)}
            >
              <MaterialSymbol icon="close" size={18} />
            </IconButton>
          </>
        }
      />
    </SectionPaper>
  );
}
