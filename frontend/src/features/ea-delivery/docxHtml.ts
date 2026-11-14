/**
 * Stored decision / SoAW section HTML → Word paragraphs, shared by the two
 * Word exporters (`adrExport.ts`, `soawExport.ts`), which carried identical
 * copies of this converter until pictures arrived.
 *
 * Pictures: Word cannot fetch a URL, so an exporter first calls
 * `prefetchDocumentImages` with every section it will write. That fetches
 * each distinct document picture once (a few at a time), reads its natural
 * size and turns WebP — which Word cannot show — into PNG. The converter
 * itself stays synchronous and looks each `<img>` up in the result: a picture
 * becomes its own paragraph holding an `ImageRun`, sized from the stored
 * `width` / `height` (else its natural size) and scaled down to the page's
 * text width, aligned from `data-align`. A picture that could not be fetched
 * or decoded becomes one translated placeholder line.
 */
import { AlignmentType, HeadingLevel, ImageRun, Paragraph, TextRun } from "docx";

import { api } from "@/api/client";
import i18n from "@/i18n";
import {
  parseDocumentImageAlign,
  parseDocumentImageDimension,
  parseDocumentImageSrc,
} from "@/lib/documentImageMarkup";
import { fillMentionLabelsI18n } from "./mentions/mentionLabels";

// ─── shared Word styles (mirroring the PDF) ─────────────────────────────────

export const FONT = "Segoe UI";
export const COLOR_BODY = "222222"; // body text
export const COLOR_H3 = "444444"; // h3
export const COLOR_PREAMBLE = "666666"; // preamble italic text

// Sizes in half-points (PDF pt × 2)
export const SIZE_BODY = 22; // 11pt
export const SIZE_H3 = 26; // 13pt

// Line spacing: 1.6× = 384 (240 = single)
export const LINE_SPACING = 384;

// Spacing in twips
export const SPACING_AFTER_DEFAULT = 160; // ~8pt
export const SPACING_H3_BEFORE = 300; // ~15pt (20px)

// ─── page geometry ──────────────────────────────────────────────────────────

/** Both exporters leave the page size at docx's default: A4 portrait, 11906 twips wide. */
export const DOCX_PAGE_WIDTH_TWIP = 11906;
/** The 1-inch margin both exporters set on every side. */
export const DOCX_PAGE_MARGIN_TWIP = 1440;
/** 1 px at 96 dpi = 15 twips; docx sizes an `ImageRun` in such pixels. */
const TWIP_PER_PX = 15;
/** The widest a picture may be: the page's text width, in px (601). */
export const DOCX_TEXT_WIDTH_PX = Math.floor(
  (DOCX_PAGE_WIDTH_TWIP - 2 * DOCX_PAGE_MARGIN_TWIP) / TWIP_PER_PX,
);

// ─── pictures ───────────────────────────────────────────────────────────────

export interface PixelSize {
  width: number;
  height: number;
}

export type DocxImageType = "png" | "jpg" | "gif";

/** A fetched picture, ready for an `ImageRun`. */
export interface DocxImage {
  type: DocxImageType;
  data: Uint8Array;
  /** Natural size in px, or `null` when it could not be read. */
  natural: PixelSize | null;
}

/** Canonical picture path → the picture, or `null` when it could not be had. */
export type DocxImageMap = ReadonlyMap<string, DocxImage | null>;

/** How many pictures are fetched at once. */
export const IMAGE_FETCH_CONCURRENCY = 4;

type SniffedType = DocxImageType | "webp";

/** The raster format by its leading bytes, or `null` for anything else. */
export function sniffImageType(bytes: Uint8Array): SniffedType | null {
  const at = (i: number, ...expected: number[]) =>
    expected.every((b, k) => bytes[i + k] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (at(0, 0xff, 0xd8, 0xff)) return "jpg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  return null;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) =>
  ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

function jpegSize(b: Uint8Array): PixelSize | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC), carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + u16be(b, i + 2);
  }
  return null;
}

function webpSize(b: Uint8Array): PixelSize | null {
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (chunk === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  if (chunk === "VP8L") {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  return null;
}

/**
 * A picture's natural size read from its header — the fallback when the
 * browser cannot decode it (`createImageBitmap` missing). `null` when the
 * header is not understood or names an empty picture.
 */
export function readImageHeaderSize(bytes: Uint8Array, type: SniffedType): PixelSize | null {
  let size: PixelSize | null = null;
  if (bytes.length >= 30) {
    if (type === "png") size = { width: u32be(bytes, 16), height: u32be(bytes, 20) };
    else if (type === "gif") size = { width: u16le(bytes, 6), height: u16le(bytes, 8) };
    else if (type === "jpg") size = jpegSize(bytes);
    else size = webpSize(bytes);
  }
  return size && size.width > 0 && size.height > 0 ? size : null;
}

/** Decoded by the browser, when it can; `null` otherwise. */
async function decode(blob: Blob): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/** A decoded picture re-encoded as PNG on a canvas, or `null` when that is not possible. */
async function toPng(bitmap: ImageBitmap): Promise<Uint8Array | null> {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return png ? new Uint8Array(await png.arrayBuffer()) : null;
}

/** One picture, fetched and made Word-ready, or `null`. Never throws. */
async function loadImage(path: string): Promise<DocxImage | null> {
  try {
    // `api.*` paths are relative to `/api/v1`.
    const res = await api.getRaw(path.slice("/api/v1".length));
    const blob = await res.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const type = sniffImageType(bytes);
    if (!type) return null;
    const bitmap = await decode(blob);
    try {
      const natural = bitmap
        ? { width: bitmap.width, height: bitmap.height }
        : readImageHeaderSize(bytes, type);
      if (type !== "webp") return { type, data: bytes, natural };
      // Word cannot show WebP: re-encode, or give up on this picture.
      const png = bitmap ? await toPng(bitmap) : null;
      return png ? { type: "png", data: png, natural } : null;
    } finally {
      bitmap?.close();
    }
  } catch {
    return null;
  }
}

/** Every distinct document picture path the HTML fragments reference, in order. */
export function documentImagePaths(htmls: readonly (string | null | undefined)[]): string[] {
  const paths: string[] = [];
  for (const html of htmls) {
    if (!html || !html.includes("<img")) continue;
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const img of Array.from(doc.querySelectorAll("img"))) {
      const ref = parseDocumentImageSrc(img.getAttribute("src"));
      if (ref && !paths.includes(ref.path)) paths.push(ref.path);
    }
  }
  return paths;
}

/**
 * Fetch every distinct document picture the sections reference, at most
 * `IMAGE_FETCH_CONCURRENCY` at a time. A picture that failed maps to `null`.
 */
export async function prefetchDocumentImages(
  htmls: readonly (string | null | undefined)[],
): Promise<Map<string, DocxImage | null>> {
  const paths = documentImagePaths(htmls);
  const out = new Map<string, DocxImage | null>();
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const path = paths[next];
      next += 1;
      out.set(path, await loadImage(path));
    }
  };
  const workers = Math.min(IMAGE_FETCH_CONCURRENCY, paths.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}

/**
 * The size a picture is drawn at in Word, in px: the stored `width` /
 * `height` when both are there; one of them with the other derived from the
 * natural proportions; else the natural size. Then scaled down, keeping the
 * proportions, to at most `maxWidth`. `null` when nothing gives a size.
 */
export function docxImageSize(
  stored: { width: number | null; height: number | null },
  natural: PixelSize | null,
  maxWidth: number = DOCX_TEXT_WIDTH_PX,
): PixelSize | null {
  let size: PixelSize | null = null;
  if (stored.width !== null && stored.height !== null) {
    size = { width: stored.width, height: stored.height };
  } else if (natural) {
    if (stored.width !== null) {
      size = { width: stored.width, height: (stored.width * natural.height) / natural.width };
    } else if (stored.height !== null) {
      size = { width: (stored.height * natural.width) / natural.height, height: stored.height };
    } else {
      size = natural;
    }
  }
  if (!size) return null;
  const scale = Math.min(1, maxWidth / size.width);
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/** A picture's paragraph alignment from its `data-align`; none (start) when absent. */
export function docxImageAlignment(
  align: string | null | undefined,
): (typeof AlignmentType)["CENTER"] | (typeof AlignmentType)["RIGHT"] | undefined {
  const parsed = parseDocumentImageAlign(align);
  if (parsed === "center") return AlignmentType.CENTER;
  if (parsed === "right") return AlignmentType.RIGHT;
  return undefined;
}

/**
 * The paragraph for one `<img>`: the picture, or the translated placeholder
 * when it could not be had. Nothing for a picture that is not a document
 * picture (the sanitiser never shows one either).
 */
function imageParagraph(
  el: Element,
  images: DocxImageMap,
  inset?: { left: number },
): Paragraph | null {
  const ref = parseDocumentImageSrc(el.getAttribute("src"));
  if (!ref) return null;
  const alignment = docxImageAlignment(el.getAttribute("data-align"));
  // Inside a list item or a quote a start-aligned picture sits under its text.
  const indent = alignment ? undefined : inset;
  const image = images.get(ref.path) ?? null;
  const size = image
    ? docxImageSize(
        {
          width: parseDocumentImageDimension(el.getAttribute("width")),
          height: parseDocumentImageDimension(el.getAttribute("height")),
        },
        image.natural,
      )
    : null;
  if (!image || !size) {
    return new Paragraph({
      children: [
        new TextRun({
          text: String(i18n.t("delivery:export.imageUnavailable")),
          italics: true,
          font: FONT,
          size: SIZE_BODY,
          color: COLOR_PREAMBLE,
        }),
      ],
      alignment,
      indent,
      spacing: { line: LINE_SPACING, after: SPACING_AFTER_DEFAULT },
    });
  }
  return new Paragraph({
    children: [new ImageRun({ type: image.type, data: image.data, transformation: size })],
    alignment,
    indent,
    spacing: { after: SPACING_AFTER_DEFAULT },
  });
}

/** The indent of a list item's or a quote's text, which its pictures share. */
const NESTED_INDENT = { left: 720 };

/**
 * The picture paragraphs of the document pictures inside `container` that
 * `owns` says belong to it (a list item keeps only those whose closest item
 * is itself, so a nested list's pictures are written once, under their own
 * item).
 */
function nestedPictures(
  container: Element,
  images: DocxImageMap,
  owns: (img: Element) => boolean,
): Paragraph[] {
  const out: Paragraph[] = [];
  for (const img of Array.from(container.querySelectorAll("img"))) {
    if (!owns(img)) continue;
    const picture = imageParagraph(img, images, NESTED_INDENT);
    if (picture) out.push(picture);
  }
  return out;
}

// ─── HTML → Paragraphs ──────────────────────────────────────────────────────

const NO_IMAGES: DocxImageMap = new Map();

/**
 * Parse simple stored HTML into docx Paragraphs. `images` is what
 * `prefetchDocumentImages` returned for the same document; without it every
 * picture reads as the placeholder line.
 */
export function htmlToParagraphs(stored: string, images: DocxImageMap = NO_IMAGES): Paragraph[] {
  if (!stored || stored === "<p></p>") return [];
  // Restricted / deleted mentions arrive empty: the reader's words go in first.
  const html = fillMentionLabelsI18n(stored);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const paragraphs: Paragraph[] = [];

  const processNode = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text, font: FONT, size: SIZE_BODY, color: COLOR_BODY })],
            spacing: { line: LINE_SPACING, after: SPACING_AFTER_DEFAULT },
          }),
        );
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === "img") {
      const picture = imageParagraph(el, images);
      if (picture) paragraphs.push(picture);
    } else if (tag === "p") {
      const runs = inlineRuns(el);
      if (runs.length > 0) {
        paragraphs.push(
          new Paragraph({
            children: runs,
            spacing: { line: LINE_SPACING, after: SPACING_AFTER_DEFAULT },
          }),
        );
      }
    } else if (tag === "h3" || tag === "h4") {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: el.textContent ?? "",
              bold: true,
              font: FONT,
              size: SIZE_H3,
              color: COLOR_H3,
            }),
          ],
          heading: tag === "h3" ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4,
          spacing: { before: SPACING_H3_BEFORE, after: SPACING_AFTER_DEFAULT },
        }),
      );
    } else if (tag === "ul" || tag === "ol") {
      el.querySelectorAll("li").forEach((li, idx) => {
        const prefix = tag === "ol" ? `${idx + 1}. ` : "•  ";
        const pictures = nestedPictures(li, images, (img) => img.closest("li") === li);
        // An item holding only pictures is the pictures, not an empty bullet.
        if (pictures.length > 0 && !(li.textContent ?? "").trim()) {
          paragraphs.push(...pictures);
          return;
        }
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: prefix + (li.textContent ?? ""),
                font: FONT,
                size: SIZE_BODY,
                color: COLOR_BODY,
              }),
            ],
            indent: { left: 720 },
            spacing: { line: LINE_SPACING, after: 80 },
          }),
        );
        paragraphs.push(...pictures);
      });
    } else if (tag === "blockquote") {
      // The quote is written whole (nested blocks included), so all its pictures are its own.
      const pictures = nestedPictures(el, images, () => true);
      if (pictures.length > 0 && !(el.textContent ?? "").trim()) {
        paragraphs.push(...pictures);
        return;
      }
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: el.textContent ?? "",
              italics: true,
              font: FONT,
              size: SIZE_BODY,
              color: COLOR_PREAMBLE,
            }),
          ],
          indent: { left: 720 },
          spacing: { line: LINE_SPACING, after: SPACING_AFTER_DEFAULT },
        }),
      );
      paragraphs.push(...pictures);
    } else {
      el.childNodes.forEach(processNode);
    }
  };

  doc.body.childNodes.forEach(processNode);
  return paragraphs;
}

/** Convert inline HTML children to a TextRun array. */
function inlineRuns(el: HTMLElement): TextRun[] {
  const runs: TextRun[] = [];
  el.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (text) runs.push(new TextRun({ text, font: FONT, size: SIZE_BODY, color: COLOR_BODY }));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const c = child as HTMLElement;
      const tag = c.tagName.toLowerCase();
      const text = c.textContent ?? "";
      runs.push(
        new TextRun({
          text,
          font: FONT,
          size: SIZE_BODY,
          color: COLOR_BODY,
          bold: tag === "strong" || tag === "b",
          italics: tag === "em" || tag === "i",
          underline: tag === "u" ? {} : undefined,
          strike: tag === "s" || tag === "del",
        }),
      );
    }
  });
  return runs;
}
