/**
 * MUI theme builder.
 *
 * Wires the design tokens from `./tokens` into the MUI palette so that
 * components using semantic Chip/Alert/Button colors (`color="success"` etc.)
 * resolve to the canonical token values.
 */

import { createTheme } from "@mui/material/styles";
import { brand, surface, STATUS_COLORS, typography } from "./tokens";

export function buildTheme(mode: "light" | "dark", direction: "ltr" | "rtl" = "ltr") {
  return createTheme({
    direction,
    typography: {
      fontFamily: typography.fontFamily,
    },
    palette: {
      mode,
      primary: { main: brand.primary },
      success: { main: STATUS_COLORS.success },
      warning: { main: STATUS_COLORS.warning },
      error: { main: STATUS_COLORS.error },
      info: { main: STATUS_COLORS.info },
      background: mode === "dark" ? surface.dark : surface.light,
    },
    components: {
      MuiCard: {
        defaultProps: { variant: "outlined" },
      },
      // Field labels are static — see UI_GUIDELINES.md §3.5.
      //
      // MUI floats an outlined field's label and opens the outline "notch"
      // (the <legend> inside .MuiOutlinedInput-notchedOutline, whose
      // max-width flips from 0.01px to 100%) from the same FormControl state
      // (filled || focused || adornedStart). WebKit does not re-lay out a
      // percentage max-width on a <legend> inside a <fieldset> in some flex
      // layouts (the multiline InputBase root, a Stack parent), so whenever
      // the notch opened AFTER mount — a value arriving asynchronously, the
      // first keystroke, a focus — Safari drew the border straight through
      // the floated label (mui/material-ui#44988, #46891; fix PR #48566 still
      // open). Pinning both here means neither ever transitions: the label
      // always sits on the border and the notch is always open, in core and
      // in every extension (they render inside this ThemeProvider). Never
      // pin `shrink` / `notched` per field — staticLabels.test.tsx fails the
      // build on it — and never derive a label position from field state.
      MuiInputLabel: {
        defaultProps: { shrink: true },
      },
      MuiOutlinedInput: {
        defaultProps: { notched: true },
      },
    },
  });
}

export * from "./tokens";
