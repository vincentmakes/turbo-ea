import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PATHS, VIEW_BOX } from "./linkChangeGlyphs";

/**
 * These two glyphs are hand-copied out of `@material-symbols/svg-400` instead
 * of going through `npm run gen:diagram-icons` (the module's own docblock says
 * why). Nothing regenerates them, so this compares the literals against the
 * package on every run: a geometry change in a dependency bump surfaces here
 * rather than as a quietly wrong icon on the canvas.
 *
 * Same source directory the generator reads, so the two stay in step.
 */
const SYMBOLS_DIR = resolve(
  __dirname,
  "../../../node_modules/@material-symbols/svg-400/outlined",
);

const SOURCES: Record<keyof typeof PATHS, string> = {
  gained: "add_link",
  lost: "link_off",
};

function readSymbol(name: string): string {
  return readFileSync(resolve(SYMBOLS_DIR, `${name}.svg`), "utf8");
}

describe("LinkChangeIcon glyph data", () => {
  for (const [kind, name] of Object.entries(SOURCES)) {
    it(`matches @material-symbols/svg-400 ${name}.svg`, () => {
      const src = readSymbol(name);
      const ds = [...src.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]);
      // A second path would mean the icon was redrawn as a compound shape and
      // the single-<path> component can no longer represent it.
      expect(ds).toHaveLength(1);
      expect(PATHS[kind as keyof typeof PATHS]).toBe(ds[0]);
    });

    it(`shares the ${name}.svg coordinate system`, () => {
      expect(readSymbol(name)).toContain(`viewBox="${VIEW_BOX}"`);
    });
  }
});
