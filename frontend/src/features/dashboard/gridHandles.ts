/**
 * The customize-mode rules for the grid's resize and drag handles, as `sx`
 * for the `.dashboard-grid` container. The handles themselves are the
 * library's: react-grid-layout and react-resizable draw 20 px handles with
 * their own positions, rotations and cursors, and those are left alone.
 *
 * What is added while arranging:
 * - a touch on a handle resizes or moves instead of starting the page's
 *   scroll gesture (`touch-action: none`; the page still scrolls from
 *   anywhere else on a widget), and a long press never selects text;
 * - the corner handle is always shown (the library reveals it only on
 *   `:hover`, which a touch screen never produces), and its mark is a little
 *   larger than the library's 5 px one and drawn in the theme's disabled
 *   text colour instead of a hard-coded black that disappears in dark mode;
 * - the right and bottom edges stay grabbable but draw no mark: the library
 *   rotates the same corner mark onto each edge, which reads as three
 *   corners;
 * - where a moved or resized widget will land (the library's placeholder, a
 *   square red block at 20 % opacity by default) is an area with the card's
 *   corners, a 1 px dotted primary border and a faint primary fill; the
 *   library's z-index and transition stay;
 * - the widget being dragged lifts (`CARD_SHADOW.lifted`) above its resting
 *   customize-mode shadow (`CARD_SHADOW.soft`, `WidgetFrame` / `KpiTile`),
 *   the cue that it is in hand.
 *
 * Outside customize mode there are no handle rules at all. Pure.
 */
import { alpha, type Theme } from "@mui/material/styles";
import { CARD_SHADOW } from "@/theme/tokens";
import { DRAG_HANDLE_CLASS } from "./widgets/WidgetFrame";

const HANDLE = "& .react-grid-item > .react-resizable-handle";

const TOUCH = { touchAction: "none", WebkitUserSelect: "none", userSelect: "none" };

// react-resizable's own stylesheet also paints a corner glyph as a
// background image on every handle; on an edge it is rotated like the
// `::after` mark, so both go.
const NO_EDGE_MARK = { backgroundImage: "none", "&::after": { display: "none" } };

// `borderRadius: 1` in `sx` is one theme radius (4 px), the card's. A theme
// radius passed as a number (`theme.shape.borderRadius`) is multiplied by
// the theme radius again — 16 px, rounder than the card it stands for.
const CARD_RADIUS = 1;

export function handleStyles(theme: Theme, editing: boolean): Record<string, unknown> {
  if (!editing) return {};
  const primary = theme.palette.primary.main;
  return {
    [HANDLE]: { ...TOUCH },
    [`${HANDLE}.react-resizable-handle-se`]: {
      opacity: 1,
      // react-resizable paints its own corner glyph as a background image on
      // every handle; with the `::after` mark that made two corners.
      backgroundImage: "none",
      "&::after": { width: 8, height: 8, right: 4, bottom: 4, borderColor: theme.palette.text.disabled },
    },
    [`${HANDLE}.react-resizable-handle-e`]: NO_EDGE_MARK,
    [`${HANDLE}.react-resizable-handle-s`]: NO_EDGE_MARK,
    [`& .${DRAG_HANDLE_CLASS}`]: { ...TOUCH },
    "& .react-grid-item.react-grid-placeholder": {
      backgroundColor: alpha(primary, 0.06),
      border: `1px dotted ${primary}`,
      borderRadius: CARD_RADIUS,
      opacity: 1,
      boxSizing: "border-box",
    },
    "& .react-grid-item.react-draggable-dragging": {
      boxShadow: CARD_SHADOW.lifted,
      borderRadius: CARD_RADIUS,
    },
  };
}
