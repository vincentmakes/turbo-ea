/**
 * Pictures inside a decision (ADR) or SoAW rich-text section.
 *
 * A picture's bytes live in the backend's `document_images` store; the
 * section's HTML only references them, as
 * `<img src="/api/v1/document-images/{kind}/{uuid}" width height data-align>`.
 * The `src` is always the RELATIVE path — the server's canonical form and the
 * editor's output must be byte-identical, or every load reads as an edit.
 */
import { api } from "@/api/client";
import i18n from "@/i18n";
import { MAX_DOCUMENT_IMAGE_BYTES, MAX_DOCUMENT_IMAGE_MB } from "@/lib/attachmentFormats";
import {
  DOCUMENT_IMAGE_CSS,
  DOCUMENT_IMAGE_PATH_PREFIX,
  parseDocumentImageSrc,
  type DocumentImageKind,
} from "@/lib/documentImageMarkup";

export type { DocumentImageKind };
export { DOCUMENT_IMAGE_CSS };

/** What `POST /document-images/{kind}` answers. */
export interface DocumentImageUpload {
  id: string;
  src: string;
  mime_type: string;
  size: number;
}

/** The raster formats the backend accepts (by magic bytes). SVG is refused. */
export const DOCUMENT_IMAGE_MIME_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

/** The file input's `accept=` list. */
export const DOCUMENT_IMAGE_ACCEPT = DOCUMENT_IMAGE_MIME_TYPES.join(",");

/** The relative URL a stored picture is referenced by. */
export function documentImageSrc(kind: DocumentImageKind, id: string): string {
  return `${DOCUMENT_IMAGE_PATH_PREFIX}${kind}/${id}`;
}

/**
 * The canonical relative path of a picture of this kind (uuid lower-cased, as
 * the server stores it), or `null` for anything else.
 * Accepts the relative path, or the same path absolutised by the browser
 * against this page's own origin (pasted HTML carries that form); every
 * other origin, scheme, kind, query string, fragment or trailing path is
 * refused. The kind-agnostic parser is `parseDocumentImageSrc` in `lib/`.
 */
export function documentImagePath(
  src: string | null | undefined,
  kind: DocumentImageKind,
): string | null {
  const ref = parseDocumentImageSrc(src);
  return ref && ref.kind === kind ? ref.path : null;
}

/** Whether `src` references a picture of this kind (see `documentImagePath`). */
export function isDocumentImageSrc(
  src: string | null | undefined,
  kind: DocumentImageKind,
): boolean {
  return documentImagePath(src, kind) !== null;
}

const tr = (key: string, opts?: Record<string, unknown>) =>
  String(i18n.t(`delivery:${key}`, opts as never));

/**
 * Why a file cannot become a picture, translated, or `null` when it may be
 * uploaded. Saves a round-trip only: the backend checks the bytes itself.
 */
export function imageRefusal(file: Pick<File, "type" | "size">): string | null {
  if (!DOCUMENT_IMAGE_MIME_TYPES.includes(file.type)) return tr("richText.imageInvalidType");
  if (file.size > MAX_DOCUMENT_IMAGE_BYTES) {
    return tr("richText.imageTooLarge", { size: MAX_DOCUMENT_IMAGE_MB });
  }
  return null;
}

/**
 * Whether clipboard HTML holds any text. A copy from Word or Excel carries
 * both its HTML and a rendered picture of the selection: that paste is text.
 * A browser's "Copy image" carries an `<img>` alone: that paste is the file.
 */
export function clipboardHtmlHasText(html: string): boolean {
  if (!html.trim()) return false;
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").trim() !== "";
}

/** Store a picture; the answer's `src` is what the document references. */
export function uploadDocumentImage(
  kind: DocumentImageKind,
  file: File,
): Promise<DocumentImageUpload> {
  return api.upload<DocumentImageUpload>(`/document-images/${kind}`, file, "file");
}
