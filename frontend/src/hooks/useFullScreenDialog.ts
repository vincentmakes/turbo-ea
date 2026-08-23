import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";

/**
 * Whether a dialog should render edge-to-edge on this viewport.
 *
 * Below `sm` even a `maxWidth="xs"` dialog leaves only a sliver of margin and
 * its form controls get squeezed, so dialogs go `fullScreen` instead. The
 * breakpoint is deliberately `sm` and not the `md` the PPM *pages* use: a 600px
 * dialog still sits comfortably inside a 768px tablet, so "does the dialog fit?"
 * is a different question from "is the page layout cramped?".
 *
 * Callers should also pass `autoFocus={!fullScreen}` — an autofocused field pops
 * the on-screen keyboard the moment a full-screen dialog opens.
 */
export function useFullScreenDialog(): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down("sm"));
}
