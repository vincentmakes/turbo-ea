/**
 * Admin-written help: a small info icon that shows the help text on hover or
 * keyboard focus, and toggles it on a tap or click (Enter / Space from the
 * keyboard); a second tap, a tap anywhere else or Escape closes it. It is the
 * one shape help takes, beside a label while a card is read and inside the
 * control's floating label while it is edited (`FieldEditor`, through
 * `labelWithHelp`). Inside a `<label>` the icon's click is prevented, so it
 * never reaches the field: it neither focuses nor opens the control, and a
 * field already being edited keeps its focus.
 *
 * Renders nothing when the text is empty, so a call site can pass whatever
 * its resolver returns.
 * The text is free text an admin typed, so it goes through `LinkifiedText`;
 * the tooltip is interactive, so a link inside it can be clicked.
 */
import Box from "@mui/material/Box";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useId, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode, SyntheticEvent } from "react";

import LinkifiedText from "@/components/LinkifiedText";
import MaterialSymbol from "@/components/MaterialSymbol";

export interface HelpTipProps {
  text: string | null | undefined;
  /** Icon size in px (default 14, the caption size). */
  size?: number;
}

export default function HelpTip({ text, size = 14 }: HelpTipProps) {
  // Two reasons to show the tooltip: hover / keyboard focus (MUI's own
  // listeners) and an explicit tap or click. MUI's long-press touch listener is
  // off: on a touch device a plain tap opens it. MUI still marks a touch start
  // on the icon and then ignores the mouseover iOS emulates for the tap, so a
  // tap never sets `hoverOpen` and a second tap closes it.
  const [hoverOpen, setHoverOpen] = useState(false);
  const [tapOpen, setTapOpen] = useState(false);
  const tipId = useId();
  const trimmed = text?.trim();
  if (!trimmed) return null;
  const open = hoverOpen || tapOpen;

  const handleClose = (e: Event | SyntheticEvent) => {
    setHoverOpen(false);
    // MUI closes on Escape anywhere in the document; that closes a tap too,
    // which matters because a tapped icon never takes focus.
    if (e.type === "keydown") setTapOpen(false);
  };

  const handleClick = (e: MouseEvent) => {
    // Inside a control's <label>, the click would otherwise activate the label
    // and focus or open its field.
    e.preventDefault();
    // The icon often sits inside something clickable (a group header, a grid
    // header, a list row); the click must not trigger that too.
    e.stopPropagation();
    setTapOpen((v) => !v);
  };

  // Escape needs no branch here: MUI's document Escape listener calls
  // `handleClose` with the keydown, which clears a tap too.
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      setTapOpen((v) => !v);
    }
  };

  const handleClickAway = (e: globalThis.MouseEvent | TouchEvent) => {
    // The tooltip is portaled out of the icon's subtree; a tap on it (on a
    // link in it, say) is not a tap elsewhere.
    const popper = document.getElementById(tipId);
    if (popper && e.target instanceof Node && popper.contains(e.target)) return;
    setTapOpen(false);
  };

  return (
    // Listens only while tap-opened, so a form full of help icons does not
    // put a document listener pair on the page per icon.
    <ClickAwayListener
      mouseEvent={tapOpen ? "onClick" : false}
      touchEvent={tapOpen ? "onTouchEnd" : false}
      onClickAway={handleClickAway}
    >
      <Tooltip
        id={tipId}
        open={open}
        onOpen={() => setHoverOpen(true)}
        onClose={handleClose}
        disableTouchListener
        title={
          <Typography variant="caption" component="span" sx={{ whiteSpace: "pre-wrap" }}>
            <LinkifiedText text={trimmed} linkProps={{ color: "inherit" }} />
          </Typography>
        }
      >
        <Box
          component="span"
          tabIndex={0}
          role="button"
          aria-label={trimmed}
          aria-expanded={open}
          data-testid="help-tip"
          // Keeps focus on a field being edited instead of moving it here.
          onMouseDown={(e: MouseEvent) => e.preventDefault()}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          sx={{
            display: "inline-flex",
            verticalAlign: "middle",
            ml: 0.5,
            color: "text.secondary",
            cursor: "help",
            borderRadius: "50%",
            "&:focus-visible": { outline: 2, outlineColor: "primary.main", outlineStyle: "solid" },
          }}
        >
          <MaterialSymbol icon="help" size={size} />
        </Box>
      </Tooltip>
    </ClickAwayListener>
  );
}

/**
 * Icon size inside an outlined control's floating label. The theme keeps every
 * label floated, and a floated label is scaled to 0.75, so 18 px renders at
 * about 13.5 px, level with the 12 px label text (the read-mode 14 px icon sits
 * unscaled beside a 14 px label).
 */
export const HELP_TIP_IN_LABEL_SIZE = 18;

/**
 * What an outlined control's notch label carries in place of the icon. The
 * legend's font is 0.75 em, so 1.4 em is about 16.8 px: the 18 px icon plus
 * its 4 px left margin, scaled by 0.75 (16.5 px). The gap in the border line
 * is sized for the icon without putting a second, invisible focusable icon in
 * the `<legend>`.
 */
export function HelpTipNotchSpacer() {
  return <Box component="span" aria-hidden sx={{ display: "inline-block", width: "1.4em" }} />;
}

/**
 * An outlined control's label with the help icon after its text, as the pair
 * MUI needs: `label` for the visible `InputLabel` and `notch` for the label
 * copy inside the border's `<legend>`, which only sizes the gap in the border
 * line. The two differ on purpose: the icon in both would leave a focusable,
 * invisible duplicate tab stop in the legend, so the notch gets a spacer of the
 * icon's width instead.
 *
 * Pass `label` to the control's label (`TextField label`, `InputLabel`
 * children) and `notch` to its notch label (`slotProps.input.label` on a
 * `TextField`, which wins over the notch label `TextField` derives from
 * `label`; `Select label`). On a required field MUI appends the asterisk after
 * the label's children, so it reads "Label (i) *".
 *
 * Without help both are the plain text.
 */
export function labelWithHelp(
  text: string,
  help: string,
): { label: ReactNode; notch: ReactNode } {
  if (!help.trim()) return { label: text, notch: text };
  return {
    label: (
      <>
        {text}
        <HelpTip text={help} size={HELP_TIP_IN_LABEL_SIZE} />
      </>
    ),
    notch: (
      <>
        {text}
        <HelpTipNotchSpacer />
      </>
    ),
  };
}
