import useMediaQuery from "@mui/material/useMediaQuery";

/** `true` when the reader asked their operating system for less motion. */
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
