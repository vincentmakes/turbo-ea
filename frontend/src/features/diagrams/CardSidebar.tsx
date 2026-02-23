import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Collapse from "@mui/material/Collapse";
import Chip from "@mui/material/Chip";
import InputAdornment from "@mui/material/InputAdornment";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useResolveMetaLabel } from "@/hooks/useResolveLabel";
import { api } from "@/api/client";
import type { CardType, Card, CardListResponse } from "@/types";

interface Props {
  onInsert: (card: Card, cardTypeKey: CardType) => void;
}

export default function CardSidebar({ onInsert }: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const rml = useResolveMetaLabel();
  const [types, setTypes] = useState<CardType[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [search, setSearch] = useState("");
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [loadingType, setLoadingType] = useState<string | null>(null);

  // Load card types on mount
  useEffect(() => {
    api
      .get<CardType[]>("/metamodel/types")
      .then((t) => setTypes(t.filter((x) => !x.is_hidden)));
  }, []);

  // Load cards when a type group is expanded or search changes
  useEffect(() => {
    const params = new URLSearchParams({ page_size: "200" });
    if (expandedType) params.set("type", expandedType);
    if (search.trim()) params.set("search", search.trim());

    // Only fetch when there's an expanded type or a search query
    if (!expandedType && !search.trim()) {
      setCards([]);
      return;
    }

    setLoadingType(expandedType);
    api
      .get<CardListResponse>(`/cards?${params}`)
      .then((r) => setCards(r.items))
      .finally(() => setLoadingType(null));
  }, [expandedType, search]);

  // Group cards by type (when searching across all types)
  const grouped = useMemo(() => {
    const map = new Map<string, Card[]>();
    for (const card of cards) {
      const arr = map.get(card.type) || [];
      arr.push(card);
      map.set(card.type, arr);
    }
    return map;
  }, [cards]);

  const toggleType = (key: string) => {
    setExpandedType((prev) => (prev === key ? null : key));
  };

  const isSearchMode = search.trim().length > 0;

  // In search mode, show all matching types that have results
  // In browse mode, show all types but only expand the selected one
  const visibleTypes = isSearchMode
    ? types.filter((t) => grouped.has(t.key))
    : types;

  return (
    <Box
      sx={{
        width: 280,
        borderRight: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        bgcolor: "action.hover",
      }}
    >
      {/* Header */}
      <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
          {t("common:labels.cards")}
        </Typography>
        <TextField
          size="small"
          fullWidth
          placeholder={t("cardSidebar.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <MaterialSymbol icon="search" size={18} color="#999" />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {/* Type groups */}
      <Box sx={{ flex: 1, overflow: "auto" }}>
        <List dense disablePadding>
          {visibleTypes.map((ct) => {
            const isExpanded = isSearchMode
              ? grouped.has(ct.key)
              : expandedType === ct.key;
            const items = grouped.get(ct.key) || [];

            return (
              <Box key={ct.key}>
                {/* Type header */}
                <ListItemButton
                  onClick={() => toggleType(ct.key)}
                  sx={{ py: 0.5, gap: 1 }}
                >
                  <MaterialSymbol icon={ct.icon} size={18} color={ct.color} />
                  <ListItemText
                    primary={rml(ct.label, ct.translations, "label")}
                    primaryTypographyProps={{
                      variant: "body2",
                      fontWeight: 600,
                      noWrap: true,
                    }}
                  />
                  {isExpanded && items.length > 0 && (
                    <Chip label={items.length} size="small" sx={{ height: 20, fontSize: 11 }} />
                  )}
                  <MaterialSymbol
                    icon={isExpanded ? "expand_less" : "expand_more"}
                    size={18}
                    color="#999"
                  />
                </ListItemButton>

                {/* Card items */}
                <Collapse in={isExpanded} unmountOnExit>
                  {loadingType === ct.key && items.length === 0 ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ pl: 5, py: 0.5, display: "block" }}
                    >
                      {t("common:labels.loading")}
                    </Typography>
                  ) : items.length === 0 && isExpanded ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ pl: 5, py: 0.5, display: "block" }}
                    >
                      {t("common:emptyStates.noCards")}
                    </Typography>
                  ) : (
                    <List dense disablePadding>
                      {items.map((card) => (
                        <Tooltip
                          key={card.id}
                          title={t("cardSidebar.insertTooltip", { name: card.name })}
                          placement="right"
                          arrow
                        >
                          <ListItemButton
                            sx={{ pl: 5, py: 0.25 }}
                            onClick={() => onInsert(card, ct)}
                          >
                            <ListItemText
                              primary={card.name}
                              primaryTypographyProps={{
                                variant: "body2",
                                noWrap: true,
                              }}
                            />
                          </ListItemButton>
                        </Tooltip>
                      ))}
                    </List>
                  )}
                </Collapse>
              </Box>
            );
          })}
        </List>

        {visibleTypes.length === 0 && search.trim() && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ textAlign: "center", py: 3 }}
          >
            {t("common:labels.noResults")}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
