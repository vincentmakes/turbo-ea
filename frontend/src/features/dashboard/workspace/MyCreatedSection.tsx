import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import type { Card as CardType } from "@/types";
import CardTypePill from "./CardTypePill";
import SectionPaper, { EmptyState } from "./SectionPaper";

interface Props {
  createdCount: number;
}

interface MyCreatedResponse {
  items: CardType[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

const INITIAL_PAGE_SIZE = 50;
// Show more loads the rest in one go. Capped at the backend's maximum
// limit; in the rare case a user has created more than INITIAL +
// SHOW_MORE_PAGE_SIZE cards the button just appears again to load
// another batch.
const SHOW_MORE_PAGE_SIZE = 200;

export default function MyCreatedSection({ createdCount }: Props) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cards, setCards] = useState<CardType[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(createdCount);

  useEffect(() => {
    api
      .get<MyCreatedResponse>(`/cards/my-created?limit=${INITIAL_PAGE_SIZE}&offset=0`)
      .then((data) => {
        setCards(data.items);
        setHasMore(data.has_more);
        setTotal(data.total);
      })
      .finally(() => setLoading(false));
  }, []);

  const showMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const data = await api.get<MyCreatedResponse>(
        `/cards/my-created?limit=${SHOW_MORE_PAGE_SIZE}&offset=${cards.length}`,
      );
      setCards((prev) => [...prev, ...data.items]);
      setHasMore(data.has_more);
      setTotal(data.total);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <SectionPaper
      icon="edit_note"
      iconColor="#00897b"
      title={t("dashboard.workspace.myCreated")}
      action={
        total > 0 ? (
          <Typography variant="caption" color="text.secondary">
            {t("dashboard.workspace.showingNofM", { shown: cards.length, total })}
          </Typography>
        ) : undefined
      }
    >
      {loading ? (
        <LinearProgress />
      ) : cards.length === 0 ? (
        <EmptyState message={t("dashboard.workspace.empty.created")} />
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
            </Box>
          ))}
          {hasMore && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 1 }}>
              <Button size="small" onClick={showMore} disabled={loadingMore}>
                {loadingMore ? t("labels.loading") : t("actions.showMore")}
              </Button>
            </Box>
          )}
        </Box>
      )}
    </SectionPaper>
  );
}
