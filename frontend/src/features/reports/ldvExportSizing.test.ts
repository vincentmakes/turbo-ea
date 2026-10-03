import { describe, it, expect } from "vitest";
import { exportImageSize, isAppleMobileDevice } from "./ldvExportSizing";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const DESKTOP = { isAppleMobile: false, devicePixelRatio: 1 };
const APPLE = { isAppleMobile: true, devicePixelRatio: 3 };

describe("isAppleMobileDevice", () => {
  it("recognises an iPhone and an iPad by their user agent", () => {
    expect(isAppleMobileDevice({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
    expect(isAppleMobileDevice({ userAgent: IPAD, maxTouchPoints: 5 })).toBe(true);
  });

  it("recognises iPadOS reporting itself as a touch Macintosh", () => {
    expect(isAppleMobileDevice({ userAgent: MAC, maxTouchPoints: 5 })).toBe(true);
  });

  it("leaves a real Macintosh alone", () => {
    expect(isAppleMobileDevice({ userAgent: MAC, maxTouchPoints: 0 })).toBe(false);
  });

  it("leaves a touch-screen Windows laptop alone", () => {
    expect(isAppleMobileDevice({ userAgent: WINDOWS, maxTouchPoints: 10 })).toBe(false);
  });
});

describe("exportImageSize on desktop", () => {
  it("never goes below 800×600 for a tiny diagram", () => {
    expect(exportImageSize({ width: 10, height: 10 }, 0, DESKTOP)).toEqual({
      imageWidth: 800,
      imageHeight: 600,
      pixelRatio: 1,
    });
  });

  it("caps the pixel ratio at 2 and treats a falsy one as 1", () => {
    expect(exportImageSize({ width: 10, height: 10 }, 0, { ...DESKTOP, devicePixelRatio: 3 }).pixelRatio).toBe(2);
    expect(exportImageSize({ width: 10, height: 10 }, 0, { ...DESKTOP, devicePixelRatio: 1.5 }).pixelRatio).toBe(1.5);
    expect(exportImageSize({ width: 10, height: 10 }, 0, { ...DESKTOP, devicePixelRatio: 0 }).pixelRatio).toBe(1);
  });

  it("supersamples the padded bounds twice over, clamping each side to the minimum on its own", () => {
    // 400 + 2·48 = 496 → 992 wide; 200 + 2·48 = 296 → 592 tall, under the
    // 600 floor, so only the height is lifted.
    expect(exportImageSize({ width: 400, height: 200 }, 48, DESKTOP)).toEqual({
      imageWidth: 992,
      imageHeight: 600,
      pixelRatio: 1,
    });
  });

  it("scales a huge diagram so the final canvas fits 6000 px a side, keeping its aspect", () => {
    const size = exportImageSize({ width: 10_000, height: 5_000 }, 0, {
      ...DESKTOP,
      devicePixelRatio: 2,
    });
    // raw 20000×10000 at ratio 2 → 40000×20000; fit 0.15 → 6000×3000.
    expect(size).toEqual({ imageWidth: 3000, imageHeight: 1500, pixelRatio: 2 });
    expect(size.imageWidth * size.pixelRatio).toBeLessThanOrEqual(6000);
    expect(size.imageHeight * size.pixelRatio).toBeLessThanOrEqual(6000);
    expect(size.imageWidth * size.imageHeight * size.pixelRatio ** 2).toBeLessThanOrEqual(64_000_000);
  });

  it("keeps the aspect ratio within rounding when the width alone is what overflows", () => {
    const size = exportImageSize({ width: 7_000, height: 3_000 }, 0, DESKTOP);
    expect(size.imageWidth).toBe(6000);
    expect(size.imageWidth / size.imageHeight).toBeCloseTo(14_000 / 6_000, 2);
    expect(Number.isInteger(size.imageHeight)).toBe(true);
  });
});

describe("exportImageSize on an Apple mobile device", () => {
  it("renders at pixel ratio 1 whatever the screen reports", () => {
    expect(exportImageSize({ width: 10, height: 10 }, 0, APPLE)).toEqual({
      imageWidth: 800,
      imageHeight: 600,
      pixelRatio: 1,
    });
  });

  it("fits each side inside 4096 px", () => {
    const size = exportImageSize({ width: 10_000, height: 2_000 }, 0, APPLE);
    // raw 20000×4000; fit 0.2048 → 4096×819.2.
    expect(size).toEqual({ imageWidth: 4096, imageHeight: 819, pixelRatio: 1 });
  });

  it("fits the total area inside 16M px when the sides alone would exceed it", () => {
    // A square: 4096² is 16.78M, over WebKit's ~16.7M canvas budget, so the
    // area clamp has to shave it to 4000².
    const size = exportImageSize({ width: 5_000, height: 5_000 }, 0, APPLE);
    expect(size).toEqual({ imageWidth: 4000, imageHeight: 4000, pixelRatio: 1 });
    expect(size.imageWidth * size.imageHeight).toBeLessThanOrEqual(16_000_000);
  });

  it("preserves the aspect ratio through the area clamp", () => {
    const size = exportImageSize({ width: 6_000, height: 4_500 }, 0, APPLE);
    expect(size.imageWidth).toBeLessThanOrEqual(4096);
    expect(size.imageHeight).toBeLessThanOrEqual(4096);
    expect(size.imageWidth * size.imageHeight).toBeLessThanOrEqual(16_000_000);
    expect(size.imageWidth / size.imageHeight).toBeCloseTo(6_000 / 4_500, 2);
  });

  it("never returns a side below 1 px, even for an absurd aspect ratio", () => {
    // A ribbon a billion px wide scales its 600 px height to a fraction of a
    // pixel; the result must still be a usable image size.
    const size = exportImageSize({ width: 1_000_000_000, height: 0 }, 0, APPLE);
    expect(size.imageWidth).toBe(4096);
    expect(size.imageHeight).toBe(1);
    expect(Number.isInteger(size.imageWidth)).toBe(true);
    expect(Number.isInteger(size.imageHeight)).toBe(true);
  });
});
