/**
 * Whether a stored rich-text section has anything to show — the one check
 * the print view, the Word exports and the SoAW preview use to decide whether
 * a section (and its heading) appears at all.
 */
import { parseDocumentImageSrc } from "./documentImageMarkup";

// A restricted or deleted mention is stored empty; every surface writes the
// reader's words into it (`fillMentionLabels`), so it is content.
const LABELLED_MENTION =
  'span[data-type="mention"][data-restricted="true"], span[data-type="mention"][data-missing="true"]';

/**
 * True when the HTML has visible text, a document picture (either kind's
 * internal route — any other picture is removed by the sanitiser, so it does
 * not count), or a restricted / deleted mention. Blank markup is not content.
 */
export function richHtmlHasContent(html: string | null | undefined): boolean {
  if (!html) return false;
  const body = new DOMParser().parseFromString(html, "text/html").body;
  if ((body.textContent ?? "").trim()) return true;
  for (const img of Array.from(body.querySelectorAll("img"))) {
    if (parseDocumentImageSrc(img.getAttribute("src"))) return true;
  }
  return body.querySelector(LABELLED_MENTION) !== null;
}
