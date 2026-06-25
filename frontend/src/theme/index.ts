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
    },
  });
}

export * from "./tokens";
