/**
 * The one sanitiser for stored rich text — ADR sections, SoAW sections, a
 * portal's card description — and the reason there is exactly one.
 *
 * DOMPurify's default allowlist keeps `href` and `rel` but drops `target`, so
 * a bare `DOMPurify.sanitize(html)` renders every anchor as a same-tab link
 * and quietly discards the `target="_blank"` the editor wrote — and keeps far
 * more than the editor ever writes (`<style>`, forms, media, any inline
 * `style`). This wrapper does what every stored-HTML surface owes:
 *
 *   1. **Autolink** bare `http(s)://` addresses in text nodes (the same
 *      tokenizer free text uses, `lib/linkify.ts`), skipping text already
 *      inside an `<a>`. Documents written before the editor autolinked, and
 *      URLs pasted as plain text, become links when displayed.
 *   2. **Sanitise last**, so the anchors the autolinker created go through the
 *      same allowlist as the stored ones — one code path, one policy.
 *   3. **Stamp every anchor** `target="_blank" rel="noopener noreferrer"` when
 *      its href is http(s)/mailto, and strip the href otherwise. A stored
 *      `javascript:` or relative href never survives.
 *   4. **Keep a picture only when it is a document picture** — its `src` the
 *      internal `/api/v1/document-images/{adr|soaw}/{uuid}` route (UI SDK
 *      1.35) — reduced to the contract attributes in the contract order. Any
 *      other `<img>` (an external, `data:`, `blob:` or other-path one) is
 *      removed. No `loading="lazy"`: the print body goes through here, and a lazy
 *      picture below the fold prints blank.
 *   5. **Remove the tags the editor never writes** that style the page, load
 *      a resource, submit, navigate or overlay (`FORBIDDEN_TAGS`). A removed
 *      tag's words stay (a button's label, a form's paragraphs) except where
 *      they are not prose: CSS, a template, a media fallback, SVG and MathML
 *      go with their tag (DOMPurify's own `FORBID_CONTENTS`).
 *   6. **Remove the attributes that take a URL or open something**
 *      (`FORBIDDEN_ATTRIBUTES`): only an anchor's `href` and a document
 *      picture's `src` may name an address; `background`, `srcset` and the
 *      other attributes in the list are removed on every element.
 *   7. **Keep an inline `style` only in the shapes the table editor writes**,
 *      exactly as it writes them: a pixel `width` / `min-width` on `table` and
 *      `col`, a `text-align` on `td` and `th`. Any other `style`, on any
 *      element, is removed whole — never rewritten. DOMPurify's defaults keep
 *      any `style` value as written, so the shape check is the only test a
 *      `style` value gets.
 *   8. **Keep `colspan` / `rowspan` only as a whole number from 1 to 1000.**
 *      `colwidth` (the editor's model attribute) is not kept: display widths
 *      come from `<col style>`.
 *
 * It runs on a **private** DOMPurify instance: hooks are per instance, and
 * the SVG-thumbnail sanitisers (`ProcessNavigator`, `ProcessFlowTab`) must
 * not inherit an anchor hook, nor lose the SVG this policy removes. The
 * pre-sanitise walk is safe because a `DOMParser` document is inert — no
 * scripts run, no subresources load.
 */
import createDOMPurify from "dompurify";

import {
  parseDocumentImageAlign,
  parseDocumentImageDimension,
  parseDocumentImageSrc,
} from "./documentImageMarkup";
import { isLinkableHref, splitLinks } from "./linkify";

type Purifier = ReturnType<typeof createDOMPurify>;

let purifier: Purifier | null = null;

/**
 * Tags removed on top of DOMPurify's defaults (3.4.17). `iframe`, `object`,
 * `embed`, `link`, `meta` and `base` are not in the defaults at all.
 */
const FORBIDDEN_TAGS = [
  // Style sheets: the document is styled by the display rules
  // (`lib/documentContentCss.ts`), never by its own CSS.
  "style",
  // Submit or take input: none of them belongs in read-only text.
  "form",
  "input",
  "button",
  "select",
  "option",
  "optgroup",
  "datalist",
  "textarea",
  // Overlays the page (`<dialog open>`) or holds inert markup.
  "dialog",
  "template",
  // Load a resource.
  "video",
  "audio",
  "source",
  "track",
  "picture",
  // An image map's `area` is a link the anchor policy never sees.
  "map",
  "area",
  // Foreign content: an SVG `<image>` / `<use>` loads, MathML is not written.
  "svg",
  "math",
  "marquee",
];

/** Attributes removed on top of DOMPurify's defaults, on every element. */
const FORBIDDEN_ATTRIBUTES = [
  // Take a URL: a cell or table background, responsive picture sources, a
  // video poster, a form target, a quotation source, an image map.
  "action",
  "background",
  "cite",
  "formaction",
  "poster",
  "srcset",
  "usemap",
  // Colour a cell outside the document's look.
  "bgcolor",
  // Open a popover or invoke a command on another element.
  "popover",
  "popovertarget",
  "popovertargetaction",
  "command",
  "commandfor",
];

const SANITIZE_CONFIG = {
  ADD_ATTR: ["target"],
  FORBID_TAGS: FORBIDDEN_TAGS,
  FORBID_ATTR: FORBIDDEN_ATTRIBUTES,
};

/** `<table style>` / `<col style>` as the table extension writes it: `width: 150px`, `min-width: 25px`. */
const PIXEL_WIDTH_STYLE = /^(?:min-)?width: \d{1,5}px;?$/;

/** `<td style>` / `<th style>` as the table extension writes a cell's alignment. */
const CELL_ALIGN_STYLE = /^text-align: (?:left|center|right);?$/;

const STYLE_SHAPES = new Map<string, RegExp>([
  ["TABLE", PIXEL_WIDTH_STYLE],
  ["COL", PIXEL_WIDTH_STYLE],
  ["TD", CELL_ALIGN_STYLE],
  ["TH", CELL_ALIGN_STYLE],
]);

/** A cell span: a whole number from 1 to 1000, no sign, no leading zero. */
const SPAN_VALUE = /^[1-9]\d{0,3}$/;
const MAX_SPAN = 1000;

/**
 * Whether an attribute that passed DOMPurify's own allowlist may stay. The
 * value is DOMPurify's trimmed one; nothing is rewritten here.
 */
function keepsAttribute(tag: string, name: string, value: string): boolean {
  if (name === "style") return STYLE_SHAPES.get(tag)?.test(value) ?? false;
  if (name === "colspan" || name === "rowspan") {
    return SPAN_VALUE.test(value) && Number(value) <= MAX_SPAN;
  }
  return true;
}

/**
 * A mention of a card or decision the reader can open becomes a keyboard-
 * reachable link (`role="link"`, `tabindex="0"`); the preview navigates on it
 * with one delegated handler (`MentionContainer`). No href: the sanitiser
 * strips relative ones. A person, a restricted mention (no id) and a target
 * that is gone get neither, whatever the stored HTML claimed.
 */
function markMentionLink(node: Element): void {
  const kind = node.getAttribute("data-kind");
  const linkable =
    (kind === "card" || kind === "decision") &&
    Boolean(node.getAttribute("data-id")) &&
    node.getAttribute("data-restricted") !== "true" &&
    node.getAttribute("data-missing") !== "true";
  if (linkable) {
    node.setAttribute("role", "link");
    node.setAttribute("tabindex", "0");
  } else {
    node.removeAttribute("role");
    node.removeAttribute("tabindex");
  }
}

/**
 * A document picture reduced to `src alt title width height data-align`, in
 * that order, each kept only when valid; any other picture removed whole.
 * Rewriting from scratch keeps the output canonical, so a second pass is a
 * no-op.
 */
function keepDocumentImage(node: Element): void {
  const ref = parseDocumentImageSrc(node.getAttribute("src"));
  if (!ref) {
    node.remove();
    return;
  }
  const alt = node.getAttribute("alt");
  const title = node.getAttribute("title");
  const width = parseDocumentImageDimension(node.getAttribute("width"));
  const height = parseDocumentImageDimension(node.getAttribute("height"));
  const align = parseDocumentImageAlign(node.getAttribute("data-align"));
  for (const name of node.getAttributeNames()) node.removeAttribute(name);
  node.setAttribute("src", ref.path);
  if (alt !== null) node.setAttribute("alt", alt);
  if (title !== null) node.setAttribute("title", title);
  if (width !== null) node.setAttribute("width", String(width));
  if (height !== null) node.setAttribute("height", String(height));
  if (align !== null) node.setAttribute("data-align", align);
}

function getPurifier(): Purifier {
  if (purifier) return purifier;
  const p = createDOMPurify(window);
  p.addHook("uponSanitizeAttribute", (node, data) => {
    data.keepAttr = keepsAttribute(node.nodeName, data.attrName, data.attrValue);
  });
  p.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "SPAN" && node.getAttribute("data-type") === "mention") {
      markMentionLink(node);
      return;
    }
    if (node.nodeName === "IMG") {
      keepDocumentImage(node);
      return;
    }
    if (node.nodeName !== "A") return;
    // Stryker disable next-line StringLiteral: an absent href is unlinkable whatever it defaults to
    const href = node.getAttribute("href") ?? "";
    if (!isLinkableHref(href)) {
      node.removeAttribute("href");
      node.removeAttribute("target");
      node.removeAttribute("rel");
      return;
    }
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  });
  purifier = p;
  return p;
}

/** Wrap bare URLs found in text nodes that are not already inside an anchor. */
function autolinkTextNodes(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  // Collect first: replacing a node while the walker is on it skips its
  // successors.
  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    // Stryker disable next-line OptionalChaining: a text node under <body> always has a parent element
    if (t.parentElement?.closest("a")) continue;
    targets.push(t);
  }
  for (const t of targets) {
    // A node with no link rebuilds as one identical text node.
    const frag = doc.createDocumentFragment();
    for (const tok of splitLinks(t.data)) {
      if (tok.type === "text") {
        frag.append(doc.createTextNode(tok.value));
      } else {
        const a = doc.createElement("a");
        a.setAttribute("href", tok.href);
        a.textContent = tok.value;
        frag.append(a);
      }
    }
    t.replaceWith(frag);
  }
  return doc.body.innerHTML;
}

/**
 * Sanitised HTML for `dangerouslySetInnerHTML`, with every link opening in a
 * new tab and every bare URL linked. Empty input gives `""`.
 */
export function sanitizeRichHtml(html: string | null | undefined): string {
  if (!html) return "";
  return getPurifier().sanitize(autolinkTextNodes(html), SANITIZE_CONFIG);
}
