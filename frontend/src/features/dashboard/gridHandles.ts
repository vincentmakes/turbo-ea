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
 * - the corner keeps the library's mark, recoloured from its hard-coded
 *   black (invisible in dark mode) to the theme's secondary text colour;
 * - the right and bottom edges stay grabbable but draw no mark: the library
 *   rotates the same corner mark onto each edge, which reads as three
 *   corners;
 * - the library reveals handles only on `:hover`, which a touch screen never
 *   produces, so where there is no hover the handles are always shown; a
 *   mouse user keeps the hover reveal;
 * - where a moved or resized widget will land (the library's placeholder, a
 *   square red block at 20 % opacity by default) is a rounded area with a
 *   dotted primary border and a faint primary fill; the library's z-index
 *   and transition stay;
 * - the widget being dragged lifts higher than its resting customize-mode
 *   shadow (`WidgetFrame`), the usual cue that it is in hand.
 *
 * Outside customize mode there are no handle rules at all. Pure.
 */
import { alpha, type Theme } from "@mui/material/styles";
import { DRAG_HANDLE_CLASS } from "./widgets/WidgetFrame";

const HANDLE = "& .react-grid-item > .react-resizable-handle";

const TOUCH = { touchAction: "none", WebkitUserSelect: "none", userSelect: "none" };

// react-resizable's own stylesheet also paints a corner glyph as a
// background image on every handle; on an edge it is rotated like the
// `::after` mark, so both go.
const NO_EDGE_MARK = { backgroundImage: "none", "&::after": { display: "none" } };

export function handleStyles(theme: Theme, editing: boolean): Record<string, unknown> {
  if (!editing) return {};
  return {
    [HANDLE]: { ...TOUCH },
    [`${HANDLE}.react-resizable-handle-se`]: {
      "&::after": { borderColor: theme.palette.text.secondary },
    },
    [`${HANDLE}.react-resizable-handle-e`]: NO_EDGE_MARK,
    [`${HANDLE}.react-resizable-handle-s`]: NO_EDGE_MARK,
    [`& .${DRAG_HANDLE_CLASS}`]: { ...TOUCH },
    "@media (hover: none)": { [HANDLE]: { opacity: 1 } },
    "& .react-grid-item.react-grid-placeholder": {
      backgroundColor: alpha(theme.palette.primary.main, 0.08),
      border: `2px dotted ${theme.palette.primary.main}`,
      borderRadius: theme.shape.borderRadius,
      opacity: 1,
      boxSizing: "border-box",
    },
    "& .react-grid-item.react-draggable-dragging": {
      boxShadow: theme.shadows[8],
      borderRadius: theme.shape.borderRadius,
    },
  };
}
