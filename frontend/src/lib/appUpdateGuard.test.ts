import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  shouldReloadForVersion,
  shouldReloadForChunkError,
  CHUNK_RELOAD_MIN_INTERVAL_MS,
} from "./appUpdateGuard";

describe("shouldReloadForVersion", () => {
  it("reloads when the backend reports a different version than the running build", () => {
    // The stale-cache case: Safari served an old index.html, so the app is
    // 2.68.x while the deployed backend already reports 2.69.0.
    expect(shouldReloadForVersion("2.68.0", "2.69.0", null)).toBe(true);
  });

  it("does nothing when build and backend agree", () => {
    expect(shouldReloadForVersion("2.69.0", "2.69.0", null)).toBe(false);
  });

  it("never reloads twice for the same server version — no loop when the cache refuses to update", () => {
    expect(shouldReloadForVersion("2.68.0", "2.69.0", "2.69.0")).toBe(false);
    // ...but a NEWER deploy after the failed heal is a fresh attempt.
    expect(shouldReloadForVersion("2.68.0", "2.70.0", "2.69.0")).toBe(true);
  });

  it("ignores a malformed or missing server version", () => {
    expect(shouldReloadForVersion("2.69.0", undefined, null)).toBe(false);
    expect(shouldReloadForVersion("2.69.0", "", null)).toBe(false);
    expect(shouldReloadForVersion("2.69.0", 42, null)).toBe(false);
    expect(shouldReloadForVersion("2.69.0", { v: "x" }, null)).toBe(false);
  });

  it("ignores an empty built version rather than reload-looping a broken build", () => {
    expect(shouldReloadForVersion("", "2.69.0", null)).toBe(false);
  });
});

describe("shouldReloadForChunkError", () => {
  it("allows the first reload", () => {
    expect(shouldReloadForChunkError(1_000_000, null)).toBe(true);
  });

  it("throttles a second reload inside the interval — a mid-deploy server cannot spin the tab", () => {
    const now = 1_000_000;
    expect(shouldReloadForChunkError(now, String(now - 5_000))).toBe(false);
    expect(shouldReloadForChunkError(now, String(now - CHUNK_RELOAD_MIN_INTERVAL_MS))).toBe(true);
  });

  it("treats a corrupted guard value as no guard", () => {
    expect(shouldReloadForChunkError(1_000_000, "not-a-number")).toBe(true);
  });
});

describe("installAppUpdateGuard wiring", () => {
  const reload = vi.fn();
  let originalLocation: Location;

  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    reload.mockClear();
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, reload },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
    vi.unstubAllGlobals();
  });

  async function install(healthVersion: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: "ok", version: healthVersion }),
      })),
    );
    // Fresh module instance so the in-memory fallbacks reset per test.
    const mod = await import("./appUpdateGuard");
    mod.installAppUpdateGuard();
    // Let the health probe's whole async chain settle (fetch → json → decide).
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("reloads once on version skew and records the guard", async () => {
    await install("99.0.0");
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem("turboea.updateGuard.reloadedFor")).toBe("99.0.0");
  });

  it("does not reload when versions match", async () => {
    await install("0.0.0-test"); // vitest builds inject __APP_VERSION__ = 0.0.0-test
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload again for a version it already reloaded for", async () => {
    sessionStorage.setItem("turboea.updateGuard.reloadedFor", "99.0.0");
    await install("99.0.0");
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads on vite:preloadError and suppresses Vite's re-throw", async () => {
    await install("0.0.0-test");
    const event = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(event);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    // A second chunk error right after must not stack another reload.
    window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("survives a failing health endpoint without reloading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("backend restarting");
      }),
    );
    const mod = await import("./appUpdateGuard");
    expect(() => mod.installAppUpdateGuard()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reload).not.toHaveBeenCalled();
  });
});
