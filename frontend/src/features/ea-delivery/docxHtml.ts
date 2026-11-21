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
 *
 * Tables: a stored `<table>` becomes a real Word table (see "stored tables"
 * below) — merged cells, the stored column widths fitted to the page, a
 * shaded and repeated header row, each cell's content through the same
 * converter.
 */
import {
  AlignmentType,
  BorderStyle,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
  convertInchesToTwip,
} from "docx";

import { api } from "@/api/client";
import i18n from "@/i18n";
import {
  parseDocumentImageAlign,
  parseDocumentImageDimension,
  parseDocumentImageSrc,
} from "@/lib/documentImageMarkup";
import { isLinkableHref } from "@/lib/linkify";
import { fillMentionLabelsI18n } from "./mentions/mentionLabels";

// ─── shared Word styles (mirroring the PDF) ─────────────────────────────────

export const FONT = "Segoe UI";
/** Code and code blocks. */
export const FONT_MONO = "Consolas";
export const COLOR_BODY = "222222"; // body text
export const COLOR_H3 = "444444"; // h3
export const COLOR_PREAMBLE = "666666"; // preamble italic text

// Sizes in half-points (PDF pt × 2)
export const SIZE_BODY = 22; // 11pt
export const SIZE_H3 = 26; // 13pt
export const SIZE_H4 = 24; // 12pt

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
export const TWIP_PER_PX = 15;
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
  maxWidth: number = DOCX_TEXT_WIDTH_PX,
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
        maxWidth,
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

// ─── inline content: segments with their marks ──────────────────────────────

/** The formatting a stretch of text carries: the union of its ancestors' marks. */
export interface DocxMarks {
  bold: boolean;
  italics: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  /** The link's address — only an http(s) / mailto one; anything else is plain text. */
  href: string | null;
}

/** A stretch of text with one formatting. `\n` is a line break. */
export interface DocxSegment extends DocxMarks {
  text: string;
}

const NO_MARKS: DocxMarks = {
  bold: false,
  italics: false,
  underline: false,
  strike: false,
  code: false,
  href: null,
};

/** The marks inside `el`: what it inherits plus its own. */
function marksOf(el: Element, inherited: DocxMarks): DocxMarks {
  switch (el.tagName) {
    case "STRONG":
    case "B":
      return { ...inherited, bold: true };
    case "EM":
    case "I":
      return { ...inherited, italics: true };
    case "U":
      return { ...inherited, underline: true };
    case "S":
    case "DEL":
    case "STRIKE":
      return { ...inherited, strike: true };
    case "CODE":
      return { ...inherited, code: true };
    case "A": {
      const href = (el.getAttribute("href") ?? "").trim();
      return isLinkableHref(href) ? { ...inherited, href } : inherited;
    }
    default:
      return inherited;
  }
}

const sameMarks = (a: DocxMarks, b: DocxMarks) =>
  a.bold === b.bold &&
  a.italics === b.italics &&
  a.underline === b.underline &&
  a.strike === b.strike &&
  a.code === b.code &&
  a.href === b.href;

/** Adjacent segments with the same formatting become one. Empty ones go. */
function mergeSegments(segments: readonly DocxSegment[]): DocxSegment[] {
  const out: DocxSegment[] = [];
  for (const seg of segments) {
    if (!seg.text) continue;
    const last = out[out.length - 1];
    if (last && sameMarks(last, seg)) last.text += seg.text;
    else out.push({ ...seg });
  }
  return out;
}

/**
 * The segments of inline content. Text keeps its marks from every ancestor;
 * `<br>` is a line break; a picture leaves no text (pictures are blocks);
 * any other element (a mention's `span`) passes its text through. Outside
 * `<pre>` a source line break is a space, as the browser shows it.
 */
export function inlineSegments(
  nodes: Iterable<Node>,
  marks: DocxMarks = NO_MARKS,
  pre = false,
): DocxSegment[] {
  const out: DocxSegment[] = [];
  const visit = (node: Node, current: DocxMarks) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent ?? "";
      out.push({ ...current, text: pre ? raw : raw.replace(/\r?\n/g, " ") });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.tagName === "BR") {
      out.push({ ...current, text: "\n" });
      return;
    }
    if (el.tagName === "IMG") return;
    const inner = marksOf(el, current);
    el.childNodes.forEach((child) => visit(child, inner));
  };
  for (const node of nodes) visit(node, marks);
  return mergeSegments(out);
}

/** Spaces at the very start and end of a paragraph are not shown; line breaks are. */
function trimSegments(segments: DocxSegment[]): DocxSegment[] {
  const out = segments.map((s) => ({ ...s }));
  while (out.length > 0) {
    out[0].text = out[0].text.replace(/^[ \t]+/, "");
    if (out[0].text) break;
    out.shift();
  }
  while (out.length > 0) {
    const last = out[out.length - 1];
    last.text = last.text.replace(/[ \t]+$/, "");
    if (last.text) break;
    out.pop();
  }
  return out;
}

// ─── blocks ─────────────────────────────────────────────────────────────────

/** How far a list level or a quote indents its content, in twips. */
export const DOCX_NESTED_INDENT_TWIP = 720;
/** Space after a list item's paragraph, in twips. */
const SPACING_LIST_ITEM_AFTER = 80;

/** Where a block sits: what its paragraphs look like. */
interface BlockContext {
  images: DocxImageMap;
  /** Left indent of the content, in twips (0 at the top level). */
  indent: number;
  /** Space after a text paragraph, in twips. */
  after: number;
  /** Inside a quote: italic, in the quote's colour. */
  quote: boolean;
  /** Inside a header cell: bold. */
  bold: boolean;
  /** The widest a picture (or a table) may be drawn here, in px. */
  maxImageWidth: number;
}

type TextStyle = "body" | "h3" | "h4" | "pre";

/**
 * One converted block. Text stays as segments until the end, so a list item
 * can put its bullet in front of its first paragraph; anything else is
 * already a docx node.
 */
type Block =
  | { kind: "text"; segments: DocxSegment[]; style: TextStyle; ctx: BlockContext }
  | { kind: "node"; node: Paragraph | Table; picture: boolean };

/** Tags that start a block of their own; anything else is inline. */
const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "CAPTION", "COLGROUP", "DD", "DETAILS", "DIV",
  "DL", "DT", "FIGCAPTION", "FIGURE", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER",
  "HR", "IMG", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "SUMMARY", "TABLE", "TBODY",
  "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
]);

/** The blocks of `parent`'s children; runs of inline content become paragraphs. */
function convertChildren(parent: Node, ctx: BlockContext): Block[] {
  const blocks: Block[] = [];
  let inline: Node[] = [];
  const flush = () => {
    if (inline.length === 0) return;
    const segments = trimSegments(inlineSegments(inline));
    inline = [];
    if (segments.length > 0) blocks.push({ kind: "text", segments, style: "body", ctx });
  };
  parent.childNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as Element).tagName)) {
      flush();
      blocks.push(...convertBlock(node as Element, ctx));
    } else {
      inline.push(node);
    }
  });
  flush();
  return blocks;
}

/** One block element. */
function convertBlock(el: Element, ctx: BlockContext): Block[] {
  switch (el.tagName) {
    case "IMG": {
      const picture = imageParagraph(
        el,
        ctx.images,
        ctx.indent ? { left: ctx.indent } : undefined,
        ctx.maxImageWidth,
      );
      return picture ? [{ kind: "node", node: picture, picture: true }] : [];
    }
    case "H3":
    case "H4": {
      const segments = trimSegments(inlineSegments(el.childNodes));
      if (segments.length === 0) return [];
      return [{ kind: "text", segments, style: el.tagName === "H3" ? "h3" : "h4", ctx }];
    }
    case "PRE": {
      const segments = inlineSegments(el.childNodes, { ...NO_MARKS, code: true }, true);
      // The editor writes no final line break; a hand-written block often has one.
      const last = segments[segments.length - 1];
      if (last) last.text = last.text.replace(/\n$/, "");
      const kept = segments.filter((s) => s.text);
      return kept.length > 0 ? [{ kind: "text", segments: kept, style: "pre", ctx }] : [];
    }
    case "UL":
    case "OL":
      return listBlocks(el, ctx);
    case "BLOCKQUOTE":
      return quoteBlocks(el, ctx);
    case "TABLE": {
      const table = docxTable(el, ctx);
      return table ? [{ kind: "node", node: table, picture: false }] : [];
    }
    default:
      // Paragraphs, containers and any other block: their content, in order.
      return convertChildren(el, ctx);
  }
}

/** An `<ol start>`, else 1. */
function listStart(list: Element): number {
  const start = Number.parseInt(list.getAttribute("start") ?? "", 10);
  return Number.isFinite(start) ? start : 1;
}

/**
 * A list: each item's blocks one level further in, its bullet or number in
 * front of its first paragraph. Numbers count this list's own items only. An
 * item holding only pictures is the pictures, not an empty bullet.
 */
function listBlocks(list: Element, ctx: BlockContext): Block[] {
  const ordered = list.tagName === "OL";
  let number = listStart(list);
  const itemCtx: BlockContext = {
    ...ctx,
    indent: ctx.indent + DOCX_NESTED_INDENT_TWIP,
    after: SPACING_LIST_ITEM_AFTER,
  };
  const blocks: Block[] = [];
  for (const item of Array.from(list.children)) {
    if (item.tagName !== "LI") {
      blocks.push(...convertBlock(item, itemCtx));
      continue;
    }
    const prefix: DocxSegment = { ...NO_MARKS, text: ordered ? `${number}. ` : "•  " };
    number += 1;
    const content = convertChildren(item, itemCtx);
    const first = content[0];
    if (first?.kind === "text" && first.ctx === itemCtx && first.style === "body") {
      first.segments = mergeSegments([prefix, ...first.segments]);
    } else if (content.length === 0 || !content.every((b) => b.kind === "node" && b.picture)) {
      content.unshift({ kind: "text", segments: [prefix], style: "body", ctx: itemCtx });
    }
    blocks.push(...content);
  }
  return blocks;
}

/**
 * A quote: its blocks indented, italic, in the quote's colour — several
 * paragraphs stay several. A quote holding only pictures is the pictures; an
 * empty one is one empty quote line.
 */
function quoteBlocks(el: Element, ctx: BlockContext): Block[] {
  const quoteCtx: BlockContext = {
    ...ctx,
    indent: ctx.indent + DOCX_NESTED_INDENT_TWIP,
    after: SPACING_AFTER_DEFAULT,
    quote: true,
  };
  const content = convertChildren(el, quoteCtx);
  return content.length > 0
    ? content
    : [{ kind: "text", segments: [], style: "body", ctx: quoteCtx }];
}

// ─── stored tables ──────────────────────────────────────────────────────────

/** One cell of a table's grid: where it starts and how far it spans. */
export interface DocxGridCell {
  /** The `<td>` / `<th>`; `null` for a filler where a short row has no cell. */
  el: Element | null;
  /** Its first column, from 0. */
  col: number;
  colSpan: number;
  rowSpan: number;
}

/** A table as a grid: per row, the cells that start in it, in column order. */
export interface DocxTableGrid {
  rows: DocxGridCell[][];
  columns: number;
}

/** The most columns one cell may span (the HTML limit). */
export const MAX_COLSPAN = 1000;
/** The narrowest a column with no stored width gets, in px, before fitting. */
export const MIN_COLUMN_PX = 30;
/** Space after a paragraph inside a cell, in twips (the 4px the display rules leave). */
const SPACING_CELL_AFTER = 60;

const ROW_GROUPS = new Set(["THEAD", "TBODY", "TFOOT"]);

/** The table's own rows in document order: direct, or in its `thead` / `tbody` / `tfoot`. */
export function tableRowElements(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of Array.from(table.children)) {
    if (child.tagName === "TR") rows.push(child);
    else if (ROW_GROUPS.has(child.tagName)) {
      rows.push(...Array.from(child.children).filter((c) => c.tagName === "TR"));
    }
  }
  return rows;
}

/** A `colspan` / `rowspan` value as an integer from 1 to `max`; anything unusable is 1. */
export function parseSpan(value: string | null | undefined, max: number): number {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, max);
}

const isCell = (el: Element) => el.tagName === "TD" || el.tagName === "TH";

/**
 * The table's grid. Each cell takes the first column its row has free (cells
 * spanning down from rows above hold theirs); a row span running past the last
 * row is clipped to it. The column count is the widest row; a position no cell
 * covers gets a filler, so every row spans the whole grid.
 */
export function tableGrid(table: Element): DocxTableGrid {
  const trs = tableRowElements(table);
  const taken: boolean[][] = trs.map(() => []);
  const placed: DocxGridCell[][] = trs.map(() => []);
  let columns = 0;
  trs.forEach((tr, r) => {
    let col = 0;
    for (const el of Array.from(tr.children).filter(isCell)) {
      while (taken[r][col]) col += 1;
      const colSpan = parseSpan(el.getAttribute("colspan"), MAX_COLSPAN);
      const rowSpan = parseSpan(el.getAttribute("rowspan"), trs.length - r);
      for (let dr = 0; dr < rowSpan; dr += 1) {
        for (let dc = 0; dc < colSpan; dc += 1) taken[r + dr][col + dc] = true;
      }
      placed[r].push({ el, col, colSpan, rowSpan });
      col += colSpan;
      columns = Math.max(columns, col);
    }
  });
  const rows = placed.map((cells, r) => {
    const out = [...cells];
    for (let col = 0; col < columns; col += 1) {
      if (!taken[r][col]) out.push({ el: null, col, colSpan: 1, rowSpan: 1 });
    }
    return out.sort((a, b) => a.col - b.col);
  });
  return { rows, columns };
}

/** A positive number of px, or `null`. */
function positivePx(value: string | undefined): number | null {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The px width in a `style` attribute's `width: Npx` (never its `min-width`), or `null`. */
export function styleWidthPx(style: string | null | undefined): number | null {
  const match = /(?:^|;)\s*width\s*:\s*([\d.]+)px\s*(?:;|$)/i.exec(style ?? "");
  return match ? positivePx(match[1]) : null;
}

/**
 * Each column's stored width in px, or `null` where nothing says: first from a
 * cell's `colwidth` (the n-th entry of its comma list for the n-th column it
 * spans; the first cell in document order wins), then from the matching
 * `<col style="width: Npx">`.
 */
export function storedColumnWidths(table: Element, grid: DocxTableGrid): (number | null)[] {
  const widths: (number | null)[] = Array(grid.columns).fill(null);
  for (const row of grid.rows) {
    for (const cell of row) {
      const list = cell.el?.getAttribute("colwidth");
      if (!list) continue;
      list.split(",").forEach((entry, k) => {
        const px = positivePx(entry.trim());
        if (k < cell.colSpan && px !== null && widths[cell.col + k] === null) {
          widths[cell.col + k] = px;
        }
      });
    }
  }
  const cols: Element[] = [];
  for (const child of Array.from(table.children)) {
    if (child.tagName === "COL") cols.push(child);
    else if (child.tagName === "COLGROUP") {
      cols.push(...Array.from(child.children).filter((c) => c.tagName === "COL"));
    }
  }
  let col = 0;
  for (const el of cols) {
    const px = styleWidthPx(el.getAttribute("style"));
    for (let k = parseSpan(el.getAttribute("span"), MAX_COLSPAN); k > 0; k -= 1) {
      if (col < grid.columns && widths[col] === null) widths[col] = px;
      col += 1;
    }
  }
  return widths;
}

/**
 * Column widths in px that fit `available` px. Columns without a stored width
 * share what the others leave, at least `MIN_COLUMN_PX` each. A table wider
 * than `available` is scaled down, keeping the proportions; one whose every
 * column has a stored width keeps its width when it is narrower.
 */
export function fitColumnWidths(stored: readonly (number | null)[], available: number): number[] {
  const known = stored.reduce<number>((sum, w) => sum + (w ?? 0), 0);
  const unknown = stored.filter((w) => w === null).length;
  const share = unknown > 0 ? Math.max(MIN_COLUMN_PX, (available - known) / unknown) : 0;
  const widths = stored.map((w) => w ?? share);
  const total = known + unknown * share;
  const scale = total > available ? available / total : 1;
  return widths.map((w) => w * scale);
}

/** A width in px as whole twips, never more than the px say (and at least 1). */
export function pxToTwip(px: number): number {
  return Math.max(1, Math.floor(px * TWIP_PER_PX));
}

/** Whether a grid row is all header cells (and has at least one). */
function isHeaderRow(row: readonly DocxGridCell[]): boolean {
  const cells = row.filter((c) => c.el !== null);
  return cells.length > 0 && cells.every((c) => c.el!.tagName === "TH");
}

/** A cell's content: tight paragraphs, nothing after the last one. */
function cellChildren(el: Element | null, ctx: BlockContext): (Paragraph | Table)[] {
  if (!el) return [];
  const blocks = convertChildren(el, ctx);
  const last = blocks[blocks.length - 1];
  if (last?.kind === "text") blocks[blocks.length - 1] = { ...last, ctx: { ...last.ctx, after: 0 } };
  // An empty cell, or one ending in a table, gets its closing empty paragraph
  // from docx itself (`TableCell.prepForXml`): Word needs one there.
  return blocksToDocx(blocks);
}

/**
 * A stored `<table>` as a Word table, or `null` when it has no cell. Column
 * widths: the stored ones fitted to the room here (`ctx.maxImageWidth` less
 * the indent), given both as the grid and on every cell so Word and
 * LibreOffice agree. Merged cells pass `columnSpan` / `rowSpan`; docx's
 * `Table` inserts the continuation cells of a row span itself (`vMerge`), so
 * none are written here. A leading run of all-`<th>` rows repeats on every
 * page; no row splits across a page break.
 */
function docxTable(el: Element, ctx: BlockContext): Table | null {
  const grid = tableGrid(el);
  if (grid.columns === 0) return null;
  const available = Math.max(MIN_COLUMN_PX, Math.floor(ctx.maxImageWidth - ctx.indent / TWIP_PER_PX));
  const twips = fitColumnWidths(storedColumnWidths(el, grid), available).map(pxToTwip);
  const sideMargins = DOCX_CELL_MARGINS.left + DOCX_CELL_MARGINS.right;
  let header = true;
  const rows = grid.rows.map((row) => {
    header = header && isHeaderRow(row);
    const cells = row.map((cell) => {
      const width = twips.slice(cell.col, cell.col + cell.colSpan).reduce((a, b) => a + b, 0);
      const th = cell.el?.tagName === "TH";
      const cellCtx: BlockContext = {
        ...ctx,
        indent: 0,
        after: SPACING_CELL_AFTER,
        bold: th,
        maxImageWidth: Math.max(1, Math.floor((width - sideMargins) / TWIP_PER_PX)),
      };
      return new TableCell({
        children: cellChildren(cell.el, cellCtx),
        width: { size: width, type: WidthType.DXA },
        columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
        rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
        shading: th ? { type: ShadingType.CLEAR, fill: DOCX_HEADER_FILL } : undefined,
        borders: DOCX_CELL_BORDERS,
        margins: DOCX_CELL_MARGINS,
        verticalAlign: VerticalAlignTable.TOP,
      });
    });
    return new TableRow({ children: cells, cantSplit: true, tableHeader: header || undefined });
  });
  return new Table({
    rows,
    columnWidths: twips,
    width: { size: twips.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    indent: ctx.indent ? { size: ctx.indent, type: WidthType.DXA } : undefined,
    // The continuation cells docx inserts carry no margins: the table's own apply.
    margins: DOCX_CELL_MARGINS,
    borders: DOCX_TABLE_BORDERS,
  });
}

// ─── blocks → docx ──────────────────────────────────────────────────────────

/** The look every run of one paragraph starts from. */
interface RunBase {
  font: string;
  size: number;
  color: string;
  bold: boolean;
  italics: boolean;
}

/** One segment's runs: a run per line, each after the first opening with a line break. */
function segmentRuns(seg: DocxSegment, base: RunBase): TextRun[] {
  return seg.text.split("\n").map(
    (line, i) =>
      new TextRun({
        text: line,
        font: seg.code ? FONT_MONO : base.font,
        size: base.size,
        // A link takes its colour (and underline) from the Hyperlink style; a
        // direct colour would override it.
        color: seg.href ? undefined : base.color,
        style: seg.href ? "Hyperlink" : undefined,
        bold: seg.bold || base.bold || undefined,
        italics: seg.italics || base.italics || undefined,
        underline: seg.underline ? {} : undefined,
        strike: seg.strike || undefined,
        break: i > 0 ? 1 : undefined,
      }),
  );
}

/** A paragraph's children: runs, with each link's runs inside one `ExternalHyperlink`. */
function paragraphChildren(
  segments: readonly DocxSegment[],
  base: RunBase,
): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];
  let i = 0;
  while (i < segments.length) {
    const href = segments[i].href;
    if (!href) {
      out.push(...segmentRuns(segments[i], base));
      i += 1;
      continue;
    }
    const runs: TextRun[] = [];
    while (i < segments.length && segments[i].href === href) {
      runs.push(...segmentRuns(segments[i], base));
      i += 1;
    }
    out.push(new ExternalHyperlink({ link: href, children: runs }));
  }
  return out;
}

function textParagraph(block: Extract<Block, { kind: "text" }>): Paragraph {
  const { ctx, style, segments } = block;
  const indent = ctx.indent ? { left: ctx.indent } : undefined;
  const color = ctx.quote ? COLOR_PREAMBLE : COLOR_BODY;
  if (style === "h3" || style === "h4") {
    return new Paragraph({
      children: paragraphChildren(segments, {
        font: FONT,
        size: style === "h3" ? SIZE_H3 : SIZE_H4,
        color: COLOR_H3,
        bold: true,
        italics: ctx.quote,
      }),
      heading: style === "h3" ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4,
      indent,
      spacing: { before: SPACING_H3_BEFORE, after: SPACING_AFTER_DEFAULT },
    });
  }
  const base: RunBase = { font: FONT, size: SIZE_BODY, color, bold: ctx.bold, italics: ctx.quote };
  if (style === "pre") {
    return new Paragraph({
      children: paragraphChildren(segments, base),
      shading: { type: ShadingType.CLEAR, fill: DOCX_CODE_FILL },
      indent,
      spacing: { after: SPACING_AFTER_DEFAULT },
    });
  }
  return new Paragraph({
    children: paragraphChildren(segments, base),
    indent,
    spacing: { line: LINE_SPACING, after: ctx.after },
  });
}

/** Converted blocks as docx nodes, in order. */
function blocksToDocx(blocks: readonly Block[]): (Paragraph | Table)[] {
  return blocks.map((b) => (b.kind === "text" ? textParagraph(b) : b.node));
}

// ─── HTML → Paragraphs ──────────────────────────────────────────────────────

const NO_IMAGES: DocxImageMap = new Map();

/**
 * Parse stored HTML into docx paragraphs and tables. `images` is what `prefetchDocumentImages` returned for the same
 * document; without it every picture reads as the placeholder line.
 *
 * Marks survive everywhere (paragraphs, headings, list items, quotes);
 * an http(s) / mailto link is a clickable Word hyperlink; code is monospace;
 * `<br>` and a code block's lines are line breaks; lists nest one indent
 * level deeper and number per list (honouring `<ol start>`).
 */
export function htmlToParagraphs(
  stored: string,
  images: DocxImageMap = NO_IMAGES,
): (Paragraph | Table)[] {
  if (!stored || stored === "<p></p>") return [];
  // Restricted / deleted mentions arrive empty: the reader's words go in first.
  const html = fillMentionLabelsI18n(stored);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const ctx: BlockContext = {
    images,
    indent: 0,
    after: SPACING_AFTER_DEFAULT,
    quote: false,
    bold: false,
    maxImageWidth: DOCX_TEXT_WIDTH_PX,
  };
  return blocksToDocx(convertChildren(doc.body, ctx));
}

// ─── generated tables (facts, version history, links…) ──────────────────────

/** The light fill behind a table header and a code block. */
const DOCX_LIGHT_FILL = "f5f5f5";
/** A generated table's header row fill. */
export const DOCX_HEADER_FILL = DOCX_LIGHT_FILL;
/** A code block's fill. */
export const DOCX_CODE_FILL = DOCX_LIGHT_FILL;
/** Table rule colour. */
export const DOCX_TABLE_BORDER_COLOR = "cccccc";
/** One cell side's border. */
export const DOCX_TABLE_BORDER = {
  style: BorderStyle.SINGLE,
  size: 1,
  color: DOCX_TABLE_BORDER_COLOR,
};
/** A table cell's text size in half-points (10pt). */
export const SIZE_TABLE = 20;
/** A table cell's inner margins, in twips. */
export const DOCX_CELL_MARGINS = {
  top: convertInchesToTwip(0.04),
  bottom: convertInchesToTwip(0.04),
  left: convertInchesToTwip(0.07),
  right: convertInchesToTwip(0.07),
};
const DOCX_CELL_BORDERS = {
  top: DOCX_TABLE_BORDER,
  bottom: DOCX_TABLE_BORDER,
  left: DOCX_TABLE_BORDER,
  right: DOCX_TABLE_BORDER,
};
/** A stored table's own borders, outside and between cells. */
const DOCX_TABLE_BORDERS = {
  ...DOCX_CELL_BORDERS,
  insideHorizontal: DOCX_TABLE_BORDER,
  insideVertical: DOCX_TABLE_BORDER,
};

/**
 * A full-width table with a shaded, bold header row and one plain line per
 * cell — what both exporters write for their own facts and lists.
 */
export function buildDocxTable(columns: string[], rows: string[][]): Table {
  const headerCells = columns.map(
    (col) =>
      new TableCell({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: col,
                bold: true,
                font: FONT,
                size: SIZE_TABLE,
                color: COLOR_BODY,
              }),
            ],
          }),
        ],
        shading: { type: ShadingType.CLEAR, fill: DOCX_HEADER_FILL },
        borders: DOCX_CELL_BORDERS,
        margins: DOCX_CELL_MARGINS,
      }),
  );

  const dataRows = rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: cell,
                      font: FONT,
                      size: SIZE_TABLE,
                      color: COLOR_BODY,
                    }),
                  ],
                }),
              ],
              borders: DOCX_CELL_BORDERS,
              margins: DOCX_CELL_MARGINS,
            }),
        ),
      }),
  );

  return new Table({
    rows: [new TableRow({ children: headerCells }), ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}
