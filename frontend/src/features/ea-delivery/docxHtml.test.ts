import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({ api: { getRaw: vi.fn() } }));

import JSZip from "jszip";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
} from "docx";
import { api } from "@/api/client";
import i18n from "@/i18n";
import {
  TABLE_3X3,
  TABLE_MERGED_RESIZED,
  TABLE_ONE_RESIZED,
  TABLE_RESIZED,
} from "@/test/fixtures/tableMarkup";

import {
  DOCX_PAGE_MARGIN_TWIP,
  DOCX_PAGE_WIDTH_TWIP,
  DOCX_TEXT_WIDTH_PX,
  DOCX_CODE_FILL,
  DOCX_HEADER_FILL,
  DOCX_TABLE_BORDER,
  FONT_MONO,
  IMAGE_FETCH_CONCURRENCY,
  MAX_COLSPAN,
  MIN_COLUMN_PX,
  SIZE_H3,
  SIZE_H4,
  TWIP_PER_PX,
  buildDocxTable,
  docxImageAlignment,
  docxImageSize,
  documentImagePaths,
  fitColumnWidths,
  htmlToParagraphs,
  inlineSegments,
  parseSpan,
  prefetchDocumentImages,
  pxToTwip,
  readImageHeaderSize,
  sniffImageType,
  storedColumnWidths,
  styleWidthPx,
  tableGrid,
  tableRowElements,
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

async function packageOf(paragraphs: (Paragraph | Table)[]): Promise<JSZip> {
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

// ─── marks, links, code, headings, lists and quotes ─────────────────────────

/** Every `<w:t>` text in document order, entities decoded. */
function textsOf(xml: string): string[] {
  return Array.from(xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g), (m) =>
    m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"),
  );
}

/** The `<w:r>` whose text is exactly `text`. */
function runWith(xml: string, text: string): string {
  const runs = xml.match(/<w:r>(?:(?!<\/w:r>)[\s\S])*<\/w:r>/g) ?? [];
  const found = runs.find((r) => r.includes(`>${text}</w:t>`));
  if (!found) throw new Error(`no run with text "${text}"`);
  return found;
}

/** The `<w:p>` holding `text`. */
function paraWith(xml: string, text: string): string {
  const paras = xml.match(/<w:p>(?:(?!<\/w:p>)[\s\S])*<\/w:p>/g) ?? [];
  const found = paras.find((p) => p.includes(`>${text}</w:t>`));
  if (!found) throw new Error(`no paragraph with text "${text}"`);
  return found;
}

const convert = async (html: string) => xmlOf(await packageOf(htmlToParagraphs(html)));

describe("inlineSegments", () => {
  const nodes = (html: string) => new DOMParser().parseFromString(html, "text/html").body.childNodes;
  const plain = { bold: false, italics: false, underline: false, strike: false, code: false, href: null };

  it("carries the union of every ancestor's marks and merges equal neighbours", () => {
    expect(
      inlineSegments(nodes('a <strong>b <em>c</em><u><s>d</s></u></strong><span>e</span> f<code>g</code><del>h</del>')),
    ).toEqual([
      { ...plain, text: "a " },
      { ...plain, bold: true, text: "b " },
      { ...plain, bold: true, italics: true, text: "c" },
      { ...plain, bold: true, underline: true, strike: true, text: "d" },
      { ...plain, text: "e f" },
      { ...plain, code: true, text: "g" },
      { ...plain, strike: true, text: "h" },
    ]);
    expect(inlineSegments(nodes("<b>x</b><i>y</i><strike>z</strike>"))).toEqual([
      { ...plain, bold: true, text: "x" },
      { ...plain, italics: true, text: "y" },
      { ...plain, strike: true, text: "z" },
    ]);
  });

  it("keeps an http(s) or mailto address as the link and drops any other", () => {
    expect(inlineSegments(nodes('<a href=" https://x.example/a ">x <b>y</b></a>'))).toEqual([
      { ...plain, href: "https://x.example/a", text: "x " },
      { ...plain, bold: true, href: "https://x.example/a", text: "y" },
    ]);
    expect(inlineSegments(nodes('<a href="mailto:a@x.example">m</a>'))[0].href).toBe("mailto:a@x.example");
    for (const href of ["ftp://x.example", "/relative", "javascript:alert(1)", ""]) {
      expect(inlineSegments(nodes(`a <a href="${href}">b</a> c`))).toEqual([{ ...plain, text: "a b c" }]);
    }
    expect(inlineSegments(nodes("<a>no href</a>"))).toEqual([{ ...plain, text: "no href" }]);
  });

  it("reads <br> as a line break, a source line break as a space, and skips pictures", () => {
    expect(inlineSegments(nodes('a<br>b\nc\r\nd<img src="x">e'))).toEqual([{ ...plain, text: "a\nb c de" }]);
  });

  it("keeps line breaks as they are inside a code block", () => {
    expect(inlineSegments(nodes("a\nb"), undefined, true)).toEqual([{ ...plain, text: "a\nb" }]);
  });
});

describe("htmlToParagraphs — marks and links", () => {
  it("keeps nested marks on one run", async () => {
    const xml = await convert("<p>a <strong>b <em>c</em></strong></p>");
    expect(runWith(xml, "a ")).not.toContain("<w:b/>");
    expect(runWith(xml, "b ")).toContain("<w:b/>");
    expect(runWith(xml, "b ")).not.toContain("<w:i/>");
    expect(runWith(xml, "c")).toContain("<w:b/>");
    expect(runWith(xml, "c")).toContain("<w:i/>");
  });

  it("writes plain text as one run in the body font, size and colour", async () => {
    const xml = await convert("<p>Hello <span>there</span> world</p>");
    expect(textsOf(xml)).toEqual(["Hello there world"]);
    const run = runWith(xml, "Hello there world");
    expect(run).toContain('w:ascii="Segoe UI"');
    expect(run).toContain('<w:sz w:val="22"/>');
    expect(run).toContain('<w:color w:val="222222"/>');
    expect(run).not.toMatch(/<w:(b|i|strike|u)[ />]/);
  });

  it("makes an http(s) link a hyperlink with its external relationship, in the Hyperlink style", async () => {
    const zip = await packageOf(
      htmlToParagraphs('<p>See <a href="https://example.com/doc?a=1&amp;b=2"><strong>the</strong> doc</a>.</p>'),
    );
    const xml = await xmlOf(zip);
    const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
    const link = xml.match(/<w:hyperlink [^>]*>(?:(?!<\/w:hyperlink>)[\s\S])*<\/w:hyperlink>/g) ?? [];
    expect(link).toHaveLength(1);
    expect(link[0]).toContain(">the</w:t>");
    expect(link[0]).toContain("> doc</w:t>");
    expect(link[0]).not.toContain(">See ");
    expect(link[0]).not.toContain(">.</w:t>");
    expect(link[0].split('<w:rStyle w:val="Hyperlink"/>')).toHaveLength(3);
    expect(link[0]).not.toContain("<w:color ");
    expect(runWith(xml, "the")).toContain("<w:b/>");
    const id = /r:id="([^"]+)"/.exec(link[0])![1];
    expect(rels).toMatch(new RegExp(`Id="${id}"[^>]*Target="https://example.com/doc\\?a=1&amp;b=2" TargetMode="External"`));
    expect(runWith(xml, "See ")).toContain('<w:color w:val="222222"/>');
  });

  it("makes a mailto link a hyperlink too, and two links two hyperlinks", async () => {
    const xml = await convert('<p><a href="mailto:a@x.example">mail</a> <a href="https://x.example">web</a></p>');
    expect(xml.split("<w:hyperlink ")).toHaveLength(3);
  });

  it("writes a link of any other kind as its plain text", async () => {
    const xml = await convert('<p>a <a href="ftp://x.example/f">b</a> c <a href="/cards/1">d</a></p>');
    expect(xml).not.toContain("<w:hyperlink");
    expect(textsOf(xml)).toEqual(["a b c d"]);
  });

  it("writes code in the monospace font", async () => {
    expect(FONT_MONO).toBe("Consolas");
    const xml = await convert("<p>run <code>make test</code> now</p>");
    expect(runWith(xml, "make test")).toContain('w:ascii="Consolas"');
    expect(runWith(xml, "run ")).not.toContain("Consolas");
  });

  it("keeps a line break inside a paragraph", async () => {
    const xml = await convert("<p>one<br>two</p>");
    const para = paraWith(xml, "one");
    expect(para).toContain(">two</w:t>");
    expect(para).toMatch(/>one<\/w:t><\/w:r><w:r>(?:(?!<\/w:r>)[\s\S])*<w:br\/><w:t[^>]*>two<\/w:t>/);
    expect(xml.split("<w:p>")).toHaveLength(2);
  });

  it("trims spaces at a paragraph's edges and drops a blank one", async () => {
    expect(textsOf(await convert("<p>  x  </p>"))).toEqual(["x"]);
    expect(htmlToParagraphs("<p>   </p><p></p>")).toEqual([]);
    expect(htmlToParagraphs("\n<p>x</p>\n")).toHaveLength(1);
  });

  it("keeps the marks of loose inline content", async () => {
    const xml = await convert("<strong>loose</strong><p>next</p>");
    expect(runWith(xml, "loose")).toContain("<w:b/>");
    expect(textsOf(xml)).toEqual(["loose", "next"]);
  });
});

describe("htmlToParagraphs — code blocks and headings", () => {
  it("writes a code block as one shaded monospace paragraph that keeps its lines", async () => {
    expect(DOCX_CODE_FILL).toBe("f5f5f5");
    const paragraphs = htmlToParagraphs("<pre><code>line 1\n  line 2\n</code></pre>");
    expect(paragraphs).toHaveLength(1);
    const xml = await xmlOf(await packageOf(paragraphs));
    expect(textsOf(xml)).toEqual(["line 1", "  line 2"]);
    expect(xml.split("<w:br/>")).toHaveLength(2);
    expect(runWith(xml, "line 1")).toContain('w:ascii="Consolas"');
    expect(runWith(xml, "  line 2")).toContain('w:ascii="Consolas"');
    expect(xml).toContain(`w:fill="${DOCX_CODE_FILL}"`);
    expect(htmlToParagraphs("<pre></pre>")).toEqual([]);
    expect(htmlToParagraphs("<pre>\n</pre>")).toEqual([]);
  });

  it("writes h3 and h4 as headings at their own sizes, keeping their marks and links", async () => {
    expect(SIZE_H3).toBe(26);
    expect(SIZE_H4).toBe(24);
    const xml = await convert('<h3>Big <em>one</em></h3><h4>Small <a href="https://x.example">link</a></h4>');
    expect(paraWith(xml, "Big ")).toContain('<w:pStyle w:val="Heading3"/>');
    expect(runWith(xml, "Big ")).toContain('<w:sz w:val="26"/>');
    expect(runWith(xml, "Big ")).toContain("<w:b/>");
    expect(runWith(xml, "Big ")).toContain('<w:color w:val="444444"/>');
    expect(runWith(xml, "one")).toContain("<w:i/>");
    expect(paraWith(xml, "Small ")).toContain('<w:pStyle w:val="Heading4"/>');
    expect(runWith(xml, "Small ")).toContain('<w:sz w:val="24"/>');
    expect(paraWith(xml, "Small ")).toContain("<w:hyperlink ");
    expect(runWith(xml, "link")).not.toContain("<w:color ");
    expect(htmlToParagraphs("<h3> </h3>")).toEqual([]);
  });
});

describe("htmlToParagraphs — lists and quotes", () => {
  it("numbers each list on its own, from its start, with nested items one level in", async () => {
    const xml = await convert(
      '<ol start="3"><li><p>a</p></li><li><p>b</p><ol><li><p>x</p></li><li><p>y</p></li></ol></li><li><p>c</p></li></ol>',
    );
    expect(textsOf(xml)).toEqual(["3. a", "4. b", "1. x", "2. y", "5. c"]);
    expect(paraWith(xml, "3. a")).toContain('<w:ind w:left="720"/>');
    expect(paraWith(xml, "3. a")).toContain('w:after="80"');
    expect(paraWith(xml, "1. x")).toContain('<w:ind w:left="1440"/>');
    expect(paraWith(xml, "5. c")).toContain('<w:ind w:left="720"/>');
  });

  it("starts at 1 without a usable start", async () => {
    expect(textsOf(await convert('<ol start="x"><li>a</li></ol>'))).toEqual(["1. a"]);
    expect(textsOf(await convert('<ol start="0"><li>a</li></ol>'))).toEqual(["0. a"]);
  });

  it("does not repeat a nested list's text in its parent item", async () => {
    const xml = await convert("<ul><li><p>outer</p><ul><li><p>inner</p></li></ul></li></ul>");
    expect(textsOf(xml)).toEqual(["•  outer", "•  inner"]);
    expect(paraWith(xml, "•  inner")).toContain('<w:ind w:left="1440"/>');
  });

  it("keeps formatting and links inside a list item", async () => {
    const xml = await convert('<ul><li><p>do <strong>this</strong> <a href="https://x.example">now</a></p></li></ul>');
    expect(textsOf(xml)).toEqual(["•  do ", "this", " ", "now"]);
    expect(runWith(xml, "this")).toContain("<w:b/>");
    expect(runWith(xml, "•  do ")).not.toContain("<w:b/>");
    expect(xml).toContain("<w:hyperlink ");
  });

  it("writes an item's later paragraphs under it, and an item starting with a quote on a bullet line", async () => {
    const xml = await convert("<ul><li><p>one</p><p>two</p></li><li><blockquote><p>q</p></blockquote></li></ul>");
    expect(textsOf(xml)).toEqual(["•  one", "two", "•  ", "q"]);
    expect(paraWith(xml, "two")).toContain('<w:ind w:left="720"/>');
    expect(paraWith(xml, "q")).toContain('<w:ind w:left="1440"/>');
    expect(runWith(xml, "q")).toContain("<w:i/>");
  });

  it("puts the bullet on its own run when the item opens in bold", async () => {
    const xml = await convert("<ul><li><strong>Key</strong> point</li></ul>");
    expect(textsOf(xml)).toEqual(["•  ", "Key", " point"]);
    expect(runWith(xml, "•  ")).not.toContain("<w:b/>");
  });

  it("writes a multi-paragraph quote as several italic, indented paragraphs", async () => {
    const paragraphs = htmlToParagraphs("<blockquote><p>one <strong>bold</strong></p><p>two</p></blockquote>");
    expect(paragraphs).toHaveLength(2);
    const xml = await xmlOf(await packageOf(paragraphs));
    for (const text of ["one ", "bold", "two"]) {
      expect(runWith(xml, text)).toContain("<w:i/>");
      expect(runWith(xml, text)).toContain('<w:color w:val="666666"/>');
    }
    expect(runWith(xml, "bold")).toContain("<w:b/>");
    expect(paraWith(xml, "two")).toContain('<w:ind w:left="720"/>');
    expect(paraWith(xml, "two")).toContain('w:after="160"');
  });

  it("indents a list inside a quote past the quote", async () => {
    const xml = await convert("<blockquote><ul><li>a</li></ul></blockquote>");
    expect(paraWith(xml, "•  a")).toContain('<w:ind w:left="1440"/>');
    expect(runWith(xml, "•  a")).toContain("<w:i/>");
  });

  it("indents a picture in a nested item with its item", async () => {
    const images = new Map<string, DocxImage | null>([
      [path("adr", ID1), { type: "png", data: PNG_1X1, natural: { width: 10, height: 10 } }],
    ]);
    const xml = await xmlOf(
      await packageOf(
        htmlToParagraphs(`<ul><li><p>a</p><ul><li><p>b</p><img src="${path("adr", ID1)}"></li></ul></li></ul>`, images),
      ),
    );
    const paras = xml.match(/<w:p>(?:(?!<\/w:p>)[\s\S])*<\/w:p>/g) ?? [];
    expect(paras.find((p) => p.includes("<w:drawing>"))).toContain('<w:ind w:left="1440"/>');
  });
});

// ─── generated tables ───────────────────────────────────────────────────────

describe("buildDocxTable", () => {
  /** The table both exporters built before it moved here, verbatim. */
  function before(columns: string[], rows: string[][]): Table {
    const border = { style: BorderStyle.SINGLE, size: 1, color: "cccccc" };
    const cellBorders = { top: border, bottom: border, left: border, right: border };
    const cellMargins = {
      top: convertInchesToTwip(0.04),
      bottom: convertInchesToTwip(0.04),
      left: convertInchesToTwip(0.07),
      right: convertInchesToTwip(0.07),
    };
    const run = (text: string, bold = false) =>
      new TextRun(bold ? { text, bold: true, font: "Segoe UI", size: 20, color: "222222" } : { text, font: "Segoe UI", size: 20, color: "222222" });
    return new Table({
      rows: [
        new TableRow({
          children: columns.map(
            (c) =>
              new TableCell({
                children: [new Paragraph({ children: [run(c, true)] })],
                shading: { type: ShadingType.CLEAR, fill: "f5f5f5" },
                borders: cellBorders,
                margins: cellMargins,
              }),
          ),
        }),
        ...rows.map(
          (r) =>
            new TableRow({
              children: r.map(
                (c) =>
                  new TableCell({
                    children: [new Paragraph({ children: [run(c)] })],
                    borders: cellBorders,
                    margins: cellMargins,
                  }),
              ),
            }),
        ),
      ],
      width: { size: 100, type: WidthType.PERCENTAGE },
    });
  }

  it("writes exactly what the exporters wrote before", async () => {
    const columns = ["Field", "Value <x>"];
    const rows = [["Status", "Signed & sealed"], ["", "x"]];
    expect(await xmlOf(await packageOf([buildDocxTable(columns, rows)]))).toBe(
      await xmlOf(await packageOf([before(columns, rows)])),
    );
  });

  it("keeps its style constants", () => {
    expect(DOCX_HEADER_FILL).toBe("f5f5f5");
    expect(DOCX_TABLE_BORDER).toEqual({ style: BorderStyle.SINGLE, size: 1, color: "cccccc" });
  });
});

// ─── stored tables ──────────────────────────────────────────────────────────

/** The first `<table>` of `html`, parsed. */
const tableOf = (html: string) => new DOMParser().parseFromString(html, "text/html").querySelector("table")!;

/** A grid as `[col, colSpan, rowSpan, text]` per row (`null` text: a filler). */
const gridShape = (html: string) =>
  tableGrid(tableOf(html)).rows.map((row) =>
    row.map((c) => [c.col, c.colSpan, c.rowSpan, c.el ? c.el.textContent : null]),
  );

describe("stored tables — grid model", () => {
  it("reads rows from thead, tbody, tfoot and the table itself, in document order, but not a nested table's", () => {
    const doc = new DOMParser().parseFromString("<div></div>", "text/html");
    const table = doc.createElement("table");
    const add = (parent: Element, tag: string, text?: string) => {
      const el = doc.createElement(tag);
      if (text) el.textContent = text;
      parent.appendChild(el);
      return el;
    };
    add(table, "caption", "cap");
    const thead = add(table, "thead");
    add(thead, "tr", "h");
    add(table, "tr", "direct");
    const tbody = add(table, "tbody");
    add(tbody, "tr", "b1");
    add(tbody, "td", "stray");
    const tfoot = add(table, "tfoot");
    add(tfoot, "tr", "f");
    const nested = add(add(add(tbody, "tr", ""), "td"), "table");
    add(nested, "tr", "inner");
    expect(tableRowElements(table).map((r) => r.textContent)).toEqual(["h", "direct", "b1", "inner", "f"]);
    expect(tableRowElements(table)).toHaveLength(5);
    expect(tableRowElements(nested).map((r) => r.textContent)).toEqual(["inner"]);
  });

  it("parses a span as an integer from 1 to the maximum", () => {
    expect(parseSpan("3", 10)).toBe(3);
    expect(parseSpan("2.7", 10)).toBe(2);
    expect(parseSpan("1", 10)).toBe(1);
    expect(parseSpan("12", 10)).toBe(10);
    expect(parseSpan("10", 10)).toBe(10);
    for (const bad of ["0", "-2", "x", "", null, undefined]) expect(parseSpan(bad, 10)).toBe(1);
    expect(MAX_COLSPAN).toBe(1000);
  });

  it("places plain cells row by row", () => {
    expect(gridShape("<table><tr><th>a</th><th>b</th></tr><tr><td>c</td><td>d</td></tr></table>")).toEqual([
      [[0, 1, 1, "a"], [1, 1, 1, "b"]],
      [[0, 1, 1, "c"], [1, 1, 1, "d"]],
    ]);
    expect(tableGrid(tableOf("<table><tr><td>a</td><td>b</td><td>c</td></tr></table>")).columns).toBe(3);
  });

  it("skips the positions a row span from above holds and counts a column span", () => {
    const grid = tableGrid(
      tableOf(
        '<table><tr><td rowspan="2">a</td><td colspan="2">b</td></tr><tr><td>c</td><td>d</td></tr>' +
          '<tr><td>e</td><td rowspan="1" colspan="1">f</td><td>g</td></tr></table>',
      ),
    );
    expect(grid.columns).toBe(3);
    expect(grid.rows.map((r) => r.map((c) => [c.col, c.colSpan, c.rowSpan, c.el?.textContent]))).toEqual([
      [[0, 1, 2, "a"], [1, 2, 1, "b"]],
      [[1, 1, 1, "c"], [2, 1, 1, "d"]],
      [[0, 1, 1, "e"], [1, 1, 1, "f"], [2, 1, 1, "g"]],
    ]);
  });

  it("clips a row span running past the last row, and fills a short row's free positions", () => {
    expect(
      gridShape('<table><tr><td rowspan="9">a</td><td>b</td><td>c</td></tr><tr><td>d</td></tr></table>'),
    ).toEqual([
      [[0, 1, 2, "a"], [1, 1, 1, "b"], [2, 1, 1, "c"]],
      [[1, 1, 1, "d"], [2, 1, 1, null]],
    ]);
  });

  it("has no columns without a cell", () => {
    expect(tableGrid(tableOf("<table></table>"))).toEqual({ rows: [], columns: 0 });
    expect(tableGrid(tableOf("<table><tr></tr></table>"))).toEqual({ rows: [[]], columns: 0 });
  });
});

describe("stored tables — column widths", () => {
  it("reads a style's pixel width, never its min-width", () => {
    expect(styleWidthPx("width: 150px")).toBe(150);
    expect(styleWidthPx("width:80.5px;")).toBe(80.5);
    expect(styleWidthPx("min-width: 25px; width: 80px")).toBe(80);
    expect(styleWidthPx("WIDTH: 70PX")).toBe(70);
    for (const none of ["min-width: 25px", "width: 50%", "width: 0px", "width: 12px solid", "", null, undefined]) {
      expect(styleWidthPx(none)).toBeNull();
    }
  });

  const widths = (html: string) => {
    const table = tableOf(html);
    return storedColumnWidths(table, tableGrid(table));
  };

  it("takes each column's width from a cell's colwidth list, first cell wins, else from its col", () => {
    expect(
      widths(
        '<table><colgroup><col style="width: 90px"><col style="min-width: 25px"><col style="width: 70px"><col style="width: 60px"></colgroup>' +
          '<tbody><tr><td colspan="2" colwidth="150,200,999">a</td><td colwidth="x">b</td><td>c</td></tr>' +
          '<tr><td colwidth="10">d</td><td>e</td><td colwidth="40">f</td><td colwidth="0">g</td></tr></tbody></table>',
      ),
    ).toEqual([150, 200, 40, 60]);
  });

  it("leaves a column without a stored width unknown, and follows a col's span", () => {
    expect(widths("<table><tr><td>a</td><td>b</td></tr></table>")).toEqual([null, null]);
    expect(
      widths('<table><col span="2" style="width: 50px"><col><tr><td>a</td><td>b</td><td>c</td><td>d</td></tr></table>'),
    ).toEqual([50, 50, null, null]);
    expect(widths('<table><colgroup><col style="width: 5px"><col style="width: 6px"></colgroup><tr><td>a</td></tr></table>')).toEqual([5]);
  });

  it("shares the page equally among columns with no stored width", () => {
    expect(fitColumnWidths([null, null, null], 601)).toEqual([601 / 3, 601 / 3, 601 / 3]);
  });

  it("keeps a table narrower than the page when every column has a width", () => {
    expect(fitColumnWidths([100, 200], 601)).toEqual([100, 200]);
    expect(fitColumnWidths([601], 601)).toEqual([601]);
  });

  it("gives the unknown columns what the known ones leave", () => {
    expect(fitColumnWidths([150, null, null], 601)).toEqual([150, 225.5, 225.5]);
  });

  it("scales an over-wide table down, keeping the proportions", () => {
    const out = fitColumnWidths([400, 400, 200], 601);
    expect(out[0]).toBeCloseTo(240.4, 6);
    expect(out[1]).toBeCloseTo(240.4, 6);
    expect(out[2]).toBeCloseTo(120.2, 6);
  });

  it("gives an unknown column at least the minimum, then fits the whole", () => {
    expect(MIN_COLUMN_PX).toBe(30);
    const out = fitColumnWidths([580, null], 601);
    expect(out[0] + out[1]).toBeCloseTo(601, 6);
    expect(out[1]).toBeCloseTo((30 * 601) / 610, 6);
    expect(fitColumnWidths([500, null], 601)).toEqual([500, 101]);
  });

  it("turns px into whole twips, never rounding up, at least one", () => {
    expect(TWIP_PER_PX).toBe(15);
    expect(pxToTwip(200)).toBe(3000);
    expect(pxToTwip(200.5)).toBe(3007);
    expect(pxToTwip(0.01)).toBe(1);
  });
});

/** The `<w:tbl>` elements' outer rows: each `<w:tr>` of a table with no nested table. */
const rowsOf = (xml: string) => xml.match(/<w:tr>(?:(?!<\/w:tr>)[\s\S])*<\/w:tr>/g) ?? [];
const cellsOf = (row: string) => row.match(/<w:tc>(?:(?!<\/w:tc>)[\s\S])*<\/w:tc>/g) ?? [];
/** How many grid columns a row covers. */
const gridWidth = (row: string) =>
  cellsOf(row).reduce((sum, tc) => sum + Number(/<w:gridSpan w:val="(\d+)"\/>/.exec(tc)?.[1] ?? 1), 0);
const gridCols = (xml: string) => Array.from(xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g), (m) => Number(m[1]));

describe("htmlToParagraphs — stored tables", () => {
  it("writes a real, fixed-layout table with the fitted grid, its width and each cell's width", async () => {
    const paragraphs = htmlToParagraphs(
      '<table style="min-width: 75px"><colgroup><col style="width: 150px"><col style="min-width: 25px"><col style="min-width: 25px"></colgroup>' +
        '<tbody><tr><td colspan="1" rowspan="1" colwidth="150"><p>a</p></td><td colspan="1" rowspan="1"><p>b</p></td><td colspan="1" rowspan="1"><p>c</p></td></tr></tbody></table>',
    );
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toBeInstanceOf(Table);
    const xml = await xmlOf(await packageOf(paragraphs));
    expect(gridCols(xml)).toEqual([2250, 3382, 3382]);
    expect(xml).toContain('<w:tblW w:type="dxa" w:w="9014"/>');
    expect(xml).toContain('<w:tblLayout w:type="fixed"/>');
    expect(cellsOf(rowsOf(xml)[0]).map((tc) => /<w:tcW w:type="dxa" w:w="(\d+)"\/>/.exec(tc)?.[1])).toEqual([
      "2250",
      "3382",
      "3382",
    ]);
    expect(textsOf(xml)).toEqual(["a", "b", "c"]);
    expect(xml).not.toContain("<w:tblInd ");
  });

  it("draws the shared borders and margins on the table and every cell, top-aligned", async () => {
    const xml = await convert("<table><tr><td>a</td></tr></table>");
    expect(xml).toContain('<w:insideH w:val="single" w:color="cccccc" w:sz="1"/>');
    expect(xml).toContain('<w:insideV w:val="single" w:color="cccccc" w:sz="1"/>');
    expect(xml).toContain('<w:tblCellMar><w:top w:type="dxa" w:w="57"/><w:left w:type="dxa" w:w="100"/>');
    const tc = cellsOf(rowsOf(xml)[0])[0];
    expect(tc).toContain('<w:tcBorders><w:top w:val="single" w:color="cccccc" w:sz="1"/>');
    expect(tc).toContain('<w:tcMar><w:top w:type="dxa" w:w="57"/>');
    expect(tc).toContain('<w:vAlign w:val="top"/>');
    expect(tc).not.toContain("<w:shd ");
  });

  it("merges cells with gridSpan and vMerge, writing each content once and every row full width", async () => {
    const xml = await convert(
      '<table><tr><th>A</th><th colspan="2">B</th></tr>' +
        '<tr><td rowspan="2">c</td><td>d</td><td rowspan="3">e</td></tr>' +
        '<tr><td>f</td></tr><tr><td>g</td><td>h</td></tr></table>',
    );
    const rows = rowsOf(xml);
    expect(rows).toHaveLength(4);
    expect(rows.map(gridWidth)).toEqual([3, 3, 3, 3]);
    expect(textsOf(xml)).toEqual(["A", "B", "c", "d", "e", "f", "g", "h"]);
    const b = cellsOf(rows[0])[1];
    expect(b).toContain('<w:gridSpan w:val="2"/>');
    expect(b).toContain('<w:tcW w:type="dxa" w:w="6010"/>');
    const restart = (row: string) => cellsOf(row).map((tc) => tc.includes('<w:vMerge w:val="restart"/>'));
    const cont = (row: string) => cellsOf(row).map((tc) => tc.includes('<w:vMerge w:val="continue"/>'));
    expect(restart(rows[1])).toEqual([true, false, true]);
    expect(cont(rows[2])).toEqual([true, false, true]);
    expect(cont(rows[3])).toEqual([false, false, true]);
    expect(xml.split('w:val="restart"')).toHaveLength(3);
    expect(xml.split('w:val="continue"')).toHaveLength(4);
    expect(cellsOf(rows[2])[0]).not.toMatch(/<w:t[ >]/);
    expect(xml.split("<w:gridSpan ")).toHaveLength(2);
  });

  it("carries a column span into the continuation of a merged block", async () => {
    const xml = await convert(
      '<table><tr><td colspan="2" rowspan="2">x</td><td>y</td></tr><tr><td>z</td></tr></table>',
    );
    const rows = rowsOf(xml);
    expect(rows.map(gridWidth)).toEqual([3, 3]);
    const first = cellsOf(rows[1])[0];
    expect(first).toContain('<w:gridSpan w:val="2"/>');
    expect(first).toContain('<w:vMerge w:val="continue"/>');
    expect(textsOf(xml)).toEqual(["x", "y", "z"]);
  });

  it("fills a short row with an empty cell", async () => {
    const xml = await convert("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>");
    const rows = rowsOf(xml);
    expect(rows.map(gridWidth)).toEqual([2, 2]);
    expect(cellsOf(rows[1])[1]).toContain("<w:p/>");
  });

  it("shades and bolds header cells and repeats only the leading header rows; no row splits", async () => {
    const xml = await convert(
      "<table><tbody><tr><th><p>H1</p></th><th><p>H2</p></th></tr><tr><th><p>Side</p></th><td><p>v</p></td></tr>" +
        "<tr><th><p>Late</p></th><th><p>row</p></th></tr></tbody></table>",
    );
    const rows = rowsOf(xml);
    expect(rows.map((r) => r.includes("<w:tblHeader/>"))).toEqual([true, false, false]);
    expect(rows.every((r) => r.includes("<w:cantSplit/>"))).toBe(true);
    for (const text of ["H1", "H2", "Side", "Late"]) expect(runWith(xml, text)).toContain("<w:b/>");
    expect(runWith(xml, "v")).not.toContain("<w:b/>");
    const shaded = (row: string) => cellsOf(row).map((tc) => tc.includes('<w:shd w:fill="f5f5f5" w:val="clear"/>'));
    expect(shaded(rows[0])).toEqual([true, true]);
    expect(shaded(rows[1])).toEqual([true, false]);
  });

  it("does not repeat a row that only holds the cells of a header spanning down into it", async () => {
    const xml = await convert(
      '<table><tr><th rowspan="2">a</th></tr><tr></tr><tr><td>x</td></tr></table>',
    );
    expect(rowsOf(xml).map((r) => r.includes("<w:tblHeader/>"))).toEqual([true, false, false]);
  });

  it("writes cell text at the body size, tight: a small gap between paragraphs, none after the last", async () => {
    const xml = await convert("<table><tr><td><p>one</p><p>two</p></td></tr></table>");
    expect(runWith(xml, "one")).toContain('<w:sz w:val="22"/>');
    expect(paraWith(xml, "one")).toContain('w:after="60"');
    expect(paraWith(xml, "two")).toContain('w:after="0"');
  });

  it("keeps a link and bold inside a cell", async () => {
    const xml = await convert('<table><tr><td><p>see <strong>this</strong> <a href="https://x.example">link</a></p></td></tr></table>');
    expect(textsOf(xml)).toEqual(["see ", "this", " ", "link"]);
    expect(runWith(xml, "this")).toContain("<w:b/>");
    expect(cellsOf(rowsOf(xml)[0])[0]).toContain("<w:hyperlink ");
    expect(runWith(xml, "link")).toContain('<w:rStyle w:val="Hyperlink"/>');
  });

  it("writes a list in a cell with its bullets and indents", async () => {
    const xml = await convert("<table><tr><td><ul><li><p>a</p></li><li><p>b</p></li></ul></td></tr></table>");
    expect(textsOf(xml)).toEqual(["•  a", "•  b"]);
    expect(paraWith(xml, "•  a")).toContain('<w:ind w:left="720"/>');
    expect(paraWith(xml, "•  a")).toContain('w:after="80"');
    expect(paraWith(xml, "•  b")).toContain('w:after="0"');
  });

  it("scales a picture in a cell to the cell's inner width and packs it as media", async () => {
    const images = new Map<string, DocxImage | null>([
      [path("adr", ID1), { type: "png", data: PNG_1X1, natural: { width: 1000, height: 500 } }],
    ]);
    const zip = await packageOf(
      htmlToParagraphs(`<table><tr><td><img src="${path("adr", ID1)}"></td><td>x</td></tr></table>`, images),
    );
    expect(media(zip)).toHaveLength(1);
    const xml = await xmlOf(zip);
    // Two equal columns of 300.5 px → 4507 twips; less 200 twips of margins → 287 px.
    expect(gridCols(xml)).toEqual([4507, 4507]);
    expect(xml).toContain(`<wp:extent cx="${287 * EMU_PER_PX}" cy="${144 * EMU_PER_PX}"/>`);
    expect(cellsOf(rowsOf(xml)[0])[0]).toContain("<w:drawing>");
  });

  it("sizes a nested table to its cell", async () => {
    const paragraphs = htmlToParagraphs(
      "<table><tr><td><p>out</p><table><tr><td>in1</td><td>in2</td></tr></table></td><td>right</td></tr></table>",
    );
    expect(paragraphs).toHaveLength(1);
    const xml = await xmlOf(await packageOf(paragraphs));
    expect(gridCols(xml)).toEqual([4507, 4507, 2152, 2152]);
    expect(xml.split("<w:tbl>")).toHaveLength(3);
    expect(textsOf(xml)).toEqual(["out", "in1", "in2", "right"]);
    // Word needs a paragraph after a table that ends a cell.
    expect(xml).toContain("</w:tbl><w:p/></w:tc>");
  });

  it("gives a table in a very narrow cell at least the minimum column width", async () => {
    const cells = Array.from({ length: 20 }, (_, i) => (i === 0 ? "<td><table><tr><td>n</td></tr></table></td>" : "<td></td>")).join("");
    const xml = await convert(`<table><tr>${cells}</tr></table>`);
    const cols = gridCols(xml);
    expect(cols.slice(0, 20)).toEqual(Array(20).fill(450));
    expect(cols[20]).toBe(MIN_COLUMN_PX * 15);
  });

  it("reads a plain table written through the API: no colgroup, no tbody, no paragraphs, a thead", async () => {
    const xml = await convert(
      "<table><thead><tr><th>Name</th><th>Owner</th></tr></thead><tr><td>CRM</td><td>Sales</td></tr></table>",
    );
    const rows = rowsOf(xml);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("<w:tblHeader/>");
    expect(rows[1]).not.toContain("<w:tblHeader/>");
    expect(gridCols(xml)).toEqual([4507, 4507]);
    expect(textsOf(xml)).toEqual(["Name", "Owner", "CRM", "Sales"]);
    expect(runWith(xml, "Name")).toContain("<w:b/>");
  });

  it("writes a table in a list item after the item's line, indented with it and narrowed by the indent", async () => {
    const xml = await convert("<ul><li><p>item</p><table><tr><td>cell</td></tr></table></li><li>next</li></ul>");
    expect(textsOf(xml)).toEqual(["•  item", "cell", "•  next"]);
    expect(xml).toContain('<w:tblInd w:type="dxa" w:w="720"/>');
    // 601 px less the 48 px indent.
    expect(gridCols(xml)).toEqual([553 * 15]);
  });

  it("gives an item that opens with a table its bullet line, and keeps a quoted table once", async () => {
    expect(textsOf(await convert("<ul><li><table><tr><td>t</td></tr></table></li></ul>"))).toEqual(["•  ", "t"]);
    const quoted = await convert("<blockquote><p>q</p><table><tr><td>t</td></tr></table></blockquote>");
    expect(textsOf(quoted)).toEqual(["q", "t"]);
    expect(quoted.split("<w:tbl>")).toHaveLength(2);
  });

  it("gives an empty cell one empty paragraph", async () => {
    const xml = await convert("<table><tr><td></td><td><p></p></td><td>x</td></tr></table>");
    const cells = cellsOf(rowsOf(xml)[0]);
    expect(cells).toHaveLength(3);
    expect(cells[0]).toMatch(/<\/w:tcPr><w:p\/><\/w:tc>$/);
    expect(cells[1]).toMatch(/<\/w:tcPr><w:p\/><\/w:tc>$/);
  });

  it("writes nothing for a table with no rows or no cells", () => {
    expect(htmlToParagraphs("<table></table>")).toEqual([]);
    expect(htmlToParagraphs("<table><tbody><tr></tr></tbody></table>")).toEqual([]);
    expect(htmlToParagraphs("<p>a</p><table><colgroup><col></colgroup></table>")).toHaveLength(1);
  });
});

// The strings `RichTextEditor.test.tsx` pins as the editor's `getHTML()`
// (every inline style ends in `;`). 1px = 15 twips; the text width is 601px.
describe("htmlToParagraphs — the editor's real table markup", () => {
  const cellWidths = (row: string) =>
    cellsOf(row).map((tc) => Number(/<w:tcW w:type="dxa" w:w="(\d+)"\/>/.exec(tc)?.[1]));

  it("keeps a resized table's stored widths", async () => {
    const xml = await convert(TABLE_RESIZED);
    expect(gridCols(xml)).toEqual([2250, 3000]);
    expect(xml).toContain('<w:tblW w:type="dxa" w:w="5250"/>');
    expect(rowsOf(xml).map(cellWidths)).toEqual([
      [2250, 3000],
      [2250, 3000],
    ]);
  });

  it("gives the rest of the text width to the column not resized", async () => {
    const xml = await convert(TABLE_ONE_RESIZED);
    expect(gridCols(xml)).toEqual([2250, 6765]);
    expect(xml).toContain('<w:tblW w:type="dxa" w:w="9015"/>');
  });

  it("writes a merged cell across resized columns as one cell spanning both", async () => {
    const xml = await convert(TABLE_MERGED_RESIZED);
    expect(gridCols(xml)).toEqual([2250, 3000]);
    const merged = cellsOf(rowsOf(xml)[1]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toContain('<w:gridSpan w:val="2"/>');
    expect(cellWidths(rowsOf(xml)[1])).toEqual([5250]);
  });

  it("splits the text width equally across a fresh table", async () => {
    const xml = await convert(TABLE_3X3);
    expect(gridCols(xml)).toEqual([3005, 3005, 3005]);
    expect(rowsOf(xml)).toHaveLength(3);
    expect(rowsOf(xml).map((r) => r.includes("<w:tblHeader/>"))).toEqual([true, false, false]);
  });
});
