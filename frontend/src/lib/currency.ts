/**
 * Currency symbol overrides for symbols that `Intl.NumberFormat` does not yet
 * render (newly-assigned Unicode currency signs). The override is only used when
 * the platform can actually draw the glyph — otherwise we fall back to the ISO
 * code so users never see a "tofu" box.
 */
export const CURRENCY_SYMBOL_OVERRIDES: Record<string, string> = {
  // U+20C1 SAUDI RIYAL SIGN — assigned in Unicode 17.0 (Sept 2025). Most
  // installed fonts don't carry it yet, so rendering is feature-detected below.
  SAR: "⃁",
};

const _glyphSupport: Record<string, boolean> = {};

// A guaranteed-unassigned private-use character renders as the font's `.notdef`
// box; we compare against its width to detect a missing glyph.
const NOTDEF_REF = String.fromCharCode(0xe000);

/**
 * Best-effort check that the current platform font can render `glyph`.
 * Compares the measured width against the `.notdef` reference width. Cached per
 * glyph. Returns `true` when measurement isn't available (e.g. SSR / jsdom) so
 * the override is preferred by default.
 */
export function canRenderGlyph(glyph: string): boolean {
  if (glyph in _glyphSupport) return _glyphSupport[glyph];
  let supported = true;
  try {
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.font = "72px sans-serif";
        const missingWidth = ctx.measureText(NOTDEF_REF).width;
        const glyphWidth = ctx.measureText(glyph).width;
        supported = glyphWidth > 0 && glyphWidth !== missingWidth;
      }
    }
  } catch {
    supported = true;
  }
  _glyphSupport[glyph] = supported;
  return supported;
}

/**
 * Display symbol for a currency code, applying an override glyph when one exists
 * and the font can render it. Returns `null` when there is no override (callers
 * then fall back to `Intl.NumberFormat`'s symbol).
 */
export function currencySymbolOverride(code: string): string | null {
  const override = CURRENCY_SYMBOL_OVERRIDES[code];
  if (!override) return null;
  return canRenderGlyph(override) ? override : code;
}
