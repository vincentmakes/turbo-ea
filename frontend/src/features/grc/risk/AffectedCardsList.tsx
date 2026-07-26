/**
 * Affected-cards block on the risk detail page — the linked cards grouped by
 * card type, alphabetised within each group, and colour-coded with the
 * metamodel's type colour (discussion #876).
 */
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import { useMetamodel } from "@/hooks/useMetamodel";
import { readableTypeColor } from "@/lib/color";
import type { RiskCardLink } from "@/types";
import { groupCardsByType } from "./affectedCards";

interface Props {
  cards: RiskCardLink[];
  /** Omit to render read-only chips (e.g. on a closed risk). */
  onUnlink?: (cardId: string) => void;
}

export default function AffectedCardsList({ cards, onUnlink }: Props) {
  const navigate = useNavigate();
  const { i18n } = useTranslation("grc");
  const { types } = useMetamodel();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";

  const groups = useMemo(
    () => groupCardsByType(cards, types, i18n.language),
    [cards, types, i18n.language],
  );

  return (
    <Stack spacing={1.5} sx={{ mb: 1.5 }}>
      {groups.map((group) => {
        // Admin-editable colours are never painted raw against the theme
        // paper — `readableTypeColor` keeps pale and very dark types legible.
        const accent = group.color ? readableTypeColor(group.color, isDark) : undefined;
        return (
          <Box key={group.typeKey}>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75 }}>
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  bgcolor: accent || "text.disabled",
                  flexShrink: 0,
                }}
              />
              <Typography variant="caption" fontWeight={700} color="text.secondary">
                {group.label}
              </Typography>
              <Typography variant="caption" color="text.disabled">
                {group.cards.length}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {group.cards.map((c) => (
                <Chip
                  key={c.card_id}
                  clickable
                  size="small"
                  variant="outlined"
                  onClick={() => navigate(`/cards/${c.card_id}`)}
                  label={c.card_name}
                  onDelete={onUnlink ? () => onUnlink(c.card_id) : undefined}
                  sx={
                    accent
                      ? {
                          borderColor: accent,
                          bgcolor: alpha(accent, 0.08),
                          "&:hover": { bgcolor: alpha(accent, 0.16) },
                        }
                      : undefined
                  }
                />
              ))}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}
