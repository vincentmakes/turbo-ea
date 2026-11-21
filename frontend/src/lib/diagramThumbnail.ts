/**
 * The `src` for a diagram's stored thumbnail.
 *
 * DrawIO's SVG export hands the editor a `data:image/svg+xml;base64,…` URI,
 * but a thumbnail written through the API or the tool server can be the raw
 * SVG markup. A raw SVG is turned into a percent-encoded data URI, which is
 * safe for any character (`btoa` throws on text outside Latin-1, so a diagram
 * labelled in Chinese or Arabic would break the page).
 *
 * The result is only ever an `<img src>`: an SVG shown as an image runs no
 * script and loads nothing, so a thumbnail is never inlined as markup.
 */

const DATA_IMAGE = /^data:image\//i;
const SVG_TAG = /<svg[\s>]/i;

/** A data URI for `thumbnail`, or `null` when there is nothing to show. */
export function diagramThumbnailSrc(thumbnail: string | null | undefined): string | null {
  if (typeof thumbnail !== "string") return null;
  const value = thumbnail.trim();
  if (DATA_IMAGE.test(value)) return value;
  if (value.startsWith("<") && SVG_TAG.test(value)) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value)}`;
  }
  return null;
}
