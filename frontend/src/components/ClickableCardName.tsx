/**
 * A card name in a list row that opens the card on click.
 *
 * One rendering for every such row — card detail's Hierarchy children,
 * Relations rows and Lineage lists — so they signal hover the same way:
 * the **name** underlines, and only the name. The type icon or colour dot is
 * a sibling of the underlined span, never inside it; each section used to
 * put the hover rule on the wrapper that held both, which drew the line under
 * the icon and the gap as well. The whole row stays the click target so the
 * icon remains a convenient place to click.
 *
 * Presentation only: navigation is the caller's `onClick`, which is what
 * keeps this a MUI-only leaf with no router dependency.
 */
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import ListItemText from "@mui/material/ListItemText";
import MaterialSymbol from "@/components/MaterialSymbol";

export default function ClickableCardName({
  name,
  onClick,
  icon,
  iconColor,
  dotColor,
}: {
  name: ReactNode;
  onClick: () => void;
  /** The card type's Material Symbol, drawn beside the name. */
  icon?: string;
  iconColor?: string;
  /** A type-colour dot instead of an icon (the Relations rows). */
  dotColor?: string;
}) {
  return (
    <Box
      component="div"
      onClick={onClick}
      sx={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 1 }}
    >
      {icon ? (
        <MaterialSymbol icon={icon} size={16} color={iconColor} />
      ) : dotColor ? (
        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: dotColor, flexShrink: 0 }} />
      ) : null}
      <ListItemText
        primary={
          <Box component="span" sx={{ "&:hover": { textDecoration: "underline" } }}>
            {name}
          </Box>
        }
      />
    </Box>
  );
}
