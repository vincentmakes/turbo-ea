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

/**
 * Edge of the square the composite is rasterised into.
 *
 * Twice the {@link CARD_LOGO_SLOT_PX} the cell draws it at, so it stays sharp
 * on a 2x display. Raising it raises the bytes in every card's style string,
 * which is saved into the diagram XML — measured at ~11 KB per card here.
 */
const RASTER_SCALE = 2;

/** Edge of the square the logo occupies at the card's left, in cell units. */
export const LOGO_BOX_PX = 44;

/** Edge of the type glyph in the card's top-right corner, in cell units. */
export const TYPE_GLYPH_PX = 16;

/** Inset of the logo and the glyph from the card's edges. */
const EDGE_PAD = 6;

/** The card geometry the composite is built for — see `composeCardLogoImage`. */
const CARD_W = 210;
const CARD_H = 60;

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

function cacheKey(
  logoUrl: string,
  icon: string | undefined,
  color: string,
  w: number,
  h: number,
): string {
  // The composite is card-shaped, so cards of different sizes cannot share one.
  // In practice a canvas holds very few distinct sizes — the base card, and
  // whatever detail rows have grown it to — so this stays a small set.
  return `${logoUrl}|${icon ?? ""}|${color}|${w}x${h}`;
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
function toStyleSafeDataUri(base64Url: string, w: number, h: number): string | null {
  if (!base64Url.startsWith("data:image/png")) return null;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    // `href` for SVG 2, `xlink:href` for renderers still on SVG 1.1 — the
    // cost is a duplicated attribute, the alternative is a blank tile on
    // whichever one the viewer happens to use.
    `<image href="${base64Url}" xlink:href="${base64Url}" ` +
    `x="0" y="0" width="${w}" height="${h}" ` +
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
 * Placed in the CARD's top-right corner — the opposite corner from the logo,
 * so the two never compete for room. Earlier versions put it inside the logo's
 * own tile, first over the mark and then stacked beneath it; both cost the
 * logo the space it needed and left the glyph too small to read.
 */
function drawTypeBadge(
  ctx: CanvasRenderingContext2D,
  icon: string | undefined,
  cardW: number,
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

  const scale = TYPE_GLYPH_PX / Math.max(vw, vh);

  ctx.save();
  ctx.translate(cardW - TYPE_GLYPH_PX - EDGE_PAD, EDGE_PAD);
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
  // Deliberately the BASE card geometry rather than each cell's real size.
  // mxGraph draws the image at these dimensions anchored top-left, so on a
  // card that detail rows have grown, the composite simply occupies the top
  // 60px — which is where the glyph belongs anyway. Reading every cell's
  // geometry would mean threading it through an async compose and a cache key
  // per size, to move a logo a few pixels down on the minority of cards.
  cardW: number = CARD_W,
  cardH: number = CARD_H,
): Promise<string | null> {
  const key = cacheKey(logoUrl, icon, color, cardW, cardH);
  const hit = _cache.get(key);
  if (hit !== undefined) return hit;

  const img = await loadImage(logoUrl);
  if (!img) return remember(key, null);

  try {
    // Card-shaped, not a small tile: a `shape=label` cell has exactly ONE
    // image slot, so the only way to put the type glyph in the card's own
    // top-right corner is for the image to BE the card.
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(cardW * RASTER_SCALE));
    canvas.height = Math.max(1, Math.round(cardH * RASTER_SCALE));
    const ctx = canvas.getContext("2d");
    if (!ctx) return remember(key, null);
    ctx.scale(RASTER_SCALE, RASTER_SCALE);

    // Fit the mark inside its box without cropping it — a vendor's logo must
    // never be cut — and centre what is left over. The box is square, so a
    // wordmark simply letterboxes inside it.
    const natural = Math.max(img.naturalWidth || img.width, 1);
    const naturalH = Math.max(img.naturalHeight || img.height, 1);
    const box = Math.min(LOGO_BOX_PX, cardH - EDGE_PAD * 2);
    const pad = 3;
    const scale = Math.min((box - pad * 2) / natural, (box - pad * 2) / naturalH);
    const w = Math.max(1, Math.round(natural * scale));
    const h = Math.max(1, Math.round(naturalH * scale));
    // Vertically centred in the card, so the logo does not float against the
    // top edge on a card that detail rows have grown.
    const x = EDGE_PAD + Math.round((box - w) / 2);
    const y = Math.round((cardH - h) / 2);

    drawLogoPlate(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2, box, color);
    ctx.drawImage(img, x, y, w, h);

    drawTypeBadge(ctx, icon, cardW);

    const url = canvas.toDataURL("image/png");
    // A canvas with no 2d implementation behind it (jsdom, some headless
    // runners) answers `toDataURL` with the bare "data:," sentinel.
    if (!url || !url.startsWith("data:image/png")) return remember(key, null);
    return remember(key, toStyleSafeDataUri(url, cardW, cardH));
  } catch {
    return remember(key, null);
  }
}

/** Drop every cached composition. Exported for tests. */
export function _resetCardLogoImageCache(): void {
  _cache.clear();
}
