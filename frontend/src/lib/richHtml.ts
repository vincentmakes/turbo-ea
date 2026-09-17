/**
 * The one sanitiser for stored rich text — ADR sections, SoAW sections, a
 * portal's card description — and the reason there is exactly one.
 *
 * DOMPurify's default allowlist keeps `href` and `rel` but drops `target`, so
 * a bare `DOMPurify.sanitize(html)` renders every anchor as a same-tab link
 * and quietly discards the `target="_blank"` the editor wrote. This wrapper
 * does three things every stored-HTML surface owes:
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
 *
 * It runs on a **private** DOMPurify instance: hooks are per instance, and
 * the SVG-thumbnail sanitisers (`ProcessNavigator`, `ProcessFlowTab`) must
 * not inherit an anchor hook. The pre-sanitise walk is safe because a
 * `DOMParser` document is inert — no scripts run, no subresources load.
 */
import createDOMPurify from "dompurify";

import { LINKABLE_HREF, splitLinks } from "./linkify";

type Purifier = ReturnType<typeof createDOMPurify>;

let purifier: Purifier | null = null;

function getPurifier(): Purifier {
  if (purifier) return purifier;
  const p = createDOMPurify(window);
  p.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName !== "A") return;
    const href = node.getAttribute("href") ?? "";
    if (!LINKABLE_HREF.test(href.trim())) {
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
    if (t.parentElement?.closest("a")) continue;
    targets.push(t);
  }
  for (const t of targets) {
    const tokens = splitLinks(t.data);
    if (tokens.length === 1 && tokens[0].type === "text") continue;
    const frag = doc.createDocumentFragment();
    for (const tok of tokens) {
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
  return getPurifier().sanitize(autolinkTextNodes(html), { ADD_ATTR: ["target"] });
}
