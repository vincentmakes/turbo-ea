import { describe, expect, it } from "vitest";
import { diagramThumbnailSrc } from "./diagramThumbnail";

describe("diagramThumbnailSrc", () => {
  it("keeps an image data URI as it is", () => {
    const uri = "data:image/svg+xml;base64,PHN2Zy8+";
    expect(diagramThumbnailSrc(uri)).toBe(uri);
    expect(diagramThumbnailSrc("DATA:image/png;base64,AAAA")).toBe("DATA:image/png;base64,AAAA");
  });

  it("trims whitespace around a data URI", () => {
    expect(diagramThumbnailSrc("  data:image/png;base64,AAAA\n")).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  it("refuses a data URI that is not an image", () => {
    expect(diagramThumbnailSrc("data:text/html,<script>x</script>")).toBeNull();
  });

  it("encodes a raw SVG as a UTF-8 data URI", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>A&B</text></svg>';
    expect(diagramThumbnailSrc(svg)).toBe(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    );
  });

  it("encodes an SVG with text outside Latin-1 without throwing", () => {
    const svg = "<svg><text>架构 — قرار ✓</text></svg>";
    const src = diagramThumbnailSrc(svg);
    expect(src).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(decodeURIComponent(src!.split(",").slice(1).join(","))).toBe(svg);
  });

  it("accepts an SVG with an XML prolog", () => {
    const svg = '<?xml version="1.0"?>\n<svg width="1"></svg>';
    expect(diagramThumbnailSrc(svg)).toBe(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    );
  });

  it("returns null for nothing or for text that is not an SVG", () => {
    expect(diagramThumbnailSrc(null)).toBeNull();
    expect(diagramThumbnailSrc(undefined)).toBeNull();
    expect(diagramThumbnailSrc("")).toBeNull();
    expect(diagramThumbnailSrc("not an image")).toBeNull();
    expect(diagramThumbnailSrc("<div>svg</div>")).toBeNull();
    expect(diagramThumbnailSrc("<svgx></svgx>")).toBeNull();
    expect(diagramThumbnailSrc("text <svg></svg>")).toBeNull();
    expect(diagramThumbnailSrc("https://example.com/a.svg")).toBeNull();
    expect(diagramThumbnailSrc(42 as unknown as string)).toBeNull();
  });
});
