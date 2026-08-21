/**
 * Self-healing against a stale cached SPA build.
 *
 * Deploys replace the frontend image, which purges the previous build's
 * content-hashed bundles. Two failure modes can strand a browser on the old
 * build even though `index.html` is served with `Cache-Control: no-cache`:
 *
 * 1. **Stale document on boot** — a cache that skipped revalidation (Safari
 *    cached the page before the no-cache header shipped, or an intermediary
 *    ignored it) serves the previous `index.html`, so the whole app is old.
 *    Detected by comparing the build-time `__APP_VERSION__` against the
 *    version the backend reports on `/api/health`. A `location.reload()`
 *    heals it: reload navigations revalidate the document unconditionally,
 *    bypassing heuristic caching.
 * 2. **Deploy mid-session** — the running app lazy-loads a route whose chunk
 *    no longer exists on the server. Vite surfaces that as a
 *    `vite:preloadError` event on `window`; without handling it the user
 *    gets a broken page. A reload lands them on the new build.
 *
 * Both reloads are guarded through sessionStorage so a cache that refuses to
 * update (or a rolling deploy where backend and frontend are briefly on
 * different versions) can never produce a reload loop. All guards degrade to
 * "reload at most this once" when sessionStorage itself throws (private
 * browsing, storage disabled).
 */

const RELOADED_FOR_VERSION_KEY = "turboea.updateGuard.reloadedFor";
const CHUNK_RELOAD_AT_KEY = "turboea.updateGuard.chunkReloadAt";

/** Minimum gap between chunk-error reloads, so a still-broken server
 * (e.g. mid-deploy) cannot spin the tab. */
export const CHUNK_RELOAD_MIN_INTERVAL_MS = 60_000;

/**
 * Pure decision: reload only when the server reports a concrete version that
 * differs from the running build AND this session has not already reloaded
 * for that exact server version (the anti-loop guard).
 */
export function shouldReloadForVersion(
  builtVersion: string,
  serverVersion: unknown,
  alreadyReloadedFor: string | null,
): serverVersion is string {
  if (typeof serverVersion !== "string" || serverVersion === "") return false;
  if (builtVersion === "" || serverVersion === builtVersion) return false;
  return alreadyReloadedFor !== serverVersion;
}

/** Pure decision: allow a chunk-error reload unless one happened recently. */
export function shouldReloadForChunkError(now: number, lastReloadAt: string | null): boolean {
  const last = lastReloadAt === null ? NaN : Number(lastReloadAt);
  return !(Number.isFinite(last) && now - last < CHUNK_RELOAD_MIN_INTERVAL_MS);
}

function readGuard(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeGuard(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    // Storage unavailable: report failure so callers can fall back to an
    // in-memory guard instead of reloading unboundedly.
    return false;
  }
}

// In-memory fallbacks for when sessionStorage is unavailable. They don't
// survive the reload (fresh JS context), which is exactly why the reload is
// then limited to once per *page load* rather than once per session — still
// loop-free, because a healed page stops triggering the checks.
let reloadedForVersionFallback: string | null = null;
let chunkReloadHandled = false;

async function checkServerVersion(): Promise<void> {
  let serverVersion: unknown;
  try {
    // Same-origin, unauthenticated, and tiny — and `no-store` so this probe
    // can never itself be answered by the cache being probed around.
    const res = await fetch("/api/health", { cache: "no-store" });
    if (!res.ok) return;
    serverVersion = ((await res.json()) as { version?: unknown }).version;
  } catch {
    return; // offline or backend restarting — nothing to heal from here
  }
  const reloadedFor = readGuard(RELOADED_FOR_VERSION_KEY) ?? reloadedForVersionFallback;
  if (!shouldReloadForVersion(__APP_VERSION__, serverVersion, reloadedFor)) return;
  reloadedForVersionFallback = serverVersion;
  writeGuard(RELOADED_FOR_VERSION_KEY, serverVersion);
  window.location.reload();
}

function onPreloadError(event: Event): void {
  if (chunkReloadHandled) return;
  if (!shouldReloadForChunkError(Date.now(), readGuard(CHUNK_RELOAD_AT_KEY))) return;
  chunkReloadHandled = true;
  writeGuard(CHUNK_RELOAD_AT_KEY, String(Date.now()));
  // Suppress Vite's re-throw: the reload IS the handling, and the rejected
  // lazy() promise would otherwise flash the error boundary first.
  event.preventDefault();
  window.location.reload();
}

/** Install once at boot, before React renders. */
export function installAppUpdateGuard(): void {
  window.addEventListener("vite:preloadError", onPreloadError);
  void checkServerVersion();
}
