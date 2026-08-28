// Generates the bundled brand-icon pack that `set_card_logos` resolves by
// slug, so an AI assistant can put a product's mark on a card without
// transferring an image at all.
//
// ⚠ THIS SCRIPT WRITES OUTSIDE `frontend/`. Its output lands in
//   `backend/app/services/data/`, because the pack is read by the backend
//   (that is where logo bytes are stored, and where slug resolution has to
//   happen — the MCP server never holds these bytes).
//
// Output is TWO files, not 3453:
//   brand_icons.pack   every PNG concatenated, no compression (PNG is already
//                      deflated, so a container that compressed would only
//                      cost CPU)
//   brand_icons.json   {slug, title, hex, offset, length} per icon
//
// One blob rather than a file per icon because 3453 tracked files is a real
// cost even when nothing reads them individually: it makes the GitHub diff
// unusable, and it silently truncated CI's changed-file detection, which
// caps at 3000 entries (see the note in .github/workflows/ci.yml).
//
// The format is deliberately trivial — concatenate, record offsets — rather
// than a zip: Node has no zip writer in its standard library, so a standard
// container would mean a new dependency, while `os.pread` on a plain blob is
// stdlib on the reading side, O(1), and thread-safe. Keeping the index as
// readable JSON is the other half of the trade: a pack update still shows in
// review as a text diff naming exactly which icons changed.
//
// Why rasterise here rather than in the backend: a card logo is stored as a
// bitmap, and the product deliberately refuses SVG (there is no sanitiser —
// see backend/app/api/v1/card_logos.py). Rendering SVG at runtime would mean
// a native renderer in the backend image, which we are not adding. Doing it
// at generation time costs nothing at runtime and keeps the backend free of
// any image dependency.
//
// TWO sources, both CC0 — see THIRD-PARTY-NOTICES.md. CC0 covers the artwork;
// the underlying trademarks remain their owners'.
//
//   logos         SVG Logos (gilbarbara), via @iconify-json/logos — the real,
//                 full-colour marks. Preferred for a bare slug, because a
//                 reader recognises Google's four colours far faster than a
//                 grey silhouette of them.
//   simpleicons   Simple Icons — one flat brand colour per mark. Broader
//                 coverage (3453 vs 2110), and the fallback wherever the
//                 colour set has nothing.
//
// Neither is tintable: both are baked at generation time, because honouring a
// tint parameter would need the runtime renderer we just avoided.
//
// Simple Icons are square. The colour set is not — a third of it is wordmarks,
// up to 11.8:1 — so each icon is fitted by its LONGER side and keeps its own
// aspect. Every surface that draws a logo already uses `object-fit: contain`,
// so a wide mark letterboxes in a square tile instead of stretching.
//
// Run with:  npm run gen:brand-icons
// There is intentionally no pre-commit hook — regenerate and commit the output
// deliberately, the same contract as gen-diagram-icons.

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import * as simpleIcons from "simple-icons";
import colourLogos from "@iconify-json/logos/icons.json" with { type: "json" };

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const outDir = resolve(repoRoot, "backend/app/services/data");
const packPath = join(outDir, "brand_icons.pack");
const indexPath = join(outDir, "brand_icons.json");

// A card logo renders at 32–48 CSS px, so 96 still covers 2× DPI at the
// largest of those. 128 was measured first and produced a 10.2 MB pack;
// 96 gives the same on-screen result for a little over half the bytes.
const SIZE = 96;

const simple = Object.entries(simpleIcons)
  .filter(([name]) => name.startsWith("si"))
  .map(([, icon]) => icon)
  .filter((icon) => icon && icon.slug && icon.path && icon.hex)
  .sort((a, b) => a.slug.localeCompare(b.slug));

const colour = Object.entries(colourLogos.icons)
  .filter(([, icon]) => icon && icon.body)
  .sort(([a], [b]) => a.localeCompare(b));

if (simple.length === 0 || colour.length === 0) {
  console.error("A source came back empty — aborting rather than shipping half a pack.");
  process.exit(1);
}

// The colour set carries no per-icon title, only a key. Simple Icons does, so
// borrow it wherever the two agree on a slug ("sap" → "SAP", which beats
// title-casing to "Sap"); otherwise turn the key into words.
const simpleTitles = new Map(simple.map((i) => [i.slug, i.title]));
const titleFor = (slug) =>
  simpleTitles.get(slug) ??
  slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** Rasterise an SVG so its LONGER side is SIZE, preserving aspect. */
function rasterise(svg, width, height) {
  const mode = width >= height ? "width" : "height";
  return new Resvg(svg, {
    fitTo: { mode, value: SIZE },
    background: "rgba(0,0,0,0)",
  })
    .render()
    .asPng();
}

// Both files are rewritten wholesale every run, so a slug retired upstream
// simply stops existing — there is no stale file left behind to answer a
// lookup, which a directory of loose files needed an explicit purge to avoid.
mkdirSync(outDir, { recursive: true });

let bytes = 0;
const index = [];
const blobs = [];

function add(pack, slug, title, hex, png) {
  index.push({
    pack,
    slug,
    title,
    ...(hex ? { hex } : {}),
    offset: bytes,
    length: png.length,
  });
  blobs.push(png);
  bytes += png.length;
}

// Colour first, so a bare slug resolves to the real mark.
for (const [slug, icon] of colour) {
  const w = icon.width || colourLogos.width;
  const h = icon.height || colourLogos.height;
  const svg =
    // `xmlns:xlink` is declared even though most bodies do not use it: a
    // handful still emit `xlink:href`, and resvg rejects the whole document
    // over an undeclared prefix rather than ignoring the attribute.
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" ` +
    `width="${w}" height="${h}">${icon.body}</svg>`;
  // A malformed body must not take the whole pack down with it.
  let png;
  try {
    png = rasterise(svg, w, h);
  } catch (err) {
    console.warn(`Skipping logos:${slug} — ${err.message}`);
    continue;
  }
  add("logos", slug, titleFor(slug), null, png);
}

for (const icon of simple) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<path fill="#${icon.hex}" d="${icon.path}"/></svg>`;
  add("simpleicons", icon.slug, icon.title, icon.hex, rasterise(svg, 24, 24));
}

const pack = Buffer.concat(blobs);
if (pack.length !== bytes) {
  console.error(`Pack is ${pack.length} B but the index accounts for ${bytes} B.`);
  process.exit(1);
}
writeFileSync(packPath, pack);
writeFileSync(indexPath, `${JSON.stringify(index, null, 0)}\n`);

// Every entry must round-trip: the offsets are the only thing standing
// between a slug and the wrong icon's bytes, and an off-by-one here would
// surface as a corrupted image on a card rather than as an error anywhere.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const seen = new Set();
for (const e of index) {
  const slice = pack.subarray(e.offset, e.offset + e.length);
  if (slice.length !== e.length || !slice.subarray(0, 8).equals(PNG_MAGIC)) {
    console.error(`Index entry for ${e.pack}:${e.slug} does not point at a PNG.`);
    process.exit(1);
  }
  const key = `${e.pack}:${e.slug}`;
  if (seen.has(key)) {
    console.error(`Duplicate entry ${key} — a bare slug would resolve at random.`);
    process.exit(1);
  }
  seen.add(key);
}

const byPack = index.reduce((acc, e) => ({ ...acc, [e.pack]: (acc[e.pack] || 0) + 1 }), {});
const shared = index.filter((e) => e.pack === "simpleicons")
  .filter((e) => index.some((o) => o.pack === "logos" && o.slug === e.slug)).length;
console.log(`Packs: ${JSON.stringify(byPack)} (${shared} slugs in both; colour wins a bare slug)`);

const mb = (bytes / 1024 / 1024).toFixed(1);
console.log(`Wrote ${index.length} icons at ${SIZE}px (longest side) to ${packPath}`);
console.log(`Pack size: ${mb} MB (mean ${Math.round(bytes / index.length)} B/icon)`);
