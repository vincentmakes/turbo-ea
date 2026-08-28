/**
 * Composing a card's logo into something a DrawIO cell style can carry.
 *
 * jsdom has no canvas implementation, so the drawing itself is stubbed. What
 * is worth pinning is not the pixels — it is the contract the style parser
 * imposes on the string that comes out, and the promise that nothing here ever
 * throws at a caller mid-render.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { composeCardLogoImage, _resetCardLogoImageCache } from "./cardLogoImage";

/** A 1×1 PNG, base64 — the shape `canvas.toDataURL` hands back. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let loadSucceeds = true;

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 64;
  naturalHeight = 32;
  width = 64;
  height = 32;
  set src(_v: string) {
    // Resolve on a later tick, as a real decode would.
    setTimeout(() => (loadSucceeds ? this.onload?.() : this.onerror?.()), 0);
  }
}

/** The live `toDataURL` spy. Kept as a handle because `vi.spyOn` on an
 *  already-spied method hands back the SAME spy — so a test that re-spied to
 *  count calls would inherit the history of everything before it. */
let toDataUrlSpy: ReturnType<typeof vi.spyOn>;

function stubCanvas(toDataURL: () => string) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    beginPath: () => {},
    rect: () => {},
    fill: () => {},
    stroke: () => {},
    drawImage: () => {},
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D);
  toDataUrlSpy = vi
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockImplementation(toDataURL);
}

beforeEach(() => {
  _resetCardLogoImageCache();
  loadSucceeds = true;
  vi.stubGlobal("Image", FakeImage);
  // `Path2D` is absent in jsdom; the badge draw is guarded and skips without
  // it, which is the same path a browser with a malformed glyph would take.
  stubCanvas(() => `data:image/png;base64,${PNG_B64}`);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("composeCardLogoImage", () => {
  it("returns a data URI carrying no raw ; or = ", async () => {
    // The one hard constraint: mxGraph parses a style as `;`-delimited
    // `key=value` pairs, so a `;base64,` prefix or `=` padding inside the image
    // token would truncate it and corrupt every part after it.
    const uri = await composeCardLogoImage("/api/v1/cards/c1/logo?v=1", "apps", "#0f7eb5");
    expect(uri).not.toBeNull();
    expect(uri!.startsWith("data:image/png,")).toBe(true);
    expect(uri!.slice("data:image/png,".length)).not.toMatch(/[;=]/);
  });

  it("round-trips to the same bytes the canvas produced", async () => {
    const uri = await composeCardLogoImage("/api/v1/cards/c1/logo?v=1", "apps", "#0f7eb5");
    // Decoded byte by byte, not with `decodeURIComponent`: the payload is raw
    // PNG octets, which are not valid UTF-8 — the very reason the encoder is
    // hand-rolled rather than delegating to it.
    const payload = uri!.slice("data:image/png,".length);
    const decoded = payload.replace(/%([0-9A-F]{2})/g, (_m, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
    expect(decoded).toBe(atob(PNG_B64));
  });

  it("returns null when the image cannot be loaded", async () => {
    // A 404, a wiped volume, a card whose logo was deleted between the payload
    // and the fetch. The caller keeps drawing the type icon.
    loadSucceeds = false;
    expect(await composeCardLogoImage("/api/v1/cards/gone/logo?v=1", "apps", "#0f7eb5")).toBeNull();
  });

  it("returns null when the canvas produces nothing", async () => {
    // What a headless runner with no 2d backend answers.
    stubCanvas(() => "data:,");
    expect(await composeCardLogoImage("/api/v1/cards/c1/logo?v=1", "apps", "#0f7eb5")).toBeNull();
  });

  it("composes once per card and reuses the result", async () => {
    const url = "/api/v1/cards/c1/logo?v=1";
    await composeCardLogoImage(url, "apps", "#0f7eb5");
    toDataUrlSpy.mockClear();
    await composeCardLogoImage(url, "apps", "#0f7eb5");
    expect(toDataUrlSpy).not.toHaveBeenCalled();
  });

  it("recomposes when the logo has been replaced", async () => {
    // The URL carries the logo's `updated_at`, so a replacement is a new key —
    // otherwise a card would keep showing the mark it used to have.
    await composeCardLogoImage("/api/v1/cards/c1/logo?v=1", "apps", "#0f7eb5");
    toDataUrlSpy.mockClear();
    await composeCardLogoImage("/api/v1/cards/c1/logo?v=2", "apps", "#0f7eb5");
    expect(toDataUrlSpy).toHaveBeenCalledTimes(1);
  });

  it("caches the failure too, so a missing logo is not refetched per pass", async () => {
    loadSucceeds = false;
    const url = "/api/v1/cards/gone/logo?v=1";
    expect(await composeCardLogoImage(url, "apps", "#0f7eb5")).toBeNull();
    loadSucceeds = true;
    expect(await composeCardLogoImage(url, "apps", "#0f7eb5")).toBeNull();
  });
});
