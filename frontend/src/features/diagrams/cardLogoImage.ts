/**
 * Composing a card's logo and its type icon into ONE raster image, for DrawIO.
 *
 * A `shape=label` cell has exactly one image slot (see `iconStyleParts` in
 * `drawio-shapes.ts`), so a card that wants to show both its logo and its type
 * glyph has to hand mxGraph a single picture with both already in it.
 *
 * Three constraints decide the shape of what comes out, and each of them has
 * already bitten something in this codebase:
 *
 *  - **It has to be a flat raster.** A gallery thumbnail is an exported SVG
 *    rendered through `<img src="data:…">`, which is secure static mode: an
 *    SVG-wrapping-a-PNG would put a nested data reference inside that, and
 *    whether it resolves is a per-engine judgement call. A single PNG nested
 *    one level inside the exported SVG is the ordinary case every raster on a
 *    diagram already exercises. So the type badge is rastered in here rather
 *    than carried as path data.
 *  - **It must contain no raw `;` or `=`.** mxGraph parses a style as
 *    `;`-delimited `key=value` pairs and this file's own helpers `split(";")`,
 *    so `data:image/png;base64,…==` would truncate the token and corrupt every
 *    style part after it. The composed raster is therefore handed over inside
 *    an `encodeURIComponent`-ed SVG — byte for byte the encoding the card-type
 *    icons have always used, and the only one this product has proof DrawIO
 *    renders. See `toStyleSafeDataUri` for what was tried before it.
 *  - **It has to be small.** The image lives in the cell's style string, which
 *    is saved into the diagram XML — so the megabyte a real logo may weigh
 *    would be paid again per card, per save, per thumbnail. A downscaled copy
 *    at {@link LOGO_EMBED_PX} costs a few kilobytes and is still sharp at the
 *    18 px the cell draws it at, on a 2× display.
 *
 * Nothing here is load-bearing: every failure path — a 404, a wiped volume, a
 * browser with no canvas — resolves to `null`, and the caller falls back to the
 * plain type icon the card had before logos existed.
 */

import { tint } from "@/lib/color";

import { ICON_PATHS } from "./iconPaths";

/** Edge of the square the logo is downscaled into, in device-independent px. */
export const LOGO_EMBED_PX = 48;

/**
 * Cache of composed images, keyed by card id + logo timestamp + type icon.
 *
 * Composing is a decode plus two canvas draws, and the view pass re-runs on
 * every perspective change over the same cards. Including the logo's
 * `updated_at` in the key is what makes a replaced logo miss rather than
 * serve the old picture.
 */
const _cache = new Map<string, string | null>();

/** Bounded so a long editing session over many diagrams cannot grow forever. */
const MAX_CACHE = 500;

function cacheKey(logoUrl: string, icon: string | undefined, color: string): string {
  return `${logoUrl}|${icon ?? ""}|${color}`;
}

function remember(key: string, value: string | null): string | null {
  if (_cache.size >= MAX_CACHE) {
    // Plain FIFO eviction: the working set is "the cards on this canvas", so
    // anything cleverer would buy nothing.
    const oldest = _cache.keys().next();
    if (!oldest.done) _cache.delete(oldest.value);
  }
  _cache.set(key, value);
  return value;
}

/**
 * Wrap the composed PNG in an SVG, and encode it the way the card-type icons
 * already are.
 *
 * The style value cannot carry a raw `;` or `=` — mxGraph parses a style as
 * `;`-delimited `key=value`, and this file's own helpers `split(";")` — which
 * rules out `data:image/png;base64,…==` directly.
 *
 * A percent-encoded PNG (`data:image/png,%89PNG…`) satisfies that too, and
 * loads correctly in a browser, including through the SVG `<image>` element
 * mxGraph renders into — both verified. It nonetheless came back as a broken
 * image inside DrawIO. Rather than keep guessing at which layer mangles it,
 * this uses the one encoding this product already proves DrawIO renders: the
 * card-type icons are `data:image/svg+xml,` + `encodeURIComponent`, and they
 * have shipped that way since before logos existed. Wrapping the raster in an
 * SVG makes the outer URI the same scheme, media type and encoding as the
 * icons beside it, leaving no untested variable.
 *
 * The nested `data:` reference is not an external fetch, so it resolves inside
 * an image-rendered SVG; verified painting real pixels in Chromium.
 */
function toStyleSafeDataUri(base64Url: string, size: number): string | null {
  if (!base64Url.startsWith("data:image/png")) return null;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    // `href` for SVG 2, `xlink:href` for renderers still on SVG 1.1 — the
    // cost is a duplicated attribute, the alternative is a blank tile on
    // whichever one the viewer happens to use.
    `<image href="${base64Url}" xlink:href="${base64Url}" ` +
    `x="0" y="0" width="${size}" height="${size}" ` +
    `preserveAspectRatio="xMidYMid meet"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      // Same-origin, so no crossOrigin dance — and no tainted canvas either,
      // which is what would make `toDataURL` throw below.
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    } catch {
      resolve(null);
    }
  });
}

/**
 * Share of the tile's HEIGHT the logo gets. The type glyph takes the band
 * below it, at the left edge.
 *
 * Stacked rather than cornered because a third of the colour pack is
 * wordmarks — up to 11.8:1 — and those are fitted by their longer side, so
 * they need the tile's full WIDTH. A glyph tucked into either bottom corner
 * would sit under the end of every one of them; a band underneath collides
 * with nothing.
 */
const LOGO_BAND = 0.72;

/**
 * How far the plate behind the logo is washed toward white.
 *
 * Deliberately darker than `tint`'s own default, which exists for a swimlane
 * fill covering a large area: at that strength a plate this small reads as
 * near-white, which is the stark hole-in-the-card look it is meant to avoid.
 * Measured across every seeded card colour, this keeps better than 13:1
 * contrast against black, so a mark drawn in dark ink still sits cleanly on
 * it — pinned by a test, because darkening it further is exactly the tweak
 * that would quietly cost legibility.
 */
const PLATE_TINT = 0.78;

/**
 * A plate behind the logo, sized to the mark rather than the tile, in a pale
 * wash of the card's own colour.
 *
 * A card cell is filled with its card-type colour, and a great many marks are
 * drawn in dark ink for a white page — Docker's and Kafka's among them — so
 * without this they read as a smudge on anything but a pale card. The card
 * detail page has never had the problem because `CardLogoAvatar` already puts
 * the logo on a paper-coloured tile; this is the same treatment where the
 * background is not ours to choose.
 *
 * Tinted rather than white: a white rectangle on a coloured card reads as a
 * hole punched in it. The same wash `tint` gives every other faint background
 * in the diagram module keeps the plate part of the card while still being
 * light enough for a dark mark to sit on.
 *
 * Sized to the drawn mark plus a small pad, NOT to the whole tile: a wordmark
 * 48×13 inside a 48×35 plate would be the conspicuous block this replaced.
 * The type glyph is deliberately outside it, staying white on the card's own
 * colour.
 */
function drawLogoPlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  size: number,
  color: string,
): void {
  const r = Math.max(1, Math.round(size * 0.06));
  ctx.save();
  ctx.fillStyle = tint(color, PLATE_TINT);
  ctx.beginPath();
  // `roundRect` is not universally available; a square plate is a perfectly
  // good fallback and never worth failing the whole composite over.
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.restore();
}

/**
 * Draw the card-type glyph in the band under the logo, at the left edge, as a
 * plain white mark.
 *
 * White, and with no plate behind it, for one reason: this composite is drawn
 * ON the card cell, whose fill IS the card-type colour — so a glyph in that
 * colour would be invisible against it, which is why `buildIconImage` renders
 * the plain type icon white too. An earlier version compensated with a white
 * plate, and at the size a diagram actually draws this, the plate was a
 * conspicuous white block sitting over the logo.
 *
 * Left-aligned so it lines up with the card's own left edge, the tile being
 * anchored there — and deliberately smaller than the bare type icon a card
 * without a logo shows, because here it is the secondary mark.
 */
function drawTypeBadge(
  ctx: CanvasRenderingContext2D,
  icon: string | undefined,
  size: number,
): void {
  const entry = icon ? ICON_PATHS[icon] : undefined;
  if (!entry) return;
  // `Path2D` takes SVG path data directly, so the glyph is drawn from exactly
  // the same committed path table the SVG icon uses — there is no second
  // source of truth for what a card type looks like.
  let path: Path2D;
  try {
    path = new Path2D(entry.d);
  } catch {
    return;
  }
  // The path table's viewBox varies by source ("0 0 24 24", "0 -960 960 960"),
  // so map it rather than assuming one.
  const [vx, vy, vw, vh] = entry.vb.split(/\s+/).map(Number);
  if (!vw || !vh) return;

  const glyph = size * (1 - LOGO_BAND);
  const scale = glyph / Math.max(vw, vh);

  ctx.save();
  ctx.translate(0, size - glyph);
  ctx.scale(scale, scale);
  ctx.translate(-vx, -vy);
  ctx.fillStyle = "#ffffff";
  ctx.fill(path);
  ctx.restore();
}

/**
 * Compose `logoUrl` and the type glyph into one PNG data URI, or `null`.
 *
 * Never throws and never rejects — a caller treats `null` as "this card has no
 * logo to show" and keeps whatever it was already drawing.
 */
export async function composeCardLogoImage(
  logoUrl: string,
  icon: string | undefined,
  color: string,
  size: number = LOGO_EMBED_PX,
): Promise<string | null> {
  const key = cacheKey(logoUrl, icon, color);
  const hit = _cache.get(key);
  if (hit !== undefined) return hit;

  const img = await loadImage(logoUrl);
  if (!img) return remember(key, null);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return remember(key, null);

    // Fit the mark inside the square without cropping it — a vendor's logo
    // must never be cut — and centre what is left over.
    const natural = Math.max(img.naturalWidth || img.width, 1);
    const naturalH = Math.max(img.naturalHeight || img.height, 1);
    // The logo gets the full tile width and the upper band of its height, so
    // a wordmark is never squeezed by the glyph sitting below it.
    // The plate eats into the band, so fit the mark to what is left of it.
    const bandH = size * LOGO_BAND;
    const pad = Math.max(1, Math.round(size * 0.05));
    const scale = Math.min((size - pad * 2) / natural, (bandH - pad * 2) / naturalH);
    const w = Math.max(1, Math.round(natural * scale));
    const h = Math.max(1, Math.round(naturalH * scale));
    const x = Math.round((size - w) / 2);
    const y = Math.round((bandH - h) / 2);

    drawLogoPlate(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2, size, color);
    ctx.drawImage(img, x, y, w, h);

    drawTypeBadge(ctx, icon, size);

    const url = canvas.toDataURL("image/png");
    // A canvas with no 2d implementation behind it (jsdom, some headless
    // runners) answers `toDataURL` with the bare "data:," sentinel.
    if (!url || !url.startsWith("data:image/png")) return remember(key, null);
    return remember(key, toStyleSafeDataUri(url, size));
  } catch {
    return remember(key, null);
  }
}

/** Drop every cached composition. Exported for tests. */
export function _resetCardLogoImageCache(): void {
  _cache.clear();
}
