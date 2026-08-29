/**
 * The Inventory grid's Logo cell.
 *
 * Renders the card's own mark, or — when it has none — the same type-icon tile
 * the rest of the app falls back to, so a column of logos reads as one column
 * rather than a ragged mix of images and blanks. Both are centred in the cell,
 * horizontally and vertically.
 *
 * A card whose *type* has logos switched off renders an empty cell, not a
 * placeholder: the grid mixes types, and offering a tile there would advertise
 * an upload the backend would refuse.
 *
 * Editing borrows the card-detail affordance exactly — hover reveals a camera
 * overlay, clicking opens the shared `CardLogoMenu` — so the gesture is the
 * same wherever a logo is on screen. The click is stopped from bubbling: a row
 * click otherwise navigates to the card.
 */
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from "react-i18next";

import CardLogoAvatar from "@/components/CardLogoAvatar";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { Card, CardType } from "@/types";

/** Tile size in the grid. Big enough to recognise a mark, small enough that
 *  the row stays a row. */
export const INVENTORY_LOGO_SIZE = 36;

/** Row height while the Logo column is shown — the tile plus breathing room.
 *  Every other column keeps the grid's default height. */
export const INVENTORY_LOGO_ROW_HEIGHT = 52;

interface Props {
  card: Card;
  /** The row's card type, or undefined while the metamodel is still loading. */
  type?: CardType;
  /** Whether this user may change this card's logo. */
  editable: boolean;
  onEdit: (anchor: HTMLElement, card: Card) => void;
}

export default function LogoCell({ card, type, editable, onEdit }: Props) {
  const { t } = useTranslation("cards");

  if (!type?.allow_card_logo) return null;

  return (
    <Tooltip title={editable ? t("logo.edit") : ""}>
      {/* A real button when it does something: the cell is reachable with the
          grid's own keyboard navigation, and Enter then opens the menu. */}
      <Box
        component={editable ? "button" : "div"}
        type={editable ? "button" : undefined}
        aria-label={editable ? t("logo.edit") : undefined}
        onClick={
          editable
            ? (e: React.MouseEvent<HTMLElement>) => {
                e.stopPropagation();
                e.preventDefault();
                onEdit(e.currentTarget, card);
              }
            : undefined
        }
        sx={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 0,
          border: "none",
          background: "none",
          font: "inherit",
          color: "inherit",
          cursor: editable ? "pointer" : "default",
          "&:hover .inventory-logo-edit": { opacity: editable ? 1 : 0 },
          "&:focus-visible .inventory-logo-edit": { opacity: 1 },
        }}
      >
        <Box
          sx={{ position: "relative", width: INVENTORY_LOGO_SIZE, height: INVENTORY_LOGO_SIZE }}
        >
          <CardLogoAvatar
            cardId={card.id}
            logoUpdatedAt={card.logo_updated_at}
            typeIcon={type.icon}
            typeColor={type.color}
            size={INVENTORY_LOGO_SIZE}
            // The Type column already says what this is, and the badge would
            // crowd a 36px tile.
            badge={false}
          />
          {editable && (
            <Box
              className="inventory-logo-edit"
              aria-hidden
              sx={{
                position: "absolute",
                inset: 0,
                borderRadius: 2,
                bgcolor: "rgba(0,0,0,0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 0,
                transition: "opacity 120ms",
              }}
            >
              <MaterialSymbol icon="photo_camera" size={18} color="#fff" />
            </Box>
          )}
        </Box>
      </Box>
    </Tooltip>
  );
}
