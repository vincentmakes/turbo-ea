/**
 * Read-mode help: a small info icon beside a label that shows the help text
 * on hover, focus or touch.
 *
 * The edit-mode counterpart is `FieldHelp` (a collapsible under the control,
 * `features/cards/sections/cardDetailUtils.tsx`). Renders nothing when the
 * text is empty, so a call site can pass whatever its resolver returns.
 * The text is free text an admin typed, so it goes through `LinkifiedText`;
 * the tooltip is interactive, so a link inside it can be clicked.
 */
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { MouseEvent } from "react";

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
