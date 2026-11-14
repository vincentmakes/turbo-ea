import { describe, expect, it } from "vitest";

import {
  DOCUMENT_IMAGE_CSS,
  DOCUMENT_IMAGE_SX,
  MAX_DOCUMENT_IMAGE_DIMENSION,
  documentImageCss,
  parseDocumentImageAlign,
  parseDocumentImageDimension,
  parseDocumentImageSrc,
} from "./documentImageMarkup";

const ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("parseDocumentImageSrc", () => {
  it("names the kind, the lower-cased id and the canonical path, for either kind", () => {
    expect(parseDocumentImageSrc(`/api/v1/document-images/adr/${ID.toUpperCase()}`)).toEqual({
      kind: "adr",
      id: ID,
      path: `/api/v1/document-images/adr/${ID}`,
    });
    expect(parseDocumentImageSrc(`${window.location.origin}/api/v1/document-images/soaw/${ID}`)).toEqual({
      kind: "soaw",
      id: ID,
      path: `/api/v1/document-images/soaw/${ID}`,
    });
  });

  it.each([
    null,
    undefined,
    "",
    `//evil.example/api/v1/document-images/adr/${ID}`,
    `https://evil.example/api/v1/document-images/adr/${ID}`,
    `/api/v1/document-images/card/${ID}`,
    `/api/v1/document-images/adr/${ID}/x`,
    `/x/api/v1/document-images/adr/${ID}`,
    "/api/v1/document-images/adr/not-a-uuid",
  ])("refuses %j", (src) => {
    expect(parseDocumentImageSrc(src)).toBeNull();
  });
});

describe("dimension and alignment parsers", () => {
  it("keeps plain integers 1–4000 only", () => {
    expect(MAX_DOCUMENT_IMAGE_DIMENSION).toBe(4000);
    expect(parseDocumentImageDimension("1")).toBe(1);
    expect(parseDocumentImageDimension("4000")).toBe(4000);
    for (const raw of ["0", "4001", "1.5", "10px", " 10", "", null, undefined]) {
      expect(parseDocumentImageDimension(raw)).toBeNull();
    }
  });

  it("keeps center and right only", () => {
    expect(parseDocumentImageAlign("center")).toBe("center");
    expect(parseDocumentImageAlign("right")).toBe("right");
    expect(parseDocumentImageAlign("left")).toBeNull();
    expect(parseDocumentImageAlign(null)).toBeNull();
  });
});

describe("picture styles", () => {
  it("are the bare rules unscoped", () => {
    expect(DOCUMENT_IMAGE_CSS).toBe(
      [
        "img { max-width: 100%; height: auto; }",
        'img[data-align="center"] { display: block; margin-inline: auto; }',
        'img[data-align="right"] { display: block; margin-inline-start: auto; }',
      ].join("\n"),
    );
  });

  it("prefix every rule with a scope", () => {
    expect(documentImageCss(".doc")).toBe(
      [
        ".doc img { max-width: 100%; height: auto; }",
        '.doc img[data-align="center"] { display: block; margin-inline: auto; }',
        '.doc img[data-align="right"] { display: block; margin-inline-start: auto; }',
      ].join("\n"),
    );
  });

  it("are the same rules as an sx fragment", () => {
    expect(DOCUMENT_IMAGE_SX).toEqual({
      "& img": { maxWidth: "100%", height: "auto" },
      '& img[data-align="center"]': { display: "block", marginInline: "auto" },
      '& img[data-align="right"]': { display: "block", marginInlineStart: "auto" },
    });
  });
});
