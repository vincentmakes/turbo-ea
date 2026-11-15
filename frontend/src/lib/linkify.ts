/**
 * Bare-URL detection for free text.
 *
 * A description, a comment, a risk note or a status report is plain text
 * the user typed; when it carries a web address the reader expects to click
 * it. This module finds those addresses and nothing else — it never turns
 * text into HTML, so there is no injection surface: the renderer
 * (`components/LinkifiedText.tsx`) maps the tokens to React elements, and
 * the HTML path (`lib/richHtml.ts`) builds DOM nodes from them.
 *
 * Detection is deliberately narrow: only `http://` and `https://`. That is
 * the allowlist a `url`-typed attribute already enforces (`ALLOWED_URL_SCHEMES`
 * in `cardDetailUtils.tsx`, `_ALLOWED_URL_SCHEMES` on the backend) and it
 * produces no false positives on `e.g.`, file names or `www.` fragments. A
 * `javascript:` or `data:` URI can never become a link, whatever the text.
 */

export type LinkToken =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

// The patterns below are written where they are used rather than as module
// constants: a module-level value is built while the file loads, outside any
// test, so a mutation test cannot tell which test checks it.

/**
 * What an `href` may be once it exists — on a stored anchor or a `url`-typed
 * value. `mailto:` is allowed here (the url field accepts it) but is never
 * *detected* in prose; see `splitLinks`.
 */
export function isLinkableHref(href: string): boolean {
  return /^(?:https?:\/\/|mailto:)/i.test(href.trim());
}

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/**
 * Split a raw match into the URL proper and the punctuation that followed it.
 * A closing `)` or `]` is only dropped when unbalanced, so a Wikipedia-style
 * `…/Foo_(bar)` keeps its bracket while `(see https://x.io)` does not swallow
 * the sentence's own.
 */
function trimTrailing(raw: string): [url: string, rest: string] {
  let url = raw;
  for (;;) {
    // A match starts with its scheme, which trimming never reaches, so `url`
    // is never emptied.
    const last = url[url.length - 1];
    if (".,;:!?".includes(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === ")" && count(url, "(") < count(url, ")")) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === "]" && count(url, "[") < count(url, "]")) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return [url, raw.slice(url.length)];
}

/** True when the match is nothing but a scheme (`https://`). */
function isBareScheme(url: string): boolean {
  return /^https?:\/\/$/i.test(url);
}

/**
 * Tokenise `text` into text runs and links. Text with no link comes back as
 * exactly one text token whose value is the input itself — callers rely on
 * that to take a fast path.
 */
export function splitLinks(text: string): LinkToken[] {
  const lower = text.toLowerCase();
  // Without a scheme the scan below finds nothing. For non-empty text it
  // would build this same single token; for "" it would build none, so this
  // branch is also what keeps the one-token contract above.
  if (!lower.includes("http://") && !lower.includes("https://")) {
    return [{ type: "text", value: text }];
  }

  const tokens: LinkToken[] = [];
  let cursor = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const prev = tokens[tokens.length - 1];
    if (prev && prev.type === "text") prev.value += value;
    else tokens.push({ type: "text", value });
  };

  // A scheme at a word boundary, running to whitespace, an angle bracket, a
  // quote or a backtick. Trailing punctuation is trimmed afterwards — the
  // pattern stays a single greedy class so it cannot backtrack
  // catastrophically on a very long URL.
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"'`]+/gi)) {
    const start = m.index ?? 0;
    const [url, rest] = trimTrailing(m[0]);
    pushText(text.slice(cursor, start));
    if (isBareScheme(url)) {
      pushText(m[0]);
    } else {
      tokens.push({ type: "link", value: url, href: url });
      pushText(rest);
    }
    cursor = start + m[0].length;
  }
  pushText(text.slice(cursor));
  return tokens;
}

/** True when `splitLinks` would find at least one link. */
export function hasLink(text: string): boolean {
  return splitLinks(text).some((t) => t.type === "link");
}

/**
 * What a link may point to once it is stored in rich text: an `http://`,
 * `https://` or `mailto:` address with no space or control character in it.
 * This is exactly the server's comment rule (`safe_href` in
 * `document_discussion_service.py`): a link the server would refuse in a
 * comment is shown there as escaped markup, and the sanitiser strips any
 * other href at render time anyway. The editor's Link extension uses it, so
 * a stored `ftp:`, `tel:` or relative anchor loads as plain text.
 *
 * Narrower than `isLinkableHref`, which trims and does not look past the
 * scheme: that one decides what to *show* as a link, this one what to *keep*.
 */
export function isStorableHref(href: unknown): boolean {
  if (typeof href !== "string") return false;
  // The control characters are the point: the server's `[\x00-\x20\x7f]`.
  // eslint-disable-next-line no-control-regex
  return /^(?:https?:\/\/|mailto:)/i.test(href) && !/[\x00-\x20\x7f]/.test(href);
}

/**
 * What someone typed into the link dialog, as the href to store, or `null`
 * when it cannot be one.
 *
 * - Surrounding space is trimmed; any space or control character inside
 *   refuses the input (an address has none, a sentence does).
 * - `http://`, `https://` and `mailto:` are kept as typed (case included),
 *   provided something follows them (`https://` or `mailto:` alone is refused,
 *   and so is `https:example.com`, which has no `//`).
 * - Any other scheme (`javascript:`, `data:`, `ftp:`, `tel:`, `file:`, …) is
 *   refused.
 * - An e-mail address without a scheme (`ann@example.com`) gets `mailto:`.
 * - A host without a scheme gets `https://`: a dotted name ending in a
 *   letter label (`example.com`, `www.x.io`, `example.com/path?q#f`), an IPv4
 *   address, or `localhost`, each with an optional `:port`. `localhost:3000`
 *   is a host and port, not a scheme.
 * - Anything else (`hello`, `/path`, `#anchor`, `//example.com`, `./x`) is
 *   refused: a relative link would point into the app itself.
 */
export function normaliseLinkHref(input: string): string | null {
  const value = input.trim();
  // Control characters are left to the final check.
  if (!value || /\s/u.test(value)) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):(?!\d+(?:[/?#]|$))/i.exec(value);
  let href: string | null = null;
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (/^https?:\/\/[^/?#]/i.test(value)) href = value;
    else if (name === "mailto" && value.length > "mailto:".length) href = value;
  } else if (/^[^@/?#:]+@(?:[\p{L}\p{N}-]+\.)+\p{L}[\p{L}\p{N}-]*$/u.test(value)) {
    href = `mailto:${value}`;
  } else if (
    /^(?:(?:[\p{L}\p{N}-]+\.)+\p{L}[\p{L}\p{N}-]*|localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?(?:[/?#].*)?$/iu.test(
      value,
    )
  ) {
    href = `https://${value}`;
  }
  return isStorableHref(href) ? href : null;
}
