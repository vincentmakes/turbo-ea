// Generates the bundled brand-icon pack that `set_card_logos` resolves by
// slug, so an AI assistant can put a product's mark on a card without
// transferring an image at all.
//
// ⚠ THIS SCRIPT WRITES OUTSIDE `frontend/`. Its output lands in
//   `backend/app/services/data/brand_icons/`, because the pack is read by the
//   backend (that is where logo bytes are stored, and where slug resolution
//   has to happen — the MCP server never holds these bytes).
//
// Why rasterise here rather than in the backend: a card logo is stored as a
// bitmap, and the product deliberately refuses SVG (there is no sanitiser —
// see backend/app/api/v1/card_logos.py). Rendering SVG at runtime would mean
// a native renderer in the backend image, which we are not adding. Doing it
// at generation time costs nothing at runtime and keeps the backend free of
// any image dependency.
//
// Each icon is baked in its own official brand colour, which Simple Icons
// ships per icon. There is deliberately no tint parameter: honouring one
// would need the renderer we just avoided.
//
// Source: simple-icons (CC0-1.0) — see THIRD-PARTY-NOTICES.md. CC0 covers the
// artwork; the underlying trademarks remain their owners'.
//
// Run with:  npm run gen:brand-icons
// There is intentionally no pre-commit hook — regenerate and commit the output
// deliberately, the same contract as gen-diagram-icons.

import { mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import * as simpleIcons from "simple-icons";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const outDir = resolve(repoRoot, "backend/app/services/data/brand_icons");

// A card logo renders at 32–48 CSS px, so 96 still covers 2× DPI at the
// largest of those. 128 was measured first and produced a 10.2 MB pack;
// 96 gives the same on-screen result for a little over half the bytes.
const SIZE = 96;

const icons = Object.entries(simpleIcons)
  .filter(([name]) => name.startsWith("si"))
  .map(([, icon]) => icon)
  .filter((icon) => icon && icon.slug && icon.path && icon.hex)
  .sort((a, b) => a.slug.localeCompare(b.slug));

if (icons.length === 0) {
  console.error("No icons found in simple-icons — aborting rather than emptying the pack.");
  process.exit(1);
}

// Rebuild from scratch so a slug retired upstream does not linger on disk and
// keep answering lookups.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let bytes = 0;
const index = [];

for (const icon of icons) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<path fill="#${icon.hex}" d="${icon.path}"/></svg>`;
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: SIZE },
    background: "rgba(0,0,0,0)",
  })
    .render()
    .asPng();

  writeFileSync(join(outDir, `${icon.slug}.png`), png);
  bytes += png.length;
  index.push({ slug: icon.slug, title: icon.title, hex: icon.hex });
}

writeFileSync(join(outDir, "index.json"), `${JSON.stringify(index, null, 0)}\n`);

const files = readdirSync(outDir).filter((f) => f.endsWith(".png"));
const mb = (bytes / 1024 / 1024).toFixed(1);
console.log(`Wrote ${files.length} icons at ${SIZE}px to ${outDir}`);
console.log(`Total PNG bytes: ${mb} MB (mean ${Math.round(bytes / files.length)} B/icon)`);
if (files.length !== index.length) {
  console.error(`Mismatch: ${files.length} files vs ${index.length} index entries.`);
  process.exit(1);
}
