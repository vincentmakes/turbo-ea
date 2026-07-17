/**
 * Small pure color helpers — hex validation, WCAG contrast, and the two
 * readability helpers every card-type/tag color consumer must use
 * (`readableTextColor` for text painted ON the color, `readableTypeColor`
 * for the color used AS an accent against the theme paper). Card-type and
 * tag colors are admin-editable, so no hardcoded `#fff` text or raw accent
 * can be assumed readable.
 *
 * Translucent tints (hover/active/divider alphas) are derived with MUI's
 * `alpha()` from `@mui/material/styles`; do not reimplement that here.
 */

import { darken, lighten } from "@mui/material/styles";

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_RE.test(value);
}

/** sRGB channel (0-255) → linearized value per WCAG 2.x. */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb color. */
export function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * WCAG contrast ratio between two #rrggbb colors (1..21).
 * Returns 1 for invalid input so callers never divide by garbage.
 */
export function contrastRatio(hexA: string, hexB: string): number {
  if (!isHexColor(hexA) || !isHexColor(hexB)) return 1;
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Black or white text for a given (admin-editable) background color.
 *
 * Deliberately biased toward white rather than picking the mathematically
 * higher contrast: the default card-type palette is mid-toned (Application
 * `#0f7eb5` has ~4.5:1 vs white but ~4.7:1 vs black) and has always rendered
 * white text, so a pure max-contrast pick would flip half the defaults to
 * black for no legibility gain. The 0.6 luminance cutoff keeps EVERY seed
 * color — including Provider orange `#ffa31f` (~0.48) — on white text, and
 * flips to black only for genuinely light colors (pale ArchiMate yellows,
 * light greens/greys, ~0.7+) where white text is unreadable. Invalid input
 * falls back to white — the historical hardcoded default — so legacy non-hex
 * values render as before.
 */
export function readableTextColor(bg: string): "#ffffff" | "#000000" {
  if (!isHexColor(bg)) return "#ffffff";
  return relativeLuminance(bg) <= 0.6 ? "#ffffff" : "#000000";
}

/**
 * Returns a card-type color that reads cleanly as an ACCENT (border, caption,
 * icon) against the active theme's paper. The seed palette is tuned for
 * white-ish backgrounds, and admins can now pick arbitrary colors, so both
 * directions need a luminance-gated adjustment:
 *
 * - dark theme: dark colors (navy, purple) fall below 4.5:1 on dark paper and
 *   are lightened; already-light colors pass through — blanket lightening
 *   washed pale admin colors out to near-white.
 * - light theme: near-white colors (e.g. ArchiMate pale yellows) vanish on
 *   white paper and are darkened slightly; everything else passes through
 *   untouched, so the default palette renders exactly as before.
 */
export function readableTypeColor(hex: string, isDark: boolean): string {
  if (!isHexColor(hex)) return hex;
  const lum = relativeLuminance(hex);
  if (isDark) return lum < 0.35 ? lighten(hex, 0.45) : hex;
  return lum > 0.8 ? darken(hex, 0.25) : hex;
}
