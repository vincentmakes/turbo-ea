/**
 * Which scripts the browser suite's coverage is about: the SPA's own chunks,
 * `/assets/<name>.js` at the site root, where vite's build writes them.
 *
 * One definition, imported by e2e/fixtures.ts (which records them) and
 * scripts/e2e-coverage.mjs (which converts them). No imports of its own, so
 * every Playwright worker can load it without pulling the converter's
 * libraries in. Anchored on purpose: DrawIO lives under /drawio/ and has no
 * map to src/, and a vendored bundle may well ship its own `assets/x.js` one
 * directory down — a chunk anywhere but the root is not ours.
 */
export const APP_ASSET = /^\/assets\/[^/?#]+\.js$/;

/** True for a URL whose path is an app chunk; false for anything else, a non-URL included. */
export function isAppAsset(url) {
  try {
    return APP_ASSET.test(new URL(url).pathname);
  } catch {
    return false;
  }
}
