import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({ api: { getRaw: vi.fn() } }));

import JSZip from "jszip";
import { AlignmentType, Document, Packer, Paragraph } from "docx";
import { api } from "@/api/client";
import i18n from "@/i18n";

import {
  DOCX_PAGE_MARGIN_TWIP,
  DOCX_PAGE_WIDTH_TWIP,
  DOCX_TEXT_WIDTH_PX,
  IMAGE_FETCH_CONCURRENCY,
  docxImageAlignment,
  docxImageSize,
  documentImagePaths,
  htmlToParagraphs,
  prefetchDocumentImages,
  readImageHeaderSize,
  sniffImageType,
  type DocxImage,
} from "./docxHtml";

const getRaw = vi.mocked(api.getRaw);

const ID1 = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ID2 = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const ID3 = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const ID4 = "3d4e5f6a-7b8c-4d9e-8f1a-2b3c4d5e6f7a";
const ID5 = "4e5f6a7b-8c9d-4e0f-9a2b-3c4d5e6f7a8b";
const path = (kind: string, id: string) => `/api/v1/document-images/${kind}/${id}`;

// ─── byte fixtures ──────────────────────────────────────────────────────────

/** A 1×1 PNG. */
const PNG_1X1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);

function pad(bytes: number[], length = 40): Uint8Array {
  const out = new Uint8Array(Math.max(length, bytes.length));
  out.set(bytes);
  return out;
}

/** A PNG signature + IHDR claiming `w`×`h`. */
function pngHeader(w: number, h: number): Uint8Array {
  const b = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

function gifHeader(w: number, h: number): Uint8Array {
  const b = pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  new DataView(b.buffer).setUint16(6, w, true);
  new DataView(b.buffer).setUint16(8, h, true);
  return b;
}

/** SOI, an APP0 segment, a DHT segment, then SOF2 with `w`×`h`. */
function jpegHeader(w: number, h: number): Uint8Array {
  return pad([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46,
    0xff, 0xc4, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc2, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03,
  ]);
}

function riff(chunk: string, body: number[]): Uint8Array {
  const b = pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  for (let i = 0; i < 4; i += 1) b[12 + i] = chunk.charCodeAt(i);
  b.set(body, 16);
  return b;
}

function webpVp8x(w: number, h: number): Uint8Array {
  const body = new Array(20).fill(0);
  const put24 = (at: number, v: number) => {
    body[at] = v & 0xff;
    body[at + 1] = (v >> 8) & 0xff;
    body[at + 2] = (v >> 16) & 0xff;
  };
  put24(8, w - 1); // byte 24
  put24(11, h - 1); // byte 27
  return riff("VP8X", body);
}

function webpVp8l(w: number, h: number): Uint8Array {
  const bits = (w - 1) | ((h - 1) << 14);
  const body = new Array(20).fill(0);
  body[4] = 0x2f; // byte 20: signature
  body[5] = bits & 0xff;
  body[6] = (bits >> 8) & 0xff;
  body[7] = (bits >> 16) & 0xff;
  body[8] = (bits >>> 24) & 0xff;
  return riff("VP8L", body);
}

function webpVp8(w: number, h: number): Uint8Array {
  const body = new Array(20).fill(0);
  body[7] = 0x9d;
  body[8] = 0x01;
  body[9] = 0x2a;
  body[10] = w & 0xff; // byte 26
  body[11] = (w >> 8) & 0x3f;
  body[12] = h & 0xff; // byte 28
  body[13] = (h >> 8) & 0x3f;
  return riff("VP8 ", body);
}

/** What `api.getRaw` answers for a picture: a response whose blob reads as `bytes`. */
function rawResponse(bytes: Uint8Array) {
  const blob = { arrayBuffer: async () => bytes.slice().buffer, bytes };
  return { blob: async () => blob } as unknown as Response;
}

// ─── docx helpers ───────────────────────────────────────────────────────────

async function packageOf(paragraphs: Paragraph[]): Promise<JSZip> {
  const doc = new Document({ sections: [{ children: paragraphs }] });
  return JSZip.loadAsync(await Packer.toBuffer(doc));
}

async function xmlOf(zip: JSZip): Promise<string> {
  return zip.file("word/document.xml")!.async("string");
}

const media = (zip: JSZip) => Object.keys(zip.files).filter((f) => f.startsWith("word/media/") && !f.endsWith("/"));
const EMU_PER_PX = 9525;

beforeEach(() => {
  getRaw.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── page geometry ──────────────────────────────────────────────────────────

describe("page geometry", () => {
  it("is A4 with one-inch margins, so the text is 601 px wide", () => {
    expect(DOCX_PAGE_WIDTH_TWIP).toBe(11906);
    expect(DOCX_PAGE_MARGIN_TWIP).toBe(1440);
    expect(DOCX_TEXT_WIDTH_PX).toBe(601);
  });
});

// ─── format sniffing and header sizes ───────────────────────────────────────

describe("sniffImageType", () => {
  it("names each accepted format by its leading bytes", () => {
    expect(sniffImageType(PNG_1X1)).toBe("png");
    expect(sniffImageType(jpegHeader(1, 1))).toBe("jpg");
    expect(sniffImageType(gifHeader(1, 1))).toBe("gif");
    expect(sniffImageType(webpVp8x(1, 1))).toBe("webp");
  });

  it("refuses anything else", () => {
    expect(sniffImageType(pad([0x3c, 0x73, 0x76, 0x67]))).toBeNull(); // <svg
    expect(sniffImageType(pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull(); // WAVE
    expect(sniffImageType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00]))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("readImageHeaderSize", () => {
  it("reads PNG, GIF, JPEG and the three WebP flavours", () => {
    expect(readImageHeaderSize(pngHeader(640, 480), "png")).toEqual({ width: 640, height: 480 });
    expect(readImageHeaderSize(pngHeader(70000, 3), "png")).toEqual({ width: 70000, height: 3 });
    expect(readImageHeaderSize(gifHeader(300, 2), "gif")).toEqual({ width: 300, height: 2 });
    expect(readImageHeaderSize(jpegHeader(1024, 768), "jpg")).toEqual({ width: 1024, height: 768 });
    expect(readImageHeaderSize(webpVp8x(5000, 300), "webp")).toEqual({ width: 5000, height: 300 });
    expect(readImageHeaderSize(webpVp8l(1000, 16384), "webp")).toEqual({ width: 1000, height: 16384 });
    expect(readImageHeaderSize(webpVp8(800, 600), "webp")).toEqual({ width: 800, height: 600 });
  });

  it("reads a real PNG", () => {
    expect(readImageHeaderSize(PNG_1X1, "png")).toEqual({ width: 1, height: 1 });
  });

  it("gives null for a truncated, empty or unreadable header", () => {
    expect(readImageHeaderSize(pngHeader(10, 10).slice(0, 29), "png")).toBeNull();
    expect(readImageHeaderSize(pngHeader(0, 10), "png")).toBeNull();
    expect(readImageHeaderSize(pngHeader(10, 0), "png")).toBeNull();
    expect(readImageHeaderSize(riff("ALPH", []), "webp")).toBeNull();
    // A JPEG with no frame header, and one whose segments run off the end.
    expect(readImageHeaderSize(pad([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0]), "jpg")).toBeNull();
    expect(readImageHeaderSize(pad([0xff, 0xd8, 0x00, 0x00]), "jpg")).toBeNull();
  });
});

// ─── sizing and alignment maths ─────────────────────────────────────────────

describe("docxImageSize", () => {
  const nat = { width: 800, height: 400 };

  it("uses the stored width and height when both are there", () => {
    expect(docxImageSize({ width: 300, height: 120 }, nat)).toEqual({ width: 300, height: 120 });
    expect(docxImageSize({ width: 300, height: 120 }, null)).toEqual({ width: 300, height: 120 });
  });

  it("derives the missing side from the natural proportions", () => {
    expect(docxImageSize({ width: 200, height: null }, nat)).toEqual({ width: 200, height: 100 });
    expect(docxImageSize({ width: null, height: 50 }, nat)).toEqual({ width: 100, height: 50 });
  });

  it("falls back to the natural size", () => {
    expect(docxImageSize({ width: null, height: null }, { width: 120, height: 90 })).toEqual({
      width: 120,
      height: 90,
    });
  });

  it("scales down to the text width, keeping the proportions", () => {
    expect(docxImageSize({ width: null, height: null }, { width: 1202, height: 601 })).toEqual({
      width: 601,
      height: 301,
    });
    expect(docxImageSize({ width: 1000, height: 500 }, null, 500)).toEqual({ width: 500, height: 250 });
    // Exactly the text width is left alone.
    expect(docxImageSize({ width: 601, height: 77 }, null)).toEqual({ width: 601, height: 77 });
  });

  it("never draws a side below one pixel", () => {
    expect(docxImageSize({ width: 4000, height: 1 }, null)).toEqual({ width: 601, height: 1 });
  });

  it("gives null when nothing says how big the picture is", () => {
    expect(docxImageSize({ width: null, height: null }, null)).toBeNull();
    expect(docxImageSize({ width: 200, height: null }, null)).toBeNull();
    expect(docxImageSize({ width: null, height: 200 }, null)).toBeNull();
  });
});

describe("docxImageAlignment", () => {
  it("maps centre and right; anything else stays at the start", () => {
    expect(docxImageAlignment("center")).toBe(AlignmentType.CENTER);
    expect(docxImageAlignment("right")).toBe(AlignmentType.RIGHT);
    expect(docxImageAlignment("left")).toBeUndefined();
    expect(docxImageAlignment(null)).toBeUndefined();
  });
});

// ─── collecting and fetching ────────────────────────────────────────────────

describe("documentImagePaths", () => {
  it("lists each distinct document picture once, canonical, in order", () => {
    expect(
      documentImagePaths([
        `<img src="${path("soaw", ID2)}"><p>x</p><img src="${path("adr", ID1.toUpperCase())}">`,
        null,
        "",
        "<p>no picture</p>",
        `<img src="${path("adr", ID1)}"><img src="https://cdn.example.com/a.png"><img src="${path("soaw", ID2)}">`,
      ]),
    ).toEqual([path("soaw", ID2), path("adr", ID1)]);
  });
});

describe("prefetchDocumentImages", () => {
  it("fetches each distinct picture once through the API client", async () => {
    getRaw.mockResolvedValue(rawResponse(PNG_1X1));
    const images = await prefetchDocumentImages([
      `<img src="${path("adr", ID1)}">`,
      `<img src="${path("adr", ID1)}"><img src="${path("soaw", ID2)}">`,
    ]);
    expect(getRaw).toHaveBeenCalledTimes(2);
    expect(getRaw).toHaveBeenCalledWith(`/document-images/adr/${ID1}`);
    expect(getRaw).toHaveBeenCalledWith(`/document-images/soaw/${ID2}`);
    expect(images.get(path("adr", ID1))).toEqual({
      type: "png",
      data: PNG_1X1,
      natural: { width: 1, height: 1 },
    });
  });

  it("does nothing without pictures", async () => {
    expect((await prefetchDocumentImages(["<p>x</p>", null])).size).toBe(0);
    expect(getRaw).not.toHaveBeenCalled();
  });

  it("maps a failed fetch and an unknown format to null", async () => {
    getRaw.mockImplementation(async (p: string) => {
      if (p.endsWith(ID1)) throw new Error("403");
      return rawResponse(pad([0x3c, 0x73, 0x76, 0x67]));
    });
    const images = await prefetchDocumentImages([
      `<img src="${path("adr", ID1)}"><img src="${path("adr", ID2)}">`,
    ]);
    expect(images.get(path("adr", ID1))).toBeNull();
    expect(images.get(path("adr", ID2))).toBeNull();
    expect(images.size).toBe(2);
  });

  it(`fetches at most ${IMAGE_FETCH_CONCURRENCY} at a time`, async () => {
    expect(IMAGE_FETCH_CONCURRENCY).toBe(4);
    let inFlight = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    getRaw.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => release.push(resolve));
      inFlight -= 1;
      return rawResponse(PNG_1X1);
    });
    const ids = [ID1, ID2, ID3, ID4, ID5];
    const done = prefetchDocumentImages([ids.map((id) => `<img src="${path("adr", id)}">`).join("")]);
    await vi.waitFor(() => expect(release.length).toBe(4));
    expect(peak).toBe(4);
    release.splice(0).forEach((r) => r());
    await vi.waitFor(() => expect(release.length).toBe(1));
    release.splice(0).forEach((r) => r());
    const images = await done;
    expect(images.size).toBe(5);
    expect(getRaw).toHaveBeenCalledTimes(5);
  });

  it("takes the natural size from the browser's decoder when there is one, and frees it", async () => {
    const close = vi.fn();
    const createImageBitmap = vi.fn(async () => ({ width: 320, height: 200, close }));
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    getRaw.mockResolvedValue(rawResponse(pngHeader(10, 10)));
    const images = await prefetchDocumentImages([`<img src="${path("adr", ID1)}">`]);
    expect(images.get(path("adr", ID1))?.natural).toEqual({ width: 320, height: 200 });
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("falls back to the header when the decoder refuses the picture", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => Promise.reject(new Error("bad"))));
    getRaw.mockResolvedValue(rawResponse(gifHeader(64, 32)));
    const images = await prefetchDocumentImages([`<img src="${path("adr", ID1)}">`]);
    expect(images.get(path("adr", ID1))).toMatchObject({ type: "gif", natural: { width: 64, height: 32 } });
  });

  it("re-encodes a WebP picture as PNG on a canvas", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 30, height: 20, close })));
    const drawImage = vi.fn();
    const canvases: HTMLCanvasElement[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      canvases.push(this);
      return { drawImage } as unknown as CanvasRenderingContext2D;
    } as never);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((cb: BlobCallback) =>
        cb({ arrayBuffer: async () => PNG_1X1.slice().buffer } as unknown as Blob),
      );
    getRaw.mockResolvedValue(rawResponse(webpVp8x(30, 20)));
    const images = await prefetchDocumentImages([`<img src="${path("soaw", ID1)}">`]);
    expect(images.get(path("soaw", ID1))).toEqual({
      type: "png",
      data: PNG_1X1,
      natural: { width: 30, height: 20 },
    });
    expect(canvases[0].width).toBe(30);
    expect(canvases[0].height).toBe(20);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(toBlob.mock.calls[0][1]).toBe("image/png");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("gives up on a WebP picture the browser cannot re-encode", async () => {
    getRaw.mockResolvedValue(rawResponse(webpVp8x(30, 20)));
    // No decoder at all (jsdom).
    expect((await prefetchDocumentImages([`<img src="${path("soaw", ID1)}">`])).get(path("soaw", ID1))).toBeNull();

    // A decoder, but no 2D context.
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 3, height: 2, close: vi.fn() })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect((await prefetchDocumentImages([`<img src="${path("soaw", ID2)}">`])).get(path("soaw", ID2))).toBeNull();

    // A context, but the canvas yields no PNG.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb: BlobCallback) => cb(null));
    expect((await prefetchDocumentImages([`<img src="${path("soaw", ID3)}">`])).get(path("soaw", ID3))).toBeNull();
  });
});

// ─── the converter ──────────────────────────────────────────────────────────

describe("htmlToParagraphs — pictures", () => {
  const png = (natural: { width: number; height: number } | null): DocxImage => ({
    type: "png",
    data: PNG_1X1,
    natural,
  });

  it("puts a picture in its own paragraph, as media in the package, at the stored size", async () => {
    const images = new Map([[path("adr", ID1), png({ width: 800, height: 400 })]]);
    const paragraphs = htmlToParagraphs(
      `<p>Before</p><img src="${path("adr", ID1)}" width="300" height="150"><p>After</p>`,
      images,
    );
    expect(paragraphs).toHaveLength(3);
    const zip = await packageOf(paragraphs);
    expect(media(zip)).toHaveLength(1);
    expect(media(zip)[0]).toMatch(/\.png$/);
    const xml = await xmlOf(zip);
    expect(xml).toContain(`<wp:extent cx="${300 * EMU_PER_PX}" cy="${150 * EMU_PER_PX}"/>`);
    expect(xml.indexOf("Before")).toBeLessThan(xml.indexOf("<w:drawing>"));
    expect(xml.indexOf("<w:drawing>")).toBeLessThan(xml.indexOf("After"));
  });

  it("scales a picture wider than the page to the text width", async () => {
    const images = new Map([[path("adr", ID1), png({ width: 1202, height: 400 })]]);
    const xml = await xmlOf(await packageOf(htmlToParagraphs(`<img src="${path("adr", ID1)}">`, images)));
    expect(xml).toContain(`<wp:extent cx="${601 * EMU_PER_PX}" cy="${200 * EMU_PER_PX}"/>`);
  });

  it("aligns the picture's paragraph from data-align", async () => {
    const images = new Map([
      [path("adr", ID1), png({ width: 10, height: 10 })],
      [path("adr", ID2), png({ width: 10, height: 10 })],
    ]);
    const centre = await xmlOf(
      await packageOf(htmlToParagraphs(`<img src="${path("adr", ID1)}" data-align="center">`, images)),
    );
    expect(centre).toContain('<w:jc w:val="center"/>');
    const right = await xmlOf(
      await packageOf(htmlToParagraphs(`<img src="${path("adr", ID2)}" data-align="right">`, images)),
    );
    expect(right).toContain('<w:jc w:val="right"/>');
    const left = await xmlOf(await packageOf(htmlToParagraphs(`<img src="${path("adr", ID1)}">`, images)));
    expect(left).not.toContain("<w:jc ");
  });

  it("writes the translated placeholder for a picture that could not be had, keeping its alignment", async () => {
    const placeholder = String(i18n.t("delivery:export.imageUnavailable"));
    expect(placeholder).toBe("[Picture not available]");
    const images = new Map<string, DocxImage | null>([[path("adr", ID1), null]]);
    for (const html of [
      `<img src="${path("adr", ID1)}" data-align="center">`, // fetch failed
      `<img src="${path("adr", ID2)}" data-align="center">`, // never prefetched
    ]) {
      const zip = await packageOf(htmlToParagraphs(html, images));
      expect(media(zip)).toHaveLength(0);
      const xml = await xmlOf(zip);
      expect(xml).toContain(`>${placeholder}</w:t>`);
      expect(xml).toContain("<w:i/>");
      expect(xml).toContain('<w:jc w:val="center"/>');
    }
  });

  it("writes the placeholder when nothing gives the picture a size", async () => {
    const images = new Map([[path("adr", ID1), png(null)]]);
    const xml = await xmlOf(
      await packageOf(htmlToParagraphs(`<img src="${path("adr", ID1)}" width="40">`, images)),
    );
    expect(xml).toContain(">[Picture not available]</w:t>");
    expect(xml).not.toContain("<w:drawing>");
  });

  it("finds a picture nested in a container element", async () => {
    const images = new Map([[path("soaw", ID1), png({ width: 10, height: 10 })]]);
    const zip = await packageOf(htmlToParagraphs(`<div><img src="${path("soaw", ID1)}"></div>`, images));
    expect(media(zip)).toHaveLength(1);
  });

  it("writes nothing for a picture that is not a document picture", () => {
    expect(htmlToParagraphs('<img src="https://cdn.example.com/a.png">')).toEqual([]);
  });

  it("without a picture map, a document picture is the placeholder", async () => {
    const xml = await xmlOf(await packageOf(htmlToParagraphs(`<img src="${path("adr", ID1)}">`)));
    expect(xml).toContain(">[Picture not available]</w:t>");
  });
});

describe("htmlToParagraphs — pictures in lists and quotes", () => {
  const img = (id: string, extra = "") => `<img src="${path("adr", id)}"${extra}>`;
  const images = new Map<string, DocxImage | null>(
    [ID1, ID2, ID3].map((id) => [path("adr", id), { type: "png", data: PNG_1X1, natural: { width: 10, height: 10 } }]),
  );
  const drawings = (xml: string) => xml.split("<w:drawing>").length - 1;
  /** The `<w:p>` holding the n-th drawing. */
  const drawingParagraph = (xml: string, n = 0) => {
    const paras = xml.match(/<w:p>(?:(?!<\/w:p>)[\s\S])*<\/w:p>/g) ?? [];
    return paras.filter((p) => p.includes("<w:drawing>"))[n];
  };

  it("writes a picture in a bullet item after the item's line, indented like it", async () => {
    const paragraphs = htmlToParagraphs(`<ul><li><p>step</p>${img(ID1)}</li></ul>`, images);
    expect(paragraphs).toHaveLength(2);
    const zip = await packageOf(paragraphs);
    expect(media(zip)).toHaveLength(1);
    const xml = await xmlOf(zip);
    expect(xml.indexOf("•  step")).toBeGreaterThan(-1);
    expect(xml.indexOf("•  step")).toBeLessThan(xml.indexOf("<w:drawing>"));
    expect(drawingParagraph(xml)).toContain('<w:ind w:left="720"/>');
  });

  it("writes a picture in a numbered item under that item", async () => {
    const xml = await xmlOf(
      await packageOf(
        htmlToParagraphs(`<ol><li><p>a</p></li><li><p>b</p>${img(ID1)}</li><li><p>c</p></li></ol>`, images),
      ),
    );
    expect(drawings(xml)).toBe(1);
    expect(xml.indexOf("2. b")).toBeLessThan(xml.indexOf("<w:drawing>"));
    expect(xml.indexOf("<w:drawing>")).toBeLessThan(xml.indexOf("3. c"));
  });

  it("writes a nested list's picture once, under its own item", async () => {
    const paragraphs = htmlToParagraphs(
      `<ul><li><p>outer</p>${img(ID1)}<ul><li><p>inner</p>${img(ID2)}</li></ul></li></ul>`,
      images,
    );
    expect(paragraphs).toHaveLength(4);
    // Same bytes, so docx stores one media file; two drawings use it.
    const xml = await xmlOf(await packageOf(paragraphs));
    expect(drawings(xml)).toBe(2);
    // outer line, its picture, inner line, its picture.
    const order = ["•  outer", "<w:drawing>", "•  inner"].map((s) => xml.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(xml.lastIndexOf("<w:drawing>")).toBeGreaterThan(xml.indexOf("•  inner"));
  });

  it("writes a picture in a blockquote after the quote, indented like it", async () => {
    const paragraphs = htmlToParagraphs(`<blockquote><p>quoted</p>${img(ID1)}</blockquote>`, images);
    expect(paragraphs).toHaveLength(2);
    const xml = await xmlOf(await packageOf(paragraphs));
    expect(xml.indexOf(">quoted</w:t>")).toBeLessThan(xml.indexOf("<w:drawing>"));
    expect(drawingParagraph(xml)).toContain('<w:ind w:left="720"/>');
  });

  it("writes a picture-only item or quote as the picture alone, with no empty bullet or quote line", async () => {
    const item = htmlToParagraphs(`<ul><li>${img(ID1)}</li></ul>`, images);
    expect(item).toHaveLength(1);
    const itemXml = await xmlOf(await packageOf(item));
    expect(itemXml).not.toContain("•");
    expect(drawings(itemXml)).toBe(1);
    const quote = htmlToParagraphs(`<blockquote>${img(ID1)}</blockquote>`, images);
    expect(quote).toHaveLength(1);
    expect(await xmlOf(await packageOf(quote))).not.toContain("<w:i/>");
  });

  it("does not indent a centred or right-aligned picture in an item", async () => {
    const xml = await xmlOf(
      await packageOf(
        htmlToParagraphs(`<ul><li><p>x</p>${img(ID1, ' data-align="center"')}${img(ID2, ' data-align="right"')}</li></ul>`, images),
      ),
    );
    expect(drawingParagraph(xml, 0)).toContain('<w:jc w:val="center"/>');
    expect(drawingParagraph(xml, 0)).not.toContain("<w:ind ");
    expect(drawingParagraph(xml, 1)).toContain('<w:jc w:val="right"/>');
    expect(drawingParagraph(xml, 1)).not.toContain("<w:ind ");
  });

  it("indents the placeholder of a nested picture that could not be had", async () => {
    const xml = await xmlOf(await packageOf(htmlToParagraphs(`<ul><li><p>x</p>${img(ID3)}</li></ul>`, new Map())));
    expect(xml).toMatch(/<w:ind w:left="720"\/>(?:(?!<\/w:p>)[\s\S])*\[Picture not available\]/);
  });

  it("keeps an empty item, and an item with only an external picture, as an empty bullet", () => {
    expect(htmlToParagraphs("<ul><li></li></ul>", images)).toHaveLength(1);
    expect(htmlToParagraphs('<ul><li><img src="https://x.example/a.png"></li></ul>', images)).toHaveLength(1);
    expect(htmlToParagraphs('<blockquote><img src="https://x.example/a.png"></blockquote>', images)).toHaveLength(1);
  });
});
