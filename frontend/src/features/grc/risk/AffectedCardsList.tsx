/**
 * Affected-cards block on the risk detail page — the linked cards grouped by
 * card type, alphabetised within each group (discussion #876).
 *
 * The layout deliberately mirrors the Relations section on card detail
 * (`features/cards/sections/RelationsSection.tsx`): a per-type bucket header
 * (type icon + label + outlined count) over a dense list of rows, each a small
 * type-coloured dot plus the card name. Related cards are shown as rows, not
 * as tinted chips, everywhere else in the app — and rows also let long card
 * names use the full width instead of truncating.
 */
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { readableTypeColor } from "@/lib/color";
import type { RiskCardLink } from "@/types";
import { groupCardsByType } from "./affectedCards";

interface Props {
  cards: RiskCardLink[];
  /** Omit to render read-only rows (e.g. on a closed risk). */
  onUnlink?: (cardId: string) => void;
}

export default function AffectedCardsList({ cards, onUnlink }: Props) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("grc");
  const { types } = useMetamodel();
  const isDark = useTheme().palette.mode === "dark";

  const groups = useMemo(
    () => groupCardsByType(cards, types, i18n.language),
    [cards, types, i18n.language],
  );

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        overflow: "hidden",
        mb: 1.5,
      }}
    >
      {groups.map((group, index) => {
        // Admin-editable colours are never painted raw against the theme
        // paper — `readableTypeColor` keeps pale and very dark types legible.
        const accent = group.color ? readableTypeColor(group.color, isDark) : undefined;
        return (
          <Box key={group.typeKey}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                px: 1.5,
                py: 0.5,
                bgcolor: "background.default",
                ...(index > 0 ? { borderTop: "1px solid", borderColor: "divider" } : {}),
              }}
            >
              {group.icon && (
                <MaterialSymbol icon={group.icon} size={16} color={accent} />
              )}
              <Typography variant="caption" fontWeight={600} color="text.secondary">
                {group.label}
              </Typography>
              <Chip
                size="small"
                label={group.cards.length}
                variant="outlined"
                sx={{ height: 18, fontSize: "0.65rem" }}
              />
            </Box>
            <List dense disablePadding sx={{ px: 0.5 }}>
              {group.cards.map((c) => (
                <ListItem
                  key={c.card_id}
                  sx={{ py: 0.25 }}
                  secondaryAction={
                    onUnlink ? (
                      <IconButton
                        size="small"
                        aria-label={t("risks.cards.unlink")}
                        onClick={() => onUnlink(c.card_id)}
                      >
                        <MaterialSymbol icon="close" size={16} />
                      </IconButton>
                    ) : undefined
                  }
                >
                  <Box
                    component="div"
                    onClick={() => navigate(`/cards/${c.card_id}`)}
                    sx={{
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      minWidth: 0,
                      "&:hover": { textDecoration: "underline" },
                    }}
                  >
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        bgcolor: accent || "text.disabled",
                        flexShrink: 0,
                      }}
                    />
                    <ListItemText primary={c.card_name} />
                  </Box>
                </ListItem>
              ))}
            </List>
          </Box>
        );
      })}
    </Box>
  );
}
