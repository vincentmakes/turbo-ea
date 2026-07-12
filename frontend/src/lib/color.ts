/**
 * Small pure color helpers — hex validation and WCAG contrast.
 *
 * Translucent tints (hover/active/divider alphas) are derived with MUI's
 * `alpha()` from `@mui/material/styles`; do not reimplement that here.
 */

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
function relativeLuminance(hex: string): number {
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
