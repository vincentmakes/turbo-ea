/**
 * Image size for the PNG / SVG export of the Layered Dependency View.
 *
 * html-to-image renders the diagram into an <img> sized imageWidth×imageHeight,
 * then draws it onto a canvas sized (imageWidth×pixelRatio)×(imageHeight×
 * pixelRatio). iOS/iPadOS WebKit caps canvas/image area at ~16.7M px and
 * rejects oversized SVG images with a "Load failed" error (desktop Chrome/FF
 * allow far more). So the caps are device-aware and the FINAL canvas is fitted
 * inside both a per-dimension and a total-area budget. Desktop output is
 * unchanged for normal diagrams.
 */
export interface ExportEnvironment {
  isAppleMobile: boolean;
  /** `window.devicePixelRatio`; a falsy value counts as 1. */
  devicePixelRatio: number;
}

export interface ExportImageSize {
  imageWidth: number;
  imageHeight: number;
  pixelRatio: number;
}

/** iPhone / iPad / iPod, and iPadOS reporting itself as a touch Macintosh. */
export function isAppleMobileDevice(nav: { userAgent: string; maxTouchPoints: number }): boolean {
  return (
    /iP(hone|ad|od)/.test(nav.userAgent) ||
    (nav.maxTouchPoints > 1 && /Macintosh/.test(nav.userAgent))
  );
}

export function exportImageSize(
  bounds: { width: number; height: number },
  pad: number,
  env: ExportEnvironment,
): ExportImageSize {
  const maxDim = env.isAppleMobile ? 4096 : 6000;
  const maxArea = env.isAppleMobile ? 16_000_000 : 64_000_000;
  const pixelRatio = env.isAppleMobile ? 1 : Math.min(env.devicePixelRatio || 1, 2);
  // Supersample the logical bounds (×2) for crispness.
  const rawW = Math.max(800, Math.round((bounds.width + pad * 2) * 2));
  const rawH = Math.max(600, Math.round((bounds.height + pad * 2) * 2));
  // Scale so the final canvas (raw × pixelRatio) fits maxDim per side and maxArea total.
  const finalW = rawW * pixelRatio;
  const finalH = rawH * pixelRatio;
  let fit = Math.min(1, maxDim / finalW, maxDim / finalH);
  if (finalW * fit * (finalH * fit) > maxArea) {
    fit *= Math.sqrt(maxArea / (finalW * fit * (finalH * fit)));
  }
  return {
    imageWidth: Math.max(1, Math.round(rawW * fit)),
    imageHeight: Math.max(1, Math.round(rawH * fit)),
    pixelRatio,
  };
}
