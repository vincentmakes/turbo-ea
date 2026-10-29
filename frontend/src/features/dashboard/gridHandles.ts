/**
 * The customize-mode look of the grid's resize and drag handles, as `sx`
 * rules for the `.dashboard-grid` container. react-grid-layout listens to
 * touch as well as mouse, but out of the box a touch on a 20 px handle starts
 * the page's scroll gesture instead, and the handles only show on `:hover`,
 * which a touch screen never has. While arranging, the handles therefore
 * take `touch-action: none` (the page still scrolls from anywhere else on a
 * widget), never start a text selection on a long press, and are drawn big
 * and always visible: a 28 px rounded corner, and full-length 12 px bars on
 * the right and bottom edges, in the primary colour at a low alpha, stronger
 * on hover / press. Pointer users keep the resize cursors. Outside customize
 * mode there are no handle rules at all. Pure.
 */
import { alpha, type Theme } from "@mui/material/styles";
import { DRAG_HANDLE_CLASS } from "./widgets/WidgetFrame";

const HANDLE = "& .react-grid-item > .react-resizable-handle";
const BAR = 12;
const CORNER = 28;

export function handleStyles(theme: Theme, editing: boolean): Record<string, unknown> {
  if (!editing) return {};
  const primary = theme.palette.primary.main;
  const bar = {
    backgroundColor: alpha(primary, 0.08),
    transform: "none",
    "&::after": { display: "none" },
    "&:hover, &:active": { backgroundColor: alpha(primary, 0.2) },
  };
  return {
    [HANDLE]: {
      opacity: 1,
      touchAction: "none",
      WebkitUserSelect: "none",
      userSelect: "none",
      backgroundImage: "none",
      padding: 0,
    },
    [`${HANDLE}.react-resizable-handle-se`]: {
      width: CORNER,
      height: CORNER,
      right: 0,
      bottom: 0,
      borderRadius: 1,
      zIndex: 2,
      cursor: "se-resize",
      backgroundColor: alpha(primary, 0.18),
      "&::after": { borderColor: primary },
      "&:hover, &:active": { backgroundColor: alpha(primary, 0.35) },
    },
    [`${HANDLE}.react-resizable-handle-e`]: {
      ...bar,
      top: 0,
      right: 0,
      height: "100%",
      width: BAR,
      marginTop: 0,
      cursor: "ew-resize",
    },
    [`${HANDLE}.react-resizable-handle-s`]: {
      ...bar,
      left: 0,
      bottom: 0,
      width: "100%",
      height: BAR,
      marginLeft: 0,
      cursor: "ns-resize",
    },
    [`& .${DRAG_HANDLE_CLASS}`]: { touchAction: "none" },
  };
}
