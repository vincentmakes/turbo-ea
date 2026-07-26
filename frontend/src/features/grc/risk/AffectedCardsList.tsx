/**
 * Affected-cards block on the risk detail page — the linked cards grouped by
 * card type, alphabetised within each group (discussion #876).
 *
 * Each card renders as the app's card chip — a solid chip filled with the
 * card type's colour, exactly like the Decisions grid's Cards column
 * (`AdrGrid.tsx`) — under a per-type bucket header (type icon + translated
 * label + count) borrowed from the Relations section.
 */
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import type { RiskCardLink } from "@/types";
import { cardChipSx, groupCardsByType } from "./affectedCards";

interface Props {
  cards: RiskCardLink[];
  /** Omit to render read-only chips (e.g. on a closed risk). */
  onUnlink?: (cardId: string) => void;
}

export default function AffectedCardsList({ cards, onUnlink }: Props) {
  const navigate = useNavigate();
  const { i18n } = useTranslation("grc");
  const { types } = useMetamodel();

  const groups = useMemo(
    () => groupCardsByType(cards, types, i18n.language),
    [cards, types, i18n.language],
  );

  return (
    <Stack spacing={1.5} sx={{ mb: 1.5 }}>
      {groups.map((group) => (
        <Box key={group.typeKey}>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75 }}>
            {group.icon && (
              <MaterialSymbol icon={group.icon} size={16} color={group.color} />
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
          </Stack>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {group.cards.map((c) => (
              <Chip
                key={c.card_id}
                clickable
                size="small"
                label={c.card_name}
                onClick={() => navigate(`/cards/${c.card_id}`)}
                onDelete={onUnlink ? () => onUnlink(c.card_id) : undefined}
                sx={cardChipSx(group.color)}
              />
            ))}
          </Box>
        </Box>
      ))}
    </Stack>
  );
}
