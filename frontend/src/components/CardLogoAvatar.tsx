/**
 * A card's avatar: its custom logo when it has one, its type icon when it does
 * not.
 *
 * When a logo is present the type icon does not disappear — it moves to a small
 * badge overhanging the bottom-right corner. Both identities stay readable at
 * once, which is the whole point: a reader recognises "Kafka" from the mark far
 * faster than from the label, but still needs to know they are looking at an
 * Application.
 *
 * Nothing here is load-bearing. No logo, a type whose logos an admin switched
 * off, a 404, a wiped volume — every one of them lands on exactly the tile this
 * app rendered before logos existed, never a broken-image glyph.
 */
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import MaterialSymbol from "@/components/MaterialSymbol";

interface Props {
  cardId: string;
  /**
   * When the logo was last written, or null/undefined when the card has none.
   * The backend already withholds it for types with logos switched off, so
   * this component needs no rule of its own. Doubles as the cache-buster.
   */
  logoUpdatedAt?: string | null;
  typeIcon: string;
  typeColor: string;
  size?: number;
  /** Border radius in theme units. */
  radius?: number;
  /** Show the type-icon badge over the logo. Off for dense rows. */
  badge?: boolean;
}

export function cardLogoUrl(cardId: string, logoUpdatedAt: string): string {
  // Same-origin and unauthenticated, so a plain <img> renders it — including
  // for anonymous portal visitors, who have no token to send.
  return `/api/v1/cards/${cardId}/logo?v=${encodeURIComponent(logoUpdatedAt)}`;
}

export default function CardLogoAvatar({
  cardId,
  logoUpdatedAt,
  typeIcon,
  typeColor,
  size = 40,
  radius = 2,
  badge = true,
}: Props) {
  const [failed, setFailed] = useState(false);
  // A replaced logo is a new URL, so a past failure must not suppress it.
  useEffect(() => setFailed(false), [logoUpdatedAt, cardId]);

  const common = {
    width: size,
    height: size,
    borderRadius: radius,
    flexShrink: 0,
  } as const;

  if (!logoUpdatedAt || failed) {
    return (
      <Box
        aria-hidden
        sx={{
          ...common,
          bgcolor: `${typeColor}18`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MaterialSymbol icon={typeIcon} size={size * 0.6} color={typeColor} />
      </Box>
    );
  }

  const badgeSize = Math.round(size * 0.45);

  return (
    <Box sx={{ ...common, position: "relative" }}>
      <Box
        component="img"
        src={cardLogoUrl(cardId, logoUpdatedAt)}
        // The card name is always rendered beside this, so alt text would make
        // a screen reader announce it twice.
        alt=""
        aria-hidden
        loading="lazy"
        onError={() => setFailed(true)}
        sx={{
          width: "100%",
          height: "100%",
          borderRadius: radius,
          // Never `cover` — a vendor's mark must not be cropped. The paper
          // plate keeps a transparent PNG legible in both themes.
          objectFit: "contain",
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
        }}
      />
      {badge && (
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            // Overhangs the corner, so the badge never eats into the mark.
            right: -badgeSize * 0.25,
            bottom: -badgeSize * 0.25,
            width: badgeSize,
            height: badgeSize,
            borderRadius: 1,
            bgcolor: "background.paper",
            border: "1px solid",
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MaterialSymbol
            icon={typeIcon}
            size={Math.round(badgeSize * 0.7)}
            color={typeColor}
          />
        </Box>
      )}
    </Box>
  );
}
