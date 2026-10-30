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
 * Pass `to` for a row that opens a card: the row is then a real link (an
 * `<a href>` through the router's `Link`), so middle-click, Ctrl/Cmd-click
 * and the browser's "Open in new tab" work, while a plain left click still
 * navigates in-app. `onClick` is then only a side effect (close a drawer, …)
 * and is skipped on modified clicks so the current page stays put. Without
 * `to`, the row is a plain `div` whose `onClick` is the whole action.
 */
import type { MouseEvent, ReactNode } from "react";
import { Link as RouterLink } from "react-router";
import Box from "@mui/material/Box";
import ListItemText from "@mui/material/ListItemText";
import MaterialSymbol from "@/components/MaterialSymbol";
import { isModifiedClick } from "@/lib/modifiedClick";

export default function ClickableCardName({
  name,
  to,
  onClick,
  icon,
  iconColor,
  dotColor,
}: {
  name: ReactNode;
  /** The card's in-app path (`/cards/<id>`); renders the row as a link. */
  to?: string;
  /** With `to`: a side effect of a plain click. Without: the click action. */
  onClick?: () => void;
  /** The card type's Material Symbol, drawn beside the name. */
  icon?: string;
  iconColor?: string;
  /** A type-colour dot instead of an icon (the Relations rows). */
  dotColor?: string;
}) {
  const content = (
    <>
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
    </>
  );
  const rowSx = { cursor: "pointer", display: "flex", alignItems: "center", gap: 1 } as const;

  if (to) {
    return (
      <Box
        component={RouterLink}
        to={to}
        onClick={(e: MouseEvent) => {
          if (onClick && !isModifiedClick(e)) onClick();
        }}
        sx={{ ...rowSx, color: "inherit", textDecoration: "none" }}
      >
        {content}
      </Box>
    );
  }
  return (
    <Box component="div" onClick={onClick} sx={rowSx}>
      {content}
    </Box>
  );
}
