// Generates the house marks the NexaTech demo dataset puts on its own
// in-house applications.
//
// ⚠ THIS SCRIPT WRITES OUTSIDE `frontend/`. Its output lands in
//   `backend/app/services/data/demo_logos/`, because the demo seeder
//   (`backend/app/services/seed_demo_logos.py`) reads the bytes and stores
//   them as `card_logos` rows. Same arrangement as `gen-brand-icons.mjs`.
//
// WHY THIS EXISTS. Two thirds of the demo landscape is real products, and
// those resolve straight out of the bundled brand-icon pack. The rest is
// NexaTech's own software — NexaSCADA, NexaPortal, NexaCloud — which by
// construction has no mark anywhere in the world, so a demo that wanted its
// in-house family to look like a product family had to draw one.
//
// WHY PATHS AND NOT TEXT. The obvious way to draw a lettermark is `<text>`,
// and it is the wrong way: text needs a font, none is bundled with resvg, and
// whichever font a machine happened to have installed would render differently
// on a developer's laptop and in CI. The output is committed, so a
// non-deterministic generator means a diff every time anyone runs it. Glyph
// geometry therefore comes from `src/features/diagrams/iconPaths.ts` — the
// same committed, font-free Material Symbols path data the DrawIO card shapes
// already draw with.
//
// WHY LOOSE PNGs AND NOT A `.pack`. The brand-icon pack is one blob because
// 3,453 tracked files made review impossible and silently truncated CI's
// changed-file detection at 3,000 entries. Neither applies to six files, and
// loose PNGs render in the GitHub diff, so a reviewer can actually see the
// artwork they are approving.
//
// Run with:  npm run gen:demo-logos
// There is intentionally no pre-commit hook — regenerate and commit
// deliberately, the same contract the other two generators carry.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const iconPathsFile = resolve(repoRoot, "frontend/src/features/diagrams/iconPaths.ts");
const outDir = resolve(repoRoot, "backend/app/services/data/demo_logos");

// 96px matches the brand-icon pack: a card logo renders at 32–48 CSS px, so
// this still covers 2× DPI at the largest of those.
const SIZE = 96;
// The glyph's box inside the tile. The remainder is padding; a mark that fills
// its canvas edge to edge reads as a screenshot rather than as a logo.
const GLYPH = 54;
const RADIUS = 20;

// NexaTech's house palette — one blue-to-teal family, deliberately narrow.
// A house set should read as one company at a glance, which is also what
// separates it from the third-party marks sitting next to it in the grid.
const MARKS = [
  { stem: "nexascada", icon: "precision_manufacturing", fill: "#0C4A6E" },
  { stem: "nexacloud", icon: "cloud", fill: "#0369A1" },
  { stem: "nexaportal", icon: "language", fill: "#0E7490" },
  { stem: "nexamobile", icon: "smartphone", fill: "#0F766E" },
  { stem: "nexaconnect", icon: "hub", fill: "#155E75" },
  { stem: "nexacommerce", icon: "storefront", fill: "#116C57" },
];

/** Read ICON_PATHS out of the generated TypeScript module.
 *
 * A `.mjs` script cannot `import` a `.ts` file, and adding a TypeScript
 * loader to run one generator would be a poor trade. The generated file's
 * body is plain JSON between the assignment and the closing brace, so slice
 * it out and parse it — and fail loudly if that assumption ever stops
 * holding, rather than silently drawing nothing.
 */
function loadIconPaths() {
  const src = readFileSync(iconPathsFile, "utf8");
  const start = src.indexOf("{", src.indexOf("ICON_PATHS"));
  const end = src.lastIndexOf("};");
  if (start === -1 || end === -1 || end <= start) {
    console.error(`Could not find the ICON_PATHS object literal in ${iconPathsFile}.`);
    process.exit(1);
  }
  return JSON.parse(src.slice(start, end + 1));
}

/** Transform that fits a path's own viewBox into a GLYPH-sized centred box.
 *
 * Material Symbols are authored in "0 -960 960 960" — the y axis runs
 * negative — and `iconPaths.ts` warns that sources use different coordinate
 * systems, so the offset is derived from the declared viewBox rather than
 * assumed.
 */
function glyphTransform(vb) {
  const [minX, minY, w, h] = vb.trim().split(/\s+/).map(Number);
  if (![minX, minY, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
    console.error(`Unusable viewBox "${vb}".`);
    process.exit(1);
  }
  const scale = GLYPH / Math.max(w, h);
  const x = (SIZE - w * scale) / 2 - minX * scale;
  const y = (SIZE - h * scale) / 2 - minY * scale;
  return `translate(${x} ${y}) scale(${scale})`;
}

const ICON_PATHS = loadIconPaths();

// Rewritten wholesale every run: a mark retired from MARKS must not leave a
// stale PNG behind that a seeder could still pick up.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

for (const { stem, icon, fill } of MARKS) {
  const entry = ICON_PATHS[icon];
  if (!entry) {
    console.error(`Icon "${icon}" is not in iconPaths.ts — add it to the picker catalogue and run gen:diagram-icons.`);
    process.exit(1);
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" ` +
    `width="${SIZE}" height="${SIZE}">` +
    `<rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" ry="${RADIUS}" fill="${fill}"/>` +
    `<g transform="${glyphTransform(entry.vb)}"><path fill="#FFFFFF" d="${entry.d}"/></g>` +
    `</svg>`;

  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: SIZE },
    background: "rgba(0,0,0,0)",
  })
    .render()
    .asPng();

  if (!Buffer.from(png).subarray(0, 8).equals(PNG_MAGIC)) {
    console.error(`Rasterising ${stem} did not produce a PNG.`);
    process.exit(1);
  }
  writeFileSync(join(outDir, `${stem}.png`), png);
}

const written = readdirSync(outDir).filter((f) => f.endsWith(".png"));
if (written.length !== MARKS.length) {
  console.error(`Expected ${MARKS.length} marks, wrote ${written.length}.`);
  process.exit(1);
}
console.log(`Wrote ${written.length} house marks at ${SIZE}px to ${outDir}`);
