/**
 * Admin-written help: a small info icon that shows the help text on hover,
 * focus or touch. It is the one shape help takes, beside a label while a card
 * is read and inside the control's floating label while it is edited
 * (`FieldEditor`, through `labelWithHelp`).
 *
 * Renders nothing when the text is empty, so a call site can pass whatever
 * its resolver returns.
 * The text is free text an admin typed, so it goes through `LinkifiedText`;
 * the tooltip is interactive, so a link inside it can be clicked.
 */
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { MouseEvent, ReactNode } from "react";

import LinkifiedText from "@/components/LinkifiedText";
import MaterialSymbol from "@/components/MaterialSymbol";

export interface HelpTipProps {
  text: string | null | undefined;
  /** Icon size in px (default 14, the caption size). */
  size?: number;
}

// The icon often sits inside something clickable (a group header, a grid
// header, a list row); hovering or tapping it must not also trigger that.
function stop(e: MouseEvent) {
  e.stopPropagation();
}

export default function HelpTip({ text, size = 14 }: HelpTipProps) {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return (
    <Tooltip
      enterTouchDelay={50}
      leaveTouchDelay={4000}
      title={
        <Typography variant="caption" component="span" sx={{ whiteSpace: "pre-wrap" }}>
          <LinkifiedText text={trimmed} linkProps={{ color: "inherit" }} />
        </Typography>
      }
    >
      <Box
        component="span"
        tabIndex={0}
        role="img"
        aria-label={trimmed}
        data-testid="help-tip"
        onClick={stop}
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
